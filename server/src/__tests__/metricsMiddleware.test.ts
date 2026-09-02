// Metrics middleware — regression locks from the 2026-09-02 scale audit.
//
// Three defects, all invisible at one-request-at-a-time and all
// load-bearing at 100k users:
//
//   1. `await next()` had no try/finally, so a THROWN error skipped
//      `decrementActive()`. `activeRequests` — the saturation gauge —
//      climbed by one per thrown error and never came back down.
//   2. The same missing catch skipped `record()`, so thrown errors were
//      invisible to `citrus_http_error_rate`, the metric an alert rule
//      keys on. `app.onError` converts throws into returned 500s, but it
//      runs AFTER this middleware has already been passed over.
//   3. Route keys came from `c.req.path` through a normalizer that
//      collapses UUIDs and numeric ids and nothing else. Free-text path
//      params — `/api/account/check-username/:username`, which is
//      UNAUTHENTICATED — minted a permanent Map entry per distinct
//      value, in a process meant to stay up for a season.

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { metrics, metricsMiddleware, MAX_ROUTE_KEYS, OVERFLOW_ROUTE_KEY } from '../middleware/metrics';

function appWith(register: (app: Hono) => void): Hono {
  const app = new Hono();
  app.use('/api/*', metricsMiddleware);
  register(app);
  app.onError((_err, c) => c.json({ error: 'boom' }, 500));
  return app;
}

describe('metricsMiddleware', () => {
  beforeEach(() => {
    metrics.reset();
  });

  it('records a successful request under its registered route pattern', async () => {
    const app = appWith((a) => a.get('/api/leagues/:leagueId', (c) => c.json({ ok: true })));

    const res = await app.request('/api/leagues/8f14e45f-ceea-467a-9f34-1a2b3c4d5e6f');
    expect(res.status).toBe(200);

    const snap = metrics.getSnapshot();
    expect(snap.totalRequests).toBe(1);
    expect(snap.routes['GET /api/leagues/:leagueId']).toBeDefined();
    expect(snap.routes['GET /api/leagues/:leagueId'].requests).toBe(1);
  });

  // Defect 1.
  it('does not leak activeRequests when a handler throws', async () => {
    const app = appWith((a) =>
      a.get('/api/boom', () => {
        throw new Error('handler exploded');
      }),
    );

    for (let i = 0; i < 25; i++) {
      const res = await app.request('/api/boom');
      expect(res.status).toBe(500);
    }

    expect(metrics.getSnapshot().activeRequests).toBe(0);
  });

  // Defect 2.
  it('counts a thrown error as a 5xx so the error-rate metric can see it', async () => {
    const app = appWith((a) =>
      a.get('/api/boom', () => {
        throw new Error('handler exploded');
      }),
    );

    await app.request('/api/boom');

    const snap = metrics.getSnapshot();
    expect(snap.totalRequests).toBe(1);
    expect(snap.totalErrors).toBe(1);
    expect(snap.errorRate).toBe('100.00%');
    expect(snap.routes['GET /api/boom'].errors).toBe(1);

    // And the Prometheus text carries the same number, since that is
    // what a scraper and any alert rule actually read.
    expect(metrics.toPrometheusText()).toContain('citrus_http_errors_total 1');
  });

  it('rethrows so app.onError still owns the response', async () => {
    const app = appWith((a) =>
      a.get('/api/boom', () => {
        throw new Error('handler exploded');
      }),
    );

    const res = await app.request('/api/boom');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'boom' });
  });

  // Defect 3.
  it('keys a free-text path param on its route pattern, not the value', async () => {
    const app = appWith((a) =>
      a.get('/api/account/check-username/:username', (c) => c.json({ available: true })),
    );

    for (let i = 0; i < 200; i++) {
      await app.request(`/api/account/check-username/user_${i}`);
    }

    const snap = metrics.getSnapshot();
    // One key for two hundred distinct usernames.
    expect(Object.keys(snap.routes)).toEqual(['GET /api/account/check-username/:username']);
    expect(snap.routes['GET /api/account/check-username/:username'].requests).toBe(200);
  });

  it('caps distinct route keys and folds the overflow into one bucket', async () => {
    // Belt-and-braces: even if a future route escapes `routePath`, the
    // map must not grow without bound.
    // Non-numeric segments on purpose — `normalizePath` collapses `/123`
    // to `/:n`, which is exactly the class of key that was never the
    // problem. The unbounded ones are free-text.
    const OVERFLOW = 50;
    for (let i = 0; i < MAX_ROUTE_KEYS + OVERFLOW; i++) {
      metrics.record('GET', `/api/synthetic/name_${i}/x`, 200, 5);
    }

    const snap = metrics.getSnapshot();
    // MAX_ROUTE_KEYS real keys plus the single overflow bucket.
    expect(Object.keys(snap.routes).length).toBeLessThanOrEqual(MAX_ROUTE_KEYS + 1);
    expect(snap.routes[OVERFLOW_ROUTE_KEY]).toBeDefined();
    expect(snap.routes[OVERFLOW_ROUTE_KEY].requests).toBe(OVERFLOW);
    // Totals stay honest — nothing is dropped, only relabelled.
    expect(snap.totalRequests).toBe(MAX_ROUTE_KEYS + OVERFLOW);
  });
});

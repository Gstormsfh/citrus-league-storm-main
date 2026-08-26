/**
 * Each rate limiter must count against its OWN budget.
 *
 * THE BUG (found 2026-08-26 from a device report of "Stormy is down").
 * ipBuckets/userBuckets are module-level and were keyed on the IP alone, with
 * no per-limiter namespace. Every limiter incremented and read the same
 * counter, then compared it to its own, very different ceiling:
 *
 *   app.use('/api/*',           standardRateLimit)  // 600/min
 *   app.use('/api/stormy/*',    aiRateLimit)        //  30/min
 *   app.use('/api/auth/signup', authRateLimit)      //   5/min
 *
 * standardRateLimit runs on every API call, so ordinary use filled the shared
 * counter for everyone. A single Matchup render issues ~102 requests (measured
 * on device). Within the same 60s window after that, Stormy compared 103
 * against 30 and refused, and SIGN-UP compared 103 against 5 and refused — so
 * a new user who looked around the app for a few seconds could not create an
 * account, and was told only "Too many requests."
 *
 * These tests drive the middleware directly with a stub Context rather than
 * booting the app: the buckets are module state, and what needs pinning is
 * that traffic through one limiter cannot exhaust another.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rateLimitMiddleware } from '../middleware/rateLimit';

/** Minimal stand-in for the slice of Hono's Context the middleware touches. */
function ctx(ip: string, userId?: string) {
  const headers: Record<string, string> = {};
  return {
    req: { header: (h: string) => (h === 'x-forwarded-for' ? ip : undefined) },
    header: (k: string, v: string) => {
      headers[k] = v;
    },
    get: (k: string) => (k === 'userId' ? userId : undefined),
    json: (body: unknown, status: number) => ({ __status: status, body }),
  } as never;
}

/** Returns the HTTP status the middleware produced, or 200 if it called next(). */
async function hit(mw: ReturnType<typeof rateLimitMiddleware>, ip: string, userId?: string) {
  let passed = false;
  const res = (await mw(ctx(ip, userId), async () => {
    passed = true;
  })) as { __status?: number } | undefined;
  return passed ? 200 : (res?.__status ?? 0);
}

const IP = '203.0.113.7';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-26T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a limiter enforces its own ceiling', () => {
  it('allows up to the limit and refuses past it', async () => {
    const mw = rateLimitMiddleware({ name: `solo-${Math.random()}`, maxRequests: 3, perUser: false });

    expect(await hit(mw, IP)).toBe(200);
    expect(await hit(mw, IP)).toBe(200);
    expect(await hit(mw, IP)).toBe(200);
    expect(await hit(mw, IP)).toBe(429);
  });

  it('recovers once the window passes', async () => {
    const mw = rateLimitMiddleware({ name: `window-${Math.random()}`, maxRequests: 1, windowMs: 60_000, perUser: false });

    expect(await hit(mw, IP)).toBe(200);
    expect(await hit(mw, IP)).toBe(429);

    vi.advanceTimersByTime(60_001);

    expect(await hit(mw, IP)).toBe(200);
  });
});

describe('limiters do not share a budget — the regression guard', () => {
  it('heavy standard traffic does not lock out sign-up', async () => {
    // The production shape: standardRateLimit on /api/*, authRateLimit on
    // /api/auth/signup, same IP. Before namespacing, 102 ordinary API calls
    // (one Matchup render) made the 6th of them fail the auth check.
    const standard = rateLimitMiddleware({ name: 'standard', maxRequests: 600, maxUserRequests: 1200 });
    const auth = rateLimitMiddleware({ name: 'auth', maxRequests: 5, windowMs: 60_000, perUser: false });

    for (let i = 0; i < 102; i++) {
      expect(await hit(standard, IP, 'user-1')).toBe(200);
    }

    // Sign-up must still be available to this person.
    expect(await hit(auth, IP)).toBe(200);
  });

  it('heavy standard traffic does not silence Stormy', async () => {
    const standard = rateLimitMiddleware({ name: 'standard', maxRequests: 600, maxUserRequests: 1200 });
    const ai = rateLimitMiddleware({ name: 'ai', maxRequests: 30, maxUserRequests: 20, windowMs: 60_000 });

    for (let i = 0; i < 102; i++) {
      expect(await hit(standard, IP, 'user-1')).toBe(200);
    }

    expect(await hit(ai, IP, 'user-1')).toBe(200);
  });

  it('exhausting one limiter leaves the others untouched', async () => {
    const a = rateLimitMiddleware({ name: `a-${Math.random()}`, maxRequests: 1, perUser: false });
    const b = rateLimitMiddleware({ name: `b-${Math.random()}`, maxRequests: 1, perUser: false });

    expect(await hit(a, IP)).toBe(200);
    expect(await hit(a, IP)).toBe(429);

    expect(await hit(b, IP)).toBe(200);
  });

  it('separates per-user budgets by limiter too, not just per-IP', async () => {
    const a = rateLimitMiddleware({ name: `ua-${Math.random()}`, maxRequests: 999, maxUserRequests: 1 });
    const b = rateLimitMiddleware({ name: `ub-${Math.random()}`, maxRequests: 999, maxUserRequests: 1 });

    expect(await hit(a, IP, 'user-9')).toBe(200);
    expect(await hit(a, IP, 'user-9')).toBe(429);

    expect(await hit(b, IP, 'user-9')).toBe(200);
  });
});

describe('different callers stay independent', () => {
  it('one IP exhausting its budget does not affect another', async () => {
    const mw = rateLimitMiddleware({ name: `ips-${Math.random()}`, maxRequests: 1, perUser: false });

    expect(await hit(mw, '198.51.100.1')).toBe(200);
    expect(await hit(mw, '198.51.100.1')).toBe(429);
    expect(await hit(mw, '198.51.100.2')).toBe(200);
  });
});

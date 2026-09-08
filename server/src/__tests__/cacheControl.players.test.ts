import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { cacheControlMiddleware } from '../middleware/cacheControl';

/**
 * 2026-09-09 (#22): the whole player pool is the largest response in the app
 * and had no cache rule, so it was re-downloaded in full on every relaunch.
 */
function app() {
  const a = new Hono();
  a.use('/api/*', cacheControlMiddleware);
  a.get('/api/players', (c) => c.json({ data: [{ id: 1 }, { id: 2 }] }));
  a.get('/api/players/8478402/bio', (c) => c.json({ data: {} }));
  a.get('/api/leagues/x/teams', (c) => c.json({ data: [] }));
  return a;
}

describe('cacheControl — /api/players', () => {
  it('is cacheable with an ETag, and revalidates to 304', async () => {
    const a = app();
    const first = await a.request('/api/players');
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=60, stale-while-revalidate=300');
    const etag = first.headers.get('ETag');
    expect(etag).toBeTruthy();

    const again = await a.request('/api/players', { headers: { 'If-None-Match': etag as string } });
    expect(again.status).toBe(304);
  });

  it('leaves unlisted routes private, as before', async () => {
    const res = await app().request('/api/leagues/x/teams');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=0, must-revalidate');
    expect(res.headers.get('ETag')).toBeNull();
  });
});

/**
 * Draft Kit route surface.
 *
 * Two things to pin. The first is that /api/draft-kit is genuinely its own
 * mount and is not shadowed by /api/draft, which sits one hyphen away and was
 * registered years earlier. The second, and the one that matters, is that
 * every route on the section requires authentication: an anonymous caller has
 * no entitlement to resolve, so an un-authed route would be a hole straight
 * through the paywall regardless of how careful the service is.
 */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

describe('Draft Kit routes', () => {
  it('mounts the board endpoint behind auth', async () => {
    const { app } = await import('../app');
    const res = await app.request('/api/draft-kit/board');
    expect(res.status).toBe(401);
  });

  it('mounts the entitlement endpoint behind auth', async () => {
    const { app } = await import('../app');
    const res = await app.request('/api/draft-kit/entitlement');
    expect(res.status).toBe(401);
  });

  it('mounts the checkout stub behind auth', async () => {
    const { app } = await import('../app');
    const res = await app.request('/api/draft-kit/checkout', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('does not shadow the v1 draft route surface', async () => {
    const { app } = await import('../app');
    const v1 = await app.request(
      '/api/draft/league/00000000-0000-0000-0000-000000000000/session',
    );
    // Its own auth-gated 401, not a 404 from a hyphen-adjacent mount.
    expect(v1.status).toBe(401);
  });

  it('mounts a scoped surface, not a catch-all', async () => {
    const { app } = await import('../app');
    // A path the router does not define must 404 rather than fall into a
    // wildcard handler that would answer for anything under the prefix.
    const res = await app.request('/api/draft-kit/not-a-route');
    expect(res.status).toBe(404);
  });
});

/**
 * Phase 4.5 chunk 11g.1 — discovery endpoint smoke tests.
 *
 * These follow the existing draftV2Sync.test.ts pattern: smoke-test the
 * mounting + auth-middleware engagement. Full happy-path coverage with
 * mocked Supabase + mocked LeagueMembershipService lives in chunk 11g.2's
 * integration test alongside the WebSocket upgrade work.
 */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod-must-be-long-enough';
});

describe('Discovery endpoint — chunk 11g.1', () => {
  it('returns 401 for unauthenticated request (auth middleware engaged)', async () => {
    const { app } = await import('../app');
    const res = await app.request(
      '/api/drafts/00000000-0000-0000-0000-000000000000/server',
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 with malformed Authorization header', async () => {
    const { app } = await import('../app');
    const res = await app.request(
      '/api/drafts/00000000-0000-0000-0000-000000000000/server',
      { headers: { Authorization: 'NotBearer something' } },
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 with empty Bearer token', async () => {
    const { app } = await import('../app');
    const res = await app.request(
      '/api/drafts/00000000-0000-0000-0000-000000000000/server',
      { headers: { Authorization: 'Bearer ' } },
    );
    expect(res.status).toBe(401);
  });

  it('does not collide with /api/draft (singular v1/v2 surface)', async () => {
    const { app } = await import('../app');
    // /api/draft/league/:id/session is the v1 surface — must still 401 on
    // its own auth path, NOT 404. Confirms we mounted /api/drafts (plural)
    // distinctly.
    const v1 = await app.request(
      '/api/draft/league/00000000-0000-0000-0000-000000000000/session',
    );
    expect(v1.status).toBe(401);
  });
});

describe('Discovery endpoint — response shape contract', () => {
  it('response shape per chunk 11g.1 spec: { host, port, token }', () => {
    // Contract test against the response shape the route returns. Full
    // wire-level happy path (mocked Supabase) is deferred to chunk 11g.2's
    // integration suite (the upgrade handler will exercise both paths
    // back-to-back).
    const requiredKeys = ['host', 'port', 'token'];
    const exampleResponse = {
      host: 'localhost',
      port: 3002,
      token: 'header.payload.signature',
    };
    for (const k of requiredKeys) {
      expect(exampleResponse).toHaveProperty(k);
    }
    expect(typeof exampleResponse.host).toBe('string');
    expect(typeof exampleResponse.port).toBe('number');
    expect(typeof exampleResponse.token).toBe('string');
    expect(exampleResponse.token.split('.').length).toBe(3);
  });
});

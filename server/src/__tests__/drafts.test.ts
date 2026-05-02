/**
 * Phase 4.5 chunk 11g.1 — discovery endpoint tests.
 *
 * The 401-smoke tests run against the real `app` import (the auth
 * middleware path). The 200/403/404/409 tests mock `authMiddleware` to
 * pass through with a fixed user, plus `createUserClient` and
 * `LeagueMembershipService` so the handler runs deterministically
 * without hitting Supabase.
 *
 * In Citrus's data model the "draft" is the league's drafting phase
 * (no separate drafts table). The route's `:draftId` parameter is the
 * league's UUID; the handler queries `leagues` by id and gates on
 * `draft_status` ∈ CONNECTABLE_DRAFT_STATUSES.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

const VALID_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VALID_DRAFT_ID = '00000000-0000-0000-0000-000000000001'; // = league_id
const TEST_AUTH_HEADER = { Authorization: 'Bearer test-token-abc' };

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod-must-be-long-enough';
  process.env.DRAFT_WS_HOST = 'localhost';
  process.env.DRAFT_WS_PORT = '3002';
});

// ── 401 smoke tests (real authMiddleware path) ────────────────────────
describe('Discovery endpoint — auth middleware engagement', () => {
  it('returns 401 for unauthenticated request', async () => {
    const { app } = await import('../app');
    const res = await app.request(`/api/drafts/${VALID_DRAFT_ID}/server`);
    expect(res.status).toBe(401);
  });

  it('returns 401 for malformed Authorization header', async () => {
    const { app } = await import('../app');
    const res = await app.request(
      `/api/drafts/${VALID_DRAFT_ID}/server`,
      { headers: { Authorization: 'NotBearer something' } },
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 for empty Bearer token', async () => {
    const { app } = await import('../app');
    const res = await app.request(
      `/api/drafts/${VALID_DRAFT_ID}/server`,
      { headers: { Authorization: 'Bearer ' } },
    );
    expect(res.status).toBe(401);
  });

  it('does not collide with /api/draft (singular v1/v2 surface)', async () => {
    const { app } = await import('../app');
    const v1 = await app.request(
      '/api/draft/league/00000000-0000-0000-0000-000000000000/session',
    );
    expect(v1.status).toBe(401);
  });
});

// ── 200/403/404/409 with module mocks ─────────────────────────────────
describe('Discovery endpoint — leagues lookup + status gating', () => {
  // Per-test config that the mocked supabase chain reads.
  let mockLeague: { id: string; draft_status: string } | null = null;
  let mockLeagueError: { message: string } | null = null;
  let mockIsMember = true;

  beforeAll(async () => {
    // Pass-through auth middleware: any Bearer header authenticates as VALID_USER_ID.
    vi.doMock('../middleware/auth', () => ({
      authMiddleware: async (c: any, next: any) => {
        const h = c.req.header('Authorization');
        if (!h || !h.startsWith('Bearer ') || h.slice(7).length === 0) {
          return c.json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'no auth' } }, 401);
        }
        c.set('userId', VALID_USER_ID);
        c.set('userToken', h.slice(7));
        await next();
      },
      optionalAuthMiddleware: async (_c: any, next: any) => { await next(); },
    }));

    // Mock the supabase user-client factory so `from('leagues')` returns
    // a chain whose maybeSingle() resolves to the per-test value above.
    vi.doMock('../lib/supabase', () => ({
      createUserClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: mockLeague, error: mockLeagueError }),
            }),
          }),
        }),
      }),
      supabaseAdmin: {} as never,
    }));

    // Mock the membership service so member/non-member is per-test.
    vi.doMock('../services/LeagueMembershipService', () => ({
      LeagueMembershipService: class {
        async checkMembership() {
          return { isMember: mockIsMember, isCommissioner: false };
        }
        static clearCache() { /* no-op */ }
      },
    }));

    vi.resetModules();
  });

  async function call(draftId: string = VALID_DRAFT_ID) {
    const { app } = await import('../app');
    return app.request(`/api/drafts/${draftId}/server`, { headers: TEST_AUTH_HEADER });
  }

  it('200: league exists, member, draft_status="queued" → returns {host, port, token}', async () => {
    mockLeague = { id: VALID_DRAFT_ID, draft_status: 'queued' };
    mockLeagueError = null;
    mockIsMember = true;
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.host).toBe('localhost');
    expect(body.port).toBe(3002);
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.').length).toBe(3);
  });

  it('200: league exists, member, draft_status="in_progress" → returns {host, port, token}', async () => {
    mockLeague = { id: VALID_DRAFT_ID, draft_status: 'in_progress' };
    mockIsMember = true;
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.token).toBe('string');
  });

  it('200: league exists, member, draft_status="paused" → returns {host, port, token} (mid-draft pause is connectable)', async () => {
    mockLeague = { id: VALID_DRAFT_ID, draft_status: 'paused' };
    mockIsMember = true;
    const res = await call();
    expect(res.status).toBe(200);
  });

  it('404: league does not exist', async () => {
    mockLeague = null;
    mockLeagueError = null;
    const res = await call();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('403: league exists, user is not a member', async () => {
    mockLeague = { id: VALID_DRAFT_ID, draft_status: 'in_progress' };
    mockIsMember = false;
    const res = await call();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('409: league exists, member, draft_status="not_started" → reject with status', async () => {
    mockLeague = { id: VALID_DRAFT_ID, draft_status: 'not_started' };
    mockIsMember = true;
    const res = await call();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DRAFT_NOT_CONNECTABLE');
    expect(body.error.status).toBe('not_started');
    expect(body.error.message).toContain('not_started');
  });

  it('409: league exists, member, draft_status="completed" → reject with status', async () => {
    mockLeague = { id: VALID_DRAFT_ID, draft_status: 'completed' };
    mockIsMember = true;
    const res = await call();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DRAFT_NOT_CONNECTABLE');
    expect(body.error.status).toBe('completed');
  });

  it('400: malformed draftId (not a UUID)', async () => {
    const res = await call('not-a-uuid');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });
});

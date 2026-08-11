/**
 * E104 FENCE-2 (2026-08-11) — draftV2Era endpoint tests.
 *
 * GET /api/draft/v2/league/:leagueId/era → { v2Era: boolean }
 *
 * Contract under test:
 *   - 401 for unauthenticated request (auth middleware guards)
 *   - 400 for malformed leagueId (not a UUID)
 *   - 200 { v2Era: true } when draft_events has ≥1 row for the league
 *   - 200 { v2Era: false } when draft_events has 0 rows
 *   - 500 on service-role query failure (logs + responds cleanly)
 *   - Auth-only (no membership check) — the fence needs an
 *     authoritative answer regardless of caller's league membership
 *
 * Mock strategy mirrors drafts.test.ts:
 *   - Pass-through authMiddleware requiring Bearer header
 *   - Mock getSupabaseAdmin() to return a fluent-chain that resolves
 *     to configurable {data, error} per test
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

const VALID_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VALID_LEAGUE_ID = '00000000-0000-0000-0000-000000000001';
const TEST_AUTH_HEADER = { Authorization: 'Bearer test-token-abc' };

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod-must-be-long-enough';
});

// ── 401 smoke: real authMiddleware path ─────────────────────────────
describe('E104 draftV2Era — auth middleware engagement', () => {
  it('returns 401 for unauthenticated request', async () => {
    const { app } = await import('../app');
    const res = await app.request(`/api/draft/v2/league/${VALID_LEAGUE_ID}/era`);
    expect(res.status).toBe(401);
  });

  it('returns 401 for malformed Authorization header', async () => {
    const { app } = await import('../app');
    const res = await app.request(
      `/api/draft/v2/league/${VALID_LEAGUE_ID}/era`,
      { headers: { Authorization: 'NotBearer something' } },
    );
    expect(res.status).toBe(401);
  });
});

// ── Contract tests with mocked auth + admin client ──────────────────
describe('E104 draftV2Era — era probe contract', () => {
  let mockProbeResult: { data: Array<{ id: number }> | null; error: { message: string } | null } = {
    data: null,
    error: null,
  };

  beforeAll(async () => {
    // Pass-through auth middleware: any Bearer header authenticates
    // as VALID_USER_ID. Non-member OK (era endpoint is auth-only, no
    // membership gate — the fence needs an authoritative answer
    // regardless of the caller's relationship to the league).
    vi.doMock('../middleware/auth', () => ({
      authMiddleware: async (c: any, next: any) => {
        const h = c.req.header('Authorization');
        if (!h || !h.startsWith('Bearer ') || h.slice(7).length === 0) {
          return c.json(
            { error: { code: 'AUTHENTICATION_REQUIRED', message: 'no auth' } },
            401,
          );
        }
        c.set('userId', VALID_USER_ID);
        c.set('userToken', h.slice(7));
        await next();
      },
      optionalAuthMiddleware: async (_c: any, next: any) => {
        await next();
      },
    }));

    // Mock the service-role admin client's fluent chain
    // (from → select → eq → limit → thenable). E104 uses admin
    // to bypass RLS on the existence check.
    vi.doMock('../lib/supabase', () => ({
      getSupabaseAdmin: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              limit: () => Promise.resolve(mockProbeResult),
            }),
          }),
        }),
      }),
      // Keep createUserClient exported so drafts.test.ts + other
      // tests loading the shared module in the same vitest run
      // don't crash on missing exports.
      createUserClient: () => ({ from: () => ({}) }),
      supabaseAdmin: {} as never,
    }));

    vi.resetModules();
  });

  async function call(leagueId: string = VALID_LEAGUE_ID) {
    const { app } = await import('../app');
    return app.request(`/api/draft/v2/league/${leagueId}/era`, {
      headers: TEST_AUTH_HEADER,
    });
  }

  it('200: draft_events has ≥1 row for league → v2Era: true', async () => {
    mockProbeResult = { data: [{ id: 42 }], error: null };
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ v2Era: true });
  });

  it('200: draft_events has 0 rows for league → v2Era: false', async () => {
    mockProbeResult = { data: [], error: null };
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ v2Era: false });
  });

  it('200: draft_events returns null data (defensive) → v2Era: false', async () => {
    // Defensive: some Supabase paths return `data: null` on empty
    // result sets. Handler treats null as no rows (v2Era=false).
    mockProbeResult = { data: null, error: null };
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ v2Era: false });
  });

  it('400: malformed leagueId (not a UUID) → BAD_REQUEST', async () => {
    const res = await call('not-a-uuid-at-all');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('500: service-role query error → SERVICE_UNAVAILABLE', async () => {
    // Regression guard: DB errors log + respond cleanly. The fence's
    // client-side fall-through then treats this as v1-safe (defensive
    // per Entry 80 doctrine).
    mockProbeResult = { data: null, error: { message: 'synthetic DB failure' } };
    const res = await call();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('200 auth-only: no membership check performed (fence needs answer regardless)', async () => {
    // The era endpoint is intentionally auth-only. Even a non-member
    // (e.g., someone with a stale bookmark to /draft-room?league=X
    // for a league they never joined) must receive the authoritative
    // boolean so the fence can redirect them to /draft-v2/X.
    // Downstream membership gating happens on the v2 page itself.
    //
    // This test simply verifies no 403 is returned when the mock
    // returns success — proving no membership middleware is wired.
    mockProbeResult = { data: [{ id: 1 }], error: null };
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(403);
  });
});

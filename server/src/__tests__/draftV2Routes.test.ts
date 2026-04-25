/**
 * Draft Engine v2 — route-level tests for /pick and /events.
 *
 * Chunk 9b: HTTP-layer concerns — auth gate, header validation, body
 * validation, rate-limiter behavior, cache headers, error-status
 * mapping. These are mocked tests; the SQL integration suite (9e1+)
 * verifies the layer below.
 *
 * Mocks installed at module top via `vi.mock`:
 *   - authMiddleware: replaced with a stub that 401s on missing
 *     Authorization but otherwise sets userId from `X-Test-User-Id`
 *     header (default 'user-default') and userToken from the Bearer.
 *     Preserves the 401 path so we can still test it.
 *   - membershipMiddleware: replaced with a pass-through. Membership
 *     verification has its own dedicated tests; chunk 9b doesn't
 *     re-test it.
 *   - createUserClient / supabaseAdmin: returns controllable mocks
 *     (rpc, from-chain, channel) so tests can drive the route by
 *     setting return values per-case.
 *
 * The DraftServiceV2 itself is NOT mocked — the route should
 * exercise the service's real code path (mapRpcError, broadcast
 * skip-on-duplicate). DraftServiceV2.test.ts already covers the
 * service surface.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ── Mocks (must be set up before importing the app) ─────────────────

vi.mock('../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const auth = c.req.header('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return c.json(
        { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Missing or invalid Authorization header' } },
        401,
      );
    }
    c.set('userId', c.req.header('X-Test-User-Id') ?? 'user-default');
    c.set('userToken', auth.slice(7));
    await next();
  },
  optionalAuthMiddleware: async (_: any, next: any) => { await next(); },
}));

vi.mock('../middleware/membership', () => ({
  membershipMiddleware: async (_: any, next: any) => { await next(); },
  commissionerMiddleware: async (_: any, next: any) => { await next(); },
}));

// Per-test mutable handles. Declare here so the mock factory can read
// them (vi.mock factories must be self-contained but can close over
// module-scope vars defined later via `let`).
let mockUserClientRpc: ReturnType<typeof vi.fn>;
let mockUserClientFromImpl: (table: string) => any;
let mockAdminFromImpl: (table: string) => any;
let mockAdminChannelImpl: (name: string, opts?: any) => any;
let mockAdminRemoveChannel: ReturnType<typeof vi.fn>;

vi.mock('../lib/supabase', () => ({
  createUserClient: () => ({
    rpc: (...args: any[]) => (mockUserClientRpc as any)(...args),
    from: (table: string) => mockUserClientFromImpl(table),
  }),
  supabaseAdmin: {
    from:           (table: string) => mockAdminFromImpl(table),
    channel:        (name: string, opts?: any) => mockAdminChannelImpl(name, opts),
    removeChannel:  (...args: any[]) => (mockAdminRemoveChannel as any)(...args),
  },
}));

// ── Test helpers ────────────────────────────────────────────────────

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

const LEAGUE_ID = '11111111-1111-1111-1111-111111111111';
const TEAM_ID   = '33333333-3333-3333-3333-000000000001';
const VALID_KEY = '44444444-4444-4444-4444-444444444444';

function authedHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization:    'Bearer test-token',
    'Content-Type':   'application/json',
    'X-Test-User-Id': 'user-default',
    ...extra,
  };
}

function makeFromChain(terminal: any = { data: null, error: null }) {
  const chain: any = {};
  for (const m of ['select', 'eq', 'gt', 'order', 'limit', 'in', 'gte', 'lte']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single      = vi.fn().mockResolvedValue(terminal);
  chain.maybeSingle = vi.fn().mockResolvedValue(terminal);
  chain.then = (resolve: any, reject: any) =>
    Promise.resolve(terminal).then(resolve, reject);
  return chain;
}

// Reset mocks between tests so the rate-limiter Map state and any
// per-test stubs don't leak. The rate-limiter Map lives in module
// scope inside draftV2Events.ts — to clear it between tests we
// re-import the module.
beforeEach(() => {
  vi.resetModules();
  mockUserClientRpc       = vi.fn();
  mockUserClientFromImpl  = () => makeFromChain();
  mockAdminFromImpl       = () => makeFromChain();
  mockAdminChannelImpl    = () => ({
    subscribe: (cb: any) => { queueMicrotask(() => cb('SUBSCRIBED')); return {}; },
    send:      vi.fn().mockResolvedValue(undefined),
  });
  mockAdminRemoveChannel  = vi.fn().mockResolvedValue(undefined);
});

async function getApp() {
  // Re-import after vi.resetModules so each test gets a fresh
  // rate-limiter Map (per-process state inside draftV2Events.ts).
  const mod = await import('../app');
  return mod.app;
}

// ── /pick ───────────────────────────────────────────────────────────

describe('POST /api/draft/v2/league/:leagueId/pick', () => {
  const PICK_PATH = `/api/draft/v2/league/${LEAGUE_ID}/pick`;

  it('returns 401 when Authorization header is missing', async () => {
    const app = await getApp();
    const res = await app.request(PICK_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_id: TEAM_ID, player_id: 1, round: 1, pick_number: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when X-Idempotency-Key header is missing', async () => {
    const app = await getApp();
    const res = await app.request(PICK_PATH, {
      method: 'POST',
      headers: authedHeaders(),
      body: JSON.stringify({ team_id: TEAM_ID, player_id: 1, round: 1, pick_number: 1 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toMatch(/X-Idempotency-Key/);
  });

  it('returns 400 when X-Idempotency-Key is not a UUID', async () => {
    const app = await getApp();
    const res = await app.request(PICK_PATH, {
      method: 'POST',
      headers: authedHeaders({ 'X-Idempotency-Key': 'not-a-uuid' }),
      body: JSON.stringify({ team_id: TEAM_ID, player_id: 1, round: 1, pick_number: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when X-Correlation-Id is present but not a UUID', async () => {
    const app = await getApp();
    const res = await app.request(PICK_PATH, {
      method: 'POST',
      headers: authedHeaders({
        'X-Idempotency-Key': VALID_KEY,
        'X-Correlation-Id':  'not-a-uuid',
      }),
      body: JSON.stringify({ team_id: TEAM_ID, player_id: 1, round: 1, pick_number: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body fails zod validation (missing field)', async () => {
    const app = await getApp();
    const res = await app.request(PICK_PATH, {
      method: 'POST',
      headers: authedHeaders({ 'X-Idempotency-Key': VALID_KEY }),
      body: JSON.stringify({ team_id: TEAM_ID, player_id: 1, round: 1 }), // pick_number missing
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 + service result on success, with Cache-Control: no-store', async () => {
    mockUserClientRpc = vi.fn().mockResolvedValue({
      data: { event_id: 4711, seq: 1, pick_deadline: '2026-04-25T20:00:30Z', was_duplicate: false },
      error: null,
    });

    const app = await getApp();
    const res = await app.request(PICK_PATH, {
      method: 'POST',
      headers: authedHeaders({ 'X-Idempotency-Key': VALID_KEY }),
      body: JSON.stringify({ team_id: TEAM_ID, player_id: 8478402, round: 1, pick_number: 1 }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.data).toEqual({
      event_id: 4711,
      seq: 1,
      pick_deadline: '2026-04-25T20:00:30Z',
      was_duplicate: false,
    });

    // Confirm RPC was called with the right shape.
    expect(mockUserClientRpc).toHaveBeenCalledWith(
      'submit_pick_v2',
      expect.objectContaining({
        p_league_id: LEAGUE_ID,
        p_team_id:   TEAM_ID,
        p_player_id: 8478402,
        p_round:     1,
        p_pick_number: 1,
        p_idempotency_key: VALID_KEY,
        p_actor: expect.objectContaining({ kind: 'user' }),
      }),
    );
  });

  it('maps idempotency_conflict from RPC to 409', async () => {
    mockUserClientRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'idempotency_conflict: same key, different payload_hash', code: '23505' },
    });

    const app = await getApp();
    const res = await app.request(PICK_PATH, {
      method: 'POST',
      headers: authedHeaders({ 'X-Idempotency-Key': VALID_KEY }),
      body: JSON.stringify({ team_id: TEAM_ID, player_id: 1, round: 1, pick_number: 1 }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toContain('idempotency_conflict');
  });

  it('maps illegal_state from RPC to 422', async () => {
    mockUserClientRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'illegal_state: draft_state is paused (expected active)', code: '23514' },
    });

    const app = await getApp();
    const res = await app.request(PICK_PATH, {
      method: 'POST',
      headers: authedHeaders({ 'X-Idempotency-Key': VALID_KEY }),
      body: JSON.stringify({ team_id: TEAM_ID, player_id: 1, round: 1, pick_number: 1 }),
    });
    expect(res.status).toBe(422);
  });
});

// ── /events ─────────────────────────────────────────────────────────

describe('GET /api/draft/v2/league/:leagueId/events', () => {
  const EVENTS_PATH = `/api/draft/v2/league/${LEAGUE_ID}/events`;

  function setLeagueState(state: string) {
    mockUserClientFromImpl = (table: string) => {
      if (table === 'leagues') {
        return makeFromChain({ data: { id: LEAGUE_ID, draft_state: state }, error: null });
      }
      if (table === 'draft_events') {
        return makeFromChain({ data: [], error: null });
      }
      return makeFromChain();
    };
  }

  it('returns 401 when Authorization header is missing', async () => {
    const app = await getApp();
    const res = await app.request(EVENTS_PATH);
    expect(res.status).toBe(401);
  });

  it('returns 200 with no-store Cache-Control for active drafts', async () => {
    setLeagueState('active');
    const app = await getApp();
    const res = await app.request(EVENTS_PATH, { headers: authedHeaders() });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.data.league_state).toBe('active');
    expect(body.data.events).toEqual([]);
    expect(body.data.next_since_seq).toBeNull();
  });

  it('returns immutable Cache-Control for completed drafts', async () => {
    setLeagueState('completed');
    const app = await getApp();
    const res = await app.request(EVENTS_PATH, { headers: authedHeaders() });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400, immutable');
  });

  it('returns immutable Cache-Control for cancelled drafts', async () => {
    setLeagueState('cancelled');
    const app = await getApp();
    const res = await app.request(EVENTS_PATH, { headers: authedHeaders() });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400, immutable');
  });

  it('sets next_since_seq when more pages remain (over-fetch detection)', async () => {
    // Configure events query: 3 rows when limit=2 → over-fetch detected
    // Events are ordered ascending; cursor should point to the limit-th seq.
    const evs = [
      { id: 1, seq: 10 }, { id: 2, seq: 11 }, { id: 3, seq: 12 },
    ];
    mockUserClientFromImpl = (table: string) => {
      if (table === 'leagues') {
        return makeFromChain({ data: { id: LEAGUE_ID, draft_state: 'active' }, error: null });
      }
      if (table === 'draft_events') {
        return makeFromChain({ data: evs, error: null });
      }
      return makeFromChain();
    };
    const app = await getApp();
    const res = await app.request(`${EVENTS_PATH}?limit=2`, { headers: authedHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.events).toHaveLength(2);
    expect(body.data.next_since_seq).toBe(11); // limit-th element's seq
  });

  it('returns 400 when since_seq is negative', async () => {
    setLeagueState('active');
    const app = await getApp();
    const res = await app.request(`${EVENTS_PATH}?since_seq=-1`, { headers: authedHeaders() });
    expect(res.status).toBe(400);
  });

  it('returns 400 when limit > 500', async () => {
    setLeagueState('active');
    const app = await getApp();
    const res = await app.request(`${EVENTS_PATH}?limit=501`, { headers: authedHeaders() });
    expect(res.status).toBe(400);
  });

  it('returns 404 when league is missing', async () => {
    mockUserClientFromImpl = () =>
      makeFromChain({ data: null, error: { message: 'no rows', code: 'PGRST116' } });
    const app = await getApp();
    const res = await app.request(EVENTS_PATH, { headers: authedHeaders() });
    expect(res.status).toBe(404);
  });

  it('rate-limits the 11th request in a 30s window with 429 + Retry-After', async () => {
    setLeagueState('active');
    const app = await getApp();
    // 10 requests succeed.
    for (let i = 0; i < 10; i++) {
      const res = await app.request(EVENTS_PATH, { headers: authedHeaders() });
      expect(res.status).toBe(200);
    }
    // 11th hits the limit.
    const res = await app.request(EVENTS_PATH, { headers: authedHeaders() });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
    const body = await res.json();
    expect(body.error.code).toBe('RATE_LIMITED');
  });

  it('rate limit is independent across users for the same league', async () => {
    setLeagueState('active');
    const app = await getApp();
    // user A: 10 requests
    for (let i = 0; i < 10; i++) {
      const res = await app.request(EVENTS_PATH, {
        headers: authedHeaders({ 'X-Test-User-Id': 'user-A' }),
      });
      expect(res.status).toBe(200);
    }
    // user B's 1st succeeds (independent bucket).
    const res = await app.request(EVENTS_PATH, {
      headers: authedHeaders({ 'X-Test-User-Id': 'user-B' }),
    });
    expect(res.status).toBe(200);
  });

  it('rate limit is independent across leagues for the same user', async () => {
    setLeagueState('active');
    const app = await getApp();
    const OTHER_LEAGUE = '99999999-9999-9999-9999-999999999999';
    // user-default × LEAGUE_ID: 10 requests
    for (let i = 0; i < 10; i++) {
      const res = await app.request(EVENTS_PATH, { headers: authedHeaders() });
      expect(res.status).toBe(200);
    }
    // user-default × OTHER_LEAGUE: 1st succeeds (independent bucket).
    const res = await app.request(
      `/api/draft/v2/league/${OTHER_LEAGUE}/events`,
      { headers: authedHeaders() },
    );
    expect(res.status).toBe(200);
  });
});

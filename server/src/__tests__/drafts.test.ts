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
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

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

// ── Phase 4.5 chunk 11g.7 sub-step 7b — snapshot endpoint tests ───────
//
// `GET /api/drafts/:draftId/snapshot` reuses the same `authMiddleware`
// + `LeagueMembershipService` mocks established for the discovery
// endpoint. Additionally mocks `snapshotService.buildSnapshot` so
// the route handler runs deterministically without hitting Postgres.

describe('Snapshot endpoint — chunk 11g.7 sub-step 7b', () => {
  let mockLeague: { id: string; draft_status: string } | null = null;
  let mockLeagueError: { message: string } | null = null;
  let mockIsMember = true;
  let mockSnapshot: unknown = null;
  let mockSnapshotError: Error | null = null;
  // Entry 103 F2b (2026-08-11) — per-test picks projection + joins.
  let mockPicks: Array<{
    pick_number: number;
    round: number;
    team_id: string;
    player_id: number;
    picked_at: string;
    picked_by_actor: { kind: string } | null;
  }> = [];
  let mockPicksError: { message: string } | null = null;
  let mockTeams: Array<{ id: string; team_name: string | null }> = [];
  let mockPlayers: Array<{
    player_id: number;
    full_name: string | null;
    position_code: string | null;
    team_abbrev: string | null;
  }> = [];

  beforeAll(async () => {
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

    vi.doMock('../lib/supabase', () => ({
      createUserClient: () => ({
        // Entry 103 F2b (2026-08-11): the mock is table-aware. The
        // snapshot route now hits four tables per terminal request:
        //   - leagues (maybeSingle for status/id) — pre-existing
        //   - draft_picks_v2 (list picks with .order) — E103 new
        //   - teams (batch by .in for team_name) — E103 new
        //   - player_directory (batch by .in + .eq season) — E103 new
        // The `from(table)` dispatch returns a shape appropriate to
        // the table so the route's chained methods resolve correctly.
        from: (table: string) => {
          if (table === 'draft_picks_v2') {
            return {
              select: () => ({
                eq: () => ({
                  order: () => Promise.resolve({
                    data: mockPicks,
                    error: mockPicksError,
                  }),
                }),
              }),
            };
          }
          if (table === 'teams') {
            return {
              select: () => ({
                in: () => Promise.resolve({
                  data: mockTeams,
                  error: null,
                }),
              }),
            };
          }
          if (table === 'player_directory') {
            return {
              select: () => ({
                in: () => ({
                  eq: () => Promise.resolve({
                    data: mockPlayers,
                    error: null,
                  }),
                }),
              }),
            };
          }
          // Default: leagues (or any pre-E103 table) — maybeSingle path.
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: mockLeague,
                  error: mockLeagueError,
                }),
              }),
            }),
          };
        },
      }),
      supabaseAdmin: {} as never,
    }));

    vi.doMock('../services/LeagueMembershipService', () => ({
      LeagueMembershipService: class {
        async checkMembership() {
          return { isMember: mockIsMember, isCommissioner: false };
        }
        static clearCache() { /* no-op */ }
      },
    }));

    // Mock the snapshot service so the route handler doesn't hit
    // the DB queries inside `buildSnapshot`.
    vi.doMock('../services/snapshotService', () => ({
      buildSnapshot: vi.fn(async () => {
        if (mockSnapshotError) throw mockSnapshotError;
        return mockSnapshot;
      }),
    }));

    vi.resetModules();
  });

  async function call(draftId: string = VALID_DRAFT_ID) {
    const { app } = await import('../app');
    return app.request(`/api/drafts/${draftId}/snapshot`, {
      headers: TEST_AUTH_HEADER,
    });
  }

  it('200: league exists, member, in_progress → returns DraftSnapshot JSON', async () => {
    mockLeague = { id: VALID_DRAFT_ID, draft_status: 'in_progress' };
    mockLeagueError = null;
    mockIsMember = true;
    mockSnapshot = {
      lobbyId: VALID_DRAFT_ID,
      format: 'snake',
      recentEvents: [],
      stateSnapshot: {
        currentPickNumber: 1,
        currentRoundNumber: 1,
        onClockTeamId: 'team-1',
        totalPicks: 9,
        picksMade: 0,
        draftStatus: 'in_progress',
        currentPickDeadline: null,
      },
    };
    mockSnapshotError = null;

    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lobbyId).toBe(VALID_DRAFT_ID);
    expect(body.format).toBe('snake');
    expect(body.stateSnapshot.draftStatus).toBe('in_progress');
  });

  it('401: unauthenticated', async () => {
    // Hits the real authMiddleware mock — no Bearer header.
    const { app } = await import('../app');
    const res = await app.request(`/api/drafts/${VALID_DRAFT_ID}/snapshot`);
    expect(res.status).toBe(401);
  });

  it('403: league exists, user is not a member', async () => {
    mockLeague = { id: VALID_DRAFT_ID, draft_status: 'in_progress' };
    mockLeagueError = null;
    mockIsMember = false;
    const res = await call();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('404: league does not exist', async () => {
    mockLeague = null;
    mockLeagueError = null;
    const res = await call();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('409: league exists, member, draft_status="not_started" → DRAFT_NOT_CONNECTABLE', async () => {
    mockLeague = { id: VALID_DRAFT_ID, draft_status: 'not_started' };
    mockLeagueError = null;
    mockIsMember = true;
    const res = await call();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DRAFT_NOT_CONNECTABLE');
    expect(body.error.status).toBe('not_started');
  });

  it('400: malformed draftId (not a UUID)', async () => {
    const res = await call('not-a-uuid');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('500: buildSnapshot throws → SERVICE_UNAVAILABLE response', async () => {
    mockLeague = { id: VALID_DRAFT_ID, draft_status: 'in_progress' };
    mockLeagueError = null;
    mockIsMember = true;
    mockSnapshot = null;
    mockSnapshotError = new Error('synthetic DB failure');
    const res = await call();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('404: buildSnapshot returns null → NOT_FOUND (draft not configured)', async () => {
    mockLeague = { id: VALID_DRAFT_ID, draft_status: 'in_progress' };
    mockLeagueError = null;
    mockIsMember = true;
    mockSnapshot = null;
    mockSnapshotError = null;
    const res = await call();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  // Entry 87 Fix A (COMPLETED-ROOM-1, 2026-08-10) — snapshot route
  // serves terminal (completed/cancelled) drafts. Pre-fix, the gate
  // rejected everything outside CONNECTABLE_DRAFT_STATUSES with 409,
  // which forced the client into a discovery → 409 → backoff loop
  // for every reconnect after the engine's lobby-eviction TTL kicked
  // in post-completion (Garrett witnessed on Run 3). The snapshot is
  // permanent league history — always safe to serve from the durable
  // draft_events + draft_picks_v2 tables via buildSnapshot.
  it('200: draft_status="completed" → serves DraftSnapshot from durable state (Entry 87 Fix A)', async () => {
    mockLeague = { id: VALID_DRAFT_ID, draft_status: 'completed' };
    mockLeagueError = null;
    mockIsMember = true;
    mockSnapshot = {
      lobbyId: VALID_DRAFT_ID,
      format: 'snake',
      recentEvents: [],
      stateSnapshot: {
        currentPickNumber: null,
        currentRoundNumber: null,
        onClockTeamId: null,
        totalPicks: 12,
        picksMade: 12,
        draftStatus: 'completed',
        currentPickDeadline: null,
      },
    };
    mockSnapshotError = null;

    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stateSnapshot.draftStatus).toBe('completed');
    expect(body.stateSnapshot.picksMade).toBe(12);
  });

  it('409: draft_status="not_started" still refuses (Entry 87 Fix A — only terminal statuses opened)', async () => {
    // Regression pin: not_started is NOT a terminal status. There's
    // no snapshot to render before the first pick fires. The gate
    // still 409s to keep the client's pre-draft UI unchanged.
    mockLeague = { id: VALID_DRAFT_ID, draft_status: 'not_started' };
    mockLeagueError = null;
    mockIsMember = true;
    const res = await call();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('DRAFT_NOT_CONNECTABLE');
  });

  // Entry 99 COMPLETED-ROOM-2 (2026-08-11) — dual-source-of-truth
  // decoration. LOAD-1-NIGHT witness draft: for a completed league,
  // the engine serializer's `stateSnapshot.draftStatus` field lies
  // (says 'in_progress' despite lastAppliedSeq=14 including
  // draft_completed). Client's completion loader waits for the
  // terminal status the payload never asserts → hangs.
  //
  // Route-level decoration: when serving a terminal league, override
  // `stateSnapshot.draftStatus` with the authoritative
  // `leagues.draft_status`. Engine serializer fix (E99 a) rides the
  // separate ENGINE-EAR deploy batch; this route override is the
  // client-visible corrective in the morning hosting/API cycle.
  it('200: draft_status="completed" + engine payload says in_progress → route overrides to "completed" (E99 b)', async () => {
    mockLeague = { id: VALID_DRAFT_ID, draft_status: 'completed' };
    mockLeagueError = null;
    mockIsMember = true;
    // Simulates the exact engine-serializer bug: draftStatus field
    // in the snapshot payload is stale/lying.
    mockSnapshot = {
      lobbyId: VALID_DRAFT_ID,
      format: 'snake',
      recentEvents: [],
      stateSnapshot: {
        currentPickNumber: null,
        currentRoundNumber: null,
        onClockTeamId: null,
        totalPicks: 12,
        picksMade: 12,
        draftStatus: 'in_progress', // ← engine lies
        currentPickDeadline: null,
      },
    };
    mockSnapshotError = null;

    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    // The route decorated the payload from the authoritative league row.
    expect(body.stateSnapshot.draftStatus).toBe('completed');
    // Rest of payload preserved.
    expect(body.stateSnapshot.picksMade).toBe(12);
    expect(body.stateSnapshot.totalPicks).toBe(12);
    expect(body.lobbyId).toBe(VALID_DRAFT_ID);
  });

  it('200: draft_status="in_progress" + engine payload agrees → no override, payload passes through', async () => {
    // Regression guard: the override ONLY fires for terminal statuses.
    // A live in-progress league whose payload agrees passes through
    // unchanged (no accidental clobber).
    mockLeague = { id: VALID_DRAFT_ID, draft_status: 'in_progress' };
    mockLeagueError = null;
    mockIsMember = true;
    mockSnapshot = {
      lobbyId: VALID_DRAFT_ID,
      format: 'snake',
      recentEvents: [],
      stateSnapshot: {
        currentPickNumber: 5,
        currentRoundNumber: 1,
        onClockTeamId: 'team-3',
        totalPicks: 12,
        picksMade: 4,
        draftStatus: 'in_progress',
        currentPickDeadline: '2026-08-11T12:00:30.000Z',
      },
    };
    mockSnapshotError = null;

    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stateSnapshot.draftStatus).toBe('in_progress');
    expect(body.stateSnapshot.picksMade).toBe(4);
    expect(body.stateSnapshot.currentPickDeadline).toBe(
      '2026-08-11T12:00:30.000Z',
    );
  });

  it('200: draft_status="completed" + payload ALREADY says completed → override is a no-op passthrough', async () => {
    // Post-ENGINE-EAR-deploy scenario: when the engine serializer
    // eventually returns the correct value, the route override is
    // an idempotent no-op. Nothing observable changes; test locks
    // the shape so a future refactor doesn't accidentally break
    // idempotency.
    mockLeague = { id: VALID_DRAFT_ID, draft_status: 'completed' };
    mockLeagueError = null;
    mockIsMember = true;
    mockSnapshot = {
      lobbyId: VALID_DRAFT_ID,
      format: 'snake',
      recentEvents: [],
      stateSnapshot: {
        currentPickNumber: null,
        currentRoundNumber: null,
        onClockTeamId: null,
        totalPicks: 12,
        picksMade: 12,
        draftStatus: 'completed',
        currentPickDeadline: null,
      },
    };
    mockSnapshotError = null;

    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stateSnapshot.draftStatus).toBe('completed');
  });

  // Entry 103 F2b (2026-08-11) — terminal snapshot enrichment.
  // Route joins draft_picks_v2 + teams + player_directory to attach
  // an authoritative `picks` array so the client can render the
  // frozen board without unpacking event-log kinds. LOAD-1-NIGHT
  // witness draft (E103) surfaced that engine lobby eviction left
  // recentEvents empty; the fold produced picksMade=0 and the room
  // rendered "0/12 · waiting for pick 1" over the full player pool.
  describe('Entry 103 F2b — terminal snapshot picks enrichment', () => {
    beforeEach(() => {
      // Clean per-test state for the E103-specific mocks.
      mockPicks = [];
      mockPicksError = null;
      mockTeams = [];
      mockPlayers = [];
    });

    it('200: terminal league with 3 picks in draft_picks_v2 → response.picks populated with joined names', async () => {
      mockLeague = { id: VALID_DRAFT_ID, draft_status: 'completed' };
      mockLeagueError = null;
      mockIsMember = true;
      mockSnapshot = {
        lobbyId: VALID_DRAFT_ID,
        format: 'snake',
        recentEvents: [],
        stateSnapshot: {
          currentPickNumber: null,
          currentRoundNumber: null,
          onClockTeamId: null,
          totalPicks: 12,
          picksMade: 12,
          draftStatus: 'in_progress', // engine lies; E99 decoration fixes.
          currentPickDeadline: null,
        },
      };
      mockSnapshotError = null;
      mockPicks = [
        {
          pick_number: 1,
          round: 1,
          team_id: 'team-a',
          player_id: 8477492,
          picked_at: '2026-08-10T00:00:01.000Z',
          picked_by_actor: { kind: 'user' },
        },
        {
          pick_number: 2,
          round: 1,
          team_id: 'team-b',
          player_id: 8478402,
          picked_at: '2026-08-10T00:00:02.000Z',
          picked_by_actor: { kind: 'autopick' },
        },
        {
          pick_number: 3,
          round: 1,
          team_id: 'team-c',
          player_id: 8478050,
          picked_at: '2026-08-10T00:00:03.000Z',
          picked_by_actor: { kind: 'user' },
        },
      ];
      mockTeams = [
        { id: 'team-a', team_name: 'Alpha Aces' },
        { id: 'team-b', team_name: 'Bravo Bears' },
        { id: 'team-c', team_name: 'Charlie Cats' },
      ];
      mockPlayers = [
        {
          player_id: 8477492,
          full_name: 'Nathan MacKinnon',
          position_code: 'C',
          team_abbrev: 'COL',
        },
        {
          player_id: 8478402,
          full_name: 'Connor McDavid',
          position_code: 'C',
          team_abbrev: 'EDM',
        },
        {
          player_id: 8478050,
          full_name: 'Auston Matthews',
          position_code: 'C',
          team_abbrev: 'TOR',
        },
      ];

      const res = await call();
      expect(res.status).toBe(200);
      const body = await res.json();

      // E99 decoration still fires (draftStatus corrected).
      expect(body.stateSnapshot.draftStatus).toBe('completed');
      // E103 picks array attached to the terminal response.
      expect(Array.isArray(body.picks)).toBe(true);
      expect(body.picks).toHaveLength(3);
      // Ordering + joined fields.
      expect(body.picks[0].pickNumber).toBe(1);
      expect(body.picks[0].teamId).toBe('team-a');
      expect(body.picks[0].teamName).toBe('Alpha Aces');
      expect(body.picks[0].playerId).toBe(8477492);
      expect(body.picks[0].playerName).toBe('Nathan MacKinnon');
      expect(body.picks[0].playerPosition).toBe('C');
      expect(body.picks[0].playerTeam).toBe('COL');
      expect(body.picks[0].isAutopick).toBe(false);
      // Autopick flag propagates from picked_by_actor.kind.
      expect(body.picks[1].isAutopick).toBe(true);
      expect(body.picks[1].playerName).toBe('Connor McDavid');
      expect(body.picks[2].isAutopick).toBe(false);
    });

    it('200: terminal league with missing team/player joins → picks still returned with null names', async () => {
      // Regression guard: if a team was purged post-completion OR the
      // player_directory row is missing (retired / offseason edge),
      // the pick row must still surface with null names — the client
      // falls back to `#<id>` labels.
      mockLeague = { id: VALID_DRAFT_ID, draft_status: 'completed' };
      mockLeagueError = null;
      mockIsMember = true;
      mockSnapshot = {
        lobbyId: VALID_DRAFT_ID,
        format: 'snake',
        recentEvents: [],
        stateSnapshot: {
          currentPickNumber: null,
          currentRoundNumber: null,
          onClockTeamId: null,
          totalPicks: 1,
          picksMade: 1,
          draftStatus: 'completed',
          currentPickDeadline: null,
        },
      };
      mockPicks = [
        {
          pick_number: 1,
          round: 1,
          team_id: 'team-ghost',
          player_id: 9999999,
          picked_at: '2026-08-10T00:00:01.000Z',
          picked_by_actor: null,
        },
      ];
      mockTeams = []; // no teams row for team-ghost
      mockPlayers = []; // no player_directory row for 9999999

      const res = await call();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.picks).toHaveLength(1);
      expect(body.picks[0].teamId).toBe('team-ghost');
      expect(body.picks[0].teamName).toBeNull();
      expect(body.picks[0].playerId).toBe(9999999);
      expect(body.picks[0].playerName).toBeNull();
      expect(body.picks[0].playerPosition).toBeNull();
      expect(body.picks[0].playerTeam).toBeNull();
      // Missing picked_by_actor → isAutopick=false.
      expect(body.picks[0].isAutopick).toBe(false);
    });

    it('200: terminal league with zero picks (edge — should not happen but stays total) → picks field absent', async () => {
      // A terminal league with no picks shouldn't exist in practice
      // (start_draft_v2 always seeds first pick's deadline; completion
      // requires picks). But the enrichment gate is
      // `picksRows.length > 0`, so an empty projection leaves picks
      // undefined rather than sending []. Client's derive falls back
      // to the recentEvents fold path.
      mockLeague = { id: VALID_DRAFT_ID, draft_status: 'completed' };
      mockLeagueError = null;
      mockIsMember = true;
      mockSnapshot = {
        lobbyId: VALID_DRAFT_ID,
        format: 'snake',
        recentEvents: [],
        stateSnapshot: {
          currentPickNumber: null,
          currentRoundNumber: null,
          onClockTeamId: null,
          totalPicks: 12,
          picksMade: 0,
          draftStatus: 'completed',
          currentPickDeadline: null,
        },
      };
      mockPicks = [];

      const res = await call();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.picks).toBeUndefined();
    });

    it('200: in_progress league does NOT get picks enrichment (fold path preserved)', async () => {
      // Regression guard: enrichment ONLY fires for terminal leagues.
      // Live in_progress drafts must not send picks — client's fold
      // path is the source of truth for live rendering.
      mockLeague = { id: VALID_DRAFT_ID, draft_status: 'in_progress' };
      mockLeagueError = null;
      mockIsMember = true;
      mockSnapshot = {
        lobbyId: VALID_DRAFT_ID,
        format: 'snake',
        recentEvents: [],
        stateSnapshot: {
          currentPickNumber: 5,
          currentRoundNumber: 1,
          onClockTeamId: 'team-3',
          totalPicks: 12,
          picksMade: 4,
          draftStatus: 'in_progress',
          currentPickDeadline: '2026-08-11T12:00:30.000Z',
        },
      };
      // Even if picks would be available, the enrichment gate skips
      // non-terminal — assert picks NOT attached.
      mockPicks = [
        {
          pick_number: 1,
          round: 1,
          team_id: 'team-a',
          player_id: 8477492,
          picked_at: '2026-08-11T12:00:01.000Z',
          picked_by_actor: { kind: 'user' },
        },
      ];

      const res = await call();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.picks).toBeUndefined();
    });
  });
});

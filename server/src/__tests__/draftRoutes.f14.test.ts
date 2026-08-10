// F14(a) Amendment 2 (2026-08-03 architect ruling) — route-level
// test proving the v1 pick route's ownership enforcement uses the
// FRESH teamId, not the cached one. Prime the cache through a real
// checkMembership call, simulate an ownership rewrite by making the
// mocked teams query return a new value, then invoke the pick route
// TWICE:
//   - once for the RIGHTFUL NEW OWNER's teamId → 200 (or the RPC's
//     own downstream response — we assert the ownership check
//     PASSED, not that the pick succeeded end-to-end)
//   - once for the FORMER OWNER's stale teamId → 403
//
// Both cases exercise the SAME cached membership entry. The route's
// getUserTeamIdFresh call is what makes the two responses diverge
// correctly. If the route regressed to consulting cached teamId,
// both requests would return the SAME response (whichever the cache
// held at prime time) and this test would go red.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { LeagueMembershipService } from '../services/LeagueMembershipService';

// Mock authMiddleware — same pattern as draftV2Routes.test.ts.
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

// Do NOT mock membership — we want the REAL LeagueMembershipService
// in the loop so we can prove the ROUTE (not just the service) uses
// the fresh teamId.

// Supabase mocking — controls what checkMembership() and
// getUserTeamIdFresh() observe.
let currentOwnedTeamId: string | null = 'old-team-uuid';
// Entry 64 gate strict: vitest 4's `ReturnType<typeof vi.fn>` widens
// to `Mock<Procedure | Constructable>` which is no longer callable
// without `new`. Explicit callable signature restores type-safety.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockUserClientRpc: ReturnType<typeof vi.fn<(...args: any[]) => Promise<any>>>;

function makeFromChain(terminal: any = { data: null, error: null }): any {
  const chain: any = {};
  for (const m of ['select', 'eq', 'gt', 'order', 'limit', 'in', 'gte', 'lte']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn().mockResolvedValue(terminal);
  chain.maybeSingle = vi.fn().mockResolvedValue(terminal);
  chain.then = (resolve: any, reject: any) =>
    Promise.resolve(terminal).then(resolve, reject);
  return chain;
}

vi.mock('../lib/supabase', () => ({
  createUserClient: () => ({
    rpc: (...args: any[]) => mockUserClientRpc(...args),
    from: (table: string) => {
      if (table === 'leagues') {
        return makeFromChain({
          data: { commissioner_id: 'other-commissioner', draft_status: 'in_progress' },
          error: null,
        });
      }
      if (table === 'teams') {
        // ALWAYS returns the CURRENT value — the test flips
        // `currentOwnedTeamId` between requests to simulate the
        // ownership rewrite. checkMembership caches based on this
        // return value; getUserTeamIdFresh re-reads it each time.
        return makeFromChain({
          data: currentOwnedTeamId ? { id: currentOwnedTeamId } : null,
          error: null,
        });
      }
      return makeFromChain();
    },
  }),
  supabaseAdmin: { from: () => makeFromChain() },
}));

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

const LEAGUE_ID = '11111111-1111-1111-1111-111111111111';
const OLD_TEAM_ID = 'old-team-uuid';
const NEW_TEAM_ID = 'new-team-uuid';
const USER_ID = 'user-under-test';
const PICK_PATH = `/api/draft/league/${LEAGUE_ID}/pick`;

function authedHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: 'Bearer test-token',
    'Content-Type': 'application/json',
    'X-Test-User-Id': USER_ID,
    ...extra,
  };
}

function pickBody(teamId: string) {
  return JSON.stringify({
    teamId,
    playerId: '8478001',  // schema requires string
    pickNumber: 1,
    roundNumber: 1,
    draftSessionId: '22222222-2222-2222-2222-222222222222',
    teamsCount: 12,
  });
}

beforeEach(() => {
  LeagueMembershipService.clearCache();
  currentOwnedTeamId = OLD_TEAM_ID;
  mockUserClientRpc = vi.fn().mockResolvedValue({
    data: { pick: {}, is_complete: false },
    error: null,
  });
});

describe('F14(a) Amendment 2 — v1 makePick route uses FRESH teamId, not cache', () => {
  // Helpers — the point of these tests is the SECURITY CHECK's
  // decision, not whether the pick RPC succeeds end-to-end (that's
  // DraftService's job). Assert the 403 with the exact ownership
  // error text for the reject branch; assert absence of that 403 for
  // the accept branch (downstream service may 500 with a mock-related
  // error, which is fine — the check passed).
  async function submitPick(app: any, teamId: string): Promise<{
    status: number;
    ownershipRejected: boolean;
  }> {
    const res = await app.request(PICK_PATH, {
      method: 'POST',
      headers: authedHeaders(),
      body: pickBody(teamId),
    });
    let ownershipRejected = false;
    if (res.status === 403) {
      const body = await res.json();
      const msg = String(body.error?.message ?? body.message ?? '');
      ownershipRejected = /only make picks/i.test(msg);
    }
    return { status: res.status, ownershipRejected };
  }

  it('BRANCH A (rightful new owner): after ownership rewrite, pick route ACCEPTS the NEW teamId (security check passes)', async () => {
    const { app } = await import('../app');

    // Prime: request as owner of OLD. Populates the checkMembership
    // cache with isMember=true; getUserTeamIdFresh returned OLD; check
    // passed; downstream RPC ran. Whether the RPC succeeded is not
    // relevant to this test.
    await submitPick(app, OLD_TEAM_ID);

    // Simulate DB-side ownership rewrite.
    currentOwnedTeamId = NEW_TEAM_ID;

    // Cache is still warm (isMember=true). Submit as the NEW owner
    // for the NEW teamId. Security check should PASS: getUserTeamIdFresh
    // returns NEW; matches body.teamId; check passes.
    const rightful = await submitPick(app, NEW_TEAM_ID);
    // NOT the ownership 403 — the check must have passed. Downstream
    // may 200 or 500 depending on mock scaffolding; either way, the
    // ownership check did NOT reject.
    expect(rightful.ownershipRejected).toBe(false);
  });

  it('BRANCH B (F14 REPRO — former owner): after ownership rewrite, pick for OLD teamId is REJECTED 403 even though membership cache is warm', async () => {
    const { app } = await import('../app');

    // Prime as OLD owner.
    await submitPick(app, OLD_TEAM_ID);

    // Ownership moves.
    currentOwnedTeamId = NEW_TEAM_ID;

    // Former owner attempts to draft for their OLD teamId. Pre-F14(a):
    // cache still says teamId=OLD; check "membershipResult.teamId ===
    // body.teamId" passes; wrong-team pick would go through. Post-fix:
    // getUserTeamIdFresh returns NEW; mismatch with body.teamId=OLD;
    // 403 with "You can only make picks for your own team."
    const former = await submitPick(app, OLD_TEAM_ID);
    expect(former.status).toBe(403);
    expect(former.ownershipRejected).toBe(true);
  });
});

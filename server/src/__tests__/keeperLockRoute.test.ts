import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createChain, createMockSupabase } from './helpers';
import { LeagueMembershipService } from '../services/LeagueMembershipService';

// GRANTS (2026-09-11): the lock route runs the RPC on the ADMIN client, not
// the caller's. That is what allows EXECUTE on lock_keepers_for_season to be
// revoked from `authenticated` (migration 20260911053000) -- otherwise a
// member could skip the handler and POST straight to PostgREST. So the admin
// client needs a real rpc() here, and the success case asserts on IT.
vi.mock('../lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn(), rpc: vi.fn() },
  createUserClient: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'u-test');
    c.set('userToken', 'tok');
    await next();
  },
}));

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
});

beforeEach(() => LeagueMembershipService.clearCache());
afterEach(() => vi.clearAllMocks());

/**
 * POST /api/keepers/league/:leagueId/lock — commissioner only (2026-09-11).
 *
 * This route was membership-only. It is the one keeper route with no
 * ownership test: designate and release both verify team.owner_id, and
 * updateKeeperSettings verifies commissioner_id. It calls
 * lock_keepers_for_season, which is SECURITY DEFINER, so RLS does not
 * backstop it either, and locking is league-wide and effectively one-way
 * from a manager's point of view -- KeeperPanel disables designate and
 * release for everybody once any designation reads 'locked'. So an
 * ordinary member could freeze all teams' keeper selections before anyone
 * had finished choosing. The client already hides the button behind
 * isCommissioner; these tests pin the server saying the same thing.
 *
 * The important assertion in the refusal case is not just the 403 -- it is
 * that the RPC is never reached.
 */
const LEAGUE = '11111111-1111-1111-1111-111111111111';
const MY_TEAM = '22222222-2222-2222-2222-222222222222';

/** Membership passes in both cases; only commissioner_id differs. */
function tables(commissionerId: string) {
  return {
    leagues: createChain({ data: { id: LEAGUE, commissioner_id: commissionerId }, error: null }),
    teams: createChain({ data: { id: MY_TEAM }, error: null }),
  };
}

function lock(app: any) {
  return app.request(`/api/keepers/league/${LEAGUE}/lock`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ seasonYear: 2026 }),
  });
}

describe('POST /api/keepers/league/:leagueId/lock — commissioner only', () => {
  it('refuses a league member who is not the commissioner, and never calls the RPC', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    const client = createMockSupabase(tables('someone-else'), { data: [], error: null });
    (createUserClient as any).mockReturnValue(client);

    const { supabaseAdmin } = await import('../lib/supabase');

    const res = await lock(app);

    expect(res.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    expect((supabaseAdmin as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();
  });

  it('lets the commissioner through to lock_keepers_for_season', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    const client = createMockSupabase(tables('u-test'), {
      data: [{ team_id: MY_TEAM, keepers_locked: 3, rounds_consumed: [1, 2, 3] }],
      error: null,
    });
    (createUserClient as any).mockReturnValue(client);

    const { supabaseAdmin } = await import('../lib/supabase');
    const adminRpc = (supabaseAdmin as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    adminRpc.mockResolvedValue({
      data: [{ team_id: MY_TEAM, keepers_locked: 3, rounds_consumed: [1, 2, 3] }],
      error: null,
    });

    const res = await lock(app);

    expect(res.status).toBe(200);
    // the RPC goes out on the ADMIN client -- that is the whole point of the change
    expect(adminRpc).toHaveBeenCalledWith('lock_keepers_for_season', {
      p_league_id: LEAGUE,
      p_season_year: 2026,
    });
    // and NOT on the caller's client, which will lose EXECUTE in 20260911053000
    expect(client.rpc).not.toHaveBeenCalledWith('lock_keepers_for_season', expect.anything());
  });
});

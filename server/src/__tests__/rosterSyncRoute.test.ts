import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createChain, createMockSupabase } from './helpers';
import { LeagueMembershipService } from '../services/LeagueMembershipService';

// GRANTS (2026-09-11): the sync route runs the RPC on the ADMIN client, not
// the caller's. That is what allows EXECUTE on
// sync_roster_assignments_for_league to be revoked from `authenticated`
// (migration 20260911053000). The admin client therefore needs a real rpc()
// here, and the success case asserts on IT.
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
 * POST /api/rosters/league/:leagueId/sync — commissioner only (2026-09-11).
 *
 * This route's comment said "(commissioner only)" and the handler enforced
 * membershipMiddleware, so ANY league member could rewrite every
 * roster_assignments row in the league. sync_roster_assignments_for_league
 * is SECURITY DEFINER, so RLS did not backstop it either. Found while
 * auditing 20260911053000, which revokes EXECUTE on that function from
 * `authenticated`: the route was also still calling it on a user client, so
 * the migration would have broken it outright.
 *
 * Both halves are pinned here. The refusal case's important assertion is not
 * the 403 -- it is that neither client reaches the RPC.
 */
const LEAGUE = '11111111-1111-1111-1111-111111111111';
const MY_TEAM = '22222222-2222-2222-2222-222222222222';

/**
 * commissionerMiddleware -> LeagueMembershipService.checkMembership reads
 * leagues.commissioner_id, then teams by (league_id, owner_id). Returning a
 * team in both cases keeps the caller a genuine MEMBER, so the only thing
 * separating the two tests is commissioner_id. That is the regression: a
 * member who is not the commissioner used to get through.
 */
function tables(commissionerId: string) {
  return {
    leagues: createChain({ data: { commissioner_id: commissionerId }, error: null }),
    teams: createChain({ data: { id: MY_TEAM }, error: null }),
  };
}

function sync(app: any) {
  return app.request(`/api/rosters/league/${LEAGUE}/sync`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
  });
}

describe('POST /api/rosters/league/:leagueId/sync — commissioner only', () => {
  it('refuses a league member who is not the commissioner, and never calls the RPC', async () => {
    const { createUserClient, supabaseAdmin } = await import('../lib/supabase');
    const { app } = await import('../app');
    const client = createMockSupabase(tables('someone-else'), { data: [], error: null });
    (createUserClient as any).mockReturnValue(client);

    const res = await sync(app);

    expect(res.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    expect((supabaseAdmin as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();
  });

  it('lets the commissioner through to sync_roster_assignments_for_league', async () => {
    const { createUserClient, supabaseAdmin } = await import('../lib/supabase');
    const { app } = await import('../app');
    const client = createMockSupabase(tables('u-test'), { data: [], error: null });
    (createUserClient as any).mockReturnValue(client);

    const adminRpc = (supabaseAdmin as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;
    adminRpc.mockResolvedValue({ data: { synced: 12 }, error: null });

    const res = await sync(app);

    expect(res.status).toBe(200);
    // the RPC goes out on the ADMIN client -- that is what makes 20260911053000 safe
    expect(adminRpc).toHaveBeenCalledWith('sync_roster_assignments_for_league', {
      p_league_id: LEAGUE,
    });
    // and NOT on the caller's client, which loses EXECUTE in that migration
    expect(client.rpc).not.toHaveBeenCalledWith(
      'sync_roster_assignments_for_league',
      expect.anything(),
    );
  });
});

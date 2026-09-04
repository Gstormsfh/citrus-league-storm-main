import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createChain, createMockSupabase } from './helpers';
import { LeagueMembershipService } from '../services/LeagueMembershipService';

// Mock the supabase factory + auth middleware before importing the app.
vi.mock('../lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
  createUserClient: vi.fn(),
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

afterEach(() => {
  vi.clearAllMocks();
  // checkMembership caches per (leagueId, userId) for 30s at module scope.
  LeagueMembershipService.clearCache();
});

/**
 * POST /api/trades/:tradeId/vote — you vote as your own team, or not at all.
 *
 * T3 (2026-09-03). The route used to hand body.voterTeamId straight to the
 * submit_trade_vote RPC. That RPC is SECURITY DEFINER, so the trade_votes_insert
 * policy (voter_team_id must be a team the caller owns) never ran against its
 * INSERT, and the INSERT is
 *   ON CONFLICT (trade_offer_id, voter_team_id) DO UPDATE SET vote = ...
 * so one league member could vote as every other team AND overwrite votes those
 * managers had already cast. With trade_veto_threshold defaulting to 0.5 that is
 * a unilateral veto on any trade in the league.
 *
 * Exposure on production 2026-09-03 was zero only because all 55 leagues carry
 * trade_review_type = 'none' and a trade must be 'under_review' to accept a
 * vote. One commissioner picking 'league_vote' in the settings UI opens it, with
 * no deploy.
 */
const LEAGUE = '11111111-1111-1111-1111-111111111111';
const OWN_TEAM = '22222222-2222-2222-2222-222222222222';
const OTHER_TEAM = '33333333-3333-3333-3333-333333333333';
const TRADE = '44444444-4444-4444-4444-444444444444';

/** One chain per table. `teams` answers both the membership probe and the
 *  fresh team-identity resolver, and both ask the same question: which team in
 *  this league does u-test own. */
function tables(ownTeam: { id: string } | null = { id: OWN_TEAM }) {
  return {
    trade_offers: createChain({ data: { league_id: LEAGUE }, error: null }),
    leagues: createChain({ data: { commissioner_id: 'u-test' }, error: null }),
    teams: createChain({ data: ownTeam, error: null }),
  };
}

function vote(app: any, body: unknown) {
  return app.request(`/api/trades/${TRADE}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    body: JSON.stringify(body),
  });
}

const RECORDED = [
  {
    success: true,
    message: 'Vote recorded',
    veto_count: 1,
    approve_count: 0,
    votes_needed: 2,
    is_vetoed: false,
  },
];

describe('POST /api/trades/:tradeId/vote — a member cannot vote as another team', () => {
  it('refuses a voterTeamId the caller does not own, and never reaches the RPC', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    const mock = createMockSupabase(tables(), { data: RECORDED, error: null });
    (createUserClient as any).mockReturnValue(mock);

    const res = await vote(app, { voterTeamId: OTHER_TEAM, vote: 'veto' });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toMatch(/only vote as a team you own/i);
    // The spoofed id never got near submit_trade_vote.
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('accepts the caller own team and passes the SERVER-resolved id to the RPC', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    const mock = createMockSupabase(tables(), { data: RECORDED, error: null });
    (createUserClient as any).mockReturnValue(mock);

    const res = await vote(app, { voterTeamId: OWN_TEAM, vote: 'veto' });

    expect(res.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith('submit_trade_vote', {
      p_trade_offer_id: TRADE,
      p_voter_team_id: OWN_TEAM,
      p_vote: 'veto',
    });
  });

  it('refuses a league member who owns no team, even the commissioner', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    // Commissioner of the league (so membership passes) but owns no team: 55 of
    // 166 production team rows have owner_id NULL, so this is not hypothetical.
    const mock = createMockSupabase(tables(null), { data: RECORDED, error: null });
    (createUserClient as any).mockReturnValue(mock);

    const res = await vote(app, { voterTeamId: OTHER_TEAM, vote: 'approve' });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.message).toMatch(/do not own a team/i);
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('surfaces the RPC own refusal instead of reporting a phantom success', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    // submit_trade_vote RETURNS TABLE(success, message, ...) and reports refusals
    // in the row, not in `error`. The service used to ignore both columns.
    const refused = [
      {
        success: false,
        message: 'Trade is not under review (status: accepted)',
        veto_count: 0,
        approve_count: 0,
        votes_needed: 0,
        is_vetoed: false,
      },
    ];
    const mock = createMockSupabase(tables(), { data: refused, error: null });
    (createUserClient as any).mockReturnValue(mock);

    const res = await vote(app, { voterTeamId: OWN_TEAM, vote: 'approve' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/not under review/i);
  });
});

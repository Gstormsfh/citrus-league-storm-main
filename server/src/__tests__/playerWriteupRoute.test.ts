import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createChain, createMockSupabase } from './helpers';
import {
  clearDashboardIndexCache,
  clearPlayerXgHistoryCache,
} from '../services/PlayerDashboardService';
import { LeagueMembershipService } from '../services/LeagueMembershipService';

/**
 * GET /api/players/:playerId/xg-history — THE SERVER-RENDERED WRITEUP.
 *
 * Every word a player card shows must be changeable with a server deploy,
 * not an App Store round trip, so the writeup engine moved into
 * `@citrus/shared` and now runs here. It rides on THIS payload, which the
 * player modal already fetches, so it costs no second round trip and no
 * loading state.
 *
 * What is pinned here and nowhere else:
 *
 *  1. THE WRITEUP IS AN ENHANCEMENT, NEVER A DEPENDENCY. The career arc
 *     this endpoint has always served must survive anything the writeup
 *     path can do to itself. A dead index read is a 200 with `points` and
 *     no `writeup` key, and the browser renders the copy still in its
 *     bundle. That fallback is the condition on which this shipped.
 *  2. THE PROJECTION SENTENCE IS SCOPED TO ONE LEAGUE'S SCORING. Two
 *     leagues with different `league_scoring_rules` get two different
 *     numbers for the same player, and a request that names no league gets
 *     no sentence at all rather than a league-neutral number that is wrong
 *     for everyone.
 *  3. A LEAGUE'S WEIGHTS ARE NOT PUBLIC. `get_effective_scoring_rules` is
 *     SECURITY DEFINER with no membership clause of its own, so a
 *     non-member naming a league id in the query string must not reach it.
 *
 * The auth gate itself is asserted in app.test.ts against the REAL
 * middleware, because this file stubs it out.
 */

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

beforeEach(() => {
  clearDashboardIndexCache();
  clearPlayerXgHistoryCache();
  LeagueMembershipService.clearCache();
});

afterEach(() => vi.clearAllMocks());

const MCDAVID = 8478402;
const MY_LEAGUE = '11111111-1111-1111-1111-111111111111';
const OTHER_LEAGUE = '22222222-2222-2222-2222-222222222222';
const NOT_MY_LEAGUE = '33333333-3333-3333-3333-333333333333';

const DIRECTORY_ROW = {
  player_id: MCDAVID,
  full_name: 'Connor McDavid',
  position_code: 'C',
  team_abbrev: 'EDM',
  jersey_number: '97',
  headshot_url: null,
  eligible_positions: 'C',
  season: 2025,
  birthdate: '1997-01-13',
  career: {
    gp: 700,
    goals: 340,
    assists: 700,
    points: 1040,
    seasons: 10,
    draft: { year: 2015, round: 1, overall: 1, team: 'EDM' },
    awards: [{ name: 'Hart Memorial Trophy', count: 3 }],
  },
};

const STATS_ROW = {
  player_id: MCDAVID,
  games_played: 76,
  nhl_goals: 44,
  nhl_assists: 89,
  nhl_shots_on_goal: 280,
  nhl_hits: 40,
  nhl_blocks: 25,
  nhl_ppp: 48,
  nhl_plus_minus: 28,
  nhl_pim: 24,
  nhl_shp: 2,
  nhl_toi_seconds: 76 * 1290,
  x_goals: 36.5,
  goalie_gp: 0,
  nhl_wins: 0,
  nhl_losses: 0,
  nhl_ot_losses: 0,
  nhl_saves: 0,
  nhl_save_pct: 0,
  nhl_gaa: 0,
  nhl_shutouts: 0,
  nhl_goals_against: 0,
  updated_at: '2026-09-01T06:00:00.000Z',
};

const ROS_ROW = {
  player_id: MCDAVID,
  games_remaining: 80,
  total_projected_points: 400,
  avg_points_per_game: 5,
  projected_goals: 45,
  projected_assists: 90,
  projected_sog: 290,
  projected_ppp: 50,
  projected_hits: 40,
  projected_blocks: 25,
  projected_pim: 24,
  projected_shp: 2,
  projected_ga_ros: null,
  projected_wins_ros: null,
  projected_saves_ros: null,
  projected_shutouts_ros: null,
  updated_at: '2026-09-01T06:00:00.000Z',
};

const XG_SEASON_ROWS = [2021, 2022, 2023].map((season) => ({
  season,
  game_type: 'regular',
  player_id: MCDAVID,
  team_id: 22,
  shots: 250,
  sog: 250,
  goals: 44,
  xg: 38,
  finishing: 6,
  updated_at: '2026-09-01T06:00:00.000Z',
}));

const CATALOG = [
  { stat_key: 'goals', applies_to: 'skater' },
  { stat_key: 'assists', applies_to: 'skater' },
  { stat_key: 'shots_on_goal', applies_to: 'skater' },
  { stat_key: 'blocks', applies_to: 'skater' },
  { stat_key: 'hits', applies_to: 'skater' },
  { stat_key: 'power_play_points', applies_to: 'skater' },
  { stat_key: 'short_handed_points', applies_to: 'skater' },
  { stat_key: 'penalty_minutes', applies_to: 'skater' },
];

/**
 * Two leagues that score a goal very differently. The projection carries 45
 * of them, so the two writeups cannot come out the same unless the league
 * was ignored.
 */
const RULES: Record<string, Array<{ stat_key: string; multiplier: number }>> = {
  [MY_LEAGUE]: [{ stat_key: 'goals', multiplier: 3 }, { stat_key: 'assists', multiplier: 1 }],
  [OTHER_LEAGUE]: [{ stat_key: 'goals', multiplier: 13 }, { stat_key: 'assists', multiplier: 1 }],
};

interface WireOptions {
  /** False makes the caller a non-member of every league. */
  member?: boolean;
  /** True makes the index's spine read fail, which must not fail the route. */
  indexDown?: boolean;
}

function wire(options: WireOptions = {}) {
  const { member = true, indexDown = false } = options;
  const rpc = vi.fn(async (_fn: string, args: { p_league_id: string }) => ({
    data: RULES[args.p_league_id] ?? [],
    error: null,
  }));

  const user = createMockSupabase();
  user.rpc = rpc;
  user.from = vi.fn((table: string) => {
    switch (table) {
      case 'player_directory':
        return indexDown
          ? createChain({ data: null, error: { message: 'player_directory unavailable' } })
          : createChain({ data: [DIRECTORY_ROW], error: null });
      case 'player_season_stats':
        return createChain({ data: [STATS_ROW], error: null });
      case 'player_ros_projections':
        return createChain({ data: [ROS_ROW], error: null });
      case 'player_xg_season':
        return createChain({ data: XG_SEASON_ROWS, error: null });
      case 'stat_catalog':
        return createChain({ data: CATALOG, error: null });
      // LeagueMembershipService: commissioner of the league, or of nothing.
      case 'leagues':
        return createChain({ data: { commissioner_id: member ? 'u-test' : 'someone-else' }, error: null });
      case 'teams':
        return createChain({ data: null, error: null });
      default:
        return createChain({ data: [], error: null });
    }
  });
  return { user, rpc };
}

async function get(path: string, options: WireOptions = {}) {
  const { createUserClient } = await import('../lib/supabase');
  const wired = wire(options);
  (createUserClient as any).mockReturnValue(wired.user);
  const { app } = await import('../app');
  const res = await app.request(path);
  return { res, ...wired };
}

/** "Projects to 1234 fantasy points over 80 games ..." -> 1234. */
function projectedPoints(analysis: string): number | null {
  const m = /Projects to (\d+) fantasy points/.exec(analysis);
  return m ? Number(m[1]) : null;
}

describe('GET /api/players/:playerId/xg-history — the server-rendered writeup', () => {
  it('carries the writeup alongside the career arc it has always served', async () => {
    const { res } = await get(`/api/players/${MCDAVID}/xg-history`);
    expect(res.status).toBe(200);

    const { data } = await res.json();
    expect(data.player_id).toBe(MCDAVID);
    expect(data.points).toHaveLength(3);

    expect(data.writeup.headline).toBe('Dual scoring routes');
    expect(data.writeup.summary).toContain('2025-26');
    expect(data.writeup.summary).not.toContain('this season');
    expect(data.writeup.hasEnoughData).toBe(true);
    expect(data.writeup.cardNote).toContain('P/GP');
    expect(Array.isArray(data.writeup.tags)).toBe(true);
    // The extras are assembled server-side out of rows the browser used to
    // fetch for itself: his age, the seasons on our books, the career
    // document and the cohort read.
    expect(data.writeup.summary).toContain('Career: 340 goals and 1,040 points in 700 games');
    expect(data.writeup.summary).toContain('Drafted 1st overall in 2015 by EDM');
    expect(data.writeup.summary).toMatch(/At 2\d, he has three straight seasons of 30 goals or more/);
  });

  it('omits the projection sentence when no league was named, and never asks for rules', async () => {
    const { res, rpc } = await get(`/api/players/${MCDAVID}/xg-history`);
    const { data } = await res.json();

    expect(data.writeup.analysis).not.toMatch(/Projects to/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('scores the projection with the league that asked for it', async () => {
    const mine = await get(`/api/players/${MCDAVID}/xg-history?leagueId=${MY_LEAGUE}`);
    const theirs = await get(`/api/players/${MCDAVID}/xg-history?leagueId=${OTHER_LEAGUE}`);

    const a = (await mine.res.json()).data.writeup.analysis as string;
    const b = (await theirs.res.json()).data.writeup.analysis as string;

    expect(projectedPoints(a)).not.toBeNull();
    expect(projectedPoints(b)).not.toBeNull();
    // 45 projected goals, ten points of weight between the two leagues.
    expect((projectedPoints(b) as number) - (projectedPoints(a) as number)).toBe(450);

    expect(mine.rpc).toHaveBeenCalledWith('get_effective_scoring_rules', { p_league_id: MY_LEAGUE });
  });

  it('gives a non-member no sentence and never runs the SECURITY DEFINER rules read', async () => {
    const { res, rpc } = await get(
      `/api/players/${MCDAVID}/xg-history?leagueId=${NOT_MY_LEAGUE}`,
      { member: false },
    );

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.writeup.analysis).not.toMatch(/Projects to/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a leagueId that is not a UUID before anything reads it', async () => {
    const { res, rpc, user } = await get(`/api/players/${MCDAVID}/xg-history?leagueId=' OR 1=1--`);
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(user.from).not.toHaveBeenCalled();
  });

  it('still serves the career arc when the writeup cannot be built', async () => {
    // The index's spine read is dead, so there is no row to write about.
    // The endpoint's own job is unaffected and must still succeed.
    const { res } = await get(`/api/players/${MCDAVID}/xg-history?leagueId=${MY_LEAGUE}`, {
      indexDown: true,
    });

    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.points).toHaveLength(3);
    expect(data.as_of).toBe('2026-09-01T06:00:00.000Z');
    expect('writeup' in data).toBe(false);
  });
});

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { getTodayMST } from '@citrus/shared';
import { createChain, createMockSupabase } from './helpers';

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

afterEach(() => vi.clearAllMocks());

/**
 * PUT /api/rosters/league/:leagueId/team/:teamId/lineup — game-lock guard
 * (2026-09-01, Sleeper parity audit R6).
 *
 * Before this the route guarded season-complete only. The client refused to
 * move a locked player through the tap handlers, but Auto Lineup did not,
 * and nothing on the server did: a save that benched a starter whose game
 * had begun was a 200, and the snapshot writer's upsert overwrote the
 * locked row with it. Now it is a 409 that names the player, and nothing
 * is written.
 */
const LEAGUE = '11111111-1111-1111-1111-111111111111';
const TEAM = '22222222-2222-2222-2222-222222222222';
const TODAY = getTodayMST();
const HOUR_AGO = new Date(Date.now() - 3600_000).toISOString();

const MCDAVID = 8478402;
const DRAISAITL = 8477934;

/** One chain per table; every builder method returns the chain, awaiting it
 *  yields the table's value. The same object serves every read of a table,
 *  so each value is shaped to satisfy all of that table's readers. */
function tables() {
  return {
    // membership (commissioner_id), season state (settings), slot config (settings)
    leagues: createChain({ data: { id: LEAGUE, commissioner_id: 'someone-else', settings: {}, league_type: 'fantasy' }, error: null }),
    // membership (maybeSingle) + ownership (single)
    teams: createChain({ data: { id: TEAM, owner_id: 'u-test' }, error: null }),
    // season state: no matchups => not complete; snapshot writer: no matchup => base path
    matchups: createChain({ data: [], error: null }),
    roster_assignments: createChain({ data: [{ player_id: String(MCDAVID) }, { player_id: String(DRAISAITL) }], error: null }),
    player_directory: createChain({
      data: [
        { player_id: MCDAVID, full_name: 'Connor McDavid', team_abbrev: 'EDM', position_code: 'C', eligible_positions: ['C'] },
        { player_id: DRAISAITL, full_name: 'Leon Draisaitl', team_abbrev: 'TOR', position_code: 'C', eligible_positions: ['C'] },
      ],
      error: null,
    }),
    // EDM is under way; TOR has no game tonight.
    nhl_games: createChain({ data: [{ game_time: HOUR_AGO, status: 'live', home_team: 'EDM', away_team: 'CGY', game_date: TODAY }], error: null }),
    // Today on record: McDavid starting at C1, Draisaitl on the bench.
    fantasy_daily_rosters: createChain({
      data: [
        { player_id: MCDAVID, slot_type: 'active', slot_id: 'slot-C-1' },
        { player_id: DRAISAITL, slot_type: 'bench', slot_id: null },
      ],
      error: null,
    }),
    // roster protection read + the base upsert's returned row
    team_lineups: createChain({
      data: { team_id: TEAM, league_id: LEAGUE, starters: [String(MCDAVID)], bench: [String(DRAISAITL)], ir: [], slot_assignments: { [String(MCDAVID)]: 'slot-C-1' } },
      error: null,
    }),
  };
}

function put(app: any, body: unknown) {
  return app.request(`/api/rosters/league/${LEAGUE}/team/${TEAM}/lineup`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/rosters/league/:leagueId/team/:teamId/lineup — game locks', () => {
  it('refuses, with a 409 naming the player, a save that benches a starter whose game has begun', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    const t = tables();
    (createUserClient as any).mockReturnValue(createMockSupabase(t));

    const res = await put(app, {
      starters: [String(DRAISAITL)],
      bench: [String(MCDAVID)],
      ir: [],
      slot_assignments: { [String(DRAISAITL)]: 'slot-C-1' },
      target_date: TODAY,
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toMatch(/Connor McDavid's game has started/);
    // Nothing was written.
    expect(t.fantasy_daily_rosters.upsert).not.toHaveBeenCalled();
    expect(t.fantasy_daily_rosters.delete).not.toHaveBeenCalled();
    expect(t.team_lineups.upsert).not.toHaveBeenCalled();
  });

  it('saves when the locked player keeps his slot and only an unlocked player moves', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    const t = tables();
    (createUserClient as any).mockReturnValue(createMockSupabase(t));

    const res = await put(app, {
      starters: [String(MCDAVID), String(DRAISAITL)],
      bench: [],
      ir: [],
      slot_assignments: { [String(MCDAVID)]: 'slot-C-1', [String(DRAISAITL)]: 'slot-C-2' },
      target_date: TODAY,
    });

    expect(res.status).toBe(200);
    // The save went through (no matchup on record, so the base lineup path wrote).
    expect(t.team_lineups.upsert).toHaveBeenCalledTimes(1);
  });

  it('refuses a base save (no target_date) that moves a locked player — it would propagate to today', async () => {
    const { createUserClient } = await import('../lib/supabase');
    const { app } = await import('../app');
    const t = tables();
    (createUserClient as any).mockReturnValue(createMockSupabase(t));

    const res = await put(app, {
      starters: [],
      bench: [String(MCDAVID), String(DRAISAITL)],
      ir: [],
      slot_assignments: {},
    });

    expect(res.status).toBe(409);
    expect(t.team_lineups.upsert).not.toHaveBeenCalled();
  });
});

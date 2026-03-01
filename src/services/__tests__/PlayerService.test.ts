import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock Supabase client
// =============================================================================

// Build a chainable mock: each method returns `this` (the same object)
// except terminal methods which resolve with { data, error }.
function createChainMock() {
  const chain: Record<string, any> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.upsert = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.or = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.range = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  // By default the chain itself resolves as a promise returning empty data
  chain.then = vi.fn().mockImplementation((resolve: any) =>
    resolve({ data: [], error: null })
  );
  return chain;
}

let defaultChain = createChainMock();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn().mockImplementation(() => defaultChain),
    rpc: vi.fn(),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/utils/seasonConstants', () => ({
  CURRENT_SEASON: 2025,
  HEADSHOT_SEASON: '20252026',
  getHeadshotUrl: (teamAbbrev: string | null, playerId: number | string | null) => {
    if (!teamAbbrev || !playerId) return null;
    return `https://assets.nhle.com/mugs/nhl/20252026/${teamAbbrev}/${playerId}.png`;
  },
}));

import { supabase } from '@/integrations/supabase/client';

// =============================================================================
// HELPERS
// =============================================================================

/** Rebuild a fresh default chain mock and wire it into `supabase.from`. */
function resetChain() {
  defaultChain = createChainMock();
  (supabase.from as any).mockReturnValue(defaultChain);
}

/**
 * Configure `supabase.from` to return different chain mocks depending on the
 * table name. This is critical for methods that query multiple tables (like
 * getAllPlayers which queries player_directory, player_season_stats,
 * player_talent_metrics, goalie_gsax_primary, and goalie_gsax).
 */
function perTableChains(map: Record<string, ReturnType<typeof createChainMock>>) {
  (supabase.from as any).mockImplementation((table: string) => {
    return map[table] ?? defaultChain;
  });
  return map;
}

/** Create a minimal player_directory row for testing. */
function makeDirectoryRow(overrides: Partial<{
  season: number;
  player_id: number;
  full_name: string;
  team_abbrev: string | null;
  position_code: string | null;
  is_goalie: boolean;
  jersey_number: string | null;
  headshot_url: string | null;
  eligible_positions: string | null;
}> = {}) {
  return {
    season: 2025,
    player_id: 8478402,
    full_name: 'Connor McDavid',
    team_abbrev: 'EDM',
    position_code: 'C',
    is_goalie: false,
    jersey_number: '97',
    headshot_url: null,
    eligible_positions: null,
    ...overrides,
  };
}

/** Create a minimal player_season_stats row for testing. */
function makeStatsRow(overrides: Partial<{
  season: number;
  player_id: number;
  team_abbrev: string | null;
  position_code: string | null;
  is_goalie: boolean;
  games_played: number;
  icetime_seconds: number;
  nhl_toi_seconds: number;
  goals: number;
  primary_assists: number;
  secondary_assists: number;
  points: number;
  shots_on_goal: number;
  hits: number;
  blocks: number;
  pim: number;
  ppp: number;
  shp: number;
  plus_minus: number;
  nhl_plus_minus: number;
  nhl_goals: number;
  nhl_assists: number;
  nhl_points: number;
  nhl_shots_on_goal: number;
  nhl_hits: number;
  nhl_blocks: number;
  nhl_pim: number;
  nhl_ppp: number;
  nhl_shp: number;
  x_goals: number;
  x_assists: number;
  goalie_gp: number;
  wins: number;
  saves: number;
  shots_faced: number;
  goals_against: number;
  shutouts: number;
  save_pct: number | null;
  nhl_wins: number;
  nhl_losses: number;
  nhl_ot_losses: number;
  nhl_saves: number;
  nhl_shots_faced: number;
  nhl_goals_against: number;
  nhl_shutouts: number;
  nhl_save_pct: number | null;
  nhl_gaa: number;
}> = {}) {
  return {
    season: 2025,
    player_id: 8478402,
    team_abbrev: 'EDM',
    position_code: 'C',
    is_goalie: false,
    games_played: 40,
    icetime_seconds: 50000,
    nhl_toi_seconds: 50000,
    goals: 20,
    primary_assists: 25,
    secondary_assists: 10,
    points: 55,
    shots_on_goal: 150,
    hits: 10,
    blocks: 5,
    pim: 12,
    ppp: 8,
    shp: 1,
    plus_minus: 15,
    nhl_plus_minus: 15,
    nhl_goals: 20,
    nhl_assists: 35,
    nhl_points: 55,
    nhl_shots_on_goal: 150,
    nhl_hits: 10,
    nhl_blocks: 5,
    nhl_pim: 12,
    nhl_ppp: 8,
    nhl_shp: 1,
    x_goals: 18.5,
    x_assists: 30.2,
    goalie_gp: 0,
    wins: 0,
    saves: 0,
    shots_faced: 0,
    goals_against: 0,
    shutouts: 0,
    save_pct: null,
    nhl_wins: 0,
    nhl_losses: 0,
    nhl_ot_losses: 0,
    nhl_saves: 0,
    nhl_shots_faced: 0,
    nhl_goals_against: 0,
    nhl_shutouts: 0,
    nhl_save_pct: null,
    nhl_gaa: 0,
    ...overrides,
  };
}

/** Create a minimal goalie directory + stats row pair. */
function makeGoalieDirectoryRow(overrides: Partial<ReturnType<typeof makeDirectoryRow>> = {}) {
  return makeDirectoryRow({
    player_id: 8477424,
    full_name: 'Stuart Skinner',
    team_abbrev: 'EDM',
    position_code: 'G',
    is_goalie: true,
    jersey_number: '74',
    ...overrides,
  });
}

function makeGoalieStatsRow(overrides: Partial<ReturnType<typeof makeStatsRow>> = {}) {
  return makeStatsRow({
    player_id: 8477424,
    position_code: 'G',
    is_goalie: true,
    games_played: 30,
    goalie_gp: 30,
    nhl_wins: 18,
    nhl_losses: 8,
    nhl_ot_losses: 4,
    nhl_saves: 800,
    nhl_shots_faced: 870,
    nhl_goals_against: 70,
    nhl_shutouts: 2,
    nhl_save_pct: 0.920,
    nhl_gaa: 2.45,
    wins: 18,
    saves: 800,
    shots_faced: 870,
    goals_against: 70,
    shutouts: 2,
    save_pct: 0.920,
    ...overrides,
  });
}

/**
 * Set up per-table mocks for getAllPlayers / getPlayersByIds.
 * Returns chain mocks keyed by table name so callers can configure
 * custom resolved values on individual tables.
 */
function setupPlayerTableMocks(opts: {
  dirRows?: any[];
  statRows?: any[];
  talentRows?: any[];
  gsaxPrimaryRows?: any[];
  gsaxFallbackRows?: any[];
} = {}) {
  const dirChain = createChainMock();
  const statChain = createChainMock();
  const talentChain = createChainMock();
  const gsaxPrimaryChain = createChainMock();
  const gsaxFallbackChain = createChainMock();

  dirChain.then = vi.fn().mockImplementation((resolve: any) =>
    resolve({ data: opts.dirRows ?? [], error: null })
  );
  statChain.then = vi.fn().mockImplementation((resolve: any) =>
    resolve({ data: opts.statRows ?? [], error: null })
  );
  talentChain.then = vi.fn().mockImplementation((resolve: any) =>
    resolve({ data: opts.talentRows ?? [], error: null })
  );
  gsaxPrimaryChain.then = vi.fn().mockImplementation((resolve: any) =>
    resolve({ data: opts.gsaxPrimaryRows ?? [], error: null })
  );
  gsaxFallbackChain.then = vi.fn().mockImplementation((resolve: any) =>
    resolve({ data: opts.gsaxFallbackRows ?? [], error: null })
  );

  perTableChains({
    player_directory: dirChain,
    player_season_stats: statChain,
    player_talent_metrics: talentChain,
    goalie_gsax_primary: gsaxPrimaryChain,
    goalie_gsax: gsaxFallbackChain,
  });

  return { dirChain, statChain, talentChain, gsaxPrimaryChain, gsaxFallbackChain };
}

// =============================================================================
// Import PlayerService AFTER mocks are registered
// =============================================================================

import { PlayerService } from '../PlayerService';
import type { Player } from '../PlayerService';

// =============================================================================
// Tests
// =============================================================================

describe('PlayerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
    // Clear internal cache between tests so each test starts fresh
    PlayerService.clearCache();
  });

  // ===========================================================================
  // clearCache
  // ===========================================================================

  describe('clearCache', () => {
    it('does not throw when called with no cached data', () => {
      expect(() => PlayerService.clearCache()).not.toThrow();
    });
  });

  // ===========================================================================
  // getAllPlayers
  // ===========================================================================

  describe('getAllPlayers', () => {
    it('returns an empty array when directory has no rows', async () => {
      setupPlayerTableMocks({ dirRows: [], statRows: [] });
      const players = await PlayerService.getAllPlayers();
      expect(players).toEqual([]);
    });

    it('returns a mapped skater with NHL.com official stats', async () => {
      const dirRow = makeDirectoryRow();
      const statRow = makeStatsRow();

      setupPlayerTableMocks({ dirRows: [dirRow], statRows: [statRow] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);

      const p = players[0];
      expect(p.id).toBe('8478402');
      expect(p.full_name).toBe('Connor McDavid');
      expect(p.position).toBe('C');
      expect(p.team).toBe('EDM');
      expect(p.goals).toBe(20);
      expect(p.assists).toBe(35);
      expect(p.points).toBe(55); // goals + assists
      expect(p.plus_minus).toBe(15);
      expect(p.shots).toBe(150);
      expect(p.hits).toBe(10);
      expect(p.blocks).toBe(5);
      expect(p.pim).toBe(12);
      expect(p.ppp).toBe(8);
      expect(p.shp).toBe(1);
      expect(p.xGoals).toBe(18.5);
      // Skater should NOT have goalie-specific stats
      expect(p.wins).toBeNull();
      expect(p.losses).toBeNull();
      expect(p.saves).toBeNull();
      expect(p.save_percentage).toBeNull();
      expect(p.goals_against_average).toBeNull();
    });

    it('returns a mapped goalie with NHL.com official stats and GSAx', async () => {
      const dirRow = makeGoalieDirectoryRow();
      const statRow = makeGoalieStatsRow();

      setupPlayerTableMocks({
        dirRows: [dirRow],
        statRows: [statRow],
        gsaxPrimaryRows: [{ goalie_id: 8477424, regressed_gsax: 5.2 }],
      });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);

      const g = players[0];
      expect(g.id).toBe('8477424');
      expect(g.position).toBe('G');
      expect(g.wins).toBe(18);
      expect(g.losses).toBe(8);
      expect(g.ot_losses).toBe(4);
      expect(g.saves).toBe(800);
      expect(g.shutouts).toBe(2);
      expect(g.save_percentage).toBe(0.920);
      expect(g.goals_against_average).toBe(2.45);
      expect(g.goalsSavedAboveExpected).toBe(5.2);
      expect(g.goalie_gp).toBe(30);
    });

    it('falls back to goalie_gsax table when goalie_gsax_primary has no data', async () => {
      const dirRow = makeGoalieDirectoryRow();
      const statRow = makeGoalieStatsRow();

      setupPlayerTableMocks({
        dirRows: [dirRow],
        statRows: [statRow],
        gsaxPrimaryRows: [], // no primary GSAx
        gsaxFallbackRows: [{ goalie_id: 8477424, regressed_gsax: 3.7 }],
      });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].goalsSavedAboveExpected).toBe(3.7);
    });

    it('sets goalie GSAx to 0 when no GSAx data is available', async () => {
      const dirRow = makeGoalieDirectoryRow();
      const statRow = makeGoalieStatsRow();

      setupPlayerTableMocks({
        dirRows: [dirRow],
        statRows: [statRow],
        gsaxPrimaryRows: [],
        gsaxFallbackRows: [],
      });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].goalsSavedAboveExpected).toBe(0);
    });

    it('returns player with zero stats when games_played is 0', async () => {
      const dirRow = makeDirectoryRow();
      const statRow = makeStatsRow({
        games_played: 0,
        nhl_goals: 5, // These should be ignored because GP = 0
        nhl_assists: 10,
      });

      setupPlayerTableMocks({ dirRows: [dirRow], statRows: [statRow] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);

      const p = players[0];
      expect(p.games_played).toBe(0);
      expect(p.goals).toBe(0);
      expect(p.assists).toBe(0);
      expect(p.points).toBe(0);
    });

    it('includes players from directory even when no stats record exists', async () => {
      const dirRow = makeDirectoryRow({
        player_id: 9999999,
        full_name: 'Rookie NoStats',
        team_abbrev: 'CGY',
        position_code: 'LW',
      });

      setupPlayerTableMocks({ dirRows: [dirRow], statRows: [] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);

      const p = players[0];
      expect(p.id).toBe('9999999');
      expect(p.full_name).toBe('Rookie NoStats');
      expect(p.goals).toBe(0);
      expect(p.assists).toBe(0);
      expect(p.points).toBe(0);
      expect(p.games_played).toBe(0);
    });

    it('sorts players by points descending', async () => {
      const dir1 = makeDirectoryRow({ player_id: 1, full_name: 'Player A' });
      const dir2 = makeDirectoryRow({ player_id: 2, full_name: 'Player B' });
      const dir3 = makeDirectoryRow({ player_id: 3, full_name: 'Player C' });

      const stat1 = makeStatsRow({ player_id: 1, nhl_goals: 10, nhl_assists: 5 });
      const stat2 = makeStatsRow({ player_id: 2, nhl_goals: 30, nhl_assists: 40 });
      const stat3 = makeStatsRow({ player_id: 3, nhl_goals: 20, nhl_assists: 15 });

      setupPlayerTableMocks({
        dirRows: [dir1, dir2, dir3],
        statRows: [stat1, stat2, stat3],
      });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(3);
      expect(players[0].full_name).toBe('Player B'); // 70 pts
      expect(players[1].full_name).toBe('Player C'); // 35 pts
      expect(players[2].full_name).toBe('Player A'); // 15 pts
    });

    it('derives IR/LTIR status from talent metrics', async () => {
      const dirRow = makeDirectoryRow();
      const statRow = makeStatsRow();

      setupPlayerTableMocks({
        dirRows: [dirRow],
        statRows: [statRow],
        talentRows: [{ player_id: 8478402, season: 2025, roster_status: 'IR', is_ir_eligible: true }],
      });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].status).toBe('injured');
      expect(players[0].roster_status).toBe('IR');
      expect(players[0].is_ir_eligible).toBe(true);
    });

    it('derives active status when no IR/LTIR roster_status', async () => {
      const dirRow = makeDirectoryRow();
      const statRow = makeStatsRow();

      setupPlayerTableMocks({
        dirRows: [dirRow],
        statRows: [statRow],
        talentRows: [{ player_id: 8478402, season: 2025, roster_status: 'ACT', is_ir_eligible: false }],
      });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].status).toBe('active');
    });

    it('returns empty array and logs error when directory fetch fails', async () => {
      const dirChain = createChainMock();
      const statChain = createChainMock();
      const talentChain = createChainMock();

      dirChain.then = vi.fn().mockImplementation((resolve: any) =>
        resolve({ data: null, error: { message: 'Connection error' } })
      );
      statChain.then = vi.fn().mockImplementation((resolve: any) =>
        resolve({ data: [], error: null })
      );
      talentChain.then = vi.fn().mockImplementation((resolve: any) =>
        resolve({ data: [], error: null })
      );

      perTableChains({
        player_directory: dirChain,
        player_season_stats: statChain,
        player_talent_metrics: talentChain,
      });

      const players = await PlayerService.getAllPlayers();
      expect(players).toEqual([]);
    });

    it('returns empty array and logs error when stats fetch fails', async () => {
      const dirChain = createChainMock();
      const statChain = createChainMock();
      const talentChain = createChainMock();

      dirChain.then = vi.fn().mockImplementation((resolve: any) =>
        resolve({ data: [makeDirectoryRow()], error: null })
      );
      statChain.then = vi.fn().mockImplementation((resolve: any) =>
        resolve({ data: null, error: { message: 'Stats table error' } })
      );
      talentChain.then = vi.fn().mockImplementation((resolve: any) =>
        resolve({ data: [], error: null })
      );

      perTableChains({
        player_directory: dirChain,
        player_season_stats: statChain,
        player_talent_metrics: talentChain,
      });

      const players = await PlayerService.getAllPlayers();
      expect(players).toEqual([]);
    });

    it('uses cached data on second call within TTL', async () => {
      setupPlayerTableMocks({
        dirRows: [makeDirectoryRow()],
        statRows: [makeStatsRow()],
      });

      const first = await PlayerService.getAllPlayers();
      expect(first).toHaveLength(1);

      // Second call should return cached result — supabase.from should not be called again
      // after the initial calls
      const callCountAfterFirst = (supabase.from as any).mock.calls.length;

      const second = await PlayerService.getAllPlayers();
      expect(second).toHaveLength(1);
      expect((supabase.from as any).mock.calls.length).toBe(callCountAfterFirst);
    });

    it('fetches fresh data after cache is cleared', async () => {
      setupPlayerTableMocks({
        dirRows: [makeDirectoryRow()],
        statRows: [makeStatsRow()],
      });

      await PlayerService.getAllPlayers();
      const callCountAfterFirst = (supabase.from as any).mock.calls.length;

      PlayerService.clearCache();

      // Re-setup mocks since clearAllMocks was not called
      setupPlayerTableMocks({
        dirRows: [makeDirectoryRow({ full_name: 'Updated Name' })],
        statRows: [makeStatsRow()],
      });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].full_name).toBe('Updated Name');
      // Supabase.from should have been called again
      expect((supabase.from as any).mock.calls.length).toBeGreaterThan(callCountAfterFirst);
    });

    it('derives dual-position eligibility when stats position differs from directory', async () => {
      const dirRow = makeDirectoryRow({ position_code: 'C' });
      const statRow = makeStatsRow({ position_code: 'LW' }); // different position

      setupPlayerTableMocks({ dirRows: [dirRow], statRows: [statRow] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].eligible_positions).toContain('C');
      expect(players[0].eligible_positions).toContain('LW');
      expect(players[0].eligible_positions).toHaveLength(2);
    });

    it('uses pre-computed eligible_positions from DB when available', async () => {
      // eligible_positions column is set by sync_rosters.py based on game-level data
      const dirRow = makeDirectoryRow({
        position_code: 'C',
        eligible_positions: 'C,LW,RW', // Player has 5+ games at C, LW, and RW
      });
      const statRow = makeStatsRow({ position_code: 'C' }); // stats only show C

      setupPlayerTableMocks({ dirRows: [dirRow], statRows: [statRow] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      // Should use DB eligible_positions (3 positions) instead of fallback (1 position)
      expect(players[0].eligible_positions).toEqual(['C', 'LW', 'RW']);
    });

    it('generates headshot URL from team and player ID when not in directory', async () => {
      const dirRow = makeDirectoryRow({ headshot_url: null });
      const statRow = makeStatsRow();

      setupPlayerTableMocks({ dirRows: [dirRow], statRows: [statRow] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].headshot_url).toBe(
        'https://assets.nhle.com/mugs/nhl/20252026/EDM/8478402.png'
      );
    });

    it('uses headshot_url from directory when available', async () => {
      const dirRow = makeDirectoryRow({ headshot_url: 'https://custom-headshot.com/mcdavid.png' });
      const statRow = makeStatsRow();

      setupPlayerTableMocks({ dirRows: [dirRow], statRows: [statRow] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].headshot_url).toBe('https://custom-headshot.com/mcdavid.png');
    });

    it('calculates points as goals + assists (not from nhl_points column)', async () => {
      const dirRow = makeDirectoryRow();
      const statRow = makeStatsRow({
        nhl_goals: 15,
        nhl_assists: 25,
        nhl_points: 999, // This should NOT be used — points are derived from goals + assists
      });

      setupPlayerTableMocks({ dirRows: [dirRow], statRows: [statRow] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].goals).toBe(15);
      expect(players[0].assists).toBe(25);
      expect(players[0].points).toBe(40); // 15 + 25, NOT 999
    });

    it('filters out directory rows with null player_id', async () => {
      const validRow = makeDirectoryRow();
      const nullIdRow = { ...makeDirectoryRow({ player_id: 99 }), player_id: null };

      setupPlayerTableMocks({ dirRows: [validRow, nullIdRow], statRows: [makeStatsRow()] });

      const players = await PlayerService.getAllPlayers();
      expect(players).toHaveLength(1);
      expect(players[0].id).toBe('8478402');
    });
  });

  // ===========================================================================
  // getPlayersByPosition
  // ===========================================================================

  describe('getPlayersByPosition', () => {
    it('filters players by primary position', async () => {
      const center = makeDirectoryRow({ player_id: 1, full_name: 'Center', position_code: 'C' });
      const dman = makeDirectoryRow({ player_id: 2, full_name: 'Defenseman', position_code: 'D' });
      const goalie = makeGoalieDirectoryRow({ player_id: 3, full_name: 'Goaltender' });

      setupPlayerTableMocks({
        dirRows: [center, dman, goalie],
        statRows: [
          makeStatsRow({ player_id: 1, position_code: 'C' }),
          makeStatsRow({ player_id: 2, position_code: 'D' }),
          makeGoalieStatsRow({ player_id: 3 }),
        ],
      });

      const defensemen = await PlayerService.getPlayersByPosition('D');
      expect(defensemen).toHaveLength(1);
      expect(defensemen[0].full_name).toBe('Defenseman');
    });

    it('returns empty array when no players match position', async () => {
      setupPlayerTableMocks({
        dirRows: [makeDirectoryRow()],
        statRows: [makeStatsRow()],
      });

      const result = await PlayerService.getPlayersByPosition('G');
      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // searchPlayers
  // ===========================================================================

  describe('searchPlayers', () => {
    it('finds players by case-insensitive partial name match', async () => {
      const mcd = makeDirectoryRow({ player_id: 1, full_name: 'Connor McDavid' });
      const drai = makeDirectoryRow({ player_id: 2, full_name: 'Leon Draisaitl' });
      const nuge = makeDirectoryRow({ player_id: 3, full_name: 'Ryan Nugent-Hopkins' });

      setupPlayerTableMocks({
        dirRows: [mcd, drai, nuge],
        statRows: [
          makeStatsRow({ player_id: 1 }),
          makeStatsRow({ player_id: 2 }),
          makeStatsRow({ player_id: 3 }),
        ],
      });

      const results = await PlayerService.searchPlayers('mcdavid');
      expect(results).toHaveLength(1);
      expect(results[0].full_name).toBe('Connor McDavid');
    });

    it('returns multiple matches when query matches multiple players', async () => {
      const p1 = makeDirectoryRow({ player_id: 1, full_name: 'Alex Ovechkin' });
      const p2 = makeDirectoryRow({ player_id: 2, full_name: 'Alexander Barkov' });
      const p3 = makeDirectoryRow({ player_id: 3, full_name: 'Sidney Crosby' });

      setupPlayerTableMocks({
        dirRows: [p1, p2, p3],
        statRows: [
          makeStatsRow({ player_id: 1 }),
          makeStatsRow({ player_id: 2 }),
          makeStatsRow({ player_id: 3 }),
        ],
      });

      const results = await PlayerService.searchPlayers('alex');
      expect(results).toHaveLength(2);
      expect(results.map(r => r.full_name)).toContain('Alex Ovechkin');
      expect(results.map(r => r.full_name)).toContain('Alexander Barkov');
    });

    it('returns empty array when no players match search query', async () => {
      setupPlayerTableMocks({
        dirRows: [makeDirectoryRow()],
        statRows: [makeStatsRow()],
      });

      const results = await PlayerService.searchPlayers('zzzznonexistent');
      expect(results).toEqual([]);
    });

    it('handles mixed-case search queries', async () => {
      setupPlayerTableMocks({
        dirRows: [makeDirectoryRow()],
        statRows: [makeStatsRow()],
      });

      const results = await PlayerService.searchPlayers('CONNOR');
      expect(results).toHaveLength(1);
      expect(results[0].full_name).toBe('Connor McDavid');
    });
  });

  // ===========================================================================
  // getPlayersByIds
  // ===========================================================================

  describe('getPlayersByIds', () => {
    it('returns empty array for empty playerIds input', async () => {
      const players = await PlayerService.getPlayersByIds([]);
      expect(players).toEqual([]);
      // Should not call supabase at all
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('returns mapped players for given IDs', async () => {
      const dirRow = makeDirectoryRow();
      const statRow = makeStatsRow();

      setupPlayerTableMocks({ dirRows: [dirRow], statRows: [statRow] });

      const players = await PlayerService.getPlayersByIds(['8478402']);
      expect(players).toHaveLength(1);
      expect(players[0].id).toBe('8478402');
      expect(players[0].full_name).toBe('Connor McDavid');
      expect(players[0].goals).toBe(20);
      expect(players[0].assists).toBe(35);
      expect(players[0].points).toBe(55);
    });

    it('returns multiple players for multiple IDs', async () => {
      const dir1 = makeDirectoryRow({ player_id: 1, full_name: 'Player A' });
      const dir2 = makeDirectoryRow({ player_id: 2, full_name: 'Player B' });

      const stat1 = makeStatsRow({ player_id: 1, nhl_goals: 10, nhl_assists: 20 });
      const stat2 = makeStatsRow({ player_id: 2, nhl_goals: 15, nhl_assists: 25 });

      setupPlayerTableMocks({
        dirRows: [dir1, dir2],
        statRows: [stat1, stat2],
      });

      const players = await PlayerService.getPlayersByIds(['1', '2']);
      expect(players).toHaveLength(2);
    });

    it('returns goalie with GSAx from primary table', async () => {
      const dirRow = makeGoalieDirectoryRow();
      const statRow = makeGoalieStatsRow();

      setupPlayerTableMocks({
        dirRows: [dirRow],
        statRows: [statRow],
        gsaxPrimaryRows: [{ goalie_id: 8477424, regressed_gsax: 4.1 }],
      });

      const players = await PlayerService.getPlayersByIds(['8477424']);
      expect(players).toHaveLength(1);
      expect(players[0].goalsSavedAboveExpected).toBe(4.1);
    });

    it('uses per-player cache on second call within TTL', async () => {
      setupPlayerTableMocks({
        dirRows: [makeDirectoryRow()],
        statRows: [makeStatsRow()],
      });

      const first = await PlayerService.getPlayersByIds(['8478402']);
      expect(first).toHaveLength(1);

      const callCountAfterFirst = (supabase.from as any).mock.calls.length;

      // Second call — should use per-player cache
      const second = await PlayerService.getPlayersByIds(['8478402']);
      expect(second).toHaveLength(1);
      expect(second[0].full_name).toBe('Connor McDavid');
      // No additional supabase.from calls
      expect((supabase.from as any).mock.calls.length).toBe(callCountAfterFirst);
    });

    it('fetches only uncached players on partial cache hit', async () => {
      // First call: fetch player 1
      setupPlayerTableMocks({
        dirRows: [makeDirectoryRow({ player_id: 1, full_name: 'Player A' })],
        statRows: [makeStatsRow({ player_id: 1, nhl_goals: 10, nhl_assists: 5 })],
      });

      await PlayerService.getPlayersByIds(['1']);
      const callCountAfterFirst = (supabase.from as any).mock.calls.length;

      // Second call: fetch player 1 (cached) + player 2 (uncached)
      setupPlayerTableMocks({
        dirRows: [makeDirectoryRow({ player_id: 2, full_name: 'Player B' })],
        statRows: [makeStatsRow({ player_id: 2, nhl_goals: 20, nhl_assists: 15 })],
      });

      const players = await PlayerService.getPlayersByIds(['1', '2']);
      expect(players).toHaveLength(2);
      // Should have made additional calls for player 2
      expect((supabase.from as any).mock.calls.length).toBeGreaterThan(callCountAfterFirst);
    });

    it('returns empty array on database error (no fallback to getAllPlayers)', async () => {
      const dirChain = createChainMock();
      const statChain = createChainMock();
      const talentChain = createChainMock();

      dirChain.then = vi.fn().mockImplementation((resolve: any) =>
        resolve({ data: null, error: { message: 'DB error' } })
      );
      statChain.then = vi.fn().mockImplementation((resolve: any) =>
        resolve({ data: [], error: null })
      );
      talentChain.then = vi.fn().mockImplementation((resolve: any) =>
        resolve({ data: [], error: null })
      );

      perTableChains({
        player_directory: dirChain,
        player_season_stats: statChain,
        player_talent_metrics: talentChain,
      });

      const players = await PlayerService.getPlayersByIds(['8478402']);
      expect(players).toEqual([]);
    });

    it('returns cached players on database error when partial cache exists', async () => {
      // First: cache player 1
      setupPlayerTableMocks({
        dirRows: [makeDirectoryRow({ player_id: 1, full_name: 'Cached Player' })],
        statRows: [makeStatsRow({ player_id: 1, nhl_goals: 5, nhl_assists: 5 })],
      });

      await PlayerService.getPlayersByIds(['1']);

      // Second: error fetching player 2, but player 1 is cached
      const dirChain = createChainMock();
      const statChain = createChainMock();
      const talentChain = createChainMock();

      dirChain.then = vi.fn().mockImplementation((resolve: any) =>
        resolve({ data: null, error: { message: 'DB error' } })
      );
      statChain.then = vi.fn().mockImplementation((resolve: any) =>
        resolve({ data: [], error: null })
      );
      talentChain.then = vi.fn().mockImplementation((resolve: any) =>
        resolve({ data: [], error: null })
      );

      perTableChains({
        player_directory: dirChain,
        player_season_stats: statChain,
        player_talent_metrics: talentChain,
      });

      const players = await PlayerService.getPlayersByIds(['1', '2']);
      // Should return the cached player 1, since fetching player 2 failed
      expect(players).toHaveLength(1);
      expect(players[0].full_name).toBe('Cached Player');
    });

    it('derives LTIR status from talent metrics', async () => {
      const dirRow = makeDirectoryRow();
      const statRow = makeStatsRow();

      setupPlayerTableMocks({
        dirRows: [dirRow],
        statRows: [statRow],
        talentRows: [{ player_id: 8478402, season: 2025, roster_status: 'LTIR', is_ir_eligible: true }],
      });

      const players = await PlayerService.getPlayersByIds(['8478402']);
      expect(players).toHaveLength(1);
      expect(players[0].status).toBe('injured');
      expect(players[0].roster_status).toBe('LTIR');
      expect(players[0].is_ir_eligible).toBe(true);
    });

    it('sorts returned players by points descending', async () => {
      const dir1 = makeDirectoryRow({ player_id: 1, full_name: 'Low Points' });
      const dir2 = makeDirectoryRow({ player_id: 2, full_name: 'High Points' });

      const stat1 = makeStatsRow({ player_id: 1, nhl_goals: 5, nhl_assists: 5 });
      const stat2 = makeStatsRow({ player_id: 2, nhl_goals: 30, nhl_assists: 40 });

      setupPlayerTableMocks({
        dirRows: [dir1, dir2],
        statRows: [stat1, stat2],
      });

      const players = await PlayerService.getPlayersByIds(['1', '2']);
      expect(players[0].full_name).toBe('High Points');
      expect(players[1].full_name).toBe('Low Points');
    });
  });
});

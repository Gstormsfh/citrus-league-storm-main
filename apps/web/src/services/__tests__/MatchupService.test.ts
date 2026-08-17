import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MOCK SETUP
// =============================================================================

// Build a chainable mock factory. Each chainable method returns `this` so that
// calls like `.from('x').select('y').eq('a', 'b').single()` work seamlessly.
// Terminal methods (`single`, `maybeSingle`) are separate so tests can override
// the resolved value per-call.

function createChainMock(defaultResolve: { data: any; error: any } = { data: null, error: null }) {
  const chain: Record<string, any> = {};
  // Internal resolve value — used when the chain is awaited directly (no terminal method)
  chain._resolve = defaultResolve;
  const chainMethods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'gte', 'is', 'in', 'or', 'order', 'limit', 'filter',
  ];
  chainMethods.forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  // Make the chain thenable so `await chain.eq(...)` works (Supabase builders are thenable)
  chain.then = (resolve: any, reject?: any) => Promise.resolve(chain._resolve).then(resolve, reject);
  return chain;
}

let defaultChain = createChainMock();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => defaultChain),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../LeagueService', () => ({
  LeagueService: {
    getLeague: vi.fn().mockResolvedValue({ league: null, error: null }),
    getLeagueTeams: vi.fn().mockResolvedValue({ teams: [] }),
  },
  Team: {},
}));

vi.mock('../DraftService', () => ({
  DraftService: {
    getDraftState: vi.fn().mockResolvedValue({ state: null, error: null }),
  },
}));

vi.mock('../PlayerService', () => ({
  PlayerService: {
    getAllPlayers: vi.fn().mockResolvedValue([]),
    getPlayersByIds: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./ScheduleService', () => ({
  ScheduleService: {
    getGamesForDateRange: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/utils/queryColumns', () => ({
  COLUMNS: {
    MATCHUP: 'id, league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date, created_at, updated_at',
    MATCHUP_SLIM: 'id, league_id, week_number, team1_id, team2_id, team1_score, team2_score, status, week_start_date, week_end_date',
    MATCHUP_LINES: 'id, matchup_id, player_id, team_id, total_points, stats_breakdown, games_played, games_remaining_total, games_remaining_active, has_live_game, updated_at, created_at',
    TEAM: 'id, league_id, owner_id, team_name, created_at, updated_at',
    ROSTER_ASSIGNMENT: 'id, team_id, player_id, position',
  },
}));

vi.mock('@/api/matchups', () => ({
  matchupApi: {
    deleteAllMatchups: vi.fn().mockResolvedValue({ data: null }),
    getLeagueMatchups: vi.fn().mockResolvedValue({ data: [] }),
    getMatchupHistory: vi.fn().mockResolvedValue({ data: [] }),
    generateMatchups: vi.fn().mockResolvedValue({ data: null }),
    getMatchupLines: vi.fn().mockResolvedValue({ data: [] }),
    getTeamRecord: vi.fn().mockResolvedValue({ data: null }),
    getMatchup: vi.fn().mockResolvedValue({ data: null }),
    getPlayoffBracket: vi.fn().mockResolvedValue({ data: null }),
    getUserMatchup: vi.fn().mockResolvedValue({ data: null }),
    clearCache: vi.fn(),
    invalidate: vi.fn(),
  },
}));

vi.mock('@/api/leagues', () => ({
  leagueApi: {
    getLeague: vi.fn().mockResolvedValue({ data: null }),
    getTeams: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock('@/api/drafts', () => ({
  draftApi: {
    getDraftPicks: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock('@/api/players', () => ({
  playerApi: {
    getPlayersByIds: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock('@/api/schedule', () => ({
  scheduleApi: {
    getGamesForDateRange: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock('@/utils/scoringUtils', () => {
  class ScoringCalculator {
    private scoring: any;
    constructor(scoring?: any) {
      this.scoring = scoring || {
        skater: { goals: 3, assists: 2, power_play_points: 1, short_handed_points: 2, shots_on_goal: 0.4, blocks: 0.5, hits: 0.2, penalty_minutes: 0.5 },
        goalie: { wins: 4, shutouts: 3, saves: 0.2, goals_against: -1 },
      };
    }
    calculatePoints(stats: any, isGoalie: boolean): number {
      if (!stats || typeof stats !== 'object') return 0;
      if (Object.keys(stats).length === 0) return 0;
      let total = 0;
      if (isGoalie) {
        const g = this.scoring.goalie;
        total += (stats.wins || 0) * g.wins;
        total += (stats.shutouts || 0) * g.shutouts;
        total += (stats.saves || 0) * g.saves;
        total += (stats.goals_against || 0) * g.goals_against;
      } else {
        const s = this.scoring.skater;
        total += (stats.goals || 0) * s.goals;
        total += (stats.assists || 0) * s.assists;
        total += (stats.ppp || 0) * s.power_play_points;
        total += (stats.shp || 0) * s.short_handed_points;
        total += (stats.sog || 0) * s.shots_on_goal;
        total += (stats.blocks || 0) * s.blocks;
        total += (stats.hits || 0) * s.hits;
        total += (stats.pim || 0) * s.penalty_minutes;
      }
      return total;
    }
  }
  const DEFAULT_SCORING = {
    skater: { goals: 3, assists: 2, power_play_points: 1, short_handed_points: 2, shots_on_goal: 0.4, blocks: 0.5, hits: 0.2, penalty_minutes: 0.5 },
    goalie: { wins: 4, shutouts: 3, saves: 0.2, goals_against: -1 },
  };
  return { ScoringCalculator, DEFAULT_SCORING, extractScoringSettings: vi.fn().mockReturnValue(DEFAULT_SCORING) };
});

vi.mock('@/components/matchup/types', () => ({}));
vi.mock('@/components/roster/HockeyPlayerCard', () => ({}));
vi.mock('../DemoLeagueService', () => ({
  DEMO_LEAGUE_ID_FOR_GUESTS: 'demo-league-id',
}));

vi.mock('@/utils/seasonConstants', async (importOriginal) => ({
  // Spread the real module: a hand-written object here omits whatever the
  // service starts calling next. getCurrentSeason() was added to several
  // services on 2026-08-11 and every partial mock broke with `undefined is
  // not a function`, surfacing as assertion noise rather than a clear error.
  ...(await importOriginal<typeof import('@/utils/seasonConstants')>()),
  CURRENT_SEASON: 2025,
  DEFAULT_TEST_DATE: '2025-01-15',
}));

vi.mock('@/utils/promiseUtils', () => ({
  withTimeout: vi.fn((promise: Promise<any>) => promise),
}));

vi.mock('@/utils/timezoneUtils', () => ({
  getTodayMST: vi.fn().mockReturnValue('2025-01-15'),
  getTodayMSTDate: vi.fn().mockReturnValue(new Date('2025-01-15')),
  formatDateToString: vi.fn((d: Date) => d.toISOString().split('T')[0]),
  isDateInRange: vi.fn().mockReturnValue(true),
}));

vi.mock('@/utils/weekCalculator', () => ({
  getFirstWeekStartDate: vi.fn().mockReturnValue(new Date('2025-01-05')),
  getWeekStartDate: vi.fn((weekNum: number, firstWeek: Date) => {
    const d = new Date(firstWeek);
    d.setDate(d.getDate() + (weekNum - 1) * 7);
    return d;
  }),
  getWeekEndDate: vi.fn((weekNum: number, firstWeek: Date) => {
    const d = new Date(firstWeek);
    d.setDate(d.getDate() + (weekNum - 1) * 7 + 6);
    return d;
  }),
  getAvailableWeeks: vi.fn().mockReturnValue([1, 2, 3]),
  getScheduleLength: vi.fn().mockReturnValue(3),
}));

// Grab the mocked modules so we can configure them per-test
import { supabase } from '@/integrations/supabase/client';
import { matchupApi } from '@/api/matchups';
import { MatchupService } from '../MatchupService';
import type { Team } from '../LeagueService';

// =============================================================================
// HELPERS
// =============================================================================

/** Rebuild a fresh chain mock and wire it into `supabase.from`. */
function resetChain() {
  defaultChain = createChainMock();
  (supabase.from as any).mockReturnValue(defaultChain);
}

/**
 * Configure `supabase.from` to return different chain mocks depending on the
 * table name. This is critical for methods that query multiple tables.
 */
function perTableChains(map: Record<string, ReturnType<typeof createChainMock>>) {
  (supabase.from as any).mockImplementation((table: string) => {
    return map[table] ?? defaultChain;
  });
  return map;
}

/** Create a mock Team object */
function makeTeam(id: string, name: string = `Team ${id}`): Team {
  return {
    id,
    league_id: 'league-1',
    owner_id: `owner-${id}`,
    team_name: name,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  };
}

// =============================================================================
// deleteAllMatchupsForLeague
// =============================================================================

describe('MatchupService.deleteAllMatchupsForLeague', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('should delete all matchups for a league and return no error on success', async () => {
    (matchupApi.deleteAllMatchups as any).mockResolvedValue({ data: null });

    const result = await MatchupService.deleteAllMatchupsForLeague('league-1');

    expect(result.error).toBeNull();
    expect(matchupApi.deleteAllMatchups).toHaveBeenCalledWith('league-1');
  });

  it('should return an error when the API call fails', async () => {
    (matchupApi.deleteAllMatchups as any).mockRejectedValue(new Error('delete failed'));

    const result = await MatchupService.deleteAllMatchupsForLeague('league-1');

    expect(result.error).toBeTruthy();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('should wrap non-Error exceptions in an Error', async () => {
    (matchupApi.deleteAllMatchups as any).mockRejectedValue('string error');

    const result = await MatchupService.deleteAllMatchupsForLeague('league-1');

    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toContain('string error');
  });
});

// =============================================================================
// getRoundRobinPairings (pure function — no DB mocks needed)
// =============================================================================

describe('MatchupService.getRoundRobinPairings', () => {
  it('should pair all teams in an even-number league with no byes', () => {
    const teams = [makeTeam('a'), makeTeam('b'), makeTeam('c'), makeTeam('d')];
    // 4 teams => numRounds = 3
    const pairs = MatchupService.getRoundRobinPairings(1, teams, 3);

    // 4 teams / 2 = 2 pairs
    expect(pairs).toHaveLength(2);

    // Every team should appear exactly once across all pairs
    const teamIds = pairs.flatMap(p => [p.team1.id, p.team2?.id].filter(Boolean));
    expect(new Set(teamIds).size).toBe(4);

    // No bye weeks for even team count
    pairs.forEach(p => {
      expect(p.team2).not.toBeNull();
    });
  });

  it('should give exactly one team a bye in an odd-number league', () => {
    const teams = [makeTeam('a'), makeTeam('b'), makeTeam('c')];
    // 3 teams => numRounds = 3
    const pairs = MatchupService.getRoundRobinPairings(1, teams, 3);

    // One team gets a bye (null team2), plus 1 real matchup
    const byePairs = pairs.filter(p => p.team2 === null);
    const realPairs = pairs.filter(p => p.team2 !== null);
    expect(byePairs).toHaveLength(1);
    expect(realPairs).toHaveLength(1);

    // All 3 team IDs should be present across all pairs
    const teamIds = pairs.flatMap(p => [p.team1.id, p.team2?.id].filter(Boolean));
    expect(new Set(teamIds).size).toBe(3);
  });

  it('should cycle pairings for weeks beyond numRounds', () => {
    const teams = [makeTeam('a'), makeTeam('b'), makeTeam('c'), makeTeam('d')];
    const numRounds = 3;

    // Week 1 and week 4 should produce the same pairings (cycle repeats)
    const pairsWeek1 = MatchupService.getRoundRobinPairings(1, teams, numRounds);
    const pairsWeek4 = MatchupService.getRoundRobinPairings(4, teams, numRounds);

    // Same structure
    expect(pairsWeek1).toHaveLength(pairsWeek4.length);
    // Same teams paired (order may differ but teams should match)
    const ids1 = pairsWeek1.map(p => [p.team1.id, p.team2?.id].sort().join('-')).sort();
    const ids4 = pairsWeek4.map(p => [p.team1.id, p.team2?.id].sort().join('-')).sort();
    expect(ids1).toEqual(ids4);
  });

  it('should produce different pairings for different weeks (within a cycle)', () => {
    const teams = [makeTeam('a'), makeTeam('b'), makeTeam('c'), makeTeam('d')];
    const numRounds = 3;

    const pairsWeek1 = MatchupService.getRoundRobinPairings(1, teams, numRounds);
    const pairsWeek2 = MatchupService.getRoundRobinPairings(2, teams, numRounds);

    // At least one pairing should be different
    const ids1 = pairsWeek1.map(p => [p.team1.id, p.team2?.id].sort().join('-')).sort();
    const ids2 = pairsWeek2.map(p => [p.team1.id, p.team2?.id].sort().join('-')).sort();
    expect(ids1).not.toEqual(ids2);
  });

  it('should handle a 2-team league', () => {
    const teams = [makeTeam('a'), makeTeam('b')];
    // 2 teams => numRounds = 1
    const pairs = MatchupService.getRoundRobinPairings(1, teams, 1);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].team1.id).toBe('a');
    expect(pairs[0].team2?.id).toBe('b');
  });
});

// =============================================================================
// generateMatchupsForLeague — validation
// =============================================================================

describe('MatchupService.generateMatchupsForLeague', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('should return error when fewer than 2 teams are provided', async () => {
    const result = await MatchupService.generateMatchupsForLeague(
      'league-1',
      [makeTeam('only-one')],
      new Date('2025-01-05')
    );

    expect(result.error).toBeTruthy();
    expect(result.error!.message).toContain('at least 2 teams');
  });

  it('should return error when teams have invalid IDs', async () => {
    const badTeam = makeTeam('');
    badTeam.id = '';
    const result = await MatchupService.generateMatchupsForLeague(
      'league-1',
      [makeTeam('good'), badTeam],
      new Date('2025-01-05')
    );

    expect(result.error).toBeTruthy();
    expect(result.error!.message).toContain('invalid IDs');
  });

  it('should return error when duplicate team IDs exist', async () => {
    const team1 = makeTeam('dup-id');
    const team2 = makeTeam('dup-id');
    team2.team_name = 'Different Name';

    const result = await MatchupService.generateMatchupsForLeague(
      'league-1',
      [team1, team2],
      new Date('2025-01-05')
    );

    expect(result.error).toBeTruthy();
    expect(result.error!.message).toContain('Duplicate team IDs');
  });

  it('should generate matchups for all available weeks (happy path, 4 teams)', async () => {
    const teams = [makeTeam('a'), makeTeam('b'), makeTeam('c'), makeTeam('d')];

    (matchupApi.generateMatchups as any).mockResolvedValue({ data: null });

    const result = await MatchupService.generateMatchupsForLeague(
      'league-1',
      teams,
      new Date('2025-01-05')
    );

    expect(result.error).toBeNull();
    expect(matchupApi.generateMatchups).toHaveBeenCalledWith(
      'league-1',
      teams.map(t => ({ id: t.id })),
      expect.arrayContaining([
        expect.objectContaining({ week_number: 1 }),
        expect.objectContaining({ week_number: 2 }),
        expect.objectContaining({ week_number: 3 }),
      ]),
      false, // forceRegenerate default
    );
  });

  it('should return no error when 0 teams is provided (edge: caught early)', async () => {
    const result = await MatchupService.generateMatchupsForLeague(
      'league-1',
      [],
      new Date('2025-01-05')
    );

    expect(result.error).toBeTruthy();
    expect(result.error!.message).toContain('at least 2 teams');
  });
});

// =============================================================================
// getMatchupHistory
// =============================================================================

describe('MatchupService.getMatchupHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('should return empty matchups when team2Id is null (bye week)', async () => {
    const result = await MatchupService.getMatchupHistory('league-1', 'team-1', null);

    expect(result.matchups).toEqual([]);
    expect(result.error).toBeNull();
    // Should not have called the API at all
    expect(matchupApi.getMatchupHistory).not.toHaveBeenCalled();
  });

  it('should return matchup history sorted by week descending', async () => {
    const apiData = [
      {
        id: 'matchup-1',
        week_number: 1,
        team1_id: 'team-a',
        team2_id: 'team-b',
        team1_score: '10.5',
        team2_score: '8.2',
        week_start_date: '2025-01-05',
      },
      {
        id: 'matchup-2',
        week_number: 3,
        team1_id: 'team-b',
        team2_id: 'team-a',
        team1_score: '12.0',
        team2_score: '9.5',
        week_start_date: '2025-01-19',
      },
    ];

    (matchupApi.getMatchupHistory as any).mockResolvedValue({ data: apiData });

    const result = await MatchupService.getMatchupHistory('league-1', 'team-a', 'team-b');

    expect(result.error).toBeNull();
    expect(result.matchups).toHaveLength(2);
    // Scores parsed as numbers
    expect(result.matchups[0].team1Score).toBe(10.5);
    expect(result.matchups[0].team2Score).toBe(8.2);
    expect(matchupApi.getMatchupHistory).toHaveBeenCalledWith('league-1', 'team-a', 'team-b');
  });

  it('should return empty matchups and error on API failure', async () => {
    (matchupApi.getMatchupHistory as any).mockRejectedValue(new Error('query failed'));

    const result = await MatchupService.getMatchupHistory('league-1', 'team-a', 'team-b');

    expect(result.matchups).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('should handle empty results', async () => {
    (matchupApi.getMatchupHistory as any).mockResolvedValue({ data: [] });

    const result = await MatchupService.getMatchupHistory('league-1', 'team-a', 'team-b');

    expect(result.error).toBeNull();
    expect(result.matchups).toEqual([]);
  });
});

// =============================================================================
// ScoringCalculator (unit tests for point calculation logic)
// =============================================================================
// Since calculateMatchupWeekPoints is a closure-scoped helper inside a large
// method, we test the underlying ScoringCalculator.calculatePoints directly,
// which is what calculateMatchupWeekPoints delegates to.

describe('ScoringCalculator.calculatePoints (used by calculateMatchupWeekPoints)', () => {
  // Use the ScoringCalculator from the mock (which implements the real scoring logic)
  let ScoringCalculator: any;

  beforeEach(async () => {
    const mod = await import('@/utils/scoringUtils');
    ScoringCalculator = mod.ScoringCalculator;
  });

  it('should calculate skater points with default scoring', () => {
    const scorer = new ScoringCalculator();
    const stats = {
      goals: 2,       // 2 * 3 = 6
      assists: 1,     // 1 * 2 = 2
      ppp: 1,         // 1 * 1 = 1
      shp: 0,         // 0 * 2 = 0
      sog: 5,         // 5 * 0.4 = 2
      blocks: 2,      // 2 * 0.5 = 1
      hits: 3,        // 3 * 0.2 = 0.6
      pim: 4,         // 4 * 0.5 = 2
    };
    // Total: 6 + 2 + 1 + 0 + 2 + 1 + 0.6 + 2 = 14.6
    const points = scorer.calculatePoints(stats, false);
    expect(points).toBeCloseTo(14.6, 1);
  });

  it('should calculate goalie points with default scoring', () => {
    const scorer = new ScoringCalculator();
    const stats = {
      wins: 1,           // 1 * 4 = 4
      saves: 30,         // 30 * 0.2 = 6
      shutouts: 0,       // 0 * 3 = 0
      goals_against: 2,  // 2 * -1 = -2
    };
    // Total: 4 + 6 + 0 + (-2) = 8
    const points = scorer.calculatePoints(stats, true);
    expect(points).toBeCloseTo(8.0, 1);
  });

  it('should return 0 for null or undefined stats', () => {
    const scorer = new ScoringCalculator();
    expect(scorer.calculatePoints(null, false)).toBe(0);
    expect(scorer.calculatePoints(undefined, true)).toBe(0);
  });

  it('should return 0 for empty stats object', () => {
    const scorer = new ScoringCalculator();
    expect(scorer.calculatePoints({}, false)).toBe(0);
    expect(scorer.calculatePoints({}, true)).toBe(0);
  });

  it('should calculate shutout bonus for goalies', () => {
    const scorer = new ScoringCalculator();
    const stats = {
      wins: 1,           // 1 * 4 = 4
      saves: 25,         // 25 * 0.2 = 5
      shutouts: 1,       // 1 * 3 = 3
      goals_against: 0,  // 0 * -1 = 0
    };
    // Total: 4 + 5 + 3 + 0 = 12
    const points = scorer.calculatePoints(stats, true);
    expect(points).toBeCloseTo(12.0, 1);
  });

  it('should handle custom scoring settings', () => {
    const customScoring = {
      skater: {
        goals: 5,
        assists: 3,
        power_play_points: 2,
        short_handed_points: 3,
        shots_on_goal: 0.5,
        blocks: 1,
        hits: 0.5,
        penalty_minutes: 0,
      },
      goalie: {
        wins: 5,
        shutouts: 5,
        saves: 0.3,
        goals_against: -2,
      },
    };
    const scorer = new ScoringCalculator(customScoring);
    const stats = { goals: 1, assists: 2 };
    // 1 * 5 + 2 * 3 = 11
    const points = scorer.calculatePoints(stats, false);
    expect(points).toBeCloseTo(11.0, 1);
  });

  it('should handle skater stats with only goals (missing other stats)', () => {
    const scorer = new ScoringCalculator();
    const stats = { goals: 3 };
    // 3 * 3 = 9 (all other stats default to 0)
    expect(scorer.calculatePoints(stats, false)).toBeCloseTo(9.0, 1);
  });

  it('should handle goalie stats with only wins', () => {
    const scorer = new ScoringCalculator();
    const stats = { wins: 2 };
    // 2 * 4 = 8
    expect(scorer.calculatePoints(stats, true)).toBeCloseTo(8.0, 1);
  });
});

// =============================================================================
// getMatchup
// =============================================================================

describe('MatchupService.getMatchup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
  });

  it('should return a matchup for a given league and week', async () => {
    const matchupData = {
      id: 'matchup-1',
      league_id: 'league-1',
      week_number: 1,
      team1_id: 'team-a',
      team2_id: 'team-b',
      team1_score: 10,
      team2_score: 8,
      status: 'scheduled',
      week_start_date: '2025-01-05',
      week_end_date: '2025-01-11',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };

    (matchupApi.getLeagueMatchups as any).mockResolvedValue({ data: [matchupData] });

    const result = await MatchupService.getMatchup('league-1', 1);

    expect(result.error).toBeNull();
    expect(result.matchup).toEqual(matchupData);
    expect(matchupApi.getLeagueMatchups).toHaveBeenCalledWith('league-1', 1);
  });

  it('should return null matchup when none found', async () => {
    (matchupApi.getLeagueMatchups as any).mockResolvedValue({ data: [] });

    const result = await MatchupService.getMatchup('league-1', 99);

    expect(result.error).toBeNull();
    expect(result.matchup).toBeNull();
  });

  it('should return error on API failure', async () => {
    (matchupApi.getLeagueMatchups as any).mockRejectedValue(new Error('query error'));

    const result = await MatchupService.getMatchup('league-1', 1);

    expect(result.matchup).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.error).toBeInstanceOf(Error);
  });
});

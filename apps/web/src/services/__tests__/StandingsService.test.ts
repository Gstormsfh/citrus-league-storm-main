import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock modules
// =============================================================================

const mockSupabaseFrom = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/timezoneUtils', () => ({
  getTodayMST: vi.fn().mockReturnValue('2026-03-08'),
  getTodayMSTDate: vi.fn().mockReturnValue(new Date('2026-03-08T00:00:00')),
}));

vi.mock('@/utils/seasonConstants', () => ({
  CURRENT_SEASON: '20252026',
}));

vi.mock('@/api/matchups', () => ({
  matchupApi: {
    getLeagueMatchups: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock('@/api/rosters', () => ({
  rosterApi: {
    getLeagueRosters: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock('@/utils/scoringUtils', () => ({
  compareCategoryMatchup: vi.fn().mockReturnValue({
    team1Wins: 0,
    team2Wins: 0,
    ties: 0,
    details: {},
  }),
  calculateRotoStandings: vi.fn().mockReturnValue({}),
}));

// =============================================================================
// Import AFTER mocks
// =============================================================================

import { StandingsService } from '../StandingsService';

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Helpers
// =============================================================================

const makeTeams = (ids: string[]) => ids.map(id => ({ id, name: `Team ${id}` }));

/**
 * Helper: builds a deeply chainable Supabase mock.
 * Every method returns the chain itself, except the chain is also a thenable
 * that resolves to `resolveValue`.
 */
function buildChain(resolveValue: any) {
  const chain: any = {};
  const handler = {
    get(_target: any, prop: string) {
      if (prop === 'then') {
        // Make the chain thenable so `await` resolves to resolveValue
        return (resolve: (v: any) => void, reject: (e: any) => void) =>
          Promise.resolve(resolveValue).then(resolve, reject);
      }
      // Every other property call returns the proxy itself
      return vi.fn().mockReturnValue(new Proxy(chain, handler));
    },
  };
  return new Proxy(chain, handler);
}

function mockMatchupQueries(completedMatchups: any[], pastMatchups: any[] = []) {
  let callCount = 0;
  mockSupabaseFrom.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return buildChain({ data: completedMatchups, error: null });
    }
    return buildChain({ data: pastMatchups, error: null });
  });
}

// =============================================================================
// calculateTeamStandings
// =============================================================================

describe('StandingsService.calculateTeamStandings', () => {
  it('returns initialized stats when no matchups exist', async () => {
    mockMatchupQueries([], []);

    const teams = makeTeams(['team-1', 'team-2']);
    const result = await StandingsService.calculateTeamStandings('league-1', teams, [], []);

    expect(result['team-1']).toBeDefined();
    expect(result['team-1'].wins).toBe(0);
    expect(result['team-1'].losses).toBe(0);
    expect(result['team-1'].ties).toBe(0);
    expect(result['team-1'].pointsFor).toBe(0);
    expect(result['team-1'].pointsAgainst).toBe(0);
    expect(result['team-1'].streak).toBe('-');
    expect(result['team-1'].last5).toEqual({ wins: 0, losses: 0, ties: 0 });
  });

  it('calculates wins and losses from completed matchups', async () => {
    const matchups = [
      {
        id: 'm1',
        team1_id: 'team-1',
        team2_id: 'team-2',
        team1_score: 120,
        team2_score: 100,
        week_number: 1,
        status: 'completed',
        week_end_date: '2026-03-01',
      },
      {
        id: 'm2',
        team1_id: 'team-1',
        team2_id: 'team-2',
        team1_score: 80,
        team2_score: 110,
        week_number: 2,
        status: 'completed',
        week_end_date: '2026-03-07',
      },
    ];
    mockMatchupQueries(matchups, []);

    const teams = makeTeams(['team-1', 'team-2']);
    const result = await StandingsService.calculateTeamStandings('league-wl', teams, [], []);

    expect(result['team-1'].wins).toBe(1);
    expect(result['team-1'].losses).toBe(1);
    expect(result['team-1'].pointsFor).toBe(200); // 120 + 80
    expect(result['team-1'].pointsAgainst).toBe(210); // 100 + 110

    expect(result['team-2'].wins).toBe(1);
    expect(result['team-2'].losses).toBe(1);
    expect(result['team-2'].pointsFor).toBe(210);
    expect(result['team-2'].pointsAgainst).toBe(200);
  });

  it('handles tie games correctly', async () => {
    const matchups = [
      {
        id: 'm1',
        team1_id: 'team-1',
        team2_id: 'team-2',
        team1_score: 100,
        team2_score: 100,
        week_number: 1,
        status: 'completed',
        week_end_date: '2026-03-01',
      },
    ];
    mockMatchupQueries(matchups, []);

    const teams = makeTeams(['team-1', 'team-2']);
    const result = await StandingsService.calculateTeamStandings('league-tie', teams, [], []);

    expect(result['team-1'].ties).toBe(1);
    expect(result['team-2'].ties).toBe(1);
    expect(result['team-1'].wins).toBe(0);
    expect(result['team-1'].losses).toBe(0);
  });

  it('handles bye weeks (team2_id is null)', async () => {
    const matchups = [
      {
        id: 'm1',
        team1_id: 'team-1',
        team2_id: null,
        team1_score: 100,
        team2_score: null,
        week_number: 1,
        status: 'completed',
        week_end_date: '2026-03-01',
      },
    ];
    mockMatchupQueries(matchups, []);

    const teams = makeTeams(['team-1', 'team-2']);
    const result = await StandingsService.calculateTeamStandings('league-bye', teams, [], []);

    expect(result['team-1'].wins).toBe(1);
    expect(result['team-1'].pointsFor).toBe(100);
    expect(result['team-1'].pointsAgainst).toBe(0);
  });

  it('calculates streak correctly', async () => {
    const matchups = [
      { id: 'm1', team1_id: 'team-1', team2_id: 'team-2', team1_score: 120, team2_score: 100, week_number: 1, status: 'completed', week_end_date: '2026-02-15' },
      { id: 'm2', team1_id: 'team-1', team2_id: 'team-2', team1_score: 130, team2_score: 100, week_number: 2, status: 'completed', week_end_date: '2026-02-22' },
      { id: 'm3', team1_id: 'team-1', team2_id: 'team-2', team1_score: 140, team2_score: 100, week_number: 3, status: 'completed', week_end_date: '2026-03-01' },
    ];
    mockMatchupQueries(matchups, []);

    const teams = makeTeams(['team-1', 'team-2']);
    const result = await StandingsService.calculateTeamStandings('league-streak', teams, [], []);

    expect(result['team-1'].streak).toBe('W3');
    expect(result['team-2'].streak).toBe('L3');
  });

  it('calculates last5 correctly with mixed results', async () => {
    const matchups = [];
    for (let i = 1; i <= 6; i++) {
      matchups.push({
        id: `m${i}`,
        team1_id: 'team-1',
        team2_id: 'team-2',
        team1_score: i <= 4 ? 120 : 80, // Win first 4, lose last 2
        team2_score: 100,
        week_number: i,
        status: 'completed',
        week_end_date: `2026-02-${String(i * 7).padStart(2, '0')}`,
      });
    }
    mockMatchupQueries(matchups, []);

    const teams = makeTeams(['team-1', 'team-2']);
    const result = await StandingsService.calculateTeamStandings('league-last5', teams, [], []);

    // Last 5 games (weeks 6,5,4,3,2): L,L,W,W,W -> 3W 2L
    expect(result['team-1'].last5.wins).toBe(3);
    expect(result['team-1'].last5.losses).toBe(2);
  });

  it('returns empty stats on query error', async () => {
    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      return buildChain({ data: null, error: { message: 'DB error' } });
    });

    const teams = makeTeams(['team-1']);
    const result = await StandingsService.calculateTeamStandings('league-error', teams, [], []);

    expect(result['team-1'].wins).toBe(0);
    expect(result['team-1'].losses).toBe(0);
  });

  it('deduplicates matchups from completed and past queries', async () => {
    const matchup = {
      id: 'm1',
      team1_id: 'team-1',
      team2_id: 'team-2',
      team1_score: 120,
      team2_score: 100,
      week_number: 1,
      status: 'completed',
      week_end_date: '2026-03-01',
    };
    // Same matchup appears in both completed and past queries
    mockMatchupQueries([matchup], [matchup]);

    const teams = makeTeams(['team-1', 'team-2']);
    const result = await StandingsService.calculateTeamStandings('league-dedup', teams, [], []);

    // Should only count once
    expect(result['team-1'].wins).toBe(1);
    expect(result['team-1'].losses).toBe(0);
  });
});

// =============================================================================
// calculateSeasonPointsStandings
// =============================================================================

describe('StandingsService.calculateSeasonPointsStandings', () => {
  it('returns initialized stats for all teams', async () => {
    // Mock roster_assignments, daily_scores, matchups
    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // roster_assignments
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (callCount === 2) {
        // daily_scores
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      // matchups fallback
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      };
    });

    const teams = makeTeams(['team-1', 'team-2']);
    const result = await StandingsService.calculateSeasonPointsStandings('league-1', teams, [], []);

    expect(result['team-1']).toBeDefined();
    expect(result['team-1'].pointsFor).toBe(0);
    expect(result['team-1'].gamesPlayed).toBe(0);
    expect(result['team-2']).toBeDefined();
  });

  it('sums player points per team from roster assignments', async () => {
    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // roster_assignments
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                { player_id: '101', team_id: 'team-1' },
                { player_id: '102', team_id: 'team-1' },
                { player_id: '201', team_id: 'team-2' },
              ],
              error: null,
            }),
          }),
        };
      }
      // daily_scores
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };
    });

    const teams = makeTeams(['team-1', 'team-2']);
    const allPlayers = [
      { id: '101', points: 50 },
      { id: '102', points: 30 },
      { id: '201', points: 70 },
    ];
    const result = await StandingsService.calculateSeasonPointsStandings('league-1', teams, [], allPlayers);

    expect(result['team-1'].pointsFor).toBe(80); // 50 + 30
    expect(result['team-2'].pointsFor).toBe(70);
  });

  it('falls back to draftPicks when roster_assignments errors', async () => {
    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // roster_assignments -> error
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Permission denied' },
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };
    });

    const teams = makeTeams(['team-1']);
    const draftPicks = [{ team_id: 'team-1', player_id: '101' }];
    const allPlayers = [{ id: '101', points: 42 }];
    const result = await StandingsService.calculateSeasonPointsStandings('league-1', teams, draftPicks, allPlayers);

    expect(result['team-1'].pointsFor).toBe(42);
  });

  it('counts games played from daily_scores', async () => {
    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (callCount === 2) {
        // daily_scores with unique dates
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                { team_id: 'team-1', score_date: '2026-03-01' },
                { team_id: 'team-1', score_date: '2026-03-02' },
                { team_id: 'team-1', score_date: '2026-03-03' },
              ],
              error: null,
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };
    });

    const teams = makeTeams(['team-1']);
    const result = await StandingsService.calculateSeasonPointsStandings('league-1', teams, [], []);

    expect(result['team-1'].gamesPlayed).toBe(3);
  });
});

// =============================================================================
// calculateCategoryStandings
// =============================================================================

describe('StandingsService.calculateCategoryStandings', () => {
  it('returns initialized stats for all teams with category records', async () => {
    // Mock all supabase calls to return empty
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { settings: {} }, error: null }),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
        in: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });

    const teams = makeTeams(['team-1', 'team-2']);
    const categories = ['goals', 'assists'];
    const categoryMeta = {
      goals: { higherIsBetter: true },
      assists: { higherIsBetter: true },
    };

    const result = await StandingsService.calculateCategoryStandings(
      'league-1',
      teams,
      categories,
      categoryMeta
    );

    expect(result['team-1']).toBeDefined();
    expect(result['team-1'].wins).toBe(0);
    expect(result['team-1'].categoryRecord).toBeDefined();
    expect(result['team-1'].categoryRecord['goals']).toEqual({ wins: 0, losses: 0, ties: 0 });
    expect(result['team-1'].categoryRecord['assists']).toEqual({ wins: 0, losses: 0, ties: 0 });
  });
});

// =============================================================================
// calculateRotoStandingsFromDB
// =============================================================================

describe('StandingsService.calculateRotoStandingsFromDB', () => {
  it('returns initialized stats with roto-specific fields', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { settings: {} }, error: null }),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
        in: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });

    const teams = makeTeams(['team-1']);
    const categories = ['goals', 'assists'];
    const categoryMeta = {
      goals: { higherIsBetter: true },
      assists: { higherIsBetter: true },
    };

    const result = await StandingsService.calculateRotoStandingsFromDB(
      'league-1',
      teams,
      [],
      [],
      categories,
      categoryMeta
    );

    expect(result['team-1']).toBeDefined();
    expect(result['team-1'].rotoPoints).toBe(0);
    expect(result['team-1'].categoryRanks).toEqual({});
    expect(result['team-1'].gamesPlayed).toBe(0);
  });

  it('sums points for from draft picks', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { settings: {} }, error: null }),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
        in: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });

    const teams = makeTeams(['team-1']);
    const draftPicks = [
      { team_id: 'team-1', player_id: '101' },
      { team_id: 'team-1', player_id: '102' },
    ];
    const allPlayers = [
      { id: '101', points: 25 },
      { id: '102', points: 15 },
    ];

    const result = await StandingsService.calculateRotoStandingsFromDB(
      'league-1',
      teams,
      draftPicks,
      allPlayers,
      ['goals'],
      { goals: { higherIsBetter: true } }
    );

    expect(result['team-1'].pointsFor).toBe(40); // 25 + 15
  });
});

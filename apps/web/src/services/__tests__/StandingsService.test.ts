import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock modules
// =============================================================================

const mockGetLeagueMatchups = vi.fn();
const mockGetLeagueRosters = vi.fn();
const mockGetLeague = vi.fn();
const mockGetPlayersByIds = vi.fn();

vi.mock('@/api/matchups', () => ({
  matchupApi: {
    getLeagueMatchups: (...args: unknown[]) => mockGetLeagueMatchups(...args),
  },
}));

vi.mock('@/api/rosters', () => ({
  rosterApi: {
    getLeagueRosters: (...args: unknown[]) => mockGetLeagueRosters(...args),
  },
}));

vi.mock('@/api/leagues', () => ({
  leagueApi: {
    getLeague: (...args: unknown[]) => mockGetLeague(...args),
  },
}));

vi.mock('@/services/PlayerService', () => ({
  PlayerService: {
    getPlayersByIds: (...args: unknown[]) => mockGetPlayersByIds(...args),
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

vi.mock('@/utils/seasonConstants', async (importOriginal) => ({
  // Spread the real module: a hand-written object here omits whatever the
  // service starts calling next. getCurrentSeason() was added to several
  // services on 2026-08-11 and every partial mock broke with `undefined is
  // not a function`, surfacing as assertion noise rather than a clear error.
  ...(await importOriginal<typeof import('@/utils/seasonConstants')>()),
  CURRENT_SEASON: '20252026',
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
import type { Team } from '../LeagueService';
import { deriveStandings, type StandingsMatchup } from '@citrus/shared';

beforeEach(() => {
  vi.clearAllMocks();

  // Default mock return values
  mockGetLeagueMatchups.mockResolvedValue({ data: [] });
  mockGetLeagueRosters.mockResolvedValue({ data: [] });
  mockGetLeague.mockResolvedValue({ data: { settings: {} } });
  mockGetPlayersByIds.mockResolvedValue([]);
});

// =============================================================================
// Helpers
// =============================================================================

// Build real Team fixtures. This used to return { id, name }, which is not a Team
// -- the field is team_name, and league_id / owner_id / timestamps are required.
// Every call site failed to typecheck, and `name` was silently ignored by the code
// under test, so the fixtures were not exercising the field the service reads.
const makeTeams = (ids: string[]): Team[] =>
  ids.map(id => ({
    id,
    league_id: 'league-1',
    owner_id: `owner-${id}`,
    team_name: `Team ${id}`,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }));

// =============================================================================
// calculateTeamStandings
// =============================================================================

describe('StandingsService.calculateTeamStandings', () => {
  it('returns initialized stats when no matchups exist', async () => {
    mockGetLeagueMatchups.mockResolvedValue({ data: [] });

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
    mockGetLeagueMatchups.mockResolvedValue({ data: matchups });

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
    mockGetLeagueMatchups.mockResolvedValue({ data: matchups });

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
    mockGetLeagueMatchups.mockResolvedValue({ data: matchups });

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
    mockGetLeagueMatchups.mockResolvedValue({ data: matchups });

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
    mockGetLeagueMatchups.mockResolvedValue({ data: matchups });

    const teams = makeTeams(['team-1', 'team-2']);
    const result = await StandingsService.calculateTeamStandings('league-last5', teams, [], []);

    // Last 5 games (weeks 6,5,4,3,2): L,L,W,W,W -> 3W 2L
    expect(result['team-1'].last5.wins).toBe(3);
    expect(result['team-1'].last5.losses).toBe(2);
  });

  it('returns empty stats on API error', async () => {
    mockGetLeagueMatchups.mockRejectedValue(new Error('API error'));

    const teams = makeTeams(['team-1']);
    const result = await StandingsService.calculateTeamStandings('league-error', teams, [], []);

    expect(result['team-1'].wins).toBe(0);
    expect(result['team-1'].losses).toBe(0);
  });

  it('deduplicates matchups by id', async () => {
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
    // Same matchup appears twice in API response
    mockGetLeagueMatchups.mockResolvedValue({ data: [matchup, matchup] });

    const teams = makeTeams(['team-1', 'team-2']);
    const result = await StandingsService.calculateTeamStandings('league-dedup', teams, [], []);

    // Should only count once
    expect(result['team-1'].wins).toBe(1);
    expect(result['team-1'].losses).toBe(0);
  });

  // ===========================================================================
  // AN UNPLAYED WEEK IS NOT A TIE (2026-09-03)
  //
  // Production, league 750f4e1a-92ae-44cf-a798-2f3e06d0d5c9 ("Demo League -
  // Citrus Storm Showcase"): both teams read 1-1-18. Twenty weeks of matchups
  // exist and exactly two were ever scored -- weeks 7 and 8. The other
  // eighteen sit at 0.000 / 0.000 because nothing was ever played in them,
  // and the old rule read equal scores as a draw.
  //
  // The rule itself now lives in @citrus/shared (deriveStandings) and is
  // shared with GET /api/leagues/:leagueId/standings. These tests pin the
  // behaviour the page shows; packages/shared/src/utils/__tests__/standings.test.ts
  // pins the rule's edges.
  // ===========================================================================

  // The demo league's real rows, statuses and all. Mocked "today" in this
  // file is 2026-03-08, which is why weeks 9-11 need their real 'completed'
  // status to be in the window at all.
  const DEMO_LEAGUE_MATCHUPS: StandingsMatchup[] = [
    { id: 'w1', week_number: 1, team1_id: 'team-1', team2_id: 'team-2', team1_score: '0.000', team2_score: '0.000', status: 'completed', week_end_date: '2026-01-16' },
    { id: 'w2', week_number: 2, team1_id: 'team-1', team2_id: 'team-2', team1_score: '0.000', team2_score: '0.000', status: 'completed', week_end_date: '2026-01-23' },
    { id: 'w3', week_number: 3, team1_id: 'team-1', team2_id: 'team-2', team1_score: '0.000', team2_score: '0.000', status: 'in_progress', week_end_date: '2026-01-30' },
    { id: 'w4', week_number: 4, team1_id: 'team-1', team2_id: 'team-2', team1_score: '0.000', team2_score: '0.000', status: 'scheduled', week_end_date: '2026-02-06' },
    { id: 'w5', week_number: 5, team1_id: 'team-1', team2_id: 'team-2', team1_score: '0.000', team2_score: '0.000', status: 'scheduled', week_end_date: '2026-02-13' },
    // Week 6 is the Olympic break: 294 fantasy_daily_rosters rows, no NHL
    // games, no scoring lines. Lineups were set; nothing was played.
    { id: 'w6', week_number: 6, team1_id: 'team-1', team2_id: 'team-2', team1_score: '0.000', team2_score: '0.000', status: 'scheduled', week_end_date: '2026-02-20' },
    { id: 'w7', week_number: 7, team1_id: 'team-1', team2_id: 'team-2', team1_score: '58.000', team2_score: '70.900', status: 'completed', week_end_date: '2026-02-27' },
    { id: 'w8', week_number: 8, team1_id: 'team-1', team2_id: 'team-2', team1_score: '122.900', team2_score: '104.800', status: 'completed', week_end_date: '2026-03-06' },
    { id: 'w9', week_number: 9, team1_id: 'team-1', team2_id: 'team-2', team1_score: '0.000', team2_score: '0.000', status: 'completed', week_end_date: '2026-03-13' },
    { id: 'w10', week_number: 10, team1_id: 'team-1', team2_id: 'team-2', team1_score: '0.000', team2_score: '0.000', status: 'completed', week_end_date: '2026-03-20' },
    { id: 'w11', week_number: 11, team1_id: 'team-1', team2_id: 'team-2', team1_score: '0.000', team2_score: '0.000', status: 'completed', week_end_date: '2026-03-27' },
    { id: 'w12', week_number: 12, team1_id: 'team-1', team2_id: 'team-2', team1_score: '0.000', team2_score: '0.000', status: 'scheduled', week_end_date: '2026-04-03' },
  ];

  it('reads the demo league as 1-1-0, not 1-1-18', async () => {
    mockGetLeagueMatchups.mockResolvedValue({ data: DEMO_LEAGUE_MATCHUPS });

    const teams = makeTeams(['team-1', 'team-2']);
    const result = await StandingsService.calculateTeamStandings('league-unplayed', teams, [], []);

    expect(result['team-1'].wins).toBe(1);
    expect(result['team-1'].losses).toBe(1);
    expect(result['team-1'].ties).toBe(0);
    expect(result['team-2'].ties).toBe(0);

    // Only the two weeks that were played contribute points.
    expect(result['team-1'].pointsFor).toBeCloseTo(180.9, 6);
    expect(result['team-1'].pointsAgainst).toBeCloseTo(175.7, 6);
  });

  it('does not count an unscored week as a tie even when its status is completed', async () => {
    // Weeks 1, 2, 9, 10 and 11 are 'completed' at 0-0 in production, so
    // status alone cannot be the gate that decides a week was played.
    mockGetLeagueMatchups.mockResolvedValue({
      data: DEMO_LEAGUE_MATCHUPS.filter(m => m.status === 'completed' && m.team1_score === '0.000'),
    });

    const teams = makeTeams(['team-1', 'team-2']);
    const result = await StandingsService.calculateTeamStandings('league-zero-completed', teams, [], []);

    expect(result['team-1'].ties).toBe(0);
    expect(result['team-1'].wins).toBe(0);
    expect(result['team-1'].losses).toBe(0);
    expect(result['team-1'].streak).toBe('-');
  });

  it('does not award a win for an unplayed bye week', async () => {
    // Mirrors auto_complete_matchups()'s own bye predicate:
    // (team2_id IS NULL AND team1_score > 0).
    mockGetLeagueMatchups.mockResolvedValue({
      data: [{ id: 'm1', team1_id: 'team-1', team2_id: null, team1_score: 0, team2_score: null, week_number: 1, status: 'completed', week_end_date: '2026-03-01' }],
    });

    const teams = makeTeams(['team-1', 'team-2']);
    const result = await StandingsService.calculateTeamStandings('league-empty-bye', teams, [], []);

    expect(result['team-1'].wins).toBe(0);
    expect(result['team-1'].streak).toBe('-');
  });

  it('counts a real 0-0 week when the matchup carries played evidence', async () => {
    // The vanishingly rare legitimate 0-0. The score cannot show it, so the
    // rule takes explicit evidence instead of guessing -- a scored-at stamp
    // or the existence of fantasy_matchup_lines, mapped to `played`.
    mockGetLeagueMatchups.mockResolvedValue({
      data: [{ id: 'm1', team1_id: 'team-1', team2_id: 'team-2', team1_score: 0, team2_score: 0, week_number: 1, status: 'completed', week_end_date: '2026-03-01', played: true }],
    });

    const teams = makeTeams(['team-1', 'team-2']);
    const result = await StandingsService.calculateTeamStandings('league-real-draw', teams, [], []);

    expect(result['team-1'].ties).toBe(1);
    expect(result['team-2'].ties).toBe(1);
    expect(result['team-1'].streak).toBe('T1');
  });

  it('matches the shared rule the API server derives standings with', async () => {
    // PARITY. server/src/services/LeagueService.getStandings feeds the same
    // COLUMNS.MATCHUP rows to this same function, so if this holds the
    // Standings page and GET /api/leagues/:leagueId/standings cannot
    // disagree about a league.
    mockGetLeagueMatchups.mockResolvedValue({ data: DEMO_LEAGUE_MATCHUPS });

    const teams = makeTeams(['team-1', 'team-2']);
    const result = await StandingsService.calculateTeamStandings('league-parity', teams, [], []);

    expect(result).toEqual(
      deriveStandings(['team-1', 'team-2'], DEMO_LEAGUE_MATCHUPS, '2026-03-08'),
    );
  });
});

// =============================================================================
// calculateSeasonPointsStandings
// =============================================================================

describe('StandingsService.calculateSeasonPointsStandings', () => {
  it('returns initialized stats for all teams', async () => {
    mockGetLeagueRosters.mockResolvedValue({ data: [] });
    mockGetLeagueMatchups.mockResolvedValue({ data: [] });

    const teams = makeTeams(['team-1', 'team-2']);
    const result = await StandingsService.calculateSeasonPointsStandings('league-1', teams, [], []);

    expect(result['team-1']).toBeDefined();
    expect(result['team-1'].pointsFor).toBe(0);
    expect(result['team-1'].gamesPlayed).toBe(0);
    expect(result['team-2']).toBeDefined();
  });

  it('sums player points per team from roster assignments', async () => {
    mockGetLeagueRosters.mockResolvedValue({
      data: [
        { player_id: '101', team_id: 'team-1' },
        { player_id: '102', team_id: 'team-1' },
        { player_id: '201', team_id: 'team-2' },
      ],
    });
    mockGetLeagueMatchups.mockResolvedValue({ data: [] });

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

  it('falls back to draftPicks when roster API returns empty', async () => {
    mockGetLeagueRosters.mockResolvedValue({ data: [] });
    mockGetLeagueMatchups.mockResolvedValue({ data: [] });

    const teams = makeTeams(['team-1']);
    const draftPicks = [{ team_id: 'team-1', player_id: '101' }];
    const allPlayers = [{ id: '101', points: 42 }];
    const result = await StandingsService.calculateSeasonPointsStandings('league-1', teams, draftPicks, allPlayers);

    expect(result['team-1'].pointsFor).toBe(42);
  });

  it('counts games played from past matchup weeks', async () => {
    mockGetLeagueRosters.mockResolvedValue({ data: [] });
    mockGetLeagueMatchups.mockResolvedValue({
      data: [
        { week_number: 1, week_end_date: '2026-03-01' },
        { week_number: 2, week_end_date: '2026-03-07' },
        { week_number: 3, week_end_date: '2026-03-07' },
      ],
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
    mockGetLeagueMatchups.mockResolvedValue({ data: [] });
    mockGetLeagueRosters.mockResolvedValue({ data: [] });
    mockGetLeague.mockResolvedValue({ data: { settings: {} } });
    mockGetPlayersByIds.mockResolvedValue([]);

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
    mockGetLeagueRosters.mockResolvedValue({ data: [] });
    mockGetLeague.mockResolvedValue({ data: { settings: {} } });
    mockGetPlayersByIds.mockResolvedValue([]);

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
    mockGetLeagueRosters.mockResolvedValue({ data: [] });
    mockGetLeague.mockResolvedValue({ data: { settings: {} } });
    mockGetPlayersByIds.mockResolvedValue([]);

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

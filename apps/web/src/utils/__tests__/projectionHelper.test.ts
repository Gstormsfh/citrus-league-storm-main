import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock modules
// =============================================================================

const mocks = vi.hoisted(() => ({ players: vi.fn(), schedule: vi.fn() }));
vi.mock('@/api/players', () => ({ playerApi: { getPlayersByIds: mocks.players } }));
vi.mock('@/services/ScheduleService', () => ({ ScheduleService: { getGamesForTeams: mocks.schedule } }));

const mockApiGet = vi.fn();

vi.mock('@/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

const mockGetTeams = vi.fn();
const mockGetLeague = vi.fn();
vi.mock('@/api/leagues', () => ({
  leagueApi: {
    getTeams: (...args: unknown[]) => mockGetTeams(...args),
    getLeague: (...args: unknown[]) => mockGetLeague(...args),
  },
}));

const mockGetLeagueRosters = vi.fn();
vi.mock('@/api/rosters', () => ({
  rosterApi: {
    getLeagueRosters: (...args: unknown[]) => mockGetLeagueRosters(...args),
  },
}));

// Partial mocks of this module are fragile: 12 of the 13 web test files that
// mock @/utils/seasonConstants omit getCurrentSeason, so any service that
// starts calling it gets `undefined is not a function` and fails with
// assertion noise rather than a clear error. importOriginal keeps the real
// exports and overrides only what this suite needs.
//
// The prior mock also supplied CURRENT_SEASON: '20252026' — a string in the
// HEADSHOT_SEASON format. The real export is a number (2025). No assertion
// referenced it, so it never mattered, but it was never right either.
vi.mock('@/utils/seasonConstants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/seasonConstants')>()),
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// =============================================================================
// Import AFTER mocks
// =============================================================================

import { getWeeklyProjections as readWeekly, getLeagueAverageProjections } from '../projectionHelper';
import { ScoringCalculator, projectionSettings } from '@citrus/shared';
const settings = projectionSettings({skater: {goals: 1}});
const getWeeklyProjections = (ids: number[], start: Date, end: Date) => readWeekly(ids, start, end, new ScoringCalculator(settings));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.players.mockImplementation(async (ids: string[]) => ({ data: ids.map(id => ({ id: Number(id), team: id, position: 'C' })) }));
  mocks.schedule.mockResolvedValue({ error: null, gamesByTeam: new Map([
    ['101', ['2026-03-01', '2026-03-02', '2026-03-03'].map(game_date => ({ game_date, status: 'scheduled' }))],
    ['102', [{ game_date: '2026-03-01', status: 'scheduled' }]],
    ['103', [{ game_date: '2026-03-01', status: 'scheduled' }]],
  ]) });
  mockGetLeague.mockResolvedValue({data: {scoring_settings: settings}});
});

// =============================================================================
// getWeeklyProjections
// =============================================================================

describe('getWeeklyProjections', () => {
  it('never scores a league-bound request before its settings load', async () => {
    const result = await readWeekly([101], new Date(2026, 2, 1), new Date(2026, 2, 1));
    expect(result.size).toBe(0);
    expect(mockApiGet).not.toHaveBeenCalled();
  });
  it('reprices identical raw rows for different leagues without mutating the cache', async () => {
    const rows = [{player_id: 101, projection_date: '2026-03-01', projected_goals: 2, total_projected_points: 999}];
    mockApiGet.mockResolvedValue({data: rows});
    const a = await readWeekly([101], new Date(2026, 2, 1), new Date(2026, 2, 1), new ScoringCalculator(projectionSettings({skater: {goals: 1}})));
    const b = await readWeekly([101], new Date(2026, 2, 1), new Date(2026, 2, 1), new ScoringCalculator(projectionSettings({skater: {goals: -3}})));
    expect(a.get(101)).toBe(2);
    expect(b.get(101)).toBe(-6);
    expect(rows[0].total_projected_points).toBe(999);
  });
  it('withholds partial weeks and distinguishes a proven off day from missing schedule data', async () => {
    mockApiGet.mockResolvedValue({ data: [{ player_id: 101, projection_date: '2026-03-01', projected_goals: 2 }] });
    expect((await getWeeklyProjections([101], new Date(2026, 2, 1), new Date(2026, 2, 3))).has(101)).toBe(false);
    mocks.schedule.mockResolvedValue({ error: null, gamesByTeam: new Map([['101', []]]) });
    expect((await getWeeklyProjections([101], new Date(2026, 2, 1), new Date(2026, 2, 3))).get(101)).toBe(0);
    mocks.schedule.mockResolvedValue({ error: new Error('Offline'), gamesByTeam: new Map() });
    expect((await getWeeklyProjections([101], new Date(2026, 2, 1), new Date(2026, 2, 3))).has(101)).toBe(false);
  });
  it('uses exact directory goalie identity and applies start exposure once', async () => {
    mocks.players.mockResolvedValue({ data: [{ id: 101, team: '101', position: 'G' }] });
    mockApiGet.mockResolvedValue({ data: [{ player_id: 101, projection_date: '2026-03-01', projected_wins: 0, projected_saves: 30, projected_goals_against: 2, projected_shutouts: 0, expected_starts: 0.2, projection_basis: 'conditional_on_start' }] });
    const result = await readWeekly([101], new Date(2026, 2, 1), new Date(2026, 2, 1), new ScoringCalculator(projectionSettings({ goalie: { saves: 1 } })));
    expect(result.get(101)).toBe(6);
  });
  it('rejects duplicate date rows instead of double counting', async () => {
    const row = { player_id: 101, projection_date: '2026-03-01', projected_goals: 2 };
    mockApiGet.mockResolvedValue({ data: [row, row] });
    expect((await getWeeklyProjections([101], new Date(2026, 2, 1), new Date(2026, 2, 1))).has(101)).toBe(false);
  });
  it('returns empty map when playerIds is empty', async () => {
    const result = await getWeeklyProjections([], new Date(2026, 2, 1), new Date(2026, 2, 7));

    expect(result.size).toBe(0);
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('returns empty map when playerIds is null/undefined', async () => {
    const result = await getWeeklyProjections(null as any, new Date(2026, 2, 1), new Date(2026, 2, 7));

    expect(result.size).toBe(0);
  });

  it('queries projections for all days in the week', async () => {
    mockApiGet.mockResolvedValue({
      data: [
        { player_id: 101, projected_goals: 3.5, projection_date: '2026-03-01' },
        { player_id: 101, projected_goals: 4.2, projection_date: '2026-03-02' },
        { player_id: 102, projected_goals: 2.0, projection_date: '2026-03-01' },
      ],
    });

    const result = await getWeeklyProjections(
      [101, 102],
      new Date(2026, 2, 1),
      new Date(2026, 2, 2)
    );

    expect(result.get(101)).toBeCloseTo(7.7); // 3.5 + 4.2
    expect(result.get(102)).toBeCloseTo(2.0);

    // Verify API was called with correct date range
    expect(mockApiGet).toHaveBeenCalledWith(
      expect.stringContaining('startDate=2026-03-01')
    );
    expect(mockApiGet).toHaveBeenCalledWith(
      expect.stringContaining('endDate=2026-03-02')
    );
  });

  it('sums projections per player across multiple days', async () => {
    mockApiGet.mockResolvedValue({
      data: [
        { player_id: 101, projected_goals: 1.0, projection_date: '2026-03-01' },
        { player_id: 101, projected_goals: 2.0, projection_date: '2026-03-02' },
        { player_id: 101, projected_goals: 3.0, projection_date: '2026-03-03' },
      ],
    });

    const result = await getWeeklyProjections(
      [101],
      new Date(2026, 2, 1),
      new Date(2026, 2, 3)
    );

    expect(result.get(101)).toBe(6.0); // 1 + 2 + 3
  });

  it('returns empty map on API error', async () => {
    mockApiGet.mockRejectedValue(new Error('API error'));

    const result = await getWeeklyProjections(
      [101],
      new Date(2026, 2, 1),
      new Date(2026, 2, 7)
    );

    expect(result.size).toBe(0);
  });

  it('handles null data gracefully', async () => {
    mockApiGet.mockResolvedValue({ data: null });

    const result = await getWeeklyProjections(
      [101],
      new Date(2026, 2, 1),
      new Date(2026, 2, 1)
    );

    expect(result.size).toBe(0);
  });

  it('handles projections with zero or null points', async () => {
    mockApiGet.mockResolvedValue({
      data: [
        { player_id: 101, projected_goals: 0, projection_date: '2026-03-01' },
        { player_id: 102, projected_goals: null, projection_date: '2026-03-01' },
      ],
    });

    const result = await getWeeklyProjections(
      [101, 102],
      new Date(2026, 2, 1),
      new Date(2026, 2, 1)
    );

    expect(result.get(101)).toBe(0);
    expect(result.has(102)).toBe(false);
  });

  it('generates correct date strings for single day', async () => {
    mockApiGet.mockResolvedValue({ data: [] });

    await getWeeklyProjections([101], new Date(2026, 2, 15), new Date(2026, 2, 15));

    expect(mockApiGet).toHaveBeenCalledWith(
      expect.stringContaining('startDate=2026-03-15&endDate=2026-03-15')
    );
  });
});

// =============================================================================
// getLeagueAverageProjections
// =============================================================================

describe('getLeagueAverageProjections', () => {
  it('returns empty map when no teams exist', async () => {
    mockGetTeams.mockResolvedValue({ data: [] });

    const result = await getLeagueAverageProjections(
      'league-1',
      new Date(2026, 2, 1),
      new Date(2026, 2, 7)
    );

    expect(result.size).toBe(0);
  });

  it('returns empty map when teams query fails', async () => {
    mockGetTeams.mockRejectedValue(new Error('API error'));

    const result = await getLeagueAverageProjections(
      'league-1',
      new Date(2026, 2, 1),
      new Date(2026, 2, 7)
    );

    expect(result.size).toBe(0);
  });

  it('returns empty map when no lineups exist', async () => {
    mockGetTeams.mockResolvedValue({ data: [{ id: 'team-1' }] });
    mockGetLeagueRosters.mockResolvedValue({ data: [] });

    const result = await getLeagueAverageProjections(
      'league-1',
      new Date(2026, 2, 1),
      new Date(2026, 2, 7)
    );

    expect(result.size).toBe(0);
  });

  it('returns empty map on thrown exception', async () => {
    mockGetTeams.mockImplementation(() => {
      throw new Error('Network failure');
    });

    const result = await getLeagueAverageProjections(
      'league-1',
      new Date(2026, 2, 1),
      new Date(2026, 2, 7)
    );

    expect(result.size).toBe(0);
  });

  it('calculates position averages from lineups and projections', async () => {
    mockGetTeams.mockResolvedValue({ data: [{ id: 'team-1' }] });
    mockGetLeagueRosters.mockResolvedValue({
      data: [
        { starters: [101, 102], bench: [103] },
      ],
    });

    // First call: projections batch, Second call: player directory
    mockApiGet
      .mockResolvedValueOnce({
        data: [
          { player_id: 101, projected_goals: 10, projection_date: '2026-03-01' },
          { player_id: 102, projected_goals: 8, projection_date: '2026-03-01' },
          { player_id: 103, projected_goals: 6, projection_date: '2026-03-01' },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          { player_id: 101, position_code: 'C' },
          { player_id: 102, position_code: 'C' },
          { player_id: 103, position_code: 'D' },
        ],
      });

    const result = await getLeagueAverageProjections(
      'league-1',
      new Date(2026, 2, 1),
      new Date(2026, 2, 1)
    );

    // C: (10 + 8) / 2 = 9, D: 6 / 1 = 6
    expect(result.get('C')).toBe(9);
    expect(result.get('D')).toBe(6);
    // F is every forward, per player, for F/D/G leagues: (10 + 8) / 2
    expect(result.get('F')).toBe(9);
  });

  it('handles lineups with null starters/bench', async () => {
    mockGetTeams.mockResolvedValue({ data: [{ id: 'team-1' }] });
    mockGetLeagueRosters.mockResolvedValue({
      data: [{ starters: null, bench: null }],
    });

    const result = await getLeagueAverageProjections(
      'league-1',
      new Date(2026, 2, 1),
      new Date(2026, 2, 1)
    );

    // No players collected -> empty map
    expect(result.size).toBe(0);
  });
});

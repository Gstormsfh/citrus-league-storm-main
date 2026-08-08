import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock modules
// =============================================================================

const mockApiGet = vi.fn();

vi.mock('@/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

const mockGetTeams = vi.fn();
vi.mock('@/api/leagues', () => ({
  leagueApi: {
    getTeams: (...args: unknown[]) => mockGetTeams(...args),
  },
}));

const mockGetLeagueRosters = vi.fn();
vi.mock('@/api/rosters', () => ({
  rosterApi: {
    getLeagueRosters: (...args: unknown[]) => mockGetLeagueRosters(...args),
  },
}));

vi.mock('@/utils/seasonConstants', () => ({
  CURRENT_SEASON: '20252026',
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

import { getWeeklyProjections, getLeagueAverageProjections } from '../projectionHelper';

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// getWeeklyProjections
// =============================================================================

describe('getWeeklyProjections', () => {
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
        { player_id: 101, total_projected_points: 3.5, projection_date: '2026-03-01' },
        { player_id: 101, total_projected_points: 4.2, projection_date: '2026-03-02' },
        { player_id: 102, total_projected_points: 2.0, projection_date: '2026-03-01' },
      ],
    });

    const result = await getWeeklyProjections(
      [101, 102],
      new Date(2026, 2, 1),
      new Date(2026, 2, 3)
    );

    expect(result.get(101)).toBeCloseTo(7.7); // 3.5 + 4.2
    expect(result.get(102)).toBeCloseTo(2.0);

    // Verify API was called with correct date range
    expect(mockApiGet).toHaveBeenCalledWith(
      expect.stringContaining('startDate=2026-03-01')
    );
    expect(mockApiGet).toHaveBeenCalledWith(
      expect.stringContaining('endDate=2026-03-03')
    );
  });

  it('sums projections per player across multiple days', async () => {
    mockApiGet.mockResolvedValue({
      data: [
        { player_id: 101, total_projected_points: 1.0, projection_date: '2026-03-01' },
        { player_id: 101, total_projected_points: 2.0, projection_date: '2026-03-02' },
        { player_id: 101, total_projected_points: 3.0, projection_date: '2026-03-03' },
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
        { player_id: 101, total_projected_points: 0, projection_date: '2026-03-01' },
        { player_id: 102, total_projected_points: null, projection_date: '2026-03-01' },
      ],
    });

    const result = await getWeeklyProjections(
      [101, 102],
      new Date(2026, 2, 1),
      new Date(2026, 2, 1)
    );

    expect(result.get(101)).toBe(0);
    expect(result.get(102)).toBe(0);
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
          { player_id: 101, total_projected_points: 10, projection_date: '2026-03-01' },
          { player_id: 102, total_projected_points: 8, projection_date: '2026-03-01' },
          { player_id: 103, total_projected_points: 6, projection_date: '2026-03-01' },
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

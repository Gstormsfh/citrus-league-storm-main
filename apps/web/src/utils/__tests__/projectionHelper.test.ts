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
    const result = await getWeeklyProjections([], new Date('2026-03-01'), new Date('2026-03-07'));

    expect(result.size).toBe(0);
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
  });

  it('returns empty map when playerIds is null/undefined', async () => {
    const result = await getWeeklyProjections(null as any, new Date('2026-03-01'), new Date('2026-03-07'));

    expect(result.size).toBe(0);
  });

  it('queries projections for all days in the week', async () => {
    const selectFn = vi.fn();
    const inPlayerFn = vi.fn();
    const inDateFn = vi.fn();
    const eqFn = vi.fn();

    mockSupabaseFrom.mockReturnValue({
      select: selectFn.mockReturnValue({
        in: inPlayerFn.mockReturnValue({
          in: inDateFn.mockReturnValue({
            eq: eqFn.mockResolvedValue({
              data: [
                { player_id: 101, total_projected_points: 3.5, projection_date: '2026-03-01' },
                { player_id: 101, total_projected_points: 4.2, projection_date: '2026-03-02' },
                { player_id: 102, total_projected_points: 2.0, projection_date: '2026-03-01' },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });

    const result = await getWeeklyProjections(
      [101, 102],
      new Date('2026-03-01'),
      new Date('2026-03-03')
    );

    expect(result.get(101)).toBeCloseTo(7.7); // 3.5 + 4.2
    expect(result.get(102)).toBeCloseTo(2.0);

    // Verify dates generated correctly (3 days: Mar 1, 2, 3)
    expect(inDateFn).toHaveBeenCalledWith(
      'projection_date',
      expect.arrayContaining(['2026-03-01', '2026-03-02', '2026-03-03'])
    );
  });

  it('sums projections per player across multiple days', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                { player_id: 101, total_projected_points: 1.0, projection_date: '2026-03-01' },
                { player_id: 101, total_projected_points: 2.0, projection_date: '2026-03-02' },
                { player_id: 101, total_projected_points: 3.0, projection_date: '2026-03-03' },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });

    const result = await getWeeklyProjections(
      [101],
      new Date('2026-03-01'),
      new Date('2026-03-03')
    );

    expect(result.get(101)).toBe(6.0); // 1 + 2 + 3
  });

  it('returns empty map on Supabase error', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Table not found' },
            }),
          }),
        }),
      }),
    });

    const result = await getWeeklyProjections(
      [101],
      new Date('2026-03-01'),
      new Date('2026-03-07')
    );

    expect(result.size).toBe(0);
  });

  it('returns empty map on thrown exception', async () => {
    mockSupabaseFrom.mockImplementation(() => {
      throw new Error('Network failure');
    });

    const result = await getWeeklyProjections(
      [101],
      new Date('2026-03-01'),
      new Date('2026-03-07')
    );

    expect(result.size).toBe(0);
  });

  it('handles null data gracefully', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    });

    const result = await getWeeklyProjections(
      [101],
      new Date('2026-03-01'),
      new Date('2026-03-01')
    );

    expect(result.size).toBe(0);
  });

  it('handles projections with zero or null points', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                { player_id: 101, total_projected_points: 0, projection_date: '2026-03-01' },
                { player_id: 102, total_projected_points: null, projection_date: '2026-03-01' },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });

    const result = await getWeeklyProjections(
      [101, 102],
      new Date('2026-03-01'),
      new Date('2026-03-01')
    );

    expect(result.get(101)).toBe(0);
    expect(result.get(102)).toBe(0);
  });

  it('generates correct date strings for single day', async () => {
    const inDateFn = vi.fn();
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          in: inDateFn.mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    });

    await getWeeklyProjections([101], new Date('2026-03-15'), new Date('2026-03-15'));

    expect(inDateFn).toHaveBeenCalledWith('projection_date', ['2026-03-15']);
  });
});

// =============================================================================
// getLeagueAverageProjections
// =============================================================================

describe('getLeagueAverageProjections', () => {
  it('returns empty map when no teams exist', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });

    const result = await getLeagueAverageProjections(
      'league-1',
      new Date('2026-03-01'),
      new Date('2026-03-07')
    );

    expect(result.size).toBe(0);
  });

  it('returns empty map when teams query fails', async () => {
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      }),
    });

    const result = await getLeagueAverageProjections(
      'league-1',
      new Date('2026-03-01'),
      new Date('2026-03-07')
    );

    expect(result.size).toBe(0);
  });

  it('returns empty map when no lineups exist', async () => {
    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // teams
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [{ id: 'team-1' }], error: null }),
          }),
        };
      }
      // team_lineups
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };
    });

    const result = await getLeagueAverageProjections(
      'league-1',
      new Date('2026-03-01'),
      new Date('2026-03-07')
    );

    expect(result.size).toBe(0);
  });

  it('returns empty map on thrown exception', async () => {
    mockSupabaseFrom.mockImplementation(() => {
      throw new Error('Network failure');
    });

    const result = await getLeagueAverageProjections(
      'league-1',
      new Date('2026-03-01'),
      new Date('2026-03-07')
    );

    expect(result.size).toBe(0);
  });

  it('calculates position averages from lineups and projections', async () => {
    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // teams
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'team-1' }],
              error: null,
            }),
          }),
        };
      }
      if (callCount === 2) {
        // team_lineups
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                { starters: [101, 102], bench: [103] },
              ],
              error: null,
            }),
          }),
        };
      }
      if (callCount === 3) {
        // player_projected_stats (from getWeeklyProjections)
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    { player_id: 101, total_projected_points: 10, projection_date: '2026-03-01' },
                    { player_id: 102, total_projected_points: 8, projection_date: '2026-03-01' },
                    { player_id: 103, total_projected_points: 6, projection_date: '2026-03-01' },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (callCount === 4) {
        // player_directory for position lookup
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  { player_id: 101, position_code: 'C' },
                  { player_id: 102, position_code: 'C' },
                  { player_id: 103, position_code: 'D' },
                ],
                error: null,
              }),
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

    const result = await getLeagueAverageProjections(
      'league-1',
      new Date('2026-03-01'),
      new Date('2026-03-01')
    );

    // C: (10 + 8) / 2 = 9, D: 6 / 1 = 6
    expect(result.get('C')).toBe(9);
    expect(result.get('D')).toBe(6);
  });

  it('handles lineups with null starters/bench', async () => {
    let callCount = 0;
    mockSupabaseFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: 'team-1' }],
              error: null,
            }),
          }),
        };
      }
      if (callCount === 2) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ starters: null, bench: null }],
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

    const result = await getLeagueAverageProjections(
      'league-1',
      new Date('2026-03-01'),
      new Date('2026-03-01')
    );

    // No players collected -> empty map
    expect(result.size).toBe(0);
  });
});

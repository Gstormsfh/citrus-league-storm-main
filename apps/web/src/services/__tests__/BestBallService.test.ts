import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock API client
// =============================================================================

vi.mock('@/api/bestball', () => ({
  bestballApi: {
    getWeeklyData: vi.fn(),
    getLeagueTeams: vi.fn(),
    triggerOptimization: vi.fn(),
    triggerWeekOptimization: vi.fn(),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/utils/seasonConstants', async (importOriginal) => ({
  // Spread the real module: a hand-written object here omits whatever the
  // service starts calling next. getCurrentSeason() was added to several
  // services on 2026-08-11 and every partial mock broke with `undefined is
  // not a function`, surfacing as assertion noise rather than a clear error.
  ...(await importOriginal<typeof import('@/utils/seasonConstants')>()),
  CURRENT_SEASON: '20252026',
}));

vi.mock('@/types/leagueTypes', () => ({
  DEFAULT_ROSTER_SLOTS: [
    { slot: 'C', label: 'Center', count: 2 },
    { slot: 'LW', label: 'Left Wing', count: 2 },
    { slot: 'RW', label: 'Right Wing', count: 2 },
    { slot: 'D', label: 'Defense', count: 4 },
    { slot: 'G', label: 'Goalie', count: 2 },
    { slot: 'UTIL', label: 'Utility', count: 1 },
    { slot: 'BN', label: 'Bench', count: 4 },
    { slot: 'IR', label: 'IR', count: 1 },
  ],
}));

vi.mock('@/utils/scoringUtils', () => {
  class MockScoringCalculator {
    calculatePoints(stats: Record<string, number>, isGoalie: boolean) {
      // Simple mock: just return a sum of common stat values for testing
      if (isGoalie) {
        return (stats.wins || 0) * 4 + (stats.saves || 0) * 0.2 + (stats.goals_against || 0) * -1;
      }
      return (stats.goals || 0) * 3 + (stats.assists || 0) * 2 + (stats.shots || 0) * 0.4;
    }
  }
  return {
    ScoringCalculator: MockScoringCalculator,
  };
});

// =============================================================================
// Import AFTER mocks
// =============================================================================

import { bestballApi } from '@/api/bestball';

let BestBallService: typeof import('../BestBallService').BestBallService;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../BestBallService');
  BestBallService = mod.BestBallService;
});

// =============================================================================
// optimizeLineup — Pure function tests
// =============================================================================

describe('BestBallService.optimizeLineup', () => {
  it('assigns highest-scoring players to each position slot', () => {
    const playerScores = [
      { player_id: '1', position: 'C', points: 10, is_goalie: false },
      { player_id: '2', position: 'C', points: 8, is_goalie: false },
      { player_id: '3', position: 'C', points: 5, is_goalie: false },
      { player_id: '4', position: 'LW', points: 12, is_goalie: false },
      { player_id: '5', position: 'LW', points: 6, is_goalie: false },
      { player_id: '6', position: 'RW', points: 11, is_goalie: false },
      { player_id: '7', position: 'RW', points: 4, is_goalie: false },
      { player_id: '8', position: 'D', points: 9, is_goalie: false },
      { player_id: '9', position: 'D', points: 7, is_goalie: false },
      { player_id: '10', position: 'D', points: 3, is_goalie: false },
      { player_id: '11', position: 'D', points: 2, is_goalie: false },
      { player_id: '12', position: 'G', points: 15, is_goalie: true },
      { player_id: '13', position: 'G', points: 1, is_goalie: true },
    ];

    // Use a simplified roster config for clarity
    const rosterSlots = [
      { slot: 'C', label: 'Center', count: 2 },
      { slot: 'LW', label: 'Left Wing', count: 1 },
      { slot: 'RW', label: 'Right Wing', count: 1 },
      { slot: 'D', label: 'Defense', count: 2 },
      { slot: 'G', label: 'Goalie', count: 1 },
      { slot: 'BN', label: 'Bench', count: 3 },
    ];

    const result = BestBallService.optimizeLineup(playerScores, rosterSlots);

    // C slots: 10 + 8 = 18
    // LW slot: 12
    // RW slot: 11
    // D slots: 9 + 7 = 16
    // G slot: 15
    // Total: 18 + 12 + 11 + 16 + 15 = 72
    expect(result.totalPoints).toBe(72);
    expect(result.starters).toHaveLength(7); // 2C + 1LW + 1RW + 2D + 1G

    // Bench: players 3(5), 5(6), 7(4), 10(3), 11(2), 13(1) = 21
    expect(result.benchPoints).toBe(21);
  });

  it('returns empty lineup when no players are provided', () => {
    const result = BestBallService.optimizeLineup([]);

    expect(result.starters).toEqual([]);
    expect(result.totalPoints).toBe(0);
    expect(result.benchPoints).toBe(0);
  });

  it('fills UTIL slots with best remaining skaters', () => {
    const playerScores = [
      { player_id: '1', position: 'C', points: 20, is_goalie: false },
      { player_id: '2', position: 'C', points: 15, is_goalie: false },
      { player_id: '3', position: 'C', points: 12, is_goalie: false }, // Should fill UTIL
      { player_id: '4', position: 'LW', points: 8, is_goalie: false },
    ];

    const rosterSlots = [
      { slot: 'C', label: 'Center', count: 2 },
      { slot: 'LW', label: 'Left Wing', count: 1 },
      { slot: 'UTIL', label: 'Utility', count: 1 },
      { slot: 'BN', label: 'Bench', count: 2 },
    ];

    const result = BestBallService.optimizeLineup(playerScores, rosterSlots);

    // C slots: 20 + 15 = 35, LW: 8, UTIL: 12 (3rd center)
    expect(result.totalPoints).toBe(55);
    expect(result.starters).toContain('3'); // 3rd center goes to UTIL
    expect(result.starters).toHaveLength(4);
  });

  it('does not assign goalies to UTIL slots', () => {
    const playerScores = [
      { player_id: '1', position: 'G', points: 30, is_goalie: true },
      { player_id: '2', position: 'G', points: 25, is_goalie: true },
      { player_id: '3', position: 'G', points: 20, is_goalie: true }, // Extra goalie
      { player_id: '4', position: 'C', points: 5, is_goalie: false },
    ];

    const rosterSlots = [
      { slot: 'G', label: 'Goalie', count: 2 },
      { slot: 'UTIL', label: 'Utility', count: 1 },
      { slot: 'BN', label: 'Bench', count: 2 },
    ];

    const result = BestBallService.optimizeLineup(playerScores, rosterSlots);

    // G slots: 30 + 25 = 55, UTIL: 5 (center, not the 3rd goalie)
    expect(result.totalPoints).toBe(60);
    expect(result.starters).toContain('4'); // Center in UTIL, not 3rd goalie
    expect(result.starters).not.toContain('3'); // 3rd goalie stays on bench
  });

  it('skips BN and IR slots during optimization', () => {
    const playerScores = [
      { player_id: '1', position: 'C', points: 10, is_goalie: false },
    ];

    const rosterSlots = [
      { slot: 'C', label: 'Center', count: 1 },
      { slot: 'BN', label: 'Bench', count: 5 },
      { slot: 'IR', label: 'IR', count: 2 },
    ];

    const result = BestBallService.optimizeLineup(playerScores, rosterSlots);

    // Only 1 C slot, so 1 starter
    expect(result.starters).toHaveLength(1);
    expect(result.totalPoints).toBe(10);
    expect(result.benchPoints).toBe(0);
  });

  it('prioritizes specific position slots before UTIL (greedy strategy)', () => {
    // If a player is eligible for both C and UTIL, they should fill C first
    const playerScores = [
      { player_id: '1', position: 'C', points: 10, is_goalie: false },
      { player_id: '2', position: 'LW', points: 8, is_goalie: false },
    ];

    const rosterSlots = [
      { slot: 'C', label: 'Center', count: 1 },
      { slot: 'LW', label: 'Left Wing', count: 1 },
      { slot: 'UTIL', label: 'Utility', count: 1 },
      { slot: 'BN', label: 'Bench', count: 1 },
    ];

    const result = BestBallService.optimizeLineup(playerScores, rosterSlots);

    // C: 10, LW: 8, UTIL: empty (no more players)
    expect(result.starters).toEqual(['1', '2']);
    expect(result.totalPoints).toBe(18);
  });

  it('handles players with zero points', () => {
    const playerScores = [
      { player_id: '1', position: 'C', points: 0, is_goalie: false },
      { player_id: '2', position: 'C', points: 0, is_goalie: false },
    ];

    const rosterSlots = [
      { slot: 'C', label: 'Center', count: 2 },
      { slot: 'BN', label: 'Bench', count: 1 },
    ];

    const result = BestBallService.optimizeLineup(playerScores, rosterSlots);

    expect(result.starters).toHaveLength(2);
    expect(result.totalPoints).toBe(0);
    expect(result.benchPoints).toBe(0);
  });

  it('handles negative points (e.g., bad goalie starts)', () => {
    const playerScores = [
      { player_id: '1', position: 'G', points: -3, is_goalie: true },
      { player_id: '2', position: 'G', points: 8, is_goalie: true },
    ];

    const rosterSlots = [
      { slot: 'G', label: 'Goalie', count: 2 },
      { slot: 'BN', label: 'Bench', count: 1 },
    ];

    const result = BestBallService.optimizeLineup(playerScores, rosterSlots);

    // Both goalies fill the G slots: 8 + (-3) = 5
    expect(result.totalPoints).toBe(5);
    expect(result.starters).toHaveLength(2);
  });
});

// =============================================================================
// calculateWeeklyBestBall — Integration-style tests (mocked API)
// =============================================================================

describe('BestBallService.calculateWeeklyBestBall', () => {
  it('returns empty result when no roster assignments exist', async () => {
    (bestballApi.getWeeklyData as any).mockResolvedValue({
      data: {
        lineup: null,
        playerIds: [],
        players: [],
        weeklyStats: [],
      },
    });

    const result = await BestBallService.calculateWeeklyBestBall('league-1', 'team-1', 5);

    expect(result.team_id).toBe('team-1');
    expect(result.optimized_points).toBe(0);
    expect(result.optimized_starters).toEqual([]);
    expect(result.player_scores).toEqual({});
  });

  it('returns empty result when no weekly stats exist', async () => {
    (bestballApi.getWeeklyData as any).mockResolvedValue({
      data: {
        lineup: { starters: ['101'], bench: ['102'], ir: [] },
        playerIds: ['101', '102'],
        players: [
          { player_id: 101, position_code: 'C', eligible_positions: null },
          { player_id: 102, position_code: 'LW', eligible_positions: null },
        ],
        weeklyStats: [],
      },
    });

    const result = await BestBallService.calculateWeeklyBestBall('league-1', 'team-1', 5);

    expect(result.optimized_points).toBe(0);
    expect(result.optimized_starters).toEqual([]);
  });

  it('handles errors gracefully and returns empty result', async () => {
    (bestballApi.getWeeklyData as any).mockRejectedValue(new Error('Database connection lost'));

    const result = await BestBallService.calculateWeeklyBestBall('league-1', 'team-1', 5);

    expect(result.team_id).toBe('team-1');
    expect(result.optimized_points).toBe(0);
    expect(result.optimized_starters).toEqual([]);
  });
});

// =============================================================================
// triggerServerOptimization
// =============================================================================

describe('BestBallService.triggerServerOptimization', () => {
  it('calls the triggerOptimization API', async () => {
    (bestballApi.triggerOptimization as any).mockResolvedValue({
      data: [
        { team_id: 'team-1', players_optimized: 14, total_points: 45.5 },
        { team_id: 'team-2', players_optimized: 14, total_points: 38.2 },
      ],
    });

    const result = await BestBallService.triggerServerOptimization('league-1', '2026-01-15');

    expect(bestballApi.triggerOptimization).toHaveBeenCalledWith('league-1', '2026-01-15');
    expect(result.results).toHaveLength(2);
    expect(result.results[0].teamId).toBe('team-1');
    expect(result.results[0].totalPoints).toBe(45.5);
    expect(result.error).toBeUndefined();
  });

  it('returns error when API call fails', async () => {
    (bestballApi.triggerOptimization as any).mockRejectedValue(new Error('Function not found'));

    const result = await BestBallService.triggerServerOptimization('league-1', '2026-01-15');

    expect(result.results).toEqual([]);
    expect(result.error).toContain('Function not found');
  });
});

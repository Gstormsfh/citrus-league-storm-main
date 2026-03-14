import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock playerApi from @/api/players
// =============================================================================

const mockSearchPlayers = vi.fn();
const mockGetPlayersByIds = vi.fn();

vi.mock('@/api/players', () => ({
  playerApi: {
    searchPlayers: (...args: unknown[]) => mockSearchPlayers(...args),
    getPlayersByIds: (...args: unknown[]) => mockGetPlayersByIds(...args),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/seasonConstants', () => ({
  CURRENT_SEASON: 2025,
}));

// =============================================================================
// Import after mocks
// =============================================================================

import { CitrusPuckService } from '../CitrusPuckService';
import { logger } from '@/utils/logger';

// =============================================================================
// Helpers
// =============================================================================

/** Creates a mock ServerPlayer (NormalizedPlayer shape returned by the API) */
const makeMockServerPlayer = (overrides: Record<string, any> = {}) => ({
  id: 8478402,
  full_name: 'Connor McDavid',
  position: 'C',
  team: 'EDM',
  is_goalie: false,
  games_played: 40,
  goals: 22,
  assists: 28,
  points: 50,
  shots: 155,
  hits: 32,
  blocks: 18,
  pim: 10,
  ppp: 12,
  shp: 1,
  plus_minus: 14,
  icetime_seconds: 48000,
  x_goals: 18.5,
  goalie_gp: 0,
  wins: 0,
  losses: 0,
  ot_losses: 0,
  saves: 0,
  shots_faced: 0,
  goals_against: 0,
  save_pct: 0,
  gaa: 0,
  shutouts: 0,
  ...overrides,
});

// =============================================================================
// Tests
// =============================================================================

describe('CitrusPuckService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // getAllAnalytics
  // ---------------------------------------------------------------------------
  describe('getAllAnalytics', () => {
    it('returns a Map of aggregated player data on success', async () => {
      const players = [makeMockServerPlayer()];
      mockSearchPlayers.mockResolvedValue({ data: players });

      const result = await CitrusPuckService.getAllAnalytics(2025);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(1);
      const player = result.get(8478402);
      expect(player).toBeDefined();
      expect(player?.name).toBe('Connor McDavid');
      expect(player?.team).toBe('EDM');
      expect(player?.position).toBe('C');
      expect(player?.allSituation.I_F_goals).toBe(22);
      expect(player?.allSituation.I_F_points).toBe(50);
      expect(player?.allSituation.I_F_shotsOnGoal).toBe(155);
    });

    it('returns empty Map when API call throws', async () => {
      mockSearchPlayers.mockRejectedValue(new Error('Network error'));

      const result = await CitrusPuckService.getAllAnalytics(2025);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(logger.error).toHaveBeenCalled();
    });

    it('returns empty Map when response data is null', async () => {
      mockSearchPlayers.mockResolvedValue({ data: null });

      const result = await CitrusPuckService.getAllAnalytics(2025);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('handles multiple players correctly', async () => {
      const players = [
        makeMockServerPlayer(),
        makeMockServerPlayer({
          id: 8479318,
          full_name: 'Leon Draisaitl',
          position: 'C',
          team: 'EDM',
          goals: 30,
          points: 60,
        }),
      ];
      mockSearchPlayers.mockResolvedValue({ data: players });

      const result = await CitrusPuckService.getAllAnalytics(2025);

      expect(result.size).toBe(2);
      expect(result.get(8478402)?.name).toBe('Connor McDavid');
      expect(result.get(8479318)?.name).toBe('Leon Draisaitl');
    });

    it('approximates primary/secondary assists with 60/40 split', async () => {
      const players = [makeMockServerPlayer({ assists: 30 })];
      mockSearchPlayers.mockResolvedValue({ data: players });

      const result = await CitrusPuckService.getAllAnalytics(2025);

      const player = result.get(8478402);
      expect(player?.allSituation.I_F_primaryAssists).toBe(18); // Math.round(30 * 0.6)
      expect(player?.allSituation.I_F_secondaryAssists).toBe(12); // 30 - 18
    });
  });

  // ---------------------------------------------------------------------------
  // getPlayerAnalytics
  // ---------------------------------------------------------------------------
  describe('getPlayerAnalytics', () => {
    it('returns array with single player data on success', async () => {
      const players = [makeMockServerPlayer()];
      mockGetPlayersByIds.mockResolvedValue({ data: players });

      const result = await CitrusPuckService.getPlayerAnalytics(8478402, 2025);

      expect(result).toHaveLength(1);
      expect(result[0].playerId).toBe(8478402);
      expect(result[0].situation).toBe('all');
      expect(result[0].I_F_goals).toBe(22);
      expect(result[0].I_F_points).toBe(50);
    });

    it('returns empty array when API call throws', async () => {
      mockGetPlayersByIds.mockRejectedValue(new Error('Not found'));

      const result = await CitrusPuckService.getPlayerAnalytics(99999, 2025);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });

    it('returns empty array when player is not in response', async () => {
      mockGetPlayersByIds.mockResolvedValue({ data: [] });

      const result = await CitrusPuckService.getPlayerAnalytics(99999, 2025);

      expect(result).toEqual([]);
    });

    it('returns empty array when response data is null', async () => {
      mockGetPlayersByIds.mockResolvedValue({ data: null });

      const result = await CitrusPuckService.getPlayerAnalytics(99999, 2025);

      expect(result).toEqual([]);
    });

    it('passes player ID as string to getPlayersByIds', async () => {
      mockGetPlayersByIds.mockResolvedValue({ data: [] });

      await CitrusPuckService.getPlayerAnalytics(8478402, 2025);

      expect(mockGetPlayersByIds).toHaveBeenCalledWith(['8478402']);
    });

    it('maps goalie stats correctly', async () => {
      const goaliePlayer = makeMockServerPlayer({
        id: 8479361,
        full_name: 'Igor Shesterkin',
        position: 'G',
        is_goalie: true,
        goalie_gp: 30,
        wins: 20,
        saves: 800,
        goals_against: 60,
        shutouts: 3,
        save_pct: 0.930,
      });
      mockGetPlayersByIds.mockResolvedValue({ data: [goaliePlayer] });

      const result = await CitrusPuckService.getPlayerAnalytics(8479361, 2025);

      expect(result[0].I_F_savedShotsOnGoal).toBe(800);
      expect(result[0].position).toBe('G');
      expect(result[0].name).toBe('Igor Shesterkin');
    });
  });

  // ---------------------------------------------------------------------------
  // getAggregatedPlayerData
  // ---------------------------------------------------------------------------
  describe('getAggregatedPlayerData', () => {
    it('returns aggregated data with allSituation', async () => {
      const players = [makeMockServerPlayer()];
      mockGetPlayersByIds.mockResolvedValue({ data: players });

      const result = await CitrusPuckService.getAggregatedPlayerData(8478402, 2025);

      expect(result).not.toBeNull();
      expect(result?.playerId).toBe(8478402);
      expect(result?.name).toBe('Connor McDavid');
      expect(result?.allSituation).toBeDefined();
      expect(result?.allSituation.situation).toBe('all');
    });

    it('returns null when no data is found', async () => {
      mockGetPlayersByIds.mockResolvedValue({ data: [] });

      const result = await CitrusPuckService.getAggregatedPlayerData(99999, 2025);

      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // scaleStats
  // ---------------------------------------------------------------------------
  describe('scaleStats', () => {
    it('scales numeric stat fields by the given factor', () => {
      const data = {
        playerId: 1,
        season: 2025,
        situation: 'all' as const,
        name: 'Test',
        team: 'TST',
        position: 'C',
        games_played: 10,
        I_F_goals: 5,
        I_F_points: 12,
        I_F_primaryAssists: 4,
        I_F_secondaryAssists: 3,
        I_F_shotsOnGoal: 30,
        I_F_hits: 10,
        icetime: 5000,
        shifts: 100,
      } as any;

      const scaled = CitrusPuckService.scaleStats(data, 2);

      expect(scaled.games_played).toBe(20);
      expect(scaled.I_F_goals).toBe(10);
      expect(scaled.I_F_points).toBe(24);
      expect(scaled.I_F_primaryAssists).toBe(8);
      expect(scaled.I_F_shotsOnGoal).toBe(60);
    });

    it('handles zero scale factor', () => {
      const data = {
        games_played: 10,
        I_F_goals: 5,
        icetime: 5000,
      } as any;

      const scaled = CitrusPuckService.scaleStats(data, 0);

      expect(scaled.games_played).toBe(0);
      expect(scaled.I_F_goals).toBe(0);
    });

    it('does not modify original data object', () => {
      const data = {
        games_played: 10,
        I_F_goals: 5,
      } as any;

      CitrusPuckService.scaleStats(data, 3);

      expect(data.games_played).toBe(10); // Original unchanged
    });
  });

  // ---------------------------------------------------------------------------
  // projectCurrentWeek
  // ---------------------------------------------------------------------------
  describe('projectCurrentWeek', () => {
    it('scales stats to one week (3.5 games avg)', () => {
      const aggData = {
        playerId: 1,
        name: 'Test',
        team: 'TST',
        position: 'C',
        season: 2025,
        allSituation: {
          games_played: 70,
          I_F_goals: 35,
          I_F_points: 70,
          icetime: 70000,
          I_F_shotsOnGoal: 210,
          I_F_primaryAssists: 21,
          I_F_secondaryAssists: 14,
          I_F_hits: 70,
          shifts: 700,
        } as any,
      };

      const result = CitrusPuckService.projectCurrentWeek(aggData);

      // scaleFactor = 3.5 / 70 = 0.05
      expect(result.games_played).toBeCloseTo(3.5);
      expect(result.I_F_goals).toBeCloseTo(1.75);
      expect(result.I_F_points).toBeCloseTo(3.5);
    });

    it('returns empty object when data is null', () => {
      const result = CitrusPuckService.projectCurrentWeek(null as any);

      expect(result).toEqual({});
    });

    it('returns empty object when allSituation is missing', () => {
      const result = CitrusPuckService.projectCurrentWeek({ playerId: 1 } as any);

      expect(result).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  // projectRestOfSeason
  // ---------------------------------------------------------------------------
  describe('projectRestOfSeason', () => {
    it('projects remaining games based on pace', () => {
      const currentData = {
        playerId: 1,
        name: 'Test',
        team: 'TST',
        position: 'C',
        season: 2025,
        allSituation: {
          games_played: 41,
          I_F_goals: 20,
          I_F_points: 50,
          icetime: 50000,
          I_F_shotsOnGoal: 120,
          I_F_primaryAssists: 15,
          I_F_secondaryAssists: 15,
          I_F_hits: 40,
          shifts: 400,
        } as any,
      };

      const result = CitrusPuckService.projectRestOfSeason(null, currentData);

      // gamesRemaining = 82 - 41 = 41, scaleFactor = 41/41 = 1
      expect(result.games_played).toBeCloseTo(41);
      expect(result.I_F_goals).toBeCloseTo(20);
      expect(result.I_F_points).toBeCloseTo(50);
    });

    it('returns empty object when dataCurrent is null', () => {
      const result = CitrusPuckService.projectRestOfSeason(null, null as any);

      expect(result).toEqual({});
    });

    it('uses prior season data when current season GP is 0', () => {
      const priorData = {
        playerId: 1,
        name: 'Test',
        team: 'TST',
        position: 'C',
        season: 2024,
        allSituation: {
          games_played: 82,
          I_F_goals: 40,
          I_F_points: 100,
          icetime: 82000,
        } as any,
      };

      const currentData = {
        playerId: 1,
        name: 'Test',
        team: 'TST',
        position: 'C',
        season: 2025,
        allSituation: {
          games_played: 0,
          I_F_goals: 0,
          I_F_points: 0,
          icetime: 0,
        } as any,
      };

      const result = CitrusPuckService.projectRestOfSeason(priorData, currentData);

      // 82 games remaining, prior had 82 GP, so scaleFactor = 1
      expect(result.games_played).toBeCloseTo(82);
      expect(result.I_F_goals).toBeCloseTo(40);
    });
  });
});

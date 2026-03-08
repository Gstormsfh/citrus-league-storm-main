import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock Supabase client
// =============================================================================

function createChainMock() {
  const chain: Record<string, any> = {};
  const chainMethods = ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'limit', 'filter'];
  chainMethods.forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  return chain;
}

const mockFrom = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'mock-token' } } }),
    },
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

const makeMockStats = (overrides: Record<string, any> = {}) => ({
  season: 2025,
  player_id: 8478402,
  team_abbrev: 'EDM',
  position_code: 'C',
  is_goalie: false,
  games_played: 40,
  icetime_seconds: 50000,
  nhl_toi_seconds: 48000,
  goals: 20,
  primary_assists: 15,
  secondary_assists: 10,
  points: 45,
  shots_on_goal: 150,
  hits: 30,
  blocks: 20,
  pim: 12,
  ppp: 10,
  shp: 2,
  plus_minus: 15,
  nhl_plus_minus: 14,
  nhl_goals: 22,
  nhl_assists: 28,
  nhl_points: 50,
  nhl_shots_on_goal: 155,
  nhl_hits: 32,
  nhl_blocks: 18,
  nhl_pim: 10,
  nhl_ppp: 12,
  nhl_shp: 1,
  x_goals: 18.5,
  x_assists: 22.3,
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
});

const makeMockDirectory = (overrides: Record<string, any> = {}) => ({
  season: 2025,
  player_id: 8478402,
  full_name: 'Connor McDavid',
  team_abbrev: 'EDM',
  position_code: 'C',
  is_goalie: false,
  ...overrides,
});

// Helper to create a chain that resolves as a Promise (for queries not using .single())
function createThenableChain(resolveData: any, resolveError: any = null) {
  const chain = createChainMock();
  // Make the chain thenable for Promise.all usage
  const promiseResult = { data: resolveData, error: resolveError };
  Object.defineProperty(chain, 'then', {
    value: (onFulfilled?: (val: any) => any, onRejected?: (err: any) => any) => {
      return Promise.resolve(promiseResult).then(onFulfilled, onRejected);
    },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(chain, 'catch', {
    value: (onRejected?: (err: any) => any) => {
      return Promise.resolve(promiseResult).catch(onRejected);
    },
    writable: true,
    configurable: true,
  });
  return chain;
}

// =============================================================================
// Tests
// =============================================================================

describe('CitrusPuckService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation(() => createChainMock());
  });

  // ---------------------------------------------------------------------------
  // getAllAnalytics
  // ---------------------------------------------------------------------------
  describe('getAllAnalytics', () => {
    it('returns a Map of aggregated player data on success', async () => {
      const statsData = [makeMockStats()];
      const dirData = [makeMockDirectory()];

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createThenableChain(statsData);
        }
        return createThenableChain(dirData);
      });

      const result = await CitrusPuckService.getAllAnalytics(2025);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(1);
      const player = result.get(8478402);
      expect(player).toBeDefined();
      expect(player?.name).toBe('Connor McDavid');
      expect(player?.team).toBe('EDM');
      expect(player?.position).toBe('C');
    });

    it('returns empty Map when stats query fails', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createThenableChain(null, { message: 'DB error' });
        }
        return createThenableChain([]);
      });

      const result = await CitrusPuckService.getAllAnalytics(2025);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(logger.error).toHaveBeenCalled();
    });

    it('returns empty Map when directory query fails', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createThenableChain([makeMockStats()]);
        }
        return createThenableChain(null, { message: 'Dir error' });
      });

      const result = await CitrusPuckService.getAllAnalytics(2025);

      expect(result.size).toBe(0);
      expect(logger.error).toHaveBeenCalled();
    });

    it('handles players without directory entries', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createThenableChain([makeMockStats()]);
        }
        return createThenableChain([]); // Empty directory
      });

      const result = await CitrusPuckService.getAllAnalytics(2025);

      expect(result.size).toBe(1);
      const player = result.get(8478402);
      expect(player?.name).toBe(''); // No directory = empty name
      expect(player?.team).toBe('EDM'); // Comes from stats
    });
  });

  // ---------------------------------------------------------------------------
  // getPlayerAnalytics
  // ---------------------------------------------------------------------------
  describe('getPlayerAnalytics', () => {
    it('returns array with single player data on success', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        const chain = createChainMock();
        if (callCount === 1) {
          chain.single.mockResolvedValue({ data: makeMockStats(), error: null });
        } else {
          chain.single.mockResolvedValue({ data: makeMockDirectory(), error: null });
        }
        return chain;
      });

      const result = await CitrusPuckService.getPlayerAnalytics(8478402, 2025);

      expect(result).toHaveLength(1);
      expect(result[0].playerId).toBe(8478402);
      expect(result[0].situation).toBe('all');
      expect(result[0].I_F_goals).toBe(22); // Uses NHL stats
      expect(result[0].I_F_points).toBe(50);
    });

    it('returns empty array when stats query fails', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        const chain = createChainMock();
        if (callCount === 1) {
          chain.single.mockResolvedValue({ data: null, error: { message: 'Not found' } });
        } else {
          chain.single.mockResolvedValue({ data: null, error: null });
        }
        return chain;
      });

      const result = await CitrusPuckService.getPlayerAnalytics(99999, 2025);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });

    it('returns empty array when stats data is null (no error)', async () => {
      mockFrom.mockImplementation(() => {
        const chain = createChainMock();
        chain.single.mockResolvedValue({ data: null, error: null });
        return chain;
      });

      const result = await CitrusPuckService.getPlayerAnalytics(99999, 2025);

      expect(result).toEqual([]);
    });

    it('maps goalie stats correctly', async () => {
      const goalieStats = makeMockStats({
        player_id: 8479361,
        position_code: 'G',
        is_goalie: true,
        goalie_gp: 30,
        nhl_wins: 20,
        nhl_saves: 800,
        nhl_goals_against: 60,
        nhl_shutouts: 3,
        nhl_save_pct: 0.930,
      });
      const goalieDir = makeMockDirectory({
        player_id: 8479361,
        full_name: 'Igor Shesterkin',
        position_code: 'G',
        is_goalie: true,
      });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        const chain = createChainMock();
        if (callCount === 1) {
          chain.single.mockResolvedValue({ data: goalieStats, error: null });
        } else {
          chain.single.mockResolvedValue({ data: goalieDir, error: null });
        }
        return chain;
      });

      const result = await CitrusPuckService.getPlayerAnalytics(8479361, 2025);

      expect(result[0].I_F_savedShotsOnGoal).toBe(800);
      expect(result[0].position).toBe('G');
    });
  });

  // ---------------------------------------------------------------------------
  // getAggregatedPlayerData
  // ---------------------------------------------------------------------------
  describe('getAggregatedPlayerData', () => {
    it('returns aggregated data with allSituation', async () => {
      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        const chain = createChainMock();
        if (callCount === 1) {
          chain.single.mockResolvedValue({ data: makeMockStats(), error: null });
        } else {
          chain.single.mockResolvedValue({ data: makeMockDirectory(), error: null });
        }
        return chain;
      });

      const result = await CitrusPuckService.getAggregatedPlayerData(8478402, 2025);

      expect(result).not.toBeNull();
      expect(result?.playerId).toBe(8478402);
      expect(result?.name).toBe('Connor McDavid');
      expect(result?.allSituation).toBeDefined();
      expect(result?.allSituation.situation).toBe('all');
    });

    it('returns null when no data is found', async () => {
      mockFrom.mockImplementation(() => {
        const chain = createChainMock();
        chain.single.mockResolvedValue({ data: null, error: { message: 'not found' } });
        return chain;
      });

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

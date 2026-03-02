import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock Supabase client
// =============================================================================

function createChainMock(resolveData: any = null, resolveError: any = null) {
  const result = { data: resolveData, error: resolveError, count: resolveData?.length ?? 0 };
  const chain: Record<string, any> = {};
  const chainMethods = ['select', 'insert', 'update', 'delete', 'eq', 'is', 'in', 'order', 'limit', 'filter', 'gt'];
  chainMethods.forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  // Make the chain itself thenable (for queries that don't end with .single())
  chain.then = (onFulfilled?: (val: any) => any, onRejected?: (err: any) => any) => {
    return Promise.resolve(result).then(onFulfilled, onRejected);
  };
  return chain;
}

const mockFrom = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  },
}));

const mockUpdateMatchupScores = vi.fn();

vi.mock('../MatchupService', () => ({
  MatchupService: {
    updateMatchupScores: (...args: unknown[]) => mockUpdateMatchupScores(...args),
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

// =============================================================================
// Import after mocks
// =============================================================================

import { MatchupScoreJobService } from '../MatchupScoreJobService';
import { logger } from '@/utils/logger';

// =============================================================================
// Tests
// =============================================================================

describe('MatchupScoreJobService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation(() => createChainMock());
    mockUpdateMatchupScores.mockResolvedValue({
      error: null,
      updatedCount: 5,
      results: [],
    });
  });

  // ---------------------------------------------------------------------------
  // lockCompletedDays
  // ---------------------------------------------------------------------------
  describe('lockCompletedDays', () => {
    it('queries final games and batch-locks daily rosters', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'nhl_games') {
          return createChainMock(
            [{ game_date: '2025-01-10' }, { game_date: '2025-01-10' }, { game_date: '2025-01-11' }]
          );
        }
        if (table === 'fantasy_daily_rosters') {
          return createChainMock([{ player_id: 1 }, { player_id: 2 }]);
        }
        return createChainMock();
      });

      const result = await MatchupScoreJobService.lockCompletedDays();

      expect(result.lockedCount).toBe(2);
      expect(result.error).toBeNull();
    });

    it('returns 0 when no final games exist', async () => {
      mockFrom.mockImplementation(() => createChainMock([]));

      const result = await MatchupScoreJobService.lockCompletedDays();

      expect(result.lockedCount).toBe(0);
      expect(result.error).toBeNull();
    });

    it('returns 0 when finalGames is null', async () => {
      mockFrom.mockImplementation(() => createChainMock(null));

      const result = await MatchupScoreJobService.lockCompletedDays();

      expect(result.lockedCount).toBe(0);
      expect(result.error).toBeNull();
    });

    it('returns error when games query fails', async () => {
      const dbError = { message: 'DB error', code: '42P01' };
      mockFrom.mockImplementation(() => createChainMock(null, dbError));

      const result = await MatchupScoreJobService.lockCompletedDays();

      expect(result.lockedCount).toBe(0);
      expect(result.error).toEqual(dbError);
      expect(logger.error).toHaveBeenCalled();
    });

    it('returns error when batch lock update fails', async () => {
      const updateError = { message: 'Update failed', code: '42501' };
      let callCount = 0;
      mockFrom.mockImplementation((table: string) => {
        callCount++;
        if (table === 'nhl_games') {
          return createChainMock([{ game_date: '2025-01-10' }]);
        }
        // fantasy_daily_rosters update fails
        return createChainMock(null, updateError);
      });

      const result = await MatchupScoreJobService.lockCompletedDays();

      expect(result.lockedCount).toBe(0);
      expect(result.error).toEqual(updateError);
    });

    it('handles exceptions gracefully', async () => {
      mockFrom.mockImplementation(() => {
        throw new Error('Connection lost');
      });

      const result = await MatchupScoreJobService.lockCompletedDays();

      expect(result.lockedCount).toBe(0);
      expect(result.error).toBeDefined();
    });

    it('deduplicates game dates', async () => {
      // Track what dates the 'in' filter receives
      let inFilterDates: string[] = [];
      mockFrom.mockImplementation((table: string) => {
        if (table === 'nhl_games') {
          return createChainMock([
            { game_date: '2025-01-10' },
            { game_date: '2025-01-10' },
            { game_date: '2025-01-10' },
            { game_date: '2025-01-11' },
          ]);
        }
        const chain = createChainMock([{ player_id: 1 }]);
        const origIn = chain.in;
        chain.in = vi.fn().mockImplementation((col: string, vals: string[]) => {
          if (col === 'roster_date') inFilterDates = vals;
          return chain;
        });
        return chain;
      });

      await MatchupScoreJobService.lockCompletedDays();

      // Should have 2 unique dates, not 4
      expect(inFilterDates).toHaveLength(2);
      expect(inFilterDates).toContain('2025-01-10');
      expect(inFilterDates).toContain('2025-01-11');
    });
  });

  // ---------------------------------------------------------------------------
  // calculateAndStoreScores
  // ---------------------------------------------------------------------------
  describe('calculateAndStoreScores', () => {
    it('calls MatchupService.updateMatchupScores and returns count', async () => {
      mockUpdateMatchupScores.mockResolvedValue({
        error: null,
        updatedCount: 10,
        results: [],
      });

      const result = await MatchupScoreJobService.calculateAndStoreScores('league-1');

      expect(mockUpdateMatchupScores).toHaveBeenCalledWith('league-1');
      expect(result.updatedCount).toBe(10);
      expect(result.error).toBeNull();
    });

    it('calls without leagueId when not provided', async () => {
      await MatchupScoreJobService.calculateAndStoreScores();

      expect(mockUpdateMatchupScores).toHaveBeenCalledWith(undefined);
    });

    it('returns error when MatchupService fails', async () => {
      const serviceError = { message: 'Score calculation failed', code: '42000' };
      mockUpdateMatchupScores.mockResolvedValue({
        error: serviceError,
        updatedCount: 0,
        results: [],
      });

      const result = await MatchupScoreJobService.calculateAndStoreScores('league-1');

      expect(result.updatedCount).toBe(0);
      expect(result.error).toEqual(serviceError);
      expect(logger.error).toHaveBeenCalled();
    });

    it('handles exceptions gracefully', async () => {
      mockUpdateMatchupScores.mockRejectedValue(new Error('Network error'));

      const result = await MatchupScoreJobService.calculateAndStoreScores();

      expect(result.updatedCount).toBe(0);
      expect(result.error).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // runJob
  // ---------------------------------------------------------------------------
  describe('runJob', () => {
    it('runs both steps: lock + calculate', async () => {
      // lockCompletedDays: no final games
      mockFrom.mockImplementation(() => createChainMock([]));
      mockUpdateMatchupScores.mockResolvedValue({
        error: null,
        updatedCount: 5,
        results: [],
      });

      const result = await MatchupScoreJobService.runJob('league-1');

      expect(result.lockedCount).toBe(0);
      expect(result.updatedCount).toBe(5);
      expect(result.errors).toHaveLength(0);
    });

    it('collects errors from both steps', async () => {
      const lockError = { message: 'Lock failed', code: '42000' };
      const scoreError = { message: 'Score failed', code: '42001' };

      mockFrom.mockImplementation(() => createChainMock(null, lockError));
      mockUpdateMatchupScores.mockResolvedValue({
        error: scoreError,
        updatedCount: 0,
        results: [],
      });

      const result = await MatchupScoreJobService.runJob();

      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].step).toBe('lockCompletedDays');
      expect(result.errors[1].step).toBe('calculateAndStoreScores');
    });

    it('continues to step 2 even if step 1 fails', async () => {
      mockFrom.mockImplementation(() => createChainMock(null, { message: 'Lock failed' }));
      mockUpdateMatchupScores.mockResolvedValue({
        error: null,
        updatedCount: 3,
        results: [],
      });

      const result = await MatchupScoreJobService.runJob();

      // Step 1 failed, step 2 succeeded
      expect(result.errors).toHaveLength(1);
      expect(result.updatedCount).toBe(3);
    });

    it('passes leagueId to calculateAndStoreScores', async () => {
      mockFrom.mockImplementation(() => createChainMock([]));

      await MatchupScoreJobService.runJob('league-xyz');

      expect(mockUpdateMatchupScores).toHaveBeenCalledWith('league-xyz');
    });
  });

  // ---------------------------------------------------------------------------
  // getJobStatus
  // ---------------------------------------------------------------------------
  describe('getJobStatus', () => {
    it('returns status with matchup count, locked days, and lastRun', async () => {
      let callCount = 0;
      mockFrom.mockImplementation((table: string) => {
        callCount++;
        if (table === 'matchups' && callCount <= 1) {
          // Count active matchups (select with count: 'exact', head: true)
          const chain = createChainMock(null);
          // Override to return count
          const origSelect = chain.select;
          chain.select = vi.fn().mockImplementation(() => {
            const inner = createChainMock(null);
            inner.then = (onFulfilled?: (val: any) => any) =>
              Promise.resolve({ count: 15, data: null, error: null }).then(onFulfilled);
            return inner;
          });
          return chain;
        }
        if (table === 'fantasy_daily_rosters') {
          const chain = createChainMock(null);
          chain.select = vi.fn().mockImplementation(() => {
            const inner = createChainMock(null);
            inner.then = (onFulfilled?: (val: any) => any) =>
              Promise.resolve({ count: 100, data: null, error: null }).then(onFulfilled);
            return inner;
          });
          return chain;
        }
        if (table === 'matchups') {
          // Get most recent matchup
          const chain = createChainMock(null);
          chain.single.mockResolvedValue({
            data: { updated_at: '2025-01-15T12:00:00Z' },
            error: null,
          });
          return chain;
        }
        return createChainMock();
      });

      const result = await MatchupScoreJobService.getJobStatus();

      expect(result).toHaveProperty('lastRun');
      expect(result).toHaveProperty('totalMatchups');
      expect(result).toHaveProperty('lockedDays');
    });

    it('returns defaults on error', async () => {
      mockFrom.mockImplementation(() => {
        throw new Error('DB down');
      });

      const result = await MatchupScoreJobService.getJobStatus();

      expect(result.lastRun).toBeNull();
      expect(result.totalMatchups).toBe(0);
      expect(result.lockedDays).toBe(0);
    });
  });
});

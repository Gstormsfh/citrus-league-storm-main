import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock API client layer (MatchupScoreJobService now uses matchupApi, not supabase)
// =============================================================================

const mockLockCompletedDays = vi.fn();
const mockUpdateScores = vi.fn();
const mockGetJobStatus = vi.fn();

vi.mock('@/api/matchups', () => ({
  matchupApi: {
    lockCompletedDays: (...args: unknown[]) => mockLockCompletedDays(...args),
    updateScores: (...args: unknown[]) => mockUpdateScores(...args),
    getJobStatus: (...args: unknown[]) => mockGetJobStatus(...args),
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
    mockLockCompletedDays.mockResolvedValue({ data: { lockedCount: 0 } });
    mockUpdateScores.mockResolvedValue({ data: [] });
    mockGetJobStatus.mockResolvedValue({ data: {} });
  });

  // ---------------------------------------------------------------------------
  // lockCompletedDays
  // ---------------------------------------------------------------------------
  describe('lockCompletedDays', () => {
    it('returns locked count from API response', async () => {
      mockLockCompletedDays.mockResolvedValue({ data: { lockedCount: 5 } });

      const result = await MatchupScoreJobService.lockCompletedDays();

      expect(result.lockedCount).toBe(5);
      expect(result.error).toBeNull();
    });

    it('returns 0 when API returns no lockedCount', async () => {
      mockLockCompletedDays.mockResolvedValue({ data: {} });

      const result = await MatchupScoreJobService.lockCompletedDays();

      expect(result.lockedCount).toBe(0);
      expect(result.error).toBeNull();
    });

    it('returns 0 when API returns null data', async () => {
      mockLockCompletedDays.mockResolvedValue({ data: null });

      const result = await MatchupScoreJobService.lockCompletedDays();

      expect(result.lockedCount).toBe(0);
      expect(result.error).toBeNull();
    });

    it('returns error when API call fails', async () => {
      const apiError = new Error('Lock endpoint failed');
      mockLockCompletedDays.mockRejectedValue(apiError);

      const result = await MatchupScoreJobService.lockCompletedDays();

      expect(result.lockedCount).toBe(0);
      expect(result.error).toBe(apiError);
      expect(logger.error).toHaveBeenCalled();
    });

    it('handles network exceptions gracefully', async () => {
      mockLockCompletedDays.mockRejectedValue(new Error('Network error'));

      const result = await MatchupScoreJobService.lockCompletedDays();

      expect(result.lockedCount).toBe(0);
      expect(result.error).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // calculateAndStoreScores
  // ---------------------------------------------------------------------------
  describe('calculateAndStoreScores', () => {
    it('calls matchupApi.updateScores with leagueId and returns updated count', async () => {
      mockUpdateScores.mockResolvedValue({
        data: [
          { matchup_id: 'm1', updated: true },
          { matchup_id: 'm2', updated: true },
          { matchup_id: 'm3', updated: false },
        ],
      });

      const result = await MatchupScoreJobService.calculateAndStoreScores('league-1');

      expect(mockUpdateScores).toHaveBeenCalledWith('league-1');
      expect(result.updatedCount).toBe(2);
      expect(result.error).toBeNull();
    });

    it('calls without leagueId when not provided', async () => {
      mockUpdateScores.mockResolvedValue({ data: [] });

      await MatchupScoreJobService.calculateAndStoreScores();

      expect(mockUpdateScores).toHaveBeenCalledWith(undefined);
    });

    it('returns 0 when API returns empty array', async () => {
      mockUpdateScores.mockResolvedValue({ data: [] });

      const result = await MatchupScoreJobService.calculateAndStoreScores();

      expect(result.updatedCount).toBe(0);
      expect(result.error).toBeNull();
    });

    it('returns 0 when API returns null data', async () => {
      mockUpdateScores.mockResolvedValue({ data: null });

      const result = await MatchupScoreJobService.calculateAndStoreScores();

      expect(result.updatedCount).toBe(0);
      expect(result.error).toBeNull();
    });

    it('returns error when API call fails', async () => {
      const apiError = new Error('Score calculation failed');
      mockUpdateScores.mockRejectedValue(apiError);

      const result = await MatchupScoreJobService.calculateAndStoreScores('league-1');

      expect(result.updatedCount).toBe(0);
      expect(result.error).toBe(apiError);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // runJob
  // ---------------------------------------------------------------------------
  describe('runJob', () => {
    it('runs both steps: lock + calculate', async () => {
      mockLockCompletedDays.mockResolvedValue({ data: { lockedCount: 3 } });
      mockUpdateScores.mockResolvedValue({
        data: [{ matchup_id: 'm1', updated: true }],
      });

      const result = await MatchupScoreJobService.runJob('league-1');

      expect(result.lockedCount).toBe(3);
      expect(result.updatedCount).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('collects errors from both steps', async () => {
      mockLockCompletedDays.mockRejectedValue(new Error('Lock failed'));
      mockUpdateScores.mockRejectedValue(new Error('Score failed'));

      const result = await MatchupScoreJobService.runJob();

      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].step).toBe('lockCompletedDays');
      expect(result.errors[1].step).toBe('calculateAndStoreScores');
    });

    it('continues to step 2 even if step 1 fails', async () => {
      mockLockCompletedDays.mockRejectedValue(new Error('Lock failed'));
      mockUpdateScores.mockResolvedValue({
        data: [
          { matchup_id: 'm1', updated: true },
          { matchup_id: 'm2', updated: true },
          { matchup_id: 'm3', updated: true },
        ],
      });

      const result = await MatchupScoreJobService.runJob();

      // Step 1 failed, step 2 succeeded
      expect(result.errors).toHaveLength(1);
      expect(result.updatedCount).toBe(3);
    });

    it('passes leagueId to calculateAndStoreScores', async () => {
      mockLockCompletedDays.mockResolvedValue({ data: { lockedCount: 0 } });
      mockUpdateScores.mockResolvedValue({ data: [] });

      await MatchupScoreJobService.runJob('league-xyz');

      expect(mockUpdateScores).toHaveBeenCalledWith('league-xyz');
    });
  });

  // ---------------------------------------------------------------------------
  // getJobStatus
  // ---------------------------------------------------------------------------
  describe('getJobStatus', () => {
    it('returns status from API response', async () => {
      mockGetJobStatus.mockResolvedValue({
        data: {
          lastRun: '2025-01-15T12:00:00Z',
          totalMatchups: 15,
          lockedDays: 100,
        },
      });

      const result = await MatchupScoreJobService.getJobStatus();

      expect(result.lastRun).toEqual(new Date('2025-01-15T12:00:00Z'));
      expect(result.totalMatchups).toBe(15);
      expect(result.lockedDays).toBe(100);
    });

    it('returns defaults when API returns empty data', async () => {
      mockGetJobStatus.mockResolvedValue({ data: {} });

      const result = await MatchupScoreJobService.getJobStatus();

      expect(result.lastRun).toBeNull();
      expect(result.totalMatchups).toBe(0);
      expect(result.lockedDays).toBe(0);
    });

    it('returns defaults on error', async () => {
      mockGetJobStatus.mockRejectedValue(new Error('API down'));

      const result = await MatchupScoreJobService.getJobStatus();

      expect(result.lastRun).toBeNull();
      expect(result.totalMatchups).toBe(0);
      expect(result.lockedDays).toBe(0);
    });
  });
});

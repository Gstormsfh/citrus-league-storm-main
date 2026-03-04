/**
 * MatchupScoreJobService
 *
 * Background job service for calculating and caching matchup scores.
 * Runs periodically to:
 * 1. Lock completed days in fantasy_daily_rosters (prevent retroactive changes)
 * 2. Calculate and store matchup scores in matchups table (performance optimization)
 *
 * All operations go through the API server (3-tier architecture).
 */

import { matchupApi } from '@/api/matchups';
import { logger } from '@/utils/logger';

export const MatchupScoreJobService = {
  /**
   * Lock all completed days (games finished) in fantasy_daily_rosters
   * This prevents users from retroactively changing their lineups after games complete
   */
  async lockCompletedDays(): Promise<{ lockedCount: number; error: Error | null }> {
    try {
      const response = await matchupApi.lockCompletedDays();
      return { lockedCount: response.data?.lockedCount || 0, error: null };
    } catch (error) {
      logger.error('[MatchupScoreJobService] Exception in lockCompletedDays:', error);
      return { lockedCount: 0, error: error as Error };
    }
  },

  /**
   * Calculate and store matchup scores for all active matchups
   * Uses the existing update_all_matchup_scores RPC via API
   */
  async calculateAndStoreScores(leagueId?: string): Promise<{ updatedCount: number; error: Error | null }> {
    try {
      const response = await matchupApi.updateScores(leagueId);
      const results = response.data || [];
      const updatedCount = Array.isArray(results)
        ? results.filter((r: any) => r.updated === true).length
        : 0;
      return { updatedCount, error: null };
    } catch (error) {
      logger.error('[MatchupScoreJobService] Exception in calculateAndStoreScores:', error);
      return { updatedCount: 0, error: error as Error };
    }
  },

  /**
   * Run the full job: lock completed days + calculate and store scores
   */
  async runJob(leagueId?: string): Promise<{
    lockedCount: number;
    updatedCount: number;
    errors: Array<{ step: string; error: Error | null }>
  }> {
    const errors: Array<{ step: string; error: Error | null }> = [];

    const { lockedCount, error: lockError } = await this.lockCompletedDays();
    if (lockError) {
      errors.push({ step: 'lockCompletedDays', error: lockError });
    }

    const { updatedCount, error: scoresError } = await this.calculateAndStoreScores(leagueId);
    if (scoresError) {
      errors.push({ step: 'calculateAndStoreScores', error: scoresError });
    }

    if (errors.length > 0) {
      logger.error('[MatchupScoreJobService] Errors:', errors);
    }

    return { lockedCount, updatedCount, errors };
  },

  /**
   * Get job status and last run time
   */
  async getJobStatus(): Promise<{
    lastRun: Date | null;
    totalMatchups: number;
    lockedDays: number;
  }> {
    try {
      const response = await matchupApi.getJobStatus();
      const data = response.data || {};
      return {
        lastRun: data.lastRun ? new Date(data.lastRun) : null,
        totalMatchups: data.totalMatchups || 0,
        lockedDays: data.lockedDays || 0
      };
    } catch (error) {
      logger.error('[MatchupScoreJobService] Error getting job status:', error);
      return { lastRun: null, totalMatchups: 0, lockedDays: 0 };
    }
  }
};

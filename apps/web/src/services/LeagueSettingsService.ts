/**
 * LeagueSettingsService — API client wrapper for league settings updates.
 *
 * All mutations go through the API server via leagueApi.
 * No direct Supabase calls from the frontend.
 */

import { leagueApi } from '@/api/leagues';
import { logger } from '@/utils/logger';

/** One row of the scoring catalog, with the multiplier in force for a league. */
export interface ScoringCatalogEntry {
  stat_key: string;
  display_name: string;
  applies_to: 'skater' | 'goalie';
  default_multiplier: number;
  is_core: boolean;
  sort_order: number;
  multiplier: number;
}

export const LeagueSettingsService = {
  /**
   * Update waiver/trade settings for a league (commissioner only)
   */
  async updateWaiverSettings(
    leagueId: string,
    _userId: string,
    settings: {
      waiver_process_time?: string;
      waiver_period_hours?: number;
      waiver_game_lock?: boolean;
      waiver_type?: 'rolling' | 'reverse_draft_order' | 'faab' | 'reverse_standings';
      allow_trades_during_games?: boolean;
    }
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      await leagueApi.updateWaiverSettings(leagueId, settings);
      return { success: true, error: null };
    } catch (error) {
      logger.error('Error updating waiver settings:', error);
      return { success: false, error };
    }
  },

  /**
   * Update scoring settings for a league (commissioner only)
   */
  async updateScoringSettings(
    leagueId: string,
    _userId: string,
    scoringSettings: {
      skater?: Record<string, number>;
      goalie?: Record<string, number>;
    }
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      await leagueApi.updateScoringSettings(leagueId, scoringSettings);
      return { success: true, error: null };
    } catch (error) {
      logger.error('Error updating scoring settings:', error);
      return { success: false, error };
    }
  },

  /**
   * Read the scoring catalog plus this league's effective multipliers.
   *
   * 35 stats, of which 23 became scoreable on 2026-08-11 and sit at 0 until a
   * commissioner turns them on: plus/minus, PP and SH goals/assists split out,
   * game winners, overtime goals, faceoffs, takeaways, giveaways, time on ice,
   * goalie OT losses and saves by strength.
   */
  async getScoringRules(
    leagueId: string,
  ): Promise<{ stats: ScoringCatalogEntry[]; error: unknown }> {
    try {
      // ENVELOPE FIX (2026-08-24 click-sweep): apiClient wraps payloads as
      // { data: T } — reading `.stats` off the ENVELOPE always came back
      // undefined, so the commissioner Scoring tab rendered "No scoring
      // catalog found" for every league while the API was returning all
      // 35 stats with a 200. Unwrap the envelope (and tolerate a bare
      // payload if the wire shape ever flattens).
      const resp = (await leagueApi.getScoringRules(leagueId)) as {
        data?: { stats?: ScoringCatalogEntry[] };
        stats?: ScoringCatalogEntry[];
      };
      return { stats: resp?.data?.stats ?? resp?.stats ?? [], error: null };
    } catch (error) {
      logger.error('Error fetching scoring rules:', error);
      return { stats: [], error };
    }
  },

  /**
   * Set scoring weights for a league (commissioner only).
   *
   * Send only the rules that changed. Unknown stat keys are rejected by the
   * server rather than stored as a rule that could never score anything.
   */
  async updateScoringRules(
    leagueId: string,
    rules: Array<{ stat_key: string; multiplier: number }>,
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      await leagueApi.updateScoringRules(leagueId, rules);
      return { success: true, error: null };
    } catch (error) {
      logger.error('Error updating scoring rules:', error);
      return { success: false, error };
    }
  },

  /**
   * Update draft settings for a league (commissioner only)
   */
  async updateDraftSettings(
    leagueId: string,
    _userId: string,
    draftSettings: {
      draft_rounds?: number;
      pickTimeLimit?: number;
    }
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      await leagueApi.updateDraftSettings(leagueId, draftSettings);
      return { success: true, error: null };
    } catch (error) {
      logger.error('Error updating draft settings:', error);
      return { success: false, error };
    }
  },

  /**
   * Update keeper/dynasty settings for a league (commissioner only)
   */
  async updateKeeperSettings(
    leagueId: string,
    _userId: string,
    keeperSettings: {
      keeperEnabled: boolean;
      keeperCount: number;
      keeperPenalty: 'none' | 'round-cost' | 'round-escalation';
      dynastyMode: boolean;
    }
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      await leagueApi.updateKeeperSettings(leagueId, keeperSettings);
      return { success: true, error: null };
    } catch (error) {
      logger.error('Error updating keeper settings:', error);
      return { success: false, error };
    }
  },

  /**
   * Update category settings for a league (commissioner only)
   */
  async updateCategorySettings(
    leagueId: string,
    _userId: string,
    categories: string[]
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      await leagueApi.updateCategorySettings(leagueId, categories);
      return { success: true, error: null };
    } catch (error) {
      logger.error('Error updating category settings:', error);
      return { success: false, error };
    }
  },

  /**
   * Update roster slot configuration for a league (commissioner only)
   */
  async updateRosterSlotSettings(
    leagueId: string,
    _userId: string,
    rosterSlots: Record<string, number>
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      await leagueApi.updateRosterSlots(leagueId, rosterSlots);
      return { success: true, error: null };
    } catch (error) {
      logger.error('Error updating roster slot settings:', error);
      return { success: false, error };
    }
  },
};

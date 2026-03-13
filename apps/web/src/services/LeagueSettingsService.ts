/**
 * LeagueSettingsService — API client wrapper for league settings updates.
 *
 * All mutations go through the API server via leagueApi.
 * No direct Supabase calls from the frontend.
 */

import { leagueApi } from '@/api/leagues';
import { logger } from '@/utils/logger';

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
      waiver_type?: 'rolling' | 'faab' | 'reverse_standings';
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

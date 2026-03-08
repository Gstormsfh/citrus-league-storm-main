/**
 * LeagueSettingsService — Extracted from LeagueService.ts
 *
 * Contains all league settings update methods:
 * - updateWaiverSettings()
 * - updateScoringSettings()
 * - updateDraftSettings()
 * - updateKeeperSettings()
 * - updateCategorySettings()
 * - updateRosterSlotSettings()
 *
 * These methods require commissioner access and use `notifyLeagueMembers`
 * from the parent LeagueService for notifications.
 */

import { supabase } from "@/integrations/supabase/client";
import { LeagueMembershipService } from "./LeagueMembershipService";
import { logger } from "@/utils/logger";
import type { LeagueSettings } from "@/types/leagueTypes";

/**
 * Internal helper: notify league members about settings changes.
 * Uses the notification API to send league-wide notifications.
 */
async function notifyLeagueMembers(leagueId: string, message: string, title?: string): Promise<void> {
  try {
    const { notificationApi } = await import('@/api/notifications');
    await notificationApi.sendChatMessage(leagueId, message, title || 'League Settings Changed');
  } catch (error) {
    logger.error('Error creating notifications:', error);
    // Don't throw - notification failure shouldn't block settings update
  }
}

export const LeagueSettingsService = {
  /**
   * Update waiver/trade settings for a league (commissioner only)
   */
  async updateWaiverSettings(
    leagueId: string,
    userId: string,
    settings: {
      waiver_process_time?: string;
      waiver_period_hours?: number;
      waiver_game_lock?: boolean;
      waiver_type?: 'rolling' | 'faab' | 'reverse_standings';
      allow_trades_during_games?: boolean;
    }
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      // CRITICAL: Verify user is commissioner (application-level security)
      await LeagueMembershipService.requireCommissioner(leagueId, userId);

      // Update the settings
      const { error } = await supabase
        .from('leagues')
        .update(settings)
        .eq('id', leagueId);

      if (error) throw error;

      // Create notification for all league members
      await notifyLeagueMembers(leagueId, 'Commissioner changed waiver settings', 'Waiver Settings Updated');

      return { success: true, error: null };
    } catch (error) {
      logger.error('Error updating waiver settings:', error);
      return { success: false, error };
    }
  },

  /**
   * Update scoring settings for a league (commissioner only)
   * LOCKED after games have started (matchups exist for completed draft).
   */
  async updateScoringSettings(
    leagueId: string,
    userId: string,
    scoringSettings: {
      skater?: Record<string, number>;
      goalie?: Record<string, number>;
    }
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      // CRITICAL: Verify user is commissioner (application-level security)
      await LeagueMembershipService.requireCommissioner(leagueId, userId);

      // Server-side lock: block scoring changes after games have started
      const { data: league } = await supabase
        .from('leagues')
        .select('draft_status')
        .eq('id', leagueId)
        .single();

      if (league?.draft_status === 'completed') {
        // Check if any matchups have been scored (games have started)
        const { count } = await supabase
          .from('fantasy_daily_rosters')
          .select('*', { count: 'exact', head: true })
          .eq('league_id', leagueId);

        if (count && count > 0) {
          return {
            success: false,
            error: new Error('Scoring settings cannot be changed after games have started. This protects the integrity of existing scores.'),
          };
        }
      }

      // Update the scoring settings
      const { error } = await supabase
        .from('leagues')
        .update({ scoring_settings: scoringSettings })
        .eq('id', leagueId);

      if (error) throw error;

      // Create notification for all league members
      await notifyLeagueMembers(leagueId, 'Commissioner changed scoring settings', 'Scoring Settings Updated');

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
    userId: string,
    draftSettings: {
      draft_rounds?: number;
      pickTimeLimit?: number;
    }
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      // CRITICAL: Verify user is commissioner (application-level security)
      await LeagueMembershipService.requireCommissioner(leagueId, userId);

      // Get current settings to merge pickTimeLimit
      const { data: currentLeague } = await supabase
        .from('leagues')
        .select('settings, draft_rounds')
        .eq('id', leagueId)
        .single();

      const currentSettings = (currentLeague?.settings as LeagueSettings) || {};

      // Update the draft settings
      const updateData: { draft_rounds?: number; settings?: LeagueSettings } = {};
      if (draftSettings.draft_rounds !== undefined) {
        updateData.draft_rounds = draftSettings.draft_rounds;
      }
      if (draftSettings.pickTimeLimit !== undefined) {
        updateData.settings = {
          ...currentSettings,
          pickTimeLimit: draftSettings.pickTimeLimit,
        };
      }

      const { error } = await supabase
        .from('leagues')
        .update(updateData)
        .eq('id', leagueId);

      if (error) throw error;

      // Create notification for all league members
      await notifyLeagueMembers(leagueId, 'Commissioner changed draft settings', 'Draft Settings Updated');

      return { success: true, error: null };
    } catch (error) {
      logger.error('Error updating draft settings:', error);
      return { success: false, error };
    }
  },

  /**
   * Update keeper/dynasty settings for a league (commissioner only)
   * Locked after draft has completed.
   */
  async updateKeeperSettings(
    leagueId: string,
    userId: string,
    keeperSettings: {
      keeperEnabled: boolean;
      keeperCount: number;
      keeperPenalty: 'none' | 'round-cost' | 'round-escalation';
      dynastyMode: boolean;
    }
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      await LeagueMembershipService.requireCommissioner(leagueId, userId);

      // Block changes after draft is completed
      const { data: currentLeague } = await supabase
        .from('leagues')
        .select('settings, draft_status')
        .eq('id', leagueId)
        .single();

      if (currentLeague?.draft_status === 'completed') {
        return { success: false, error: new Error('Keeper settings cannot be changed after the draft is completed') };
      }

      const currentSettings = (currentLeague?.settings as LeagueSettings) || {};

      const { error } = await supabase
        .from('leagues')
        .update({
          settings: {
            ...currentSettings,
            keeperEnabled: keeperSettings.keeperEnabled,
            keeperCount: keeperSettings.keeperCount,
            keeperPenalty: keeperSettings.keeperPenalty,
            dynastyMode: keeperSettings.dynastyMode,
          },
        })
        .eq('id', leagueId);

      if (error) throw error;

      await notifyLeagueMembers(leagueId, 'Commissioner updated keeper/dynasty settings', 'Keeper Settings Updated');
      return { success: true, error: null };
    } catch (error) {
      logger.error('Error updating keeper settings:', error);
      return { success: false, error };
    }
  },

  /**
   * Update category settings for a league (commissioner only)
   * For H2H-Categories and Roto leagues.
   * Locked after draft is completed.
   */
  async updateCategorySettings(
    leagueId: string,
    userId: string,
    categories: string[]
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      await LeagueMembershipService.requireCommissioner(leagueId, userId);

      const { data: currentLeague } = await supabase
        .from('leagues')
        .select('settings, draft_status')
        .eq('id', leagueId)
        .single();

      if (currentLeague?.draft_status === 'completed') {
        return { success: false, error: new Error('Category settings cannot be changed after the draft is completed') };
      }

      if (!categories || categories.length < 2) {
        return { success: false, error: new Error('At least 2 categories are required') };
      }

      const currentSettings = (currentLeague?.settings as LeagueSettings) || {};

      const { error } = await supabase
        .from('leagues')
        .update({
          settings: {
            ...currentSettings,
            categories,
          },
        })
        .eq('id', leagueId);

      if (error) throw error;

      await notifyLeagueMembers(leagueId, `Commissioner updated stat categories (${categories.length} categories)`, 'Category Settings Updated');
      return { success: true, error: null };
    } catch (error) {
      logger.error('Error updating category settings:', error);
      return { success: false, error };
    }
  },

  /**
   * Update roster slot configuration for a league (commissioner only)
   * Locked after draft is completed.
   */
  async updateRosterSlotSettings(
    leagueId: string,
    userId: string,
    rosterSlots: Record<string, number>
  ): Promise<{ success: boolean; error: unknown }> {
    try {
      await LeagueMembershipService.requireCommissioner(leagueId, userId);

      const { data: currentLeague } = await supabase
        .from('leagues')
        .select('settings, draft_status')
        .eq('id', leagueId)
        .single();

      if (currentLeague?.draft_status === 'completed') {
        return { success: false, error: new Error('Roster slots cannot be changed after the draft is completed') };
      }

      const currentSettings = (currentLeague?.settings as LeagueSettings) || {};

      // Calculate new roster size from slots
      const totalSlots = Object.values(rosterSlots).reduce((sum, count) => sum + count, 0);

      const { error } = await supabase
        .from('leagues')
        .update({
          roster_size: totalSlots,
          settings: {
            ...currentSettings,
            rosterSlots,
          },
        })
        .eq('id', leagueId);

      if (error) throw error;

      await notifyLeagueMembers(leagueId, `Commissioner updated roster slot configuration (${totalSlots} total slots)`, 'Roster Slots Updated');
      return { success: true, error: null };
    } catch (error) {
      logger.error('Error updating roster slot settings:', error);
      return { success: false, error };
    }
  },
};

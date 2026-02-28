/**
 * KeeperService — Manages keeper and dynasty league features.
 *
 * All keeper/dynasty settings are commissioner-configurable:
 *   - keeperEnabled: Toggle keeper mode on/off
 *   - keeperCount: Max keepers per team (1-10, or unlimited for dynasty)
 *   - keeperPenalty: 'none' | 'round-cost' | 'round-escalation'
 *   - dynastyMode: Keep entire roster (unlimited keepers)
 *
 * These settings are stored in leagues.settings JSONB and read dynamically
 * by all RPC functions. Commissioners can change them at any time before
 * keeper locks are finalized.
 *
 * When settings change mid-season (after the league has started), a
 * notification is sent to all league members via notify_league_members RPC.
 */

import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';

export interface KeeperDesignation {
  id: string;
  league_id: string;
  team_id: string;
  player_id: string;
  season_year: number;
  keeper_round: number | null;
  keeper_penalty_type: string;
  original_draft_round: number | null;
  years_kept: number;
  designated_at: string;
  approved_by: string | null;
  status: 'designated' | 'approved' | 'released' | 'locked';
}

export interface KeeperDraftCost {
  player_id: string;
  keeper_round: number | null;
  penalty_type: string;
  original_draft_round: number | null;
  years_kept: number;
  effective_round: number | null;
}

export interface KeeperValidation {
  is_valid: boolean;
  error_message: string | null;
  keepers_count: number;
  max_keepers: number;
}

export class KeeperService {
  /**
   * Designate a player as a keeper for the upcoming season.
   * Validates against league settings (commissioner-configured keeper count, etc.).
   */
  static async designateKeeper(
    leagueId: string,
    teamId: string,
    playerId: string,
    seasonYear: number,
    originalDraftRound?: number
  ): Promise<{ success: boolean; designation?: KeeperDesignation; error?: string }> {
    try {
      // Validate before designating
      const validation = await this.validateKeepers(leagueId, teamId, seasonYear);
      if (validation.error) {
        return { success: false, error: validation.error };
      }

      const { data, error } = await supabase
        .from('keeper_designations')
        .insert({
          league_id: leagueId,
          team_id: teamId,
          player_id: playerId,
          season_year: seasonYear,
          original_draft_round: originalDraftRound || null,
          status: 'designated',
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          return { success: false, error: 'Player is already designated as a keeper' };
        }
        throw error;
      }

      return { success: true, designation: data as KeeperDesignation };
    } catch (error: unknown) {
      logger.error('Error designating keeper:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Release a keeper designation (un-keep a player).
   */
  static async releaseKeeper(
    keeperDesignationId: string,
    teamId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('keeper_designations')
        .update({ status: 'released' })
        .eq('id', keeperDesignationId)
        .eq('team_id', teamId)
        .in('status', ['designated', 'approved']);

      if (error) throw error;
      return { success: true };
    } catch (error: unknown) {
      logger.error('Error releasing keeper:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Get keeper designations for a team.
   */
  static async getTeamKeepers(
    leagueId: string,
    teamId: string,
    seasonYear: number
  ): Promise<{ keepers: KeeperDesignation[]; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('keeper_designations')
        .select('*')
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .eq('season_year', seasonYear)
        .in('status', ['designated', 'approved', 'locked'])
        .order('designated_at', { ascending: true });

      if (error) throw error;
      return { keepers: (data || []) as KeeperDesignation[] };
    } catch (error: unknown) {
      logger.error('Error fetching team keepers:', error);
      return { keepers: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Get all keeper designations for a league (all teams).
   */
  static async getLeagueKeepers(
    leagueId: string,
    seasonYear: number
  ): Promise<{ keepers: KeeperDesignation[]; error?: string }> {
    try {
      const { data, error } = await supabase
        .from('keeper_designations')
        .select('*')
        .eq('league_id', leagueId)
        .eq('season_year', seasonYear)
        .in('status', ['designated', 'approved', 'locked'])
        .order('team_id', { ascending: true });

      if (error) throw error;
      return { keepers: (data || []) as KeeperDesignation[] };
    } catch (error: unknown) {
      logger.error('Error fetching league keepers:', error);
      return { keepers: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Validate keeper selections for a team using the RPC.
   * Reads league settings dynamically (keeperEnabled, keeperCount, dynastyMode).
   */
  static async validateKeepers(
    leagueId: string,
    teamId: string,
    seasonYear: number
  ): Promise<KeeperValidation & { error?: string }> {
    try {
      const { data, error } = await supabase.rpc('validate_keeper_selections', {
        p_league_id: leagueId,
        p_team_id: teamId,
        p_season_year: seasonYear,
      });

      if (error) throw error;

      const result = data?.[0] || data;
      return {
        is_valid: result?.is_valid ?? false,
        error_message: result?.error_message ?? null,
        keepers_count: result?.keepers_count ?? 0,
        max_keepers: result?.max_keepers ?? 0,
      };
    } catch (error: unknown) {
      logger.error('Error validating keepers:', error);
      return {
        is_valid: false,
        error_message: 'Validation failed',
        keepers_count: 0,
        max_keepers: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get keeper draft costs for a team.
   * Penalty type is read dynamically from league settings (commissioner-configured).
   */
  static async getKeeperDraftCosts(
    leagueId: string,
    teamId: string,
    seasonYear: number
  ): Promise<{ costs: KeeperDraftCost[]; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('get_keeper_draft_costs', {
        p_league_id: leagueId,
        p_team_id: teamId,
        p_season_year: seasonYear,
      });

      if (error) throw error;
      return { costs: (data || []) as KeeperDraftCost[] };
    } catch (error: unknown) {
      logger.error('Error fetching keeper draft costs:', error);
      return { costs: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Commissioner: Lock in all keeper designations for the season.
   * This finalizes keepers and makes them unavailable in the draft.
   * Sends notification to all league members.
   */
  static async lockKeepersForSeason(
    leagueId: string,
    seasonYear: number
  ): Promise<{
    results: Array<{ teamId: string; keepersLocked: number; roundsConsumed: number[] }>;
    error?: string;
  }> {
    try {
      const { data, error } = await supabase.rpc('lock_keepers_for_season', {
        p_league_id: leagueId,
        p_season_year: seasonYear,
      });

      if (error) throw error;

      const results = (data || []).map((row: any) => ({
        teamId: row.team_id,
        keepersLocked: row.keepers_locked,
        roundsConsumed: row.rounds_consumed || [],
      }));

      // Notify league members
      const totalKeepers = results.reduce((sum: number, r: any) => sum + r.keepersLocked, 0);
      try {
        await supabase.rpc('notify_league_members', {
          p_league_id: leagueId,
          p_title: 'Keepers Locked',
          p_message: `${totalKeepers} keeper(s) across all teams have been locked for the ${seasonYear}-${seasonYear + 1} season. The draft will exclude kept players.`,
          p_notification_type: 'SYSTEM',
        });
      } catch {
        // Non-critical
      }

      return { results };
    } catch (error: unknown) {
      logger.error('Error locking keepers:', error);
      return { results: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Commissioner: Update keeper/dynasty settings for the league.
   * All settings are dynamic and can be changed before keeper lock.
   * Sends notification to league members about the change.
   */
  static async updateKeeperSettings(
    leagueId: string,
    commissionerId: string,
    settings: {
      keeperEnabled: boolean;
      keeperCount: number;
      keeperPenalty: 'none' | 'round-cost' | 'round-escalation';
      dynastyMode: boolean;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Verify commissioner
      const { data: league } = await supabase
        .from('leagues')
        .select('commissioner_id, settings')
        .eq('id', leagueId)
        .single();

      if (!league || league.commissioner_id !== commissionerId) {
        return { success: false, error: 'Only the commissioner can update keeper settings' };
      }

      // Merge into existing settings
      const existingSettings = (league.settings || {}) as Record<string, unknown>;
      const updatedSettings = {
        ...existingSettings,
        keeperEnabled: settings.keeperEnabled,
        keeperCount: settings.dynastyMode ? 999 : settings.keeperCount,
        keeperPenalty: settings.keeperPenalty,
        dynastyMode: settings.dynastyMode,
      };

      const { error } = await supabase
        .from('leagues')
        .update({ settings: updatedSettings })
        .eq('id', leagueId);

      if (error) throw error;

      // Notify league
      const mode = settings.dynastyMode
        ? 'Dynasty (unlimited keepers)'
        : settings.keeperEnabled
          ? `Keeper (${settings.keeperCount} per team, ${settings.keeperPenalty} penalty)`
          : 'Standard (no keepers)';

      try {
        await supabase.rpc('notify_league_members', {
          p_league_id: leagueId,
          p_title: 'Keeper Settings Updated',
          p_message: `League format changed to: ${mode}`,
          p_notification_type: 'SYSTEM',
        });
      } catch {
        // Non-critical
      }

      return { success: true };
    } catch (error: unknown) {
      logger.error('Error updating keeper settings:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export default KeeperService;

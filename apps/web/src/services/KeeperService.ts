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
 * notification is sent to all league members via the API server.
 */

import { keeperApi } from '@/api/keepers';
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

      const response = await keeperApi.designateKeeper(leagueId, {
        teamId,
        playerId,
        seasonYear,
        originalDraftRound,
      });

      if (response.error) {
        return { success: false, error: response.error };
      }

      return { success: true, designation: response.data as KeeperDesignation };
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
      const response = await keeperApi.releaseKeeper(keeperDesignationId, { teamId });

      if (response.error) {
        return { success: false, error: response.error };
      }

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
      const response = await keeperApi.getTeamKeepers(leagueId, teamId, seasonYear);

      if (response.error) {
        return { keepers: [], error: response.error };
      }

      return { keepers: (response.data || []) as KeeperDesignation[] };
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
      const response = await keeperApi.getLeagueKeepers(leagueId, seasonYear);

      if (response.error) {
        return { keepers: [], error: response.error };
      }

      return { keepers: (response.data || []) as KeeperDesignation[] };
    } catch (error: unknown) {
      logger.error('Error fetching league keepers:', error);
      return { keepers: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Validate keeper selections for a team.
   * Reads league settings dynamically (keeperEnabled, keeperCount, dynastyMode).
   */
  static async validateKeepers(
    leagueId: string,
    teamId: string,
    seasonYear: number
  ): Promise<KeeperValidation & { error?: string }> {
    try {
      const response = await keeperApi.validateKeepers(leagueId, { teamId, seasonYear });

      if (response.error) {
        return {
          is_valid: false,
          error_message: response.error,
          keepers_count: 0,
          max_keepers: 0,
          error: response.error,
        };
      }

      const result = response.data as Partial<{
        is_valid: boolean;
        error_message: string | null;
        keepers_count: number;
        max_keepers: number;
      }> | undefined;
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
      const response = await keeperApi.getKeeperDraftCosts(leagueId, teamId, seasonYear);

      if (response.error) {
        return { costs: [], error: response.error };
      }

      return { costs: (response.data || []) as KeeperDraftCost[] };
    } catch (error: unknown) {
      logger.error('Error fetching keeper draft costs:', error);
      return { costs: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Commissioner: Lock in all keeper designations for the season.
   * This finalizes keepers and makes them unavailable in the draft.
   * Notification is handled server-side.
   */
  static async lockKeepersForSeason(
    leagueId: string,
    seasonYear: number
  ): Promise<{
    results: Array<{ teamId: string; keepersLocked: number; roundsConsumed: number[] }>;
    error?: string;
  }> {
    try {
      const response = await keeperApi.lockKeepers(leagueId, { seasonYear });

      if (response.error) {
        return { results: [], error: response.error };
      }

      const results = ((response.data || []) as Array<Record<string, any>>).map((row: any) => ({
        teamId: row.team_id || row.teamId,
        keepersLocked: row.keepers_locked || row.keepersLocked || 0,
        roundsConsumed: row.rounds_consumed || row.roundsConsumed || [],
      }));

      return { results };
    } catch (error: unknown) {
      logger.error('Error locking keepers:', error);
      return { results: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Commissioner: Update keeper/dynasty settings for the league.
   * All settings are dynamic and can be changed before keeper lock.
   * Commissioner check and notification are handled server-side.
   */
  static async updateKeeperSettings(
    leagueId: string,
    _commissionerId: string,
    settings: {
      keeperEnabled: boolean;
      keeperCount: number;
      keeperPenalty: 'none' | 'round-cost' | 'round-escalation';
      dynastyMode: boolean;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await keeperApi.updateKeeperSettings(leagueId, settings);

      if (response.error) {
        return { success: false, error: response.error };
      }

      return { success: true };
    } catch (error: unknown) {
      logger.error('Error updating keeper settings:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export default KeeperService;

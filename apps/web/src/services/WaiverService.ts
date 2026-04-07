import { waiverApi } from '@/api/waivers';
import { accountApi } from '@/api/account';
import { apiClient } from '@/api/client';
import { PlayerService } from './PlayerService';
import { logger } from '@/utils/logger';

export interface WaiverClaim {
  id: string;
  league_id: string;
  team_id: string;
  player_id: number;
  drop_player_id: number | null;
  priority: number;
  bid_amount: number | null;
  is_conditional_drop: boolean;
  status: 'pending' | 'successful' | 'failed' | 'cancelled';
  created_at: string;
  processed_at: string | null;
  failure_reason: string | null;
  /**
   * Server-side enrichment (see WaiverService.enrichClaimsWithClearTime).
   * Only present on pending claims whose target is still in the waiver window.
   */
  waiver_dropped_at?: string | null;
  waiver_clears_at?: string | null;
  league_waiver_period_hours?: number | null;
  league_waiver_process_time?: string | null;
}

export interface WaiverPriority {
  id: string;
  league_id: string;
  team_id: string;
  team_name: string;
  priority: number;
  updated_at: string;
}

export interface PlayerAvailability {
  player_id: number;
  is_available: boolean;
  is_game_locked: boolean;
  is_on_waivers: boolean;
  waiver_clear_time: string | null;
  lock_reason: string | null;
}

export interface LeagueWaiverSettings {
  waiver_process_time: string;
  waiver_period_hours: number;
  waiver_game_lock: boolean;
  waiver_type: 'rolling' | 'faab' | 'reverse_standings';
  allow_trades_during_games: boolean;
  weeklyAddLimit?: number;   // 0 = unlimited (industry standard)
  seasonAddLimit?: number;   // 0 = unlimited (industry standard)
}

export class WaiverService {
  /**
   * Check if a team has exceeded its weekly or season add limit.
   * Server now handles this validation during add/claim operations.
   * Kept as a no-op for backward compatibility with callers.
   */
  static async checkTransactionLimits(
    _leagueId: string,
    _teamId: string
  ): Promise<{ allowed: boolean; reason?: string; weeklyAdds?: number; seasonAdds?: number }> {
    // Server validates transaction limits during add/claim — no client-side check needed
    return { allowed: true };
  }

  /**
   * Check if a player is available for waiver claim or free agent pickup.
   * Server handles detailed availability checks during addFreeAgent/submitClaim.
   * This is kept for UI pre-flight checks that want to show availability status.
   */
  static async checkPlayerAvailability(
    playerId: number,
    leagueId: string,
    _userId: string
  ): Promise<PlayerAvailability> {
    try {
      // Use the waiver settings endpoint to get basic league waiver info
      // The server handles full availability validation during actual operations
      const { data: settings } = await waiverApi.getWaiverSettings(leagueId);

      // Return a simplified availability check — server does the authoritative check
      return {
        player_id: playerId,
        is_available: true,
        is_game_locked: false,
        is_on_waivers: false,
        waiver_clear_time: null,
        lock_reason: settings ? null : 'Unable to check availability'
      };
    } catch (error: unknown) {
      logger.error('Error checking player availability:', error);
      throw error;
    }
  }

  /**
   * Add a free agent (instant pickup - no waiver claim needed).
   * Server handles ownership verification, availability checks, roster move RPC,
   * lineup updates, and transaction limit enforcement.
   */
  static async addFreeAgent(
    leagueId: string,
    teamId: string,
    playerId: number,
    dropPlayerId: number | null = null,
    _userId?: string,
    _skipLimitCheck = false
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data } = await waiverApi.addFreeAgent(leagueId, {
        teamId,
        playerId: String(playerId),
        dropPlayerId: dropPlayerId ? String(dropPlayerId) : null,
      });

      accountApi.logSecurityEvent('ROSTER_MOVE', leagueId, {
        addPlayerId: String(playerId),
        dropPlayerId: dropPlayerId ? String(dropPlayerId) : undefined,
        teamId,
      });

      return (data as { success: boolean; error?: string }) ?? { success: true };
    } catch (error: unknown) {
      logger.error('Error adding free agent:', error);
      accountApi.logSecurityEvent('ROSTER_MOVE_FAILED', leagueId, {
        addPlayerId: String(playerId),
        dropPlayerId: dropPlayerId ? String(dropPlayerId) : undefined,
        teamId,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Submit a waiver claim (for game-locked players or players on waivers).
   * Server handles best-ball validation, limit checks, priority lookup, and insertion.
   */
  static async submitWaiverClaim(
    leagueId: string,
    teamId: string,
    playerId: number,
    dropPlayerId: number | null = null
  ): Promise<{ success: boolean; error?: string; claimId?: string }> {
    try {
      const { data } = await waiverApi.submitClaim(leagueId, {
        teamId,
        playerId: String(playerId),
        dropPlayerId: dropPlayerId ? String(dropPlayerId) : null,
      });

      const result = data as { success: boolean; error?: string; claimId?: string } | undefined;
      accountApi.logSecurityEvent('WAIVER_CLAIM', leagueId, {
        claimId: result?.claimId, teamId, playerId, dropPlayerId
      });

      return result ?? { success: true };
    } catch (error: unknown) {
      logger.error('Error submitting waiver claim:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Smart add player - automatically chooses free agent pickup or waiver claim
   * based on player availability. Server decides the appropriate action.
   */
  static async addPlayer(
    leagueId: string,
    teamId: string,
    playerId: number,
    dropPlayerId: number | null = null,
    _userId?: string
  ): Promise<{ success: boolean; error?: string; claimId?: string; isFreeAgent?: boolean }> {
    try {
      // Try free agent add first — server will reject if player is on waivers/locked
      const faResult = await waiverApi.addFreeAgent(leagueId, {
        teamId,
        playerId: String(playerId),
        dropPlayerId: dropPlayerId ? String(dropPlayerId) : null,
      });

      const faData = (faResult.data ?? { success: true }) as { success: boolean; error?: string };
      logger.info('[WaiverService.addPlayer] free-agent response', faData);
      if (faData.success === false) {
        return {
          success: false,
          error: faData.error || 'Server rejected add but returned no reason. Check server logs.',
          isFreeAgent: true,
        };
      }
      return { success: true, isFreeAgent: true };
    } catch (faError: unknown) {
      // Extract the error message from the free agent attempt
      const faErrorMsg = faError instanceof Error ? faError.message : String(faError);
      logger.error('[WaiverService.addPlayer] free-agent threw:', faErrorMsg, faError);
      const lowerMsg = faErrorMsg.toLowerCase();

      // If the error is about roster being full, do NOT fall through to waiver claim.
      // The user MUST drop a player first — a waiver claim won't help.
      if (lowerMsg.includes('roster') && (lowerMsg.includes('full') || lowerMsg.includes('max') || lowerMsg.includes('limit'))) {
        return {
          success: false,
          error: faErrorMsg,
          isFreeAgent: true
        };
      }

      // If the error is about the player already being on a roster, don't retry
      if (lowerMsg.includes('duplicate') || lowerMsg.includes('already') || lowerMsg.includes('unique')) {
        return {
          success: false,
          error: 'Player is already on a roster in this league.',
          isFreeAgent: true
        };
      }

      // For other errors (e.g., player is on waivers / game-locked),
      // fall through to waiver claim
      try {
        const claimResult = await waiverApi.submitClaim(leagueId, {
          teamId,
          playerId: String(playerId),
          dropPlayerId: dropPlayerId ? String(dropPlayerId) : null,
        });

        const claimData = (claimResult.data ?? { success: true }) as { success: boolean; error?: string; claimId?: string };
        logger.info('[WaiverService.addPlayer] waiver-claim response', claimData);
        if (claimData.success === false) {
          return {
            success: false,
            error: claimData.error || `Free agent failed (${faErrorMsg}); waiver claim also failed.`,
            isFreeAgent: false,
          };
        }
        return { success: true, claimId: claimData.claimId, isFreeAgent: false };
      } catch (error: unknown) {
        const claimErrMsg = error instanceof Error ? error.message : String(error);
        logger.error('[WaiverService.addPlayer] waiver-claim threw:', claimErrMsg, error);
        return {
          success: false,
          error: `${faErrorMsg} (waiver claim fallback also failed: ${claimErrMsg})`,
        };
      }
    }
  }

  /**
   * Cancel a pending waiver claim.
   * Server verifies ownership and pending status.
   */
  static async cancelWaiverClaim(claimId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await waiverApi.cancelClaim(claimId);
      return { success: true };
    } catch (error: unknown) {
      logger.error('Error cancelling waiver claim:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get waiver priority order for a league.
   */
  static async getWaiverPriority(leagueId: string): Promise<WaiverPriority[]> {
    try {
      const { data } = await waiverApi.getWaiverPriority(leagueId);
      return (data || []) as WaiverPriority[];
    } catch (error: unknown) {
      logger.error('Error fetching waiver priority:', error);
      return [];
    }
  }

  /**
   * Get pending waiver claims for a team.
   */
  static async getTeamWaiverClaims(
    leagueId: string,
    teamId: string
  ): Promise<WaiverClaim[]> {
    try {
      const { data } = await waiverApi.getTeamWaivers(leagueId, teamId);
      return (data || []) as WaiverClaim[];
    } catch (error: unknown) {
      logger.error('Error fetching team waiver claims:', error);
      return [];
    }
  }

  /**
   * Get league waiver settings.
   * Server handles membership validation via auth middleware.
   */
  static async getLeagueWaiverSettings(leagueId: string, _userId: string): Promise<LeagueWaiverSettings | null> {
    try {
      const { data } = await waiverApi.getWaiverSettings(leagueId);
      return data as LeagueWaiverSettings;
    } catch (error: unknown) {
      logger.error('Error fetching league waiver settings:', error);
      return null;
    }
  }

  /**
   * Get available players for waiver claims (not rostered in league).
   * Uses PlayerService as the source of truth for player data.
   * Kept client-side due to complex local filtering logic.
   */
  static async getAvailablePlayers(
    leagueId: string,
    position?: string,
    searchTerm?: string
  ): Promise<any[]> {
    try {
      // Get rostered player IDs from the league waivers endpoint
      // For now, still use PlayerService for the player list + local filtering
      const { data: teamWaivers } = await waiverApi.getLeagueWaivers(leagueId);

      // Use PlayerService as the source of truth (handles all player data correctly)
      let players = await PlayerService.getAllPlayers();

      // If the server returned rostered IDs, filter them out
      // Otherwise fall back to showing all players (server will validate on add)
      if (teamWaivers?.rosteredPlayerIds) {
        const rosteredPlayerIds = new Set<string>(
          (teamWaivers.rosteredPlayerIds as string[]).map(String)
        );
        players = players.filter(p => !rosteredPlayerIds.has(String(p.id)));
      }

      // Apply position filter
      if (position) {
        players = players.filter(p => p.position === position);
      }

      // Apply search filter
      if (searchTerm) {
        const lowerSearch = searchTerm.toLowerCase();
        players = players.filter(p => p.full_name.toLowerCase().includes(lowerSearch));
      }

      // Sort by name and limit
      players = players
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
        .slice(0, 50);

      // Map to the expected format for WaiverWire UI
      return players.map(p => ({
        player_id: Number(p.id),
        full_name: p.full_name,
        position_code: p.position,
        team_abbrev: p.team,
        jersey_number: p.jersey_number || '',
        is_goalie: p.position === 'G'
      }));
    } catch (error: unknown) {
      logger.error('Error fetching available players:', error);
      return [];
    }
  }

  /**
   * Process all pending waiver claims across all leagues.
   * Uses apiClient directly — needs admin endpoint on the server.
   */
  static async processAllPendingWaivers(): Promise<{
    success: boolean;
    results: Array<{
      league_id: string;
      league_name: string;
      total_processed: number;
      successful: number;
      failed: number;
      details: { team_id: string; success: boolean; error?: string }[];
    }>;
    error?: string;
  }> {
    try {
      const { data } = await apiClient.post('/api/waivers/process-all');

      return {
        success: true,
        results: data?.results || []
      };
    } catch (error: unknown) {
      logger.error('[WaiverService] Error processing waivers:', error);
      return {
        success: false,
        results: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get waiver processing status for all leagues.
   * Uses apiClient directly — needs admin endpoint on the server.
   */
  static async getWaiverProcessingStatus(): Promise<{
    leagues: Array<{
      league_id: string;
      league_name: string;
      pending_claims: number;
      last_processed: string | null;
      next_process_time: string | null;
    }>;
    error?: string;
  }> {
    try {
      const { data } = await apiClient.get('/api/waivers/processing-status');
      return { leagues: data?.leagues || [] };
    } catch (error: unknown) {
      logger.error('[WaiverService] Error getting waiver status:', error);
      return { leagues: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ==========================================================================
  // FAAB (Free Agent Acquisition Budget) Waivers
  // ==========================================================================

  /**
   * Submit a FAAB waiver bid.
   * Server handles best-ball validation, limit checks, budget validation,
   * existing bid updates, and new bid creation.
   */
  static async submitFAABBid(
    leagueId: string,
    teamId: string,
    playerId: number,
    bidAmount: number,
    dropPlayerId: number | null = null,
    isConditionalDrop: boolean = false
  ): Promise<{ success: boolean; error?: string; claimId?: string }> {
    try {
      const { data } = await waiverApi.submitFAABBid(leagueId, {
        teamId,
        playerId: String(playerId),
        bidAmount,
        dropPlayerId: dropPlayerId ? String(dropPlayerId) : null,
        isConditionalDrop,
      });

      return (data as { success: boolean; error?: string; claimId?: string }) ?? { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[WaiverService] submitFAABBid error:', msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Get the remaining FAAB budget for a team.
   * Fetches all budgets from server and filters by teamId.
   */
  static async getFAABBudget(leagueId: string, teamId: string): Promise<number | null> {
    try {
      const { data: budgets } = await waiverApi.getFAABBudgets(leagueId);

      if (!budgets || !Array.isArray(budgets)) return null;

      const teamBudget = budgets.find(
        (b: { team_id: string; remaining_budget: number }) => b.team_id === teamId
      );
      return teamBudget ? teamBudget.remaining_budget : null;
    } catch (err) {
      logger.error('[WaiverService] getFAABBudget error:', err);
      return null;
    }
  }

  /**
   * Get all FAAB budgets for every team in a league.
   */
  static async getAllFAABBudgets(
    leagueId: string
  ): Promise<Array<{ team_id: string; team_name: string; remaining_budget: number; total_spent: number }>> {
    try {
      const { data } = await waiverApi.getFAABBudgets(leagueId);
      return (data || []) as Array<{ team_id: string; team_name: string; remaining_budget: number; total_spent: number }>;
    } catch (err) {
      logger.error('[WaiverService] getAllFAABBudgets error:', err);
      return [];
    }
  }

  /**
   * Process FAAB waivers for a league.
   * Server handles the full FAAB processing logic (bidding, tiebreakers, budget deduction).
   */
  static async processFAABWaivers(
    leagueId: string
  ): Promise<{ processed: number; results: Array<{ player_id: number; winner_team_id: string; bid: number }>; error?: string }> {
    try {
      const { data } = await apiClient.post(`/api/waivers/league/${leagueId}/process-faab`);

      return (data as { processed: number; results: Array<{ player_id: number; winner_team_id: string; bid: number }>; error?: string }) ?? { processed: 0, results: [] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[WaiverService] processFAABWaivers error:', msg);
      return { processed: 0, results: [], error: msg };
    }
  }

  // ============================================================================
  // REVERSE STANDINGS WAIVER SUPPORT
  // ============================================================================

  /**
   * Trigger reverse standings priority recalculation.
   * Server calls the database RPC function.
   */
  static async recalculateReverseStandingsPriority(
    leagueId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data } = await apiClient.post(`/api/waivers/league/${leagueId}/recalculate-priority`);
      return (data as { success: boolean; error?: string }) ?? { success: true };
    } catch (error: unknown) {
      logger.error('[WaiverService] recalculateReverseStandingsPriority error:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Commissioner: update waiver settings for the league.
   * Server handles commissioner verification, notification, and reverse standings recalculation.
   */
  static async updateWaiverSettings(
    leagueId: string,
    _commissionerId: string,
    settings: Partial<LeagueWaiverSettings>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data } = await apiClient.put(`/api/waivers/league/${leagueId}/settings`, settings);
      return (data as { success: boolean; error?: string }) ?? { success: true };
    } catch (error: unknown) {
      logger.error('[WaiverService] updateWaiverSettings error:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export default WaiverService;

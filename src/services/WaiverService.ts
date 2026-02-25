import { supabase } from '@/integrations/supabase/client';
import { PlayerService } from './PlayerService';
import { COLUMNS } from '@/utils/queryColumns';
import { GameLockService } from './GameLockService';
import { LeagueMembershipService } from './LeagueMembershipService';
import { CURRENT_SEASON } from '@/utils/seasonConstants';
import type { LeagueSettings } from '@/types/leagueTypes';

export interface WaiverClaim {
  id: string;
  league_id: string;
  team_id: string;
  player_id: number;
  drop_player_id: number | null;
  priority: number;
  status: 'pending' | 'successful' | 'failed' | 'cancelled';
  created_at: string;
  processed_at: string | null;
  failure_reason: string | null;
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
}

export class WaiverService {
  /**
   * Check if a team has exceeded its weekly or season add limit.
   * Industry standard: ESPN, Yahoo, and Sleeper all support configurable
   * per-week and per-season acquisition limits set by the commissioner.
   *
   * Counts ADD transactions from the transaction_ledger table.
   * Returns { allowed: true } or { allowed: false, reason: '...' }.
   */
  static async checkTransactionLimits(
    leagueId: string,
    teamId: string
  ): Promise<{ allowed: boolean; reason?: string; weeklyAdds?: number; seasonAdds?: number }> {
    try {
      // Get league settings for limits
      const { data: league } = await supabase
        .from('leagues')
        .select('settings')
        .eq('id', leagueId)
        .single();

      if (!league) return { allowed: true }; // fail open if league not found

      const settings = league.settings as LeagueSettings | undefined;
      const weeklyLimit = settings?.weeklyAddLimit ?? 0;
      const seasonLimit = settings?.seasonAddLimit ?? 0;

      // 0 = unlimited (no cap) — skip the DB queries entirely
      if (weeklyLimit === 0 && seasonLimit === 0) {
        return { allowed: true };
      }

      // Check weekly limit
      if (weeklyLimit > 0) {
        // Calculate start of current NHL week (Monday 00:00 UTC)
        const now = new Date();
        const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ...
        const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const weekStart = new Date(now);
        weekStart.setUTCDate(now.getUTCDate() - daysSinceMonday);
        weekStart.setUTCHours(0, 0, 0, 0);

        const { count, error } = await supabase
          .from('transaction_ledger')
          .select('*', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('team_id', teamId)
          .eq('type', 'ADD')
          .gte('created_at', weekStart.toISOString());

        if (!error && count !== null && count >= weeklyLimit) {
          return {
            allowed: false,
            reason: `Weekly add limit reached (${count}/${weeklyLimit}). Resets Monday.`,
            weeklyAdds: count,
          };
        }
      }

      // Check season limit
      if (seasonLimit > 0) {
        const { count, error } = await supabase
          .from('transaction_ledger')
          .select('*', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('team_id', teamId)
          .eq('type', 'ADD');

        if (!error && count !== null && count >= seasonLimit) {
          return {
            allowed: false,
            reason: `Season add limit reached (${count}/${seasonLimit}).`,
            seasonAdds: count,
          };
        }
      }

      return { allowed: true };
    } catch (err) {
      console.error('[WaiverService] checkTransactionLimits error:', err);
      // Fail open — don't block adds if the check itself fails
      return { allowed: true };
    }
  }

  /**
   * Check if a player is available for waiver claim or free agent pickup
   * Respects game lock and waiver period rules
   * REQUIRES: User must be a member of the league
   */
  static async checkPlayerAvailability(
    playerId: number,
    leagueId: string,
    userId: string
  ): Promise<PlayerAvailability> {
    try {
      // CRITICAL: Validate membership BEFORE checking availability
      await LeagueMembershipService.requireMembership(leagueId, userId);

      // Get league settings (all waiver-related settings)
      const { data: league } = await supabase
        .from('leagues')
        .select('waiver_game_lock, waiver_period_hours, waiver_type, waiver_process_time')
        .eq('id', leagueId)
        .single();

      if (!league) {
        throw new Error('League not found');
      }

      // Check if player is already rostered in this league
      // CRITICAL: Use roster_assignments (source of truth) instead of team_lineups
      // team_lineups can get out of sync; roster_assignments is the atomic transactional table
      const { data: existingAssignment } = await supabase
        .from('roster_assignments')
        .select('id')
        .eq('league_id', leagueId)
        .eq('player_id', playerId.toString())
        .maybeSingle();

      if (existingAssignment) {
        return {
          player_id: playerId,
          is_available: false,
          is_game_locked: false,
          is_on_waivers: false,
          waiver_clear_time: null,
          lock_reason: 'Player is already rostered'
        };
      }

      // Get player's NHL team
      const { data: player } = await supabase
        .from('player_directory')
        .select('team_abbrev')
        .eq('season', CURRENT_SEASON)
        .eq('player_id', playerId)
        .maybeSingle();

      if (!player || !player.team_abbrev) {
        return {
          player_id: playerId,
          is_available: true,
          is_game_locked: false,
          is_on_waivers: false,
          waiver_clear_time: null,
          lock_reason: null
        };
      }

      // Check game lock if enabled
      let isGameLocked = false;
      let lockReason = null;

      if (league.waiver_game_lock) {
        // Use GameLockService which has correct column names and logic
        const lockInfo = await GameLockService.isPlayerLocked(
          playerId,
          player.team_abbrev
        );
        
        if (lockInfo.isLocked) {
          isGameLocked = true;
          if (lockInfo.gameStatus === 'live') {
            lockReason = 'Player is currently in a game';
          } else if (lockInfo.gameStatus === 'final') {
            lockReason = 'Player\'s game just finished - waivers clear tomorrow morning';
          } else {
            lockReason = 'Player\'s game has started';
          }
        }
      }

      // Check waiver period for recently dropped players (Yahoo/Sleeper style)
      let isOnWaivers = false;
      let waiverClearTime: string | null = null;
      
      if (league.waiver_period_hours && league.waiver_period_hours > 0) {
        // Check if player is on waivers using database function
        const { data: onWaivers, error: waiverError } = await supabase.rpc(
          'is_player_on_waivers',
          {
            p_league_id: leagueId,
            p_player_id: playerId
          }
        );
        
        if (!waiverError && onWaivers) {
          isOnWaivers = true;
          
          // Get waiver clear time
          const { data: clearTime, error: clearTimeError } = await supabase.rpc(
            'get_player_waiver_clear_time',
            {
              p_league_id: leagueId,
              p_player_id: playerId
            }
          );
          
          if (!clearTimeError && clearTime) {
            waiverClearTime = clearTime;
            lockReason = `Player is on waivers until ${new Date(clearTime).toLocaleString()}`;
          } else {
            lockReason = `Player is on waivers for ${league.waiver_period_hours} hours after being dropped`;
          }
        }
      }

      // Player is available if not game-locked AND not on waivers
      const isAvailable = !isGameLocked && !isOnWaivers;

      return {
        player_id: playerId,
        is_available: isAvailable,
        is_game_locked: isGameLocked,
        is_on_waivers: isOnWaivers,
        waiver_clear_time: waiverClearTime,
        lock_reason: lockReason
      };
    } catch (error: unknown) {
      console.error('Error checking player availability:', error);
      throw error;
    }
  }

  /**
   * Add a free agent (instant pickup - no waiver claim needed)
   * Only works if player is not game-locked
   * IMPORTANT: Availability is checked by addPlayer() before calling this.
   * Uses process_roster_move RPC to ensure roster_assignments stays in sync.
   */
  static async addFreeAgent(
    leagueId: string,
    teamId: string,
    playerId: number,
    dropPlayerId: number | null = null,
    userId?: string,
    /** Skip limit check when called from waiver/FAAB processing (limits were checked at claim time) */
    skipLimitCheck = false
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get userId from team if not provided
      let actualUserId = userId;
      if (!actualUserId) {
        const { data: team } = await supabase
          .from('teams')
          .select('owner_id')
          .eq('id', teamId)
          .single();

        if (!team || !team.owner_id) {
          return {
            success: false,
            error: 'Team not found or has no owner'
          };
        }
        actualUserId = team.owner_id;
      }

      // NOTE: Availability check is done in addPlayer() before this is called.
      // No need to check again here — avoids redundant API calls.

      // Enforce weekly/season add limits (ESPN/Yahoo/Sleeper industry standard)
      // Skipped during waiver/FAAB processing — limits were validated at submission time.
      // Double-checking here would unfairly block winning bids if the team added players
      // between bid submission and processing.
      if (!skipLimitCheck) {
        const limitCheck = await this.checkTransactionLimits(leagueId, teamId);
        if (!limitCheck.allowed) {
          return { success: false, error: limitCheck.reason };
        }
      }

      // Use process_roster_move RPC (atomic transaction engine)
      // This ensures roster_assignments (source of truth) stays in sync
      const { data: result, error: rpcError } = await supabase.rpc('process_roster_move', {
        p_league_id: leagueId,
        p_user_id: actualUserId,
        p_drop_player_id: dropPlayerId ? String(dropPlayerId) : null,
        p_add_player_id: String(playerId),
        p_transaction_source: 'Free Agent Add'
      });

      if (rpcError) {
        return {
          success: false,
          error: rpcError.message || 'Failed to add player'
        };
      }

      const rpcResult = result as { status: string; message: string };
      if (rpcResult.status === 'error') {
        return {
          success: false,
          error: rpcResult.message || 'Failed to add player'
        };
      }

      // After successful RPC, update team_lineups to reflect the change in UI
      // Get current lineup
      const { data: lineup } = await supabase
        .from('team_lineups')
        .select('starters, bench, ir, slot_assignments')
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .maybeSingle();

      if (lineup) {
        let newStarters = (lineup.starters as any[]) || [];
        let newBench = (lineup.bench as any[]) || [];
        let newIr = (lineup.ir as any[]) || [];
        let newSlotAssignments = (lineup.slot_assignments as any) || {};

        // Drop player if specified
        if (dropPlayerId) {
          const dropPlayerIdStr = dropPlayerId.toString();
          newStarters = newStarters.filter(id => id !== dropPlayerIdStr);
          newBench = newBench.filter(id => id !== dropPlayerIdStr);
          newIr = newIr.filter(id => id !== dropPlayerIdStr);
          delete newSlotAssignments[dropPlayerIdStr];
        }

        // Add new player to bench
        const playerIdStr = playerId.toString();
        if (!newBench.includes(playerIdStr)) {
          newBench.push(playerIdStr);
        }

        // Update lineup (non-critical - if this fails, roster_assignments is still correct)
        await supabase
          .from('team_lineups')
          .update({
            starters: newStarters,
            bench: newBench,
            ir: newIr,
            slot_assignments: newSlotAssignments,
            updated_at: new Date().toISOString()
          })
          .eq('league_id', leagueId)
          .eq('team_id', teamId);
      }

      return { success: true };
    } catch (error: unknown) {
      console.error('Error adding free agent:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Submit a waiver claim (for game-locked players or players on waivers)
   * Claim will be processed at league's waiver_process_time (default 2 AM MT)
   */
  static async submitWaiverClaim(
    leagueId: string,
    teamId: string,
    playerId: number,
    dropPlayerId: number | null = null
  ): Promise<{ success: boolean; error?: string; claimId?: string }> {
    try {
      // Best Ball leagues prohibit waivers (industry standard: zero management)
      const { data: leagueCheck, error: leagueCheckErr } = await supabase
        .from('leagues')
        .select('settings')
        .eq('id', leagueId)
        .single();

      if (leagueCheckErr || !leagueCheck) {
        return { success: false, error: 'League not found.' };
      }

      if ((leagueCheck.settings as LeagueSettings)?.bestBallEnabled) {
        return { success: false, error: 'Waivers are not allowed in Best Ball leagues.' };
      }

      // Enforce weekly/season add limits (ESPN/Yahoo/Sleeper industry standard)
      const limitCheck = await this.checkTransactionLimits(leagueId, teamId);
      if (!limitCheck.allowed) {
        return { success: false, error: limitCheck.reason };
      }

      // Get team's waiver priority
      const { data: priority } = await supabase
        .from('waiver_priority')
        .select('priority')
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .single();

      if (!priority) {
        return {
          success: false,
          error: 'Team waiver priority not found'
        };
      }

      // Submit the claim
      const { data, error } = await supabase
        .from('waiver_claims')
        .insert({
          league_id: leagueId,
          team_id: teamId,
          player_id: playerId,
          drop_player_id: dropPlayerId,
          priority: priority.priority,
          status: 'pending'
        })
        .select()
        .single();

      if (error) {
        return {
          success: false,
          error: error.message
        };
      }

      return {
        success: true,
        claimId: data.id
      };
    } catch (error: unknown) {
      console.error('Error submitting waiver claim:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Smart add player - automatically chooses free agent pickup or waiver claim
   * based on player availability
   */
  static async addPlayer(
    leagueId: string,
    teamId: string,
    playerId: number,
    dropPlayerId: number | null = null,
    userId?: string
  ): Promise<{ success: boolean; error?: string; claimId?: string; isFreeAgent?: boolean }> {
    try {
      // Get userId from team if not provided
      let actualUserId = userId;
      if (!actualUserId) {
        const { data: team } = await supabase
          .from('teams')
          .select('owner_id')
          .eq('id', teamId)
          .single();
        
        if (!team || !team.owner_id) {
          return {
            success: false,
            error: 'Team not found or has no owner'
          };
        }
        actualUserId = team.owner_id;
      }

      // Check if player is available for free agent pickup (requires userId)
      const availability = await this.checkPlayerAvailability(playerId, leagueId, actualUserId);

      if (availability.is_available) {
        // Free agent pickup (instant)
        const result = await this.addFreeAgent(leagueId, teamId, playerId, dropPlayerId, actualUserId);
        return {
          ...result,
          isFreeAgent: true
        };
      } else {
        // Submit waiver claim (processes at 3 AM)
        const result = await this.submitWaiverClaim(leagueId, teamId, playerId, dropPlayerId);
        return {
          ...result,
          isFreeAgent: false
        };
      }
    } catch (error: unknown) {
      console.error('Error adding player:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Cancel a pending waiver claim
   */
  static async cancelWaiverClaim(claimId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('waiver_claims')
        .update({ status: 'cancelled' })
        .eq('id', claimId)
        .eq('status', 'pending');

      if (error) {
        return {
          success: false,
          error: error.message
        };
      }

      return { success: true };
    } catch (error: unknown) {
      console.error('Error cancelling waiver claim:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get waiver priority order for a league
   */
  static async getWaiverPriority(leagueId: string): Promise<WaiverPriority[]> {
    try {
      const { data, error } = await supabase
        .from('waiver_priority')
        .select(`
          id,
          league_id,
          team_id,
          priority,
          updated_at,
          teams!inner(team_name)
        `)
        .eq('league_id', leagueId)
        .order('priority', { ascending: true });

      if (error) {
        throw error;
      }

      return (data || []).map(wp => ({
        id: wp.id,
        league_id: wp.league_id,
        team_id: wp.team_id,
        team_name: (wp.teams as any).team_name,
        priority: wp.priority,
        updated_at: wp.updated_at
      }));
    } catch (error: unknown) {
      console.error('Error fetching waiver priority:', error);
      return [];
    }
  }

  /**
   * Get pending waiver claims for a team
   */
  static async getTeamWaiverClaims(
    leagueId: string,
    teamId: string
  ): Promise<WaiverClaim[]> {
    try {
      const { data, error } = await supabase
        .from('waiver_claims')
        .select(COLUMNS.WAIVER)
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error: unknown) {
      console.error('Error fetching team waiver claims:', error);
      return [];
    }
  }

  /**
   * Get league waiver settings
   * REQUIRES: User must be a member of the league
   */
  static async getLeagueWaiverSettings(leagueId: string, userId: string): Promise<LeagueWaiverSettings | null> {
    try {
      // CRITICAL: Validate membership BEFORE querying (application-level security)
      await LeagueMembershipService.requireMembership(leagueId, userId);

      const { data, error } = await supabase
        .from('leagues')
        .select('waiver_process_time, waiver_period_hours, waiver_game_lock, waiver_type, allow_trades_during_games')
        .eq('id', leagueId)
        .single();

      if (error) {
        throw error;
      }

      return data as LeagueWaiverSettings;
    } catch (error: unknown) {
      console.error('Error fetching league waiver settings:', error);
      return null;
    }
  }

  /**
   * Get available players for waiver claims (not rostered in league)
   * Uses PlayerService as the source of truth for player data
   */
  static async getAvailablePlayers(
    leagueId: string,
    position?: string,
    searchTerm?: string
  ): Promise<any[]> {
    try {
      // CRITICAL: Use roster_assignments (source of truth) instead of team_lineups
      // team_lineups JSONB arrays can get out of sync; roster_assignments is the atomic table
      const { data: assignments } = await supabase
        .from('roster_assignments')
        .select('player_id')
        .eq('league_id', leagueId);

      const rosteredPlayerIds = new Set<string>();
      (assignments || []).forEach(a => rosteredPlayerIds.add(String(a.player_id)));

      // Use PlayerService as the source of truth (handles all player data correctly)
      let players = await PlayerService.getAllPlayers();

      // Filter out rostered players
      players = players.filter(p => !rosteredPlayerIds.has(String(p.id)));

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
      console.error('Error fetching available players:', error);
      return [];
    }
  }

  /**
   * Process all pending waiver claims across all leagues
   * This calls the database RPC function that handles the actual processing
   * Can be called from:
   * - Commissioner "Process Waivers" button
   * - Scheduled Edge Function
   * - Manual admin action
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
      const { data, error } = await supabase.rpc('process_all_pending_waivers');
      
      if (error) {
        console.error('[WaiverService] Error processing waivers:', error);
        return {
          success: false,
          results: [],
          error: error.message
        };
      }
      
      const results = data || [];
      
      // Log results
      let totalProcessed = 0;
      let totalSuccessful = 0;
      let totalFailed = 0;
      
      results.forEach((r: { league_id: string; league_name: string; total_processed: number; successful: number; failed: number; details: { team_id: string; success: boolean; error?: string }[] }) => {
        totalProcessed += r.total_processed || 0;
        totalSuccessful += r.successful || 0;
        totalFailed += r.failed || 0;
      });
      
      return {
        success: true,
        results
      };
    } catch (error: unknown) {
      console.error('[WaiverService] Error processing waivers:', error);
      return {
        success: false,
        results: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get waiver processing status for all leagues
   * Shows pending claims count and next processing time
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
      const { data, error } = await supabase.rpc('get_waiver_processing_status');
      
      if (error) {
        console.error('[WaiverService] Error getting waiver status:', error);
        return { leagues: [], error: error.message };
      }
      
      return { leagues: data || [] };
    } catch (error: unknown) {
      console.error('[WaiverService] Error getting waiver status:', error);
      return { leagues: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ==========================================================================
  // FAAB (Free Agent Acquisition Budget) Waivers
  // ==========================================================================

  /**
   * Submit a FAAB waiver bid. Instead of priority-based claims, teams bid
   * a dollar amount from their FAAB budget. Highest bid wins.
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
      // Best Ball leagues prohibit FAAB bidding (industry standard: zero management)
      const { data: bbCheck, error: bbCheckErr } = await supabase
        .from('leagues')
        .select('settings')
        .eq('id', leagueId)
        .single();

      if (bbCheckErr || !bbCheck) {
        return { success: false, error: 'League not found.' };
      }

      if ((bbCheck.settings as LeagueSettings)?.bestBallEnabled) {
        return { success: false, error: 'FAAB bidding is not allowed in Best Ball leagues.' };
      }

      // Enforce weekly/season add limits (ESPN/Yahoo/Sleeper industry standard)
      const limitCheck = await this.checkTransactionLimits(leagueId, teamId);
      if (!limitCheck.allowed) {
        return { success: false, error: limitCheck.reason };
      }

      // Validate bid amount
      if (bidAmount < 0) {
        return { success: false, error: 'Bid amount cannot be negative.' };
      }

      // Check remaining FAAB budget
      const budget = await this.getFAABBudget(leagueId, teamId);
      if (budget === null) {
        return { success: false, error: 'FAAB budget not found for this team.' };
      }

      if (bidAmount > budget) {
        return { success: false, error: `Bid of $${bidAmount} exceeds remaining budget of $${budget}.` };
      }

      // Check for existing pending bid on this player
      const { data: existingClaim } = await supabase
        .from('waiver_claims')
        .select('id')
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .eq('player_id', playerId)
        .eq('status', 'pending')
        .maybeSingle();

      if (existingClaim) {
        // Update existing bid
        const { error } = await supabase
          .from('waiver_claims')
          .update({
            priority: bidAmount, // Reuse priority column for FAAB bid amount
            drop_player_id: dropPlayerId,
            is_conditional_drop: isConditionalDrop,
          })
          .eq('id', existingClaim.id);

        if (error) return { success: false, error: error.message };
        return { success: true, claimId: existingClaim.id };
      }

      // Create new bid
      const { data, error } = await supabase
        .from('waiver_claims')
        .insert({
          league_id: leagueId,
          team_id: teamId,
          player_id: playerId,
          drop_player_id: dropPlayerId,
          priority: bidAmount, // Store bid amount in priority column
          status: 'pending',
          is_conditional_drop: isConditionalDrop,
        })
        .select()
        .single();

      if (error) return { success: false, error: error.message };
      return { success: true, claimId: data.id };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[WaiverService] submitFAABBid error:', msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Get the remaining FAAB budget for a team.
   * Budget is tracked in the team's league settings or a dedicated column.
   */
  static async getFAABBudget(leagueId: string, teamId: string): Promise<number | null> {
    try {
      // Try to get from faab_budgets table first
      const { data: budgetRow } = await supabase
        .from('faab_budgets')
        .select('remaining_budget')
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .maybeSingle();

      if (budgetRow) return budgetRow.remaining_budget;

      // Fallback: initialize from league settings
      const { data: league } = await supabase
        .from('leagues')
        .select('settings')
        .eq('id', leagueId)
        .single();

      const settings = league?.settings as LeagueSettings | undefined;
      const initialBudget = settings?.faabBudget ?? settings?.auctionBudget ?? 100;

      // Calculate spent budget from completed FAAB claims
      const { data: completedClaims } = await supabase
        .from('waiver_claims')
        .select('priority')
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .eq('status', 'successful');

      const totalSpent = (completedClaims ?? []).reduce(
        (sum, c) => sum + (c.priority ?? 0), 0
      );

      return Math.max(0, initialBudget - totalSpent);
    } catch (err) {
      console.error('[WaiverService] getFAABBudget error:', err);
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
      // Get league settings for initial budget
      const { data: league } = await supabase
        .from('leagues')
        .select('settings')
        .eq('id', leagueId)
        .single();

      const settings = league?.settings as LeagueSettings | undefined;
      const initialBudget = settings?.faabBudget ?? settings?.auctionBudget ?? 100;

      // Get all teams
      const { data: teams } = await supabase
        .from('teams')
        .select('id, team_name')
        .eq('league_id', leagueId);

      if (!teams) return [];

      // Get all completed FAAB claims in this league
      const { data: completedClaims } = await supabase
        .from('waiver_claims')
        .select('team_id, priority')
        .eq('league_id', leagueId)
        .eq('status', 'successful');

      // Aggregate spent per team
      const spentMap = new Map<string, number>();
      (completedClaims ?? []).forEach(c => {
        const prev = spentMap.get(c.team_id) || 0;
        spentMap.set(c.team_id, prev + (c.priority ?? 0));
      });

      return teams.map(t => {
        const spent = spentMap.get(t.id) || 0;
        return {
          team_id: t.id,
          team_name: t.team_name,
          remaining_budget: Math.max(0, initialBudget - spent),
          total_spent: spent,
        };
      }).sort((a, b) => b.remaining_budget - a.remaining_budget);
    } catch (err) {
      console.error('[WaiverService] getAllFAABBudgets error:', err);
      return [];
    }
  }

  /**
   * Process FAAB waivers for a league. Highest bid wins.
   * Ties broken by reverse standings order (worst team wins).
   */
  static async processFAABWaivers(
    leagueId: string
  ): Promise<{ processed: number; results: Array<{ player_id: number; winner_team_id: string; bid: number }>; error?: string }> {
    try {
      // Get all pending claims for this league (include conditional drop flag)
      const { data: claims, error: fetchErr } = await supabase
        .from('waiver_claims')
        .select('id, team_id, player_id, priority, drop_player_id, is_conditional_drop')
        .eq('league_id', leagueId)
        .eq('status', 'pending')
        .order('priority', { ascending: false }); // Highest bids first

      if (fetchErr) return { processed: 0, results: [], error: fetchErr.message };
      if (!claims || claims.length === 0) return { processed: 0, results: [] };

      // Group claims by player_id
      const playerClaims = new Map<number, typeof claims>();
      claims.forEach(c => {
        if (!playerClaims.has(c.player_id)) playerClaims.set(c.player_id, []);
        playerClaims.get(c.player_id)!.push(c);
      });

      const results: Array<{ player_id: number; winner_team_id: string; bid: number }> = [];

      // Fetch standings for tiebreaker (inverse standings: worst team wins ties)
      // ESPN/Yahoo/Sleeper standard: equal bids broken by worst record
      const { data: standingsData } = await supabase
        .from('teams')
        .select('id, wins, losses')
        .eq('league_id', leagueId);

      // Lower win pct = higher priority (inverse standings)
      const teamStandingsRank = new Map<string, number>();
      if (standingsData) {
        const sorted = [...standingsData].sort((a, b) => {
          const pctA = (a.wins || 0) / Math.max(1, (a.wins || 0) + (a.losses || 0));
          const pctB = (b.wins || 0) / Math.max(1, (b.wins || 0) + (b.losses || 0));
          return pctA - pctB; // Worst record first (best tiebreaker position)
        });
        sorted.forEach((t, i) => teamStandingsRank.set(t.id, i));
      }

      // Process each player
      for (const [playerId, bids] of playerClaims) {
        // Sort by bid amount desc, then by inverse standings (worst team first) for ties
        bids.sort((a, b) => {
          const bidDiff = (b.priority ?? 0) - (a.priority ?? 0);
          if (bidDiff !== 0) return bidDiff;
          // Tiebreaker: lower standings rank = worse team = wins tie
          return (teamStandingsRank.get(a.team_id) ?? 999) - (teamStandingsRank.get(b.team_id) ?? 999);
        });

        // Find first eligible bidder
        let winner = null;
        for (const bid of bids) {
          // Verify budget is still sufficient
          const budget = await this.getFAABBudget(leagueId, bid.team_id);
          if (budget !== null && budget >= (bid.priority ?? 0)) {
            winner = bid;
            break;
          }
        }

        if (winner) {
          const bidAmount = winner.priority ?? 0;

          // 1. Execute the roster move (add player, optionally drop)
          try {
            // Get team owner for the roster move
            const { data: teamData } = await supabase
              .from('teams')
              .select('owner_id')
              .eq('id', winner.team_id)
              .single();

            if (teamData?.owner_id) {
              // Conditional drop logic (ESPN/Yahoo standard):
              // - Non-conditional: always include the drop player
              // - Conditional: try add-only first; if roster is full, retry with drop
              let moveResult: { success: boolean; error?: string };

              if (winner.is_conditional_drop && winner.drop_player_id) {
                // Try add-only first (no drop)
                // skipLimitCheck=true: limits were checked at bid submission time
                moveResult = await this.addFreeAgent(
                  leagueId,
                  winner.team_id,
                  playerId,
                  null,
                  teamData.owner_id,
                  true // skipLimitCheck — waiver processing
                );

                // If add-only failed (likely roster full), retry with the drop
                if (!moveResult.success) {
                  moveResult = await this.addFreeAgent(
                    leagueId,
                    winner.team_id,
                    playerId,
                    winner.drop_player_id,
                    teamData.owner_id,
                    true // skipLimitCheck — waiver processing
                  );
                }
              } else {
                // Non-conditional: always include the drop
                moveResult = await this.addFreeAgent(
                  leagueId,
                  winner.team_id,
                  playerId,
                  winner.drop_player_id,
                  teamData.owner_id,
                  true // skipLimitCheck — waiver processing
                );
              }

              if (!moveResult.success) {
                const reason = winner.is_conditional_drop
                  ? `Conditional claim failed: ${moveResult.error}`
                  : `Roster move failed: ${moveResult.error}`;

                await supabase
                  .from('waiver_claims')
                  .update({
                    status: 'failed',
                    processed_at: new Date().toISOString(),
                    failure_reason: reason,
                  })
                  .eq('id', winner.id);

                // Try next bidder
                const loserIds = bids.filter(b => b.id !== winner!.id).map(b => b.id);
                if (loserIds.length > 0) {
                  await supabase
                    .from('waiver_claims')
                    .update({
                      status: 'failed',
                      processed_at: new Date().toISOString(),
                      failure_reason: 'Outbid or prior bidder claimed',
                    })
                    .in('id', loserIds);
                }
                continue;
              }
            }
          } catch (moveErr) {
            console.error('[WaiverService] FAAB roster move error:', moveErr);
          }

          // 2. Deduct FAAB budget from winner
          const { data: budgetRow } = await supabase
            .from('faab_budgets')
            .select('remaining_budget')
            .eq('league_id', leagueId)
            .eq('team_id', winner.team_id)
            .maybeSingle();

          if (budgetRow) {
            await supabase
              .from('faab_budgets')
              .update({
                remaining_budget: Math.max(0, budgetRow.remaining_budget - bidAmount),
                updated_at: new Date().toISOString(),
              })
              .eq('league_id', leagueId)
              .eq('team_id', winner.team_id);
          }

          // 3. Mark winner claim as successful
          await supabase
            .from('waiver_claims')
            .update({ status: 'successful', processed_at: new Date().toISOString() })
            .eq('id', winner.id);

          // 4. Mark all other bids for this player as failed
          const loserIds = bids.filter(b => b.id !== winner!.id).map(b => b.id);
          if (loserIds.length > 0) {
            await supabase
              .from('waiver_claims')
              .update({
                status: 'failed',
                processed_at: new Date().toISOString(),
                failure_reason: 'Outbid',
              })
              .in('id', loserIds);
          }

          results.push({
            player_id: playerId,
            winner_team_id: winner.team_id,
            bid: bidAmount,
          });
        } else {
          // No eligible bidder
          const allIds = bids.map(b => b.id);
          await supabase
            .from('waiver_claims')
            .update({
              status: 'failed',
              processed_at: new Date().toISOString(),
              failure_reason: 'Insufficient budget',
            })
            .in('id', allIds);
        }
      }

      return { processed: results.length, results };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[WaiverService] processFAABWaivers error:', msg);
      return { processed: 0, results: [], error: msg };
    }
  }
  // ============================================================================
  // REVERSE STANDINGS WAIVER SUPPORT
  // ============================================================================

  /**
   * Trigger reverse standings priority recalculation.
   * This is called automatically by the process_waiver_claims RPC for
   * reverse_standings leagues, but can also be triggered manually.
   *
   * Priority is based on actual matchup records — worst team gets priority 1.
   * All settings are read dynamically from league configuration.
   */
  static async recalculateReverseStandingsPriority(
    leagueId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase.rpc('recalculate_reverse_standings_priority', {
        p_league_id: leagueId,
      });

      if (error) throw error;
      return { success: true };
    } catch (error: unknown) {
      console.error('[WaiverService] recalculateReverseStandingsPriority error:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Commissioner: update waiver settings for the league.
   * Sends notification to league members when settings change.
   *
   * All waiver settings are commissioner-configurable:
   *   - waiver_type: 'rolling' | 'faab' | 'reverse_standings'
   *   - waiver_process_time: When waivers process (time of day)
   *   - waiver_period_hours: How long players are on waivers
   *   - waiver_game_lock: Lock players during active games
   *   - allow_trades_during_games: Bypass game lock for trades
   */
  static async updateWaiverSettings(
    leagueId: string,
    commissionerId: string,
    settings: Partial<LeagueWaiverSettings>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Verify commissioner
      const { data: league } = await supabase
        .from('leagues')
        .select('commissioner_id')
        .eq('id', leagueId)
        .single();

      if (!league || league.commissioner_id !== commissionerId) {
        return { success: false, error: 'Only the commissioner can update waiver settings' };
      }

      const { error } = await supabase
        .from('leagues')
        .update(settings)
        .eq('id', leagueId);

      if (error) throw error;

      // Notify league members about the change
      const typeLabels: Record<string, string> = {
        rolling: 'Rolling Priority',
        faab: 'FAAB Bidding',
        reverse_standings: 'Reverse Standings',
      };

      const changedFields = Object.entries(settings)
        .map(([k, v]) => {
          if (k === 'waiver_type') return `Waiver type: ${typeLabels[v as string] || v}`;
          if (k === 'waiver_period_hours') return `Waiver period: ${v} hours`;
          if (k === 'waiver_game_lock') return `Game lock: ${v ? 'enabled' : 'disabled'}`;
          if (k === 'allow_trades_during_games') return `Trades during games: ${v ? 'allowed' : 'blocked'}`;
          return null;
        })
        .filter(Boolean);

      if (changedFields.length > 0) {
        try {
          await supabase.rpc('notify_league_members', {
            p_league_id: leagueId,
            p_title: 'Waiver Settings Updated',
            p_message: changedFields.join('. '),
            p_notification_type: 'SYSTEM',
          });
        } catch {
          // Non-critical
        }
      }

      // If switching to reverse_standings, recalculate priority immediately
      if (settings.waiver_type === 'reverse_standings') {
        await this.recalculateReverseStandingsPriority(leagueId);
      }

      return { success: true };
    } catch (error: unknown) {
      console.error('[WaiverService] updateWaiverSettings error:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export default WaiverService;

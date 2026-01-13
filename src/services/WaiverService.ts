import { supabase } from '@/integrations/supabase/client';
import { PlayerService } from './PlayerService';
import { COLUMNS } from '@/utils/queryColumns';
import { GameLockService } from './GameLockService';

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
   * Check if a player is available for waiver claim or free agent pickup
   * Respects game lock and waiver period rules
   */
  static async checkPlayerAvailability(
    playerId: number,
    leagueId: string
  ): Promise<PlayerAvailability> {
    try {
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
      // team_lineups uses JSONB arrays (starters, bench, ir)
      const { data: lineups } = await supabase
        .from('team_lineups')
        .select('starters, bench, ir')
        .eq('league_id', leagueId);

      const isRostered = (lineups || []).some(lineup => {
        const playerIdStr = playerId.toString();
        return (
          (lineup.starters as any[])?.includes(playerIdStr) ||
          (lineup.bench as any[])?.includes(playerIdStr) ||
          (lineup.ir as any[])?.includes(playerIdStr)
        );
      });

      if (isRostered) {
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
        .eq('season', 2025)
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
    } catch (error) {
      console.error('Error checking player availability:', error);
      throw error;
    }
  }

  /**
   * Add a free agent (instant pickup - no waiver claim needed)
   * Only works if player is not game-locked
   */
  static async addFreeAgent(
    leagueId: string,
    teamId: string,
    playerId: number,
    dropPlayerId: number | null = null
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Check player availability
      const availability = await this.checkPlayerAvailability(playerId, leagueId);
      
      if (!availability.is_available) {
        return {
          success: false,
          error: availability.lock_reason || 'Player is game-locked. Submit a waiver claim instead.'
        };
      }

      // Get current lineup
      const { data: lineup } = await supabase
        .from('team_lineups')
        .select('starters, bench, ir, slot_assignments')
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .single();

      if (!lineup) {
        return {
          success: false,
          error: 'Team lineup not found'
        };
      }

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
      newBench.push(playerId.toString());

      // Update lineup
      const { error } = await supabase
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

      if (error) {
        return {
          success: false,
          error: error.message
        };
      }

      return { success: true };
    } catch (error: any) {
      console.error('Error adding free agent:', error);
      return {
        success: false,
        error: error.message || 'Failed to add free agent'
      };
    }
  }

  /**
   * Submit a waiver claim (for game-locked players or players on waivers)
   * Claim will be processed at league's waiver_process_time (default 3 AM)
   */
  static async submitWaiverClaim(
    leagueId: string,
    teamId: string,
    playerId: number,
    dropPlayerId: number | null = null
  ): Promise<{ success: boolean; error?: string; claimId?: string }> {
    try {
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
    } catch (error: any) {
      console.error('Error submitting waiver claim:', error);
      return {
        success: false,
        error: error.message || 'Failed to submit waiver claim'
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
    dropPlayerId: number | null = null
  ): Promise<{ success: boolean; error?: string; claimId?: string; isFreeAgent?: boolean }> {
    try {
      // Check if player is available for free agent pickup
      const availability = await this.checkPlayerAvailability(playerId, leagueId);

      if (availability.is_available) {
        // Free agent pickup (instant)
        const result = await this.addFreeAgent(leagueId, teamId, playerId, dropPlayerId);
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
    } catch (error: any) {
      console.error('Error adding player:', error);
      return {
        success: false,
        error: error.message || 'Failed to add player'
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
    } catch (error: any) {
      console.error('Error cancelling waiver claim:', error);
      return {
        success: false,
        error: error.message || 'Failed to cancel waiver claim'
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
    } catch (error) {
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
    } catch (error) {
      console.error('Error fetching team waiver claims:', error);
      return [];
    }
  }

  /**
   * Get league waiver settings
   */
  static async getLeagueWaiverSettings(leagueId: string): Promise<LeagueWaiverSettings | null> {
    try {
      const { data, error } = await supabase
        .from('leagues')
        .select('waiver_process_time, waiver_period_hours, waiver_game_lock, waiver_type, allow_trades_during_games')
        .eq('id', leagueId)
        .single();

      if (error) {
        throw error;
      }

      return data as LeagueWaiverSettings;
    } catch (error) {
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
      // Get all rostered players in the league from JSONB arrays
      const { data: lineups } = await supabase
        .from('team_lineups')
        .select('starters, bench, ir')
        .eq('league_id', leagueId);

      const rosteredPlayerIds = new Set<string>();
      (lineups || []).forEach(lineup => {
        ((lineup.starters as any[]) || []).forEach(id => rosteredPlayerIds.add(String(id)));
        ((lineup.bench as any[]) || []).forEach(id => rosteredPlayerIds.add(String(id)));
        ((lineup.ir as any[]) || []).forEach(id => rosteredPlayerIds.add(String(id)));
      });

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
    } catch (error) {
      console.error('Error fetching available players:', error);
      return [];
    }
  }
}

export default WaiverService;

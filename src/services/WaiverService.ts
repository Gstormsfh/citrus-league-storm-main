import { supabase } from '@/integrations/supabase/client';

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
      // Get league settings
      const { data: league } = await supabase
        .from('leagues')
        .select('waiver_game_lock, waiver_period_hours')
        .eq('id', leagueId)
        .single();

      if (!league) {
        throw new Error('League not found');
      }

      // Check if player is already rostered in this league
      const { data: rostered } = await supabase
        .from('team_lineups')
        .select('team_id')
        .eq('league_id', leagueId)
        .eq('player_id', playerId)
        .maybeSingle();

      if (rostered) {
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
        .select('current_team_abbrev')
        .eq('id', playerId)
        .single();

      if (!player || !player.current_team_abbrev) {
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
        const today = new Date().toISOString().split('T')[0];
        
        const { data: games } = await supabase
          .from('nhl_games')
          .select('game_status, start_time_utc')
          .eq('game_date', today)
          .or(`home_team_abbrev.eq.${player.current_team_abbrev},away_team_abbrev.eq.${player.current_team_abbrev}`)
          .in('game_status', ['Live', 'Final']);

        if (games && games.length > 0) {
          isGameLocked = true;
          lockReason = games[0].game_status === 'Live' 
            ? 'Player is currently in a game'
            : 'Player\'s game just finished - waivers clear tomorrow morning';
        }
      }

      // TODO: Check waiver period for recently dropped players
      // This would require tracking when players are dropped in a separate table

      return {
        player_id: playerId,
        is_available: !isGameLocked,
        is_game_locked: isGameLocked,
        is_on_waivers: false, // TODO: Implement waiver period tracking
        waiver_clear_time: null,
        lock_reason: lockReason
      };
    } catch (error) {
      console.error('Error checking player availability:', error);
      throw error;
    }
  }

  /**
   * Submit a waiver claim
   */
  static async submitWaiverClaim(
    leagueId: string,
    teamId: string,
    playerId: number,
    dropPlayerId: number | null = null
  ): Promise<{ success: boolean; error?: string; claimId?: string }> {
    try {
      // Check player availability first
      const availability = await this.checkPlayerAvailability(playerId, leagueId);
      
      if (!availability.is_available) {
        return {
          success: false,
          error: availability.lock_reason || 'Player is not available'
        };
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
    } catch (error: any) {
      console.error('Error submitting waiver claim:', error);
      return {
        success: false,
        error: error.message || 'Failed to submit waiver claim'
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
          teams!inner(name)
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
        team_name: (wp.teams as any).name,
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
        .select('*')
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
   */
  static async getAvailablePlayers(
    leagueId: string,
    position?: string,
    searchTerm?: string
  ): Promise<any[]> {
    try {
      // Get all rostered players in the league
      const { data: rosteredPlayers } = await supabase
        .from('team_lineups')
        .select('player_id')
        .eq('league_id', leagueId);

      const rosteredPlayerIds = (rosteredPlayers || []).map(rp => rp.player_id);

      // Query available players
      let query = supabase
        .from('player_directory')
        .select(`
          id,
          first_name,
          last_name,
          position,
          current_team_abbrev,
          jersey_number
        `)
        .not('id', 'in', `(${rosteredPlayerIds.join(',') || '0'})`)
        .order('last_name', { ascending: true });

      if (position) {
        query = query.eq('position', position);
      }

      if (searchTerm) {
        query = query.or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%`);
      }

      const { data, error } = await query.limit(50);

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching available players:', error);
      return [];
    }
  }
}

export default WaiverService;

import { supabase } from '@/integrations/supabase/client';
import { PlayerService } from './PlayerService';
import { COLUMNS } from '@/utils/queryColumns';

export interface TradeOffer {
  id: string;
  league_id: string;
  from_team_id: string;
  to_team_id: string;
  offered_player_ids: number[];
  requested_player_ids: number[];
  status: 'pending' | 'accepted' | 'rejected' | 'countered' | 'cancelled' | 'expired';
  message: string | null;
  created_at: string;
  expires_at: string | null;
  processed_at: string | null;
  counter_offer_id: string | null;
}

export interface TradeOfferWithPlayers extends TradeOffer {
  from_team_name: string;
  to_team_name: string;
  offered_players: any[];
  requested_players: any[];
}

export class TradeService {
  /**
   * Create a new trade proposal
   */
  static async createTradeOffer(
    leagueId: string,
    fromTeamId: string,
    toTeamId: string,
    offeredPlayerIds: number[],
    requestedPlayerIds: number[],
    message?: string
  ): Promise<{ success: boolean; error?: string; tradeId?: string }> {
    try {
      // Set expiration to 7 days from now
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const { data, error } = await supabase
        .from('trade_offers')
        .insert({
          league_id: leagueId,
          from_team_id: fromTeamId,
          to_team_id: toTeamId,
          offered_player_ids: offeredPlayerIds,
          requested_player_ids: requestedPlayerIds,
          status: 'pending',
          message: message || null,
          expires_at: expiresAt.toISOString()
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
        tradeId: data.id
      };
    } catch (error: any) {
      console.error('Error creating trade offer:', error);
      return {
        success: false,
        error: error.message || 'Failed to create trade offer'
      };
    }
  }

  /**
   * Accept a trade offer
   */
  static async acceptTradeOffer(tradeId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Get the trade offer details
      const { data: trade, error: fetchError } = await supabase
        .from('trade_offers')
        .select(COLUMNS.TRADE)
        .eq('id', tradeId)
        .eq('status', 'pending')
        .single();

      if (fetchError || !trade) {
        return {
          success: false,
          error: 'Trade offer not found or no longer pending'
        };
      }

      // Update trade status to accepted
      const { error: updateError } = await supabase
        .from('trade_offers')
        .update({
          status: 'accepted',
          processed_at: new Date().toISOString()
        })
        .eq('id', tradeId);

      if (updateError) {
        return {
          success: false,
          error: updateError.message
        };
      }

      // Execute the trade by swapping players in JSONB arrays
      // Get current lineups for both teams
      const { data: fromTeamLineup } = await supabase
        .from('team_lineups')
        .select('starters, bench, ir, slot_assignments')
        .eq('league_id', trade.league_id)
        .eq('team_id', trade.from_team_id)
        .single();

      const { data: toTeamLineup } = await supabase
        .from('team_lineups')
        .select('starters, bench, ir, slot_assignments')
        .eq('league_id', trade.league_id)
        .eq('team_id', trade.to_team_id)
        .single();

      if (!fromTeamLineup || !toTeamLineup) {
        return {
          success: false,
          error: 'Team lineups not found'
        };
      }

      // Helper function to remove players from JSONB arrays
      const removePlayers = (lineup: any, playerIds: number[]) => {
        const playerIdStrs = playerIds.map(id => id.toString());
        return {
          starters: ((lineup.starters as any[]) || []).filter(id => !playerIdStrs.includes(id)),
          bench: ((lineup.bench as any[]) || []).filter(id => !playerIdStrs.includes(id)),
          ir: ((lineup.ir as any[]) || []).filter(id => !playerIdStrs.includes(id)),
          slot_assignments: Object.fromEntries(
            Object.entries((lineup.slot_assignments as any) || {}).filter(([key]) => !playerIdStrs.includes(key))
          )
        };
      };

      // Helper function to add players to bench
      const addPlayersToBench = (lineup: any, playerIds: number[]) => {
        const newBench = [...(lineup.bench as any[]) || [], ...playerIds.map(id => id.toString())];
        return { ...lineup, bench: newBench };
      };

      // Remove offered players from fromTeam and add requested players
      let newFromTeamLineup = removePlayers(fromTeamLineup, trade.offered_player_ids);
      newFromTeamLineup = addPlayersToBench(newFromTeamLineup, trade.requested_player_ids);

      // Remove requested players from toTeam and add offered players
      let newToTeamLineup = removePlayers(toTeamLineup, trade.requested_player_ids);
      newToTeamLineup = addPlayersToBench(newToTeamLineup, trade.offered_player_ids);

      // Update both team lineups
      await supabase
        .from('team_lineups')
        .update({
          starters: newFromTeamLineup.starters,
          bench: newFromTeamLineup.bench,
          ir: newFromTeamLineup.ir,
          slot_assignments: newFromTeamLineup.slot_assignments,
          updated_at: new Date().toISOString()
        })
        .eq('league_id', trade.league_id)
        .eq('team_id', trade.from_team_id);

      await supabase
        .from('team_lineups')
        .update({
          starters: newToTeamLineup.starters,
          bench: newToTeamLineup.bench,
          ir: newToTeamLineup.ir,
          slot_assignments: newToTeamLineup.slot_assignments,
          updated_at: new Date().toISOString()
        })
        .eq('league_id', trade.league_id)
        .eq('team_id', trade.to_team_id);

      // Record in trade history
      await supabase
        .from('trade_history')
        .insert({
          league_id: trade.league_id,
          trade_offer_id: trade.id,
          team1_id: trade.from_team_id,
          team2_id: trade.to_team_id,
          team1_players: trade.offered_player_ids,
          team2_players: trade.requested_player_ids
        });

      return { success: true };
    } catch (error: any) {
      console.error('Error accepting trade:', error);
      return {
        success: false,
        error: error.message || 'Failed to accept trade'
      };
    }
  }

  /**
   * Reject a trade offer
   */
  static async rejectTradeOffer(tradeId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('trade_offers')
        .update({
          status: 'rejected',
          processed_at: new Date().toISOString()
        })
        .eq('id', tradeId)
        .eq('status', 'pending');

      if (error) {
        return {
          success: false,
          error: error.message
        };
      }

      return { success: true };
    } catch (error: any) {
      console.error('Error rejecting trade:', error);
      return {
        success: false,
        error: error.message || 'Failed to reject trade'
      };
    }
  }

  /**
   * Cancel a trade offer (by the proposer)
   */
  static async cancelTradeOffer(tradeId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('trade_offers')
        .update({
          status: 'cancelled',
          processed_at: new Date().toISOString()
        })
        .eq('id', tradeId)
        .eq('status', 'pending');

      if (error) {
        return {
          success: false,
          error: error.message
        };
      }

      return { success: true };
    } catch (error: any) {
      console.error('Error cancelling trade:', error);
      return {
        success: false,
        error: error.message || 'Failed to cancel trade'
      };
    }
  }

  /**
   * Get trade offers for a team (both sent and received)
   */
  static async getTeamTradeOffers(
    leagueId: string,
    teamId: string
  ): Promise<TradeOfferWithPlayers[]> {
    try {
      const { data: trades, error } = await supabase
        .from('trade_offers')
        .select(`
          *,
          from_team:teams!from_team_id(team_name),
          to_team:teams!to_team_id(team_name)
        `)
        .eq('league_id', leagueId)
        .or(`from_team_id.eq.${teamId},to_team_id.eq.${teamId}`)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      // Fetch player details for each trade using PlayerService
      const tradesWithPlayers = await Promise.all(
        (trades || []).map(async (trade) => {
          // Get offered players using PlayerService
          const offeredPlayerIds = (trade.offered_player_ids || []).map(String);
          const offeredPlayersRaw = await PlayerService.getPlayersByIds(offeredPlayerIds);
          const offeredPlayers = offeredPlayersRaw.map(p => ({
            player_id: Number(p.id),
            full_name: p.full_name,
            position_code: p.position,
            team_abbrev: p.team
          }));

          // Get requested players using PlayerService
          const requestedPlayerIds = (trade.requested_player_ids || []).map(String);
          const requestedPlayersRaw = await PlayerService.getPlayersByIds(requestedPlayerIds);
          const requestedPlayers = requestedPlayersRaw.map(p => ({
            player_id: Number(p.id),
            full_name: p.full_name,
            position_code: p.position,
            team_abbrev: p.team
          }));

          return {
            ...trade,
            from_team_name: (trade.from_team as any).team_name,
            to_team_name: (trade.to_team as any).team_name,
            offered_players: offeredPlayers,
            requested_players: requestedPlayers
          };
        })
      );

      return tradesWithPlayers;
    } catch (error) {
      console.error('Error fetching trade offers:', error);
      return [];
    }
  }

  /**
   * Get league trade history
   */
  static async getLeagueTradeHistory(leagueId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('trade_history')
        .select(`
          *,
          team1:teams!team1_id(team_name),
          team2:teams!team2_id(team_name)
        `)
        .eq('league_id', leagueId)
        .order('executed_at', { ascending: false })
        .limit(20);

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching trade history:', error);
      return [];
    }
  }
}

export default TradeService;

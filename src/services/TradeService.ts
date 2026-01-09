import { supabase } from '@/integrations/supabase/client';

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
        .select('*')
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

      // Execute the trade by swapping players
      // Remove offered players from fromTeam
      for (const playerId of trade.offered_player_ids) {
        await supabase
          .from('team_lineups')
          .delete()
          .eq('team_id', trade.from_team_id)
          .eq('league_id', trade.league_id)
          .eq('player_id', playerId);
      }

      // Remove requested players from toTeam
      for (const playerId of trade.requested_player_ids) {
        await supabase
          .from('team_lineups')
          .delete()
          .eq('team_id', trade.to_team_id)
          .eq('league_id', trade.league_id)
          .eq('player_id', playerId);
      }

      // Add offered players to toTeam
      for (const playerId of trade.offered_player_ids) {
        await supabase
          .from('team_lineups')
          .insert({
            team_id: trade.to_team_id,
            league_id: trade.league_id,
            player_id: playerId,
            roster_slot: 'BN'
          });
      }

      // Add requested players to fromTeam
      for (const playerId of trade.requested_player_ids) {
        await supabase
          .from('team_lineups')
          .insert({
            team_id: trade.from_team_id,
            league_id: trade.league_id,
            player_id: playerId,
            roster_slot: 'BN'
          });
      }

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
          from_team:teams!from_team_id(name),
          to_team:teams!to_team_id(name)
        `)
        .eq('league_id', leagueId)
        .or(`from_team_id.eq.${teamId},to_team_id.eq.${teamId}`)
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      // Fetch player details for each trade
      const tradesWithPlayers = await Promise.all(
        (trades || []).map(async (trade) => {
          // Get offered players
          const { data: offeredPlayers } = await supabase
            .from('player_directory')
            .select('id, first_name, last_name, position, current_team_abbrev')
            .in('id', trade.offered_player_ids);

          // Get requested players
          const { data: requestedPlayers } = await supabase
            .from('player_directory')
            .select('id, first_name, last_name, position, current_team_abbrev')
            .in('id', trade.requested_player_ids);

          return {
            ...trade,
            from_team_name: (trade.from_team as any).name,
            to_team_name: (trade.to_team as any).name,
            offered_players: offeredPlayers || [],
            requested_players: requestedPlayers || []
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
          team1:teams!team1_id(name),
          team2:teams!team2_id(name)
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

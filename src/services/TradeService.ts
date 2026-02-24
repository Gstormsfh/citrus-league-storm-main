import { supabase } from '@/integrations/supabase/client';
import { PlayerService } from './PlayerService';
import { LeagueMembershipService } from './LeagueMembershipService';
import { COLUMNS } from '@/utils/queryColumns';

export interface TradeOffer {
  id: string;
  league_id: string;
  from_team_id: string;
  to_team_id: string;
  offered_player_ids: number[];
  requested_player_ids: number[];
  status: 'pending' | 'accepted' | 'rejected' | 'countered' | 'cancelled' | 'expired' | 'under_review' | 'vetoed';
  message: string | null;
  created_at: string;
  expires_at: string | null;
  processed_at: string | null;
  counter_offer_id: string | null;
}

interface TradePlayerSummary {
  player_id: number;
  full_name: string;
  position_code: string;
  team_abbrev: string;
}

interface TeamLineup {
  starters: string[];
  bench: string[];
  ir: string[];
  slot_assignments: Record<string, string>;
}

export interface TradeOfferWithPlayers extends TradeOffer {
  from_team_name: string;
  to_team_name: string;
  offered_players: TradePlayerSummary[];
  requested_players: TradePlayerSummary[];
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
      // Best Ball leagues prohibit trades (industry standard: zero management after draft)
      // Also fetch settings for dynamic trade expiration (commissioner-configurable)
      const { data: league } = await supabase
        .from('leagues')
        .select('format_settings, settings')
        .eq('id', leagueId)
        .single();

      if (league?.format_settings?.bestBallEnabled) {
        return { success: false, error: 'Trades are not allowed in Best Ball leagues.' };
      }

      // Check trade deadline (also enforced by DB trigger, but give a friendly message)
      const tradeDeadlineWeek = (league?.settings as any)?.tradeDeadlineWeek ?? 0;
      if (tradeDeadlineWeek > 0) {
        const { data: latestMatchup } = await supabase
          .from('matchups')
          .select('week_number')
          .eq('league_id', leagueId)
          .in('status', ['in_progress', 'completed'])
          .order('week_number', { ascending: false })
          .limit(1)
          .maybeSingle();
        const currentWeek = latestMatchup?.week_number ?? 0;
        if (currentWeek >= tradeDeadlineWeek) {
          return { success: false, error: `The trade deadline has passed (Week ${tradeDeadlineWeek}). No new trades allowed.` };
        }
      }

      // Trade expiration: read from league settings (commissioner-configurable), default 7 days
      const tradeExpirationDays = (league?.settings as any)?.tradeExpirationDays ?? 7;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + tradeExpirationDays);

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
    } catch (error: unknown) {
      console.error('Error creating trade offer:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Accept a trade offer - validates that the accepting user owns the to_team
   */
  static async acceptTradeOffer(tradeId: string, userId?: string): Promise<{ success: boolean; error?: string }> {
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

      // Validate that the accepting user owns the to_team
      if (userId) {
        const { data: toTeam } = await supabase
          .from('teams')
          .select('owner_id')
          .eq('id', trade.to_team_id)
          .eq('league_id', trade.league_id)
          .single();

        if (!toTeam || toTeam.owner_id !== userId) {
          return {
            success: false,
            error: 'You can only accept trades sent to your team'
          };
        }
      }

      // Check if league requires trade review before execution
      const { data: league } = await supabase
        .from('leagues')
        .select('trade_review_type, trade_review_period_hours')
        .eq('id', trade.league_id)
        .single();

      const reviewType = league?.trade_review_type || 'none';

      if (reviewType !== 'none') {
        // Route through review process instead of immediate execution
        const reviewResult = await this.submitTradeForReview(tradeId, trade.league_id);
        if (!reviewResult.success) {
          return { success: false, error: reviewResult.error };
        }
        return {
          success: true,
          error: reviewType === 'commissioner'
            ? 'Trade accepted — awaiting commissioner approval.'
            : `Trade accepted — under league review for ${league?.trade_review_period_hours || 48} hours.`
        };
      }

      // No review required — execute immediately
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

      // ===== EXECUTE THE TRADE =====
      // 1. Update roster_assignments (source of truth for player ownership)
      const now = new Date().toISOString();

      // Transfer offered players: from_team -> to_team (single batch query)
      if (trade.offered_player_ids.length > 0) {
        await supabase
          .from('roster_assignments')
          .update({ team_id: trade.to_team_id, updated_at: now })
          .eq('league_id', trade.league_id)
          .eq('team_id', trade.from_team_id)
          .in('player_id', trade.offered_player_ids.map(String));
      }

      // Transfer requested players: to_team -> from_team (single batch query)
      if (trade.requested_player_ids.length > 0) {
        await supabase
          .from('roster_assignments')
          .update({ team_id: trade.from_team_id, updated_at: now })
          .eq('league_id', trade.league_id)
          .eq('team_id', trade.to_team_id)
          .in('player_id', trade.requested_player_ids.map(String));
      }

      // 2. Update team_lineups (display layer - starters/bench/IR)
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

      if (fromTeamLineup && toTeamLineup) {
        const removePlayers = (lineup: TeamLineup, playerIds: number[]): TeamLineup => {
          const playerIdStrs = playerIds.map(id => id.toString());
          return {
            starters: (lineup.starters || []).filter((id: string) => !playerIdStrs.includes(id)),
            bench: (lineup.bench || []).filter((id: string) => !playerIdStrs.includes(id)),
            ir: (lineup.ir || []).filter((id: string) => !playerIdStrs.includes(id)),
            slot_assignments: Object.fromEntries(
              Object.entries(lineup.slot_assignments || {}).filter(([key]) => !playerIdStrs.includes(key))
            )
          };
        };

        const addPlayersToBench = (lineup: TeamLineup, playerIds: number[]): TeamLineup => {
          const newBench = [...(lineup.bench || []), ...playerIds.map(id => id.toString())];
          return { ...lineup, bench: newBench };
        };

        let newFromTeamLineup = removePlayers(fromTeamLineup, trade.offered_player_ids);
        newFromTeamLineup = addPlayersToBench(newFromTeamLineup, trade.requested_player_ids);

        let newToTeamLineup = removePlayers(toTeamLineup, trade.requested_player_ids);
        newToTeamLineup = addPlayersToBench(newToTeamLineup, trade.offered_player_ids);

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
      }

      // 3. Log transactions in transaction_ledger
      const txnEntries = [
        ...trade.offered_player_ids.map((pid: number) => ({
          league_id: trade.league_id,
          team_id: trade.from_team_id,
          player_id: String(pid),
          type: 'TRADE',
          created_at: now
        })),
        ...trade.offered_player_ids.map((pid: number) => ({
          league_id: trade.league_id,
          team_id: trade.to_team_id,
          player_id: String(pid),
          type: 'TRADE',
          created_at: now
        })),
        ...trade.requested_player_ids.map((pid: number) => ({
          league_id: trade.league_id,
          team_id: trade.to_team_id,
          player_id: String(pid),
          type: 'TRADE',
          created_at: now
        })),
        ...trade.requested_player_ids.map((pid: number) => ({
          league_id: trade.league_id,
          team_id: trade.from_team_id,
          player_id: String(pid),
          type: 'TRADE',
          created_at: now
        }))
      ];

      // Best-effort logging — don't fail the trade if ledger insert fails
      await supabase.from('transaction_ledger').insert(txnEntries).catch(() => {});

      // 4. Record in trade history
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
    } catch (error: unknown) {
      console.error('Error accepting trade:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Reject a trade offer - validates that the rejecting user owns the to_team
   */
  static async rejectTradeOffer(tradeId: string, userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate ownership if userId provided
      if (userId) {
        const { data: trade } = await supabase
          .from('trade_offers')
          .select('to_team_id, league_id')
          .eq('id', tradeId)
          .eq('status', 'pending')
          .single();

        if (trade) {
          const { data: toTeam } = await supabase
            .from('teams')
            .select('owner_id')
            .eq('id', trade.to_team_id)
            .eq('league_id', trade.league_id)
            .single();

          if (!toTeam || toTeam.owner_id !== userId) {
            return { success: false, error: 'You can only reject trades sent to your team' };
          }
        }
      }

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
    } catch (error: unknown) {
      console.error('Error rejecting trade:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Cancel a trade offer (by the proposer) - validates that the canceller owns the from_team
   */
  static async cancelTradeOffer(tradeId: string, userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate ownership if userId provided
      if (userId) {
        const { data: trade } = await supabase
          .from('trade_offers')
          .select('from_team_id, league_id')
          .eq('id', tradeId)
          .eq('status', 'pending')
          .single();

        if (trade) {
          const { data: fromTeam } = await supabase
            .from('teams')
            .select('owner_id')
            .eq('id', trade.from_team_id)
            .eq('league_id', trade.league_id)
            .single();

          if (!fromTeam || fromTeam.owner_id !== userId) {
            return { success: false, error: 'You can only cancel trades you proposed' };
          }
        }
      }

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
    } catch (error: unknown) {
      console.error('Error cancelling trade:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
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
  // ============================================================================
  // TRADE VETO / VOTING SYSTEM
  // ============================================================================

  /**
   * Submit a trade to the league review process.
   * Based on the league's trade_review_type setting (commissioner-configured):
   *   - 'none': Trade executes immediately (default)
   *   - 'commissioner': Commissioner must approve
   *   - 'league_vote': League members vote, majority can veto
   *
   * The review period (hours) and veto threshold (fraction) are both
   * commissioner-configurable in league settings.
   */
  static async submitTradeForReview(
    tradeId: string,
    leagueId: string
  ): Promise<{ success: boolean; reviewType: string; error?: string }> {
    try {
      // Get league review settings (commissioner-configured)
      const { data: league } = await supabase
        .from('leagues')
        .select('trade_review_type, trade_review_period_hours')
        .eq('id', leagueId)
        .single();

      const reviewType = league?.trade_review_type || 'none';

      if (reviewType === 'none') {
        return { success: true, reviewType: 'none' };
      }

      // Set trade to under_review with dynamic review period from league settings
      const reviewPeriodHours = league?.trade_review_period_hours || 48;
      const reviewEndsAt = new Date();
      reviewEndsAt.setHours(reviewEndsAt.getHours() + reviewPeriodHours);

      const { error } = await supabase
        .from('trade_offers')
        .update({
          status: 'under_review',
          review_started_at: new Date().toISOString(),
          review_ends_at: reviewEndsAt.toISOString(),
        })
        .eq('id', tradeId);

      if (error) {
        return { success: false, reviewType, error: error.message };
      }

      // Notify league members about the pending trade review
      try {
        await supabase.rpc('notify_league_members', {
          p_league_id: leagueId,
          p_title: 'Trade Under Review',
          p_message: `A trade has been submitted for league review. ${reviewType === 'commissioner' ? 'The commissioner will review.' : `League vote open for ${reviewPeriodHours} hours.`}`,
          p_notification_type: 'SYSTEM',
        });
      } catch {
        // Non-critical
      }

      return { success: true, reviewType };
    } catch (error: unknown) {
      console.error('Error submitting trade for review:', error);
      return {
        success: false,
        reviewType: 'unknown',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Submit a vote on a trade under review.
   * Only eligible for league_vote review type.
   * Cannot vote on your own trade.
   *
   * Veto threshold is commissioner-configurable (default: 50% majority).
   */
  static async submitTradeVote(
    tradeOfferId: string,
    voterTeamId: string,
    vote: 'approve' | 'veto'
  ): Promise<{
    success: boolean;
    vetoCount: number;
    approveCount: number;
    votesNeeded: number;
    isVetoed: boolean;
    error?: string;
  }> {
    try {
      const { data, error } = await supabase.rpc('submit_trade_vote', {
        p_trade_offer_id: tradeOfferId,
        p_voter_team_id: voterTeamId,
        p_vote: vote,
      });

      if (error) throw error;

      const result = data?.[0] || data;
      return {
        success: result?.success ?? false,
        vetoCount: result?.veto_count ?? 0,
        approveCount: result?.approve_count ?? 0,
        votesNeeded: result?.votes_needed ?? 0,
        isVetoed: result?.is_vetoed ?? false,
        error: result?.success ? undefined : (result?.message || 'Unknown error'),
      };
    } catch (error: unknown) {
      console.error('Error submitting trade vote:', error);
      return {
        success: false,
        vetoCount: 0,
        approveCount: 0,
        votesNeeded: 0,
        isVetoed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get all votes for a specific trade.
   */
  static async getTradeVotes(
    tradeOfferId: string
  ): Promise<{
    votes: Array<{ voterTeamId: string; vote: 'approve' | 'veto'; createdAt: string }>;
    error?: string;
  }> {
    try {
      const { data, error } = await supabase
        .from('trade_votes')
        .select('voter_team_id, vote, created_at')
        .eq('trade_offer_id', tradeOfferId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      return {
        votes: (data || []).map((v: any) => ({
          voterTeamId: v.voter_team_id,
          vote: v.vote,
          createdAt: v.created_at,
        })),
      };
    } catch (error: unknown) {
      console.error('Error fetching trade votes:', error);
      return { votes: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Commissioner: approve or veto a trade directly.
   * Only works for 'commissioner' review type trades.
   */
  static async commissionerDecision(
    tradeId: string,
    leagueId: string,
    decision: 'approve' | 'veto',
    commissionerId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: league } = await supabase
        .from('leagues')
        .select('commissioner_id, trade_review_type')
        .eq('id', leagueId)
        .single();

      if (!league || league.commissioner_id !== commissionerId) {
        return { success: false, error: 'Only the commissioner can make this decision' };
      }

      if (league.trade_review_type !== 'commissioner') {
        return { success: false, error: 'League is not configured for commissioner review' };
      }

      if (decision === 'approve') {
        const { error } = await supabase
          .from('trade_offers')
          .update({ status: 'accepted', processed_at: new Date().toISOString() })
          .eq('id', tradeId)
          .eq('status', 'under_review');

        if (error) return { success: false, error: error.message };
        return await this.acceptTradeOffer(tradeId);
      } else {
        const { error } = await supabase
          .from('trade_offers')
          .update({
            status: 'vetoed',
            vetoed_at: new Date().toISOString(),
            processed_at: new Date().toISOString(),
          })
          .eq('id', tradeId)
          .eq('status', 'under_review');

        if (error) return { success: false, error: error.message };

        try {
          await supabase.rpc('notify_league_members', {
            p_league_id: leagueId,
            p_title: 'Trade Vetoed',
            p_message: 'A trade has been vetoed by the commissioner.',
            p_notification_type: 'SYSTEM',
          });
        } catch {
          // Non-critical
        }

        return { success: true };
      }
    } catch (error: unknown) {
      console.error('Error on commissioner decision:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Get trade review settings for a league (commissioner-configured).
   */
  static async getTradeReviewSettings(
    leagueId: string
  ): Promise<{
    reviewType: string;
    reviewPeriodHours: number;
    vetoThreshold: number;
    error?: string;
  }> {
    try {
      const { data, error } = await supabase
        .from('leagues')
        .select('trade_review_type, trade_review_period_hours, trade_veto_threshold')
        .eq('id', leagueId)
        .single();

      if (error) throw error;

      return {
        reviewType: data?.trade_review_type || 'none',
        reviewPeriodHours: data?.trade_review_period_hours || 48,
        vetoThreshold: data?.trade_veto_threshold || 0.5,
      };
    } catch (error: unknown) {
      return {
        reviewType: 'none',
        reviewPeriodHours: 48,
        vetoThreshold: 0.5,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Commissioner: update trade review settings for the league.
   * Sends notification to all league members about the settings change.
   */
  static async updateTradeReviewSettings(
    leagueId: string,
    commissionerId: string,
    settings: {
      trade_review_type: 'none' | 'commissioner' | 'league_vote';
      trade_review_period_hours: number;
      trade_veto_threshold: number;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: league } = await supabase
        .from('leagues')
        .select('commissioner_id')
        .eq('id', leagueId)
        .single();

      if (!league || league.commissioner_id !== commissionerId) {
        return { success: false, error: 'Only the commissioner can update trade settings' };
      }

      const { error } = await supabase
        .from('leagues')
        .update({
          trade_review_type: settings.trade_review_type,
          trade_review_period_hours: settings.trade_review_period_hours,
          trade_veto_threshold: settings.trade_veto_threshold,
        })
        .eq('id', leagueId);

      if (error) throw error;

      // Notify league about the settings change
      const reviewLabels: Record<string, string> = {
        none: 'Instant (no review)',
        commissioner: 'Commissioner review',
        league_vote: `League vote (${Math.round(settings.trade_veto_threshold * 100)}% to veto, ${settings.trade_review_period_hours}h window)`,
      };

      try {
        await supabase.rpc('notify_league_members', {
          p_league_id: leagueId,
          p_title: 'Trade Review Settings Updated',
          p_message: `Trade review changed to: ${reviewLabels[settings.trade_review_type] || settings.trade_review_type}`,
          p_notification_type: 'SYSTEM',
        });
      } catch {
        // Non-critical
      }

      return { success: true };
    } catch (error: unknown) {
      console.error('Error updating trade review settings:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export default TradeService;

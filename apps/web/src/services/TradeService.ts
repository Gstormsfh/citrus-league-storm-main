import { tradeApi } from '@/api/trades';
import { accountApi } from '@/api/account';
import { apiClient } from '@/api/client';
import { logger } from '@/utils/logger';

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
  review_type: 'none' | 'commissioner' | 'league_vote' | null;
  review_started_at: string | null;
  review_ends_at: string | null;
  vetoed_at: string | null;
}

interface TradePlayerSummary {
  player_id: number;
  full_name: string;
  position_code: string;
  team_abbrev: string;
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
    message?: string,
    _userId?: string
  ): Promise<{ success: boolean; error?: string; tradeId?: string }> {
    try {
      const result = await tradeApi.createTradeOffer(leagueId, {
        fromTeamId,
        toTeamId,
        offeredPlayerIds: offeredPlayerIds.map(String),
        requestedPlayerIds: requestedPlayerIds.map(String),
        message,
      });

      if (result.error) {
        return { success: false, error: result.error };
      }

      const tradeId = result.data?.id || result.data?.tradeId;

      accountApi.logSecurityEvent('TRADE_OFFER', leagueId, {
        tradeId, fromTeamId, toTeamId,
        offeredPlayerIds, requestedPlayerIds,
      }).catch(() => { /* non-critical */ });

      return { success: true, tradeId };
    } catch (error: unknown) {
      logger.error('Error creating trade offer:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Accept a trade offer — server handles ownership validation, roster checks,
   * review routing, trade execution (RPC), and lineup updates.
   */
  static async acceptTradeOffer(tradeId: string, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await tradeApi.acceptTrade(tradeId);

      if (result.error) {
        return { success: false, error: result.error };
      }

      accountApi.logSecurityEvent('TRADE_ACCEPT', null, { tradeId }).catch(() => { /* non-critical */ });

      // Server may return a message for review-routed trades
      if (result.data?.message) {
        return { success: true, error: result.data.message };
      }

      return { success: true };
    } catch (error: unknown) {
      logger.error('Error accepting trade:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Reject a trade offer — server validates ownership
   */
  static async rejectTradeOffer(tradeId: string, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await tradeApi.rejectTrade(tradeId);

      if (result.error) {
        return { success: false, error: result.error };
      }

      accountApi.logSecurityEvent('TRADE_REJECT', null, { tradeId }).catch(() => { /* non-critical */ });

      return { success: true };
    } catch (error: unknown) {
      logger.error('Error rejecting trade:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Cancel a trade offer (by the proposer) — server validates ownership
   */
  static async cancelTradeOffer(tradeId: string, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await tradeApi.cancelTrade(tradeId);

      if (result.error) {
        return { success: false, error: result.error };
      }

      return { success: true };
    } catch (error: unknown) {
      logger.error('Error cancelling trade:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get trade offers for a team (both sent and received).
   * Server handles membership checks. Filters client-side by teamId.
   */
  static async getTeamTradeOffers(
    leagueId: string,
    teamId: string,
    _userId?: string
  ): Promise<TradeOfferWithPlayers[]> {
    try {
      const result = await tradeApi.getLeagueTrades(leagueId);

      if (result.error || !result.data) {
        logger.error('[TradeService] getTeamTradeOffers error:', result.error);
        return [];
      }

      const trades = result.data as TradeOfferWithPlayers[];

      // Filter to trades involving this team
      return trades.filter(
        (t) => t.from_team_id === teamId || t.to_team_id === teamId
      );
    } catch (error) {
      logger.error('Error fetching trade offers:', error);
      return [];
    }
  }

  /**
   * Get league trade history.
   * Server handles membership checks.
   */
  static async getLeagueTradeHistory(leagueId: string, _userId?: string): Promise<Record<string, unknown>[]> {
    try {
      const result = await tradeApi.getLeagueTrades(leagueId);

      if (result.error || !result.data) {
        logger.error('[TradeService] getLeagueTradeHistory error:', result.error);
        return [];
      }

      return result.data as Record<string, unknown>[];
    } catch (error) {
      logger.error('Error fetching trade history:', error);
      return [];
    }
  }

  // ============================================================================
  // TRADE VETO / VOTING SYSTEM
  // ============================================================================

  /**
   * Submit a trade to the league review process.
   * Now handled server-side during accept — this is a no-op thin wrapper
   * kept for backward compatibility.
   */
  static async submitTradeForReview(
    tradeId: string,
    _leagueId: string
  ): Promise<{ success: boolean; reviewType: string; error?: string }> {
    // The server handles review routing during acceptTrade.
    // This method is retained for any callers that invoke it directly.
    try {
      const result = await tradeApi.acceptTrade(tradeId);

      if (result.error) {
        return { success: false, reviewType: 'unknown', error: result.error };
      }

      return {
        success: true,
        reviewType: result.data?.reviewType || 'none',
      };
    } catch (error: unknown) {
      logger.error('Error submitting trade for review:', error);
      return {
        success: false,
        reviewType: 'unknown',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Submit a vote on a trade under review.
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
      const result = await tradeApi.submitVote(tradeOfferId, {
        voterTeamId,
        vote,
      });

      if (result.error) {
        return {
          success: false,
          vetoCount: 0,
          approveCount: 0,
          votesNeeded: 0,
          isVetoed: false,
          error: result.error,
        };
      }

      const data = result.data || {};
      return {
        success: data.success ?? true,
        vetoCount: data.vetoCount ?? data.veto_count ?? 0,
        approveCount: data.approveCount ?? data.approve_count ?? 0,
        votesNeeded: data.votesNeeded ?? data.votes_needed ?? 0,
        isVetoed: data.isVetoed ?? data.is_vetoed ?? false,
        error: data.success === false ? (data.message || 'Unknown error') : undefined,
      };
    } catch (error: unknown) {
      logger.error('Error submitting trade vote:', error);
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
      const result = await tradeApi.getVotes(tradeOfferId);

      if (result.error) {
        return { votes: [], error: result.error };
      }

      const votes = (result.data || []).map((v: { voter_team_id?: string; voterTeamId?: string; vote: 'approve' | 'veto'; created_at?: string; createdAt?: string }) => ({
        voterTeamId: v.voterTeamId || v.voter_team_id || '',
        vote: v.vote,
        createdAt: v.createdAt || v.created_at || '',
      }));

      return { votes };
    } catch (error: unknown) {
      logger.error('Error fetching trade votes:', error);
      return { votes: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Commissioner: approve or veto a trade directly.
   */
  static async commissionerDecision(
    tradeId: string,
    leagueId: string,
    decision: 'approve' | 'veto',
    _commissionerId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await tradeApi.commissionerDecision(tradeId, {
        leagueId,
        decision,
      });

      if (result.error) {
        return { success: false, error: result.error };
      }

      return { success: true };
    } catch (error: unknown) {
      logger.error('Error on commissioner decision:', error);
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
      const result = await tradeApi.getReviewSettings(leagueId);

      if (result.error) {
        return {
          reviewType: 'none',
          reviewPeriodHours: 48,
          vetoThreshold: 0.5,
          error: result.error,
        };
      }

      const data = result.data || {};
      return {
        reviewType: data.reviewType ?? data.trade_review_type ?? 'none',
        reviewPeriodHours: data.reviewPeriodHours ?? data.trade_review_period_hours ?? 48,
        vetoThreshold: data.vetoThreshold ?? data.trade_veto_threshold ?? 0.5,
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
   */
  static async updateTradeReviewSettings(
    leagueId: string,
    _commissionerId: string,
    settings: {
      trade_review_type: 'none' | 'commissioner' | 'league_vote';
      trade_review_period_hours: number;
      trade_veto_threshold: number;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await apiClient.put(`/api/trades/league/${leagueId}/review-settings`, settings);

      if (result.error) {
        return { success: false, error: result.error };
      }

      return { success: true };
    } catch (error: unknown) {
      logger.error('Error updating trade review settings:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export default TradeService;

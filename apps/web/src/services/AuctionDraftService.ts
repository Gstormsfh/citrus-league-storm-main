/**
 * AuctionDraftService — Full bidding system for Auction-style drafts.
 *
 * Auction drafts work differently from snake/linear:
 *   1. Each team has a salary budget (e.g., $200).
 *   2. Teams take turns nominating a player.
 *   3. All teams can bid on the nominated player.
 *   4. Highest bidder wins the player; the bid amount is deducted from budget.
 *   5. Draft ends when all roster spots are filled or no budget remains.
 *
 * All database operations are now handled server-side via the API.
 */

import { auctionApi } from '@/api/auction';
import { logger } from '@/utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface AuctionBudget {
  id?: string;
  league_id: string;
  team_id: string;
  initial_budget: number;
  remaining_budget: number;
  players_won: number;
  updated_at?: string;
}

export interface AuctionNomination {
  id?: string;
  league_id: string;
  draft_session_id: string;
  nominated_by_team_id: string;
  player_id: string;
  player_name: string;
  minimum_bid: number;
  current_high_bid: number;
  current_high_bidder_team_id: string | null;
  status: 'active' | 'sold' | 'no_sale';
  nomination_number: number;
  expires_at: string;
  created_at?: string;
}

export interface AuctionBid {
  id?: string;
  league_id: string;
  nomination_id: string;
  team_id: string;
  bid_amount: number;
  created_at?: string;
}

export interface AuctionState {
  league_id: string;
  session_id: string;
  current_nomination: AuctionNomination | null;
  nomination_order: string[];    // team IDs in nomination order
  current_nominator_index: number;
  budgets: AuctionBudget[];
  is_complete: boolean;
  total_nominations: number;
}

// ============================================================================
// Service
// ============================================================================

export class AuctionDraftService {
  /**
   * Initialize auction budgets for all teams in a league.
   * Called when the draft session starts.
   */
  static async initializeAuction(
    leagueId: string,
    sessionId: string,
    teamIds: string[],
    budget: number = 200,
    minBid: number = 1
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await auctionApi.initializeAuction(leagueId, {
        sessionId,
        teamIds,
        budget,
        minBid,
      });

      if (response.error) {
        return { success: false, error: response.error };
      }

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[AuctionDraftService] initializeAuction error:', msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Get current auction state for a league draft.
   */
  static async getAuctionState(
    leagueId: string,
    sessionId: string
  ): Promise<AuctionState | null> {
    try {
      const response = await auctionApi.getAuctionState(leagueId, sessionId);

      if (response.error) {
        logger.error('[AuctionDraftService] getAuctionState error:', response.error);
        return null;
      }

      return response.data as AuctionState | null;
    } catch (err) {
      logger.error('[AuctionDraftService] getAuctionState error:', err);
      return null;
    }
  }

  /**
   * Nominate a player for bidding.
   * Only the team whose turn it is can nominate (validated server-side).
   */
  static async nominatePlayer(
    leagueId: string,
    sessionId: string,
    teamId: string,
    playerId: string,
    playerName: string,
    openingBid: number = 1,
    nominationTimerSeconds: number = 30
  ): Promise<{ success: boolean; nomination?: AuctionNomination; error?: string }> {
    try {
      const response = await auctionApi.nominatePlayer(leagueId, {
        sessionId,
        teamId,
        playerId,
        playerName,
        openingBid,
        timerSeconds: nominationTimerSeconds,
      });

      if (response.error) {
        return { success: false, error: response.error };
      }

      return { success: true, nomination: response.data as AuctionNomination };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[AuctionDraftService] nominatePlayer error:', msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Place a bid on the current nomination.
   * Bid validation (amount, budget, reserve) is handled server-side.
   */
  static async placeBid(
    leagueId: string,
    nominationId: string,
    teamId: string,
    bidAmount: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await auctionApi.placeBid(leagueId, {
        nominationId,
        teamId,
        bidAmount,
      });

      if (response.error) {
        return { success: false, error: response.error };
      }

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[AuctionDraftService] placeBid error:', msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Close the current nomination — award the player to the highest bidder.
   * Called when the nomination timer expires. All logic handled server-side.
   */
  static async closeNomination(
    leagueId: string,
    sessionId: string,
    nominationId: string
  ): Promise<{ success: boolean; winner_team_id?: string; amount?: number; error?: string }> {
    try {
      const response = await auctionApi.closeNomination(leagueId, {
        sessionId,
        nominationId,
      });

      if (response.error) {
        return { success: false, error: response.error };
      }

      const data = response.data as { winner_team_id?: string; amount?: number } | null;
      return {
        success: true,
        winner_team_id: data?.winner_team_id,
        amount: data?.amount,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[AuctionDraftService] closeNomination error:', msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Get bid history for a nomination.
   */
  static async getBidHistory(nominationId: string): Promise<AuctionBid[]> {
    try {
      const response = await auctionApi.getBidHistory(nominationId);

      if (response.error) {
        throw new Error(response.error);
      }

      return (response.data ?? []) as AuctionBid[];
    } catch (err) {
      logger.error('[AuctionDraftService] getBidHistory error:', err);
      return [];
    }
  }

  /**
   * Auto-nominate for a team when their nomination timer expires.
   * Auto-pick logic (selecting highest-ranked available player) is handled server-side.
   */
  static async autoNominate(
    leagueId: string,
    sessionId: string,
    teamId: string,
    nominationTimerSeconds: number = 30
  ): Promise<{ success: boolean; nomination?: AuctionNomination; error?: string }> {
    try {
      const response = await auctionApi.nominatePlayer(leagueId, {
        sessionId,
        teamId,
        playerId: '__auto__',
        playerName: '',
        openingBid: 1,
        timerSeconds: nominationTimerSeconds,
      });

      if (response.error) {
        return { success: false, error: response.error };
      }

      return { success: true, nomination: response.data as AuctionNomination };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[AuctionDraftService] autoNominate error:', msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Get all budgets for a league auction.
   */
  static async getAuctionBudgets(leagueId: string): Promise<AuctionBudget[]> {
    try {
      const response = await auctionApi.getAuctionBudgets(leagueId);

      if (response.error) {
        throw new Error(response.error);
      }

      return (response.data ?? []) as AuctionBudget[];
    } catch (err) {
      logger.error('[AuctionDraftService] getAuctionBudgets error:', err);
      return [];
    }
  }
}

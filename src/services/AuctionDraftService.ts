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
 * Tables used:
 *   - auction_state       — current nomination, timer, and turn order
 *   - auction_bids        — individual bids placed per nomination
 *   - auction_budgets     — per-team budget tracking
 *   - draft_picks         — final assignments (reuses existing table)
 */

import { supabase } from '@/integrations/supabase/client';
import { CURRENT_SEASON } from '@/utils/seasonConstants';

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
      // Create budget entries for each team
      const budgetRows = teamIds.map(tid => ({
        league_id: leagueId,
        team_id: tid,
        initial_budget: budget,
        remaining_budget: budget,
        players_won: 0,
      }));

      const { error: budgetErr } = await supabase
        .from('auction_budgets')
        .upsert(budgetRows, { onConflict: 'league_id,team_id' });

      if (budgetErr) return { success: false, error: budgetErr.message };

      // Store auction state metadata in the draft session settings
      const { error: sessionErr } = await supabase
        .from('draft_sessions')
        .update({
          settings: {
            draft_type: 'auction',
            budget,
            min_bid: minBid,
            nomination_order: teamIds,
            current_nominator_index: 0,
            total_nominations: 0,
          },
        })
        .eq('id', sessionId);

      if (sessionErr) return { success: false, error: sessionErr.message };

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AuctionDraftService] initializeAuction error:', msg);
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
      // Get session settings
      const { data: session } = await supabase
        .from('draft_sessions')
        .select('settings')
        .eq('id', sessionId)
        .single();

      if (!session) return null;

      const settings = session.settings as any;

      // Get all budgets
      const { data: budgets } = await supabase
        .from('auction_budgets')
        .select('*')
        .eq('league_id', leagueId)
        .order('remaining_budget', { ascending: false });

      // Get current active nomination (if any)
      const { data: activeNom } = await supabase
        .from('auction_nominations')
        .select('*')
        .eq('league_id', leagueId)
        .eq('draft_session_id', sessionId)
        .eq('status', 'active')
        .maybeSingle();

      return {
        league_id: leagueId,
        session_id: sessionId,
        current_nomination: activeNom as AuctionNomination | null,
        nomination_order: settings?.nomination_order ?? [],
        current_nominator_index: settings?.current_nominator_index ?? 0,
        budgets: (budgets ?? []) as AuctionBudget[],
        is_complete: false,
        total_nominations: settings?.total_nominations ?? 0,
      };
    } catch (err) {
      console.error('[AuctionDraftService] getAuctionState error:', err);
      return null;
    }
  }

  /**
   * Nominate a player for bidding.
   * Only the team whose turn it is can nominate.
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
      // Verify it's this team's turn
      const state = await this.getAuctionState(leagueId, sessionId);
      if (!state) return { success: false, error: 'Auction state not found' };

      const currentNominator = state.nomination_order[state.current_nominator_index];
      if (currentNominator !== teamId) {
        return { success: false, error: 'It is not your turn to nominate.' };
      }

      // Check there's no active nomination
      if (state.current_nomination) {
        return { success: false, error: 'A nomination is already active.' };
      }

      // Check player isn't already drafted
      const { data: existing } = await supabase
        .from('draft_picks')
        .select('id')
        .eq('league_id', leagueId)
        .eq('player_id', playerId)
        .is('deleted_at', null)
        .maybeSingle();

      if (existing) return { success: false, error: 'This player has already been drafted.' };

      const expiresAt = new Date(Date.now() + nominationTimerSeconds * 1000).toISOString();

      const { data: nom, error } = await supabase
        .from('auction_nominations')
        .insert({
          league_id: leagueId,
          draft_session_id: sessionId,
          nominated_by_team_id: teamId,
          player_id: playerId,
          player_name: playerName,
          minimum_bid: openingBid,
          current_high_bid: openingBid,
          current_high_bidder_team_id: teamId,
          status: 'active',
          nomination_number: state.total_nominations + 1,
          expires_at: expiresAt,
        })
        .select()
        .single();

      if (error) return { success: false, error: error.message };

      // Record the opening bid
      await supabase.from('auction_bids').insert({
        league_id: leagueId,
        nomination_id: nom.id,
        team_id: teamId,
        bid_amount: openingBid,
      });

      // Update nomination count
      const sessionSettings = (await supabase
        .from('draft_sessions')
        .select('settings')
        .eq('id', sessionId)
        .single()).data?.settings as any;

      await supabase
        .from('draft_sessions')
        .update({
          settings: {
            ...sessionSettings,
            total_nominations: (sessionSettings?.total_nominations ?? 0) + 1,
          },
        })
        .eq('id', sessionId);

      return { success: true, nomination: nom as AuctionNomination };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AuctionDraftService] nominatePlayer error:', msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Place a bid on the current nomination.
   * Bid must be higher than current high bid and within team's budget.
   */
  static async placeBid(
    leagueId: string,
    nominationId: string,
    teamId: string,
    bidAmount: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get current nomination
      const { data: nom } = await supabase
        .from('auction_nominations')
        .select('*')
        .eq('id', nominationId)
        .eq('status', 'active')
        .single();

      if (!nom) return { success: false, error: 'Nomination not found or already closed.' };

      // Check bid is higher
      if (bidAmount <= nom.current_high_bid) {
        return { success: false, error: `Bid must be higher than current bid of $${nom.current_high_bid}.` };
      }

      // Check team's budget
      const { data: budget } = await supabase
        .from('auction_budgets')
        .select('remaining_budget, players_won')
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .single();

      if (!budget) return { success: false, error: 'Budget not found.' };

      // Need to reserve $1 per remaining roster spot
      // (to ensure team can fill remaining spots with min bids)
      const { data: league } = await supabase
        .from('leagues')
        .select('roster_size')
        .eq('id', leagueId)
        .single();

      const rosterSize = league?.roster_size ?? 21;
      const slotsRemaining = rosterSize - budget.players_won - 1; // -1 for this player
      const reserveNeeded = Math.max(0, slotsRemaining); // $1 per remaining slot
      const maxBid = budget.remaining_budget - reserveNeeded;

      if (bidAmount > maxBid) {
        return { success: false, error: `Maximum bid is $${maxBid} (budget: $${budget.remaining_budget}, reserve: $${reserveNeeded}).` };
      }

      // Place the bid
      const { error: bidErr } = await supabase.from('auction_bids').insert({
        league_id: leagueId,
        nomination_id: nominationId,
        team_id: teamId,
        bid_amount: bidAmount,
      });

      if (bidErr) return { success: false, error: bidErr.message };

      // Update the nomination's current high bid
      // Anti-sniping: only extend timer if bid placed in last 10 seconds (ESPN/Yahoo standard)
      const updateFields: Record<string, unknown> = {
        current_high_bid: bidAmount,
        current_high_bidder_team_id: teamId,
      };

      // Check if within last 10 seconds — if so, extend to 15 seconds
      if (nom.expires_at) {
        const expiresAt = new Date(nom.expires_at).getTime();
        const now = Date.now();
        const remainingMs = expiresAt - now;
        if (remainingMs <= 10000) {
          // Anti-snipe: extend by 15 seconds from now
          updateFields.expires_at = new Date(now + 15000).toISOString();
        }
        // If more than 10s remaining, keep original expiration
      }

      const { error: updateErr } = await supabase
        .from('auction_nominations')
        .update(updateFields)
        .eq('id', nominationId);

      if (updateErr) return { success: false, error: updateErr.message };

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AuctionDraftService] placeBid error:', msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Close the current nomination — award the player to the highest bidder.
   * Called when the nomination timer expires.
   */
  static async closeNomination(
    leagueId: string,
    sessionId: string,
    nominationId: string
  ): Promise<{ success: boolean; winner_team_id?: string; amount?: number; error?: string }> {
    try {
      // Get the nomination
      const { data: nom } = await supabase
        .from('auction_nominations')
        .select('*')
        .eq('id', nominationId)
        .single();

      if (!nom || nom.status !== 'active') {
        return { success: false, error: 'Nomination not found or already closed.' };
      }

      const winnerTeamId = nom.current_high_bidder_team_id;
      const winAmount = nom.current_high_bid;

      // Mark nomination as sold
      await supabase
        .from('auction_nominations')
        .update({ status: 'sold' })
        .eq('id', nominationId);

      if (!winnerTeamId) {
        return { success: true }; // No bids, player not drafted
      }

      // Deduct budget from winner
      const { data: budget } = await supabase
        .from('auction_budgets')
        .select('remaining_budget, players_won')
        .eq('league_id', leagueId)
        .eq('team_id', winnerTeamId)
        .single();

      if (budget) {
        await supabase
          .from('auction_budgets')
          .update({
            remaining_budget: budget.remaining_budget - winAmount,
            players_won: budget.players_won + 1,
          })
          .eq('league_id', leagueId)
          .eq('team_id', winnerTeamId);
      }

      // Record the draft pick
      const { data: session } = await supabase
        .from('draft_sessions')
        .select('settings')
        .eq('id', sessionId)
        .single();

      const totalNoms = (session?.settings as any)?.total_nominations ?? 1;

      await supabase.from('draft_picks').insert({
        league_id: leagueId,
        team_id: winnerTeamId,
        player_id: nom.player_id,
        round_number: 1, // Auction drafts don't have traditional rounds
        pick_number: totalNoms,
        draft_session_id: sessionId,
      });

      // Advance nomination order
      const settings = session?.settings as any;
      const order = settings?.nomination_order ?? [];
      const nextIndex = ((settings?.current_nominator_index ?? 0) + 1) % order.length;

      await supabase
        .from('draft_sessions')
        .update({
          settings: { ...settings, current_nominator_index: nextIndex },
        })
        .eq('id', sessionId);

      // Check if auction is complete (all teams have filled their rosters)
      const { data: allBudgets } = await supabase
        .from('auction_budgets')
        .select('players_won')
        .eq('league_id', leagueId);

      const { data: leagueInfo } = await supabase
        .from('leagues')
        .select('roster_size')
        .eq('id', leagueId)
        .single();

      const rosterSize = leagueInfo?.roster_size ?? 21;
      const allFilled = (allBudgets ?? []).every(b => b.players_won >= rosterSize);

      if (allFilled) {
        // Mark draft as completed
        await supabase
          .from('draft_sessions')
          .update({ status: 'completed' })
          .eq('id', sessionId);

        await supabase
          .from('leagues')
          .update({ draft_status: 'completed' })
          .eq('id', leagueId);
      }

      return { success: true, winner_team_id: winnerTeamId, amount: winAmount };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AuctionDraftService] closeNomination error:', msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Get bid history for a nomination.
   */
  static async getBidHistory(nominationId: string): Promise<AuctionBid[]> {
    try {
      const { data, error } = await supabase
        .from('auction_bids')
        .select('*')
        .eq('nomination_id', nominationId)
        .order('bid_amount', { ascending: false });

      if (error) throw error;
      return (data ?? []) as AuctionBid[];
    } catch (err) {
      console.error('[AuctionDraftService] getBidHistory error:', err);
      return [];
    }
  }

  /**
   * Auto-nominate for a team when their nomination timer expires.
   * ESPN/Yahoo standard: nominates the highest-ranked available player.
   * Called by the timer expiration handler.
   */
  static async autoNominate(
    leagueId: string,
    sessionId: string,
    teamId: string,
    nominationTimerSeconds: number = 30
  ): Promise<{ success: boolean; nomination?: AuctionNomination; error?: string }> {
    try {
      // Get already-drafted player IDs
      const { data: draftedPicks } = await supabase
        .from('draft_picks')
        .select('player_id')
        .eq('league_id', leagueId)
        .is('deleted_at', null);

      const draftedIds = new Set((draftedPicks ?? []).map(p => p.player_id));

      // Get the top available player (highest fantasy points, not yet drafted)
      const { data: topPlayers } = await supabase
        .from('player_directory')
        .select('player_id, full_name, points')
        .eq('season', CURRENT_SEASON)
        .order('points', { ascending: false })
        .limit(50);

      const available = (topPlayers ?? []).find(p => !draftedIds.has(String(p.player_id)));

      if (!available) {
        return { success: false, error: 'No available players to auto-nominate.' };
      }

      // Nominate the player
      return await this.nominatePlayer(
        leagueId,
        sessionId,
        teamId,
        String(available.player_id),
        available.full_name || `Player ${available.player_id}`,
        1, // minimum $1 opening bid
        nominationTimerSeconds
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AuctionDraftService] autoNominate error:', msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Get all budgets for a league auction.
   */
  static async getAuctionBudgets(leagueId: string): Promise<AuctionBudget[]> {
    try {
      const { data, error } = await supabase
        .from('auction_budgets')
        .select('*')
        .eq('league_id', leagueId)
        .order('remaining_budget', { ascending: false });

      if (error) throw error;
      return (data ?? []) as AuctionBudget[];
    } catch (err) {
      console.error('[AuctionDraftService] getAuctionBudgets error:', err);
      return [];
    }
  }
}

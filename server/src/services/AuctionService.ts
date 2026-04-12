import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS } from '@citrus/shared';

export class AuctionService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async initializeAuction(leagueId: string, sessionId: string, teamIds: string[], budget: number = 200, minBid: number = 1) {
    const budgetRows = teamIds.map(tid => ({
      league_id: leagueId,
      team_id: tid,
      initial_budget: budget,
      remaining_budget: budget,
      players_won: 0,
    }));

    const { error: budgetErr } = await this.supabase
      .from('auction_budgets')
      .upsert(budgetRows, { onConflict: 'league_id,team_id' });

    if (budgetErr) return { success: false, error: budgetErr.message };

    const { error: sessionErr } = await this.supabase
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
  }

  async getAuctionState(leagueId: string, sessionId: string) {
    const { data: session } = await this.supabase
      .from('draft_sessions')
      .select('settings')
      .eq('id', sessionId)
      .single();

    if (!session) return null;
    const settings = session.settings as Record<string, unknown>;

    const { data: budgets } = await this.supabase
      .from('auction_budgets')
      .select(COLUMNS.AUCTION_BUDGET)
      .eq('league_id', leagueId)
      .order('remaining_budget', { ascending: false });

    const { data: activeNom } = await this.supabase
      .from('auction_nominations')
      .select(COLUMNS.AUCTION_NOMINATION)
      .eq('league_id', leagueId)
      .eq('draft_session_id', sessionId)
      .eq('status', 'active')
      .maybeSingle();

    return {
      league_id: leagueId,
      session_id: sessionId,
      current_nomination: activeNom || null,
      nomination_order: (settings?.nomination_order as string[]) ?? [],
      current_nominator_index: (settings?.current_nominator_index as number) ?? 0,
      budgets: budgets ?? [],
      is_complete: false,
      total_nominations: (settings?.total_nominations as number) ?? 0,
    };
  }

  async nominatePlayer(
    leagueId: string, sessionId: string, teamId: string,
    playerId: string, playerName: string, openingBid: number = 1, timerSeconds: number = 30
  ) {
    const state = await this.getAuctionState(leagueId, sessionId);
    if (!state) return { success: false, error: 'Auction state not found' };

    const currentNominator = state.nomination_order[state.current_nominator_index];
    if (currentNominator !== teamId) return { success: false, error: 'It is not your turn to nominate.' };
    if (state.current_nomination) return { success: false, error: 'A nomination is already active.' };

    const { data: existing } = await this.supabase
      .from('draft_picks').select('id').eq('league_id', leagueId).eq('player_id', playerId).is('deleted_at', null).maybeSingle();
    if (existing) return { success: false, error: 'This player has already been drafted.' };

    const expiresAt = new Date(Date.now() + timerSeconds * 1000).toISOString();

    const { data: nom, error } = await this.supabase
      .from('auction_nominations')
      .insert({
        league_id: leagueId, draft_session_id: sessionId, nominated_by_team_id: teamId,
        player_id: playerId, player_name: playerName, minimum_bid: openingBid,
        current_high_bid: openingBid, current_high_bidder_team_id: teamId,
        status: 'active', nomination_number: state.total_nominations + 1, expires_at: expiresAt,
      })
      .select(COLUMNS.AUCTION_NOMINATION).single();

    if (error) return { success: false, error: error.message };

    await this.supabase.from('auction_bids').insert({
      league_id: leagueId, nomination_id: (nom as any).id, team_id: teamId, bid_amount: openingBid,
    });

    const sessionSettings = (await this.supabase.from('draft_sessions').select('settings').eq('id', sessionId).single()).data?.settings as Record<string, unknown> | null;
    await this.supabase.from('draft_sessions').update({
      settings: { ...sessionSettings, total_nominations: ((sessionSettings?.total_nominations as number) ?? 0) + 1 },
    }).eq('id', sessionId);

    return { success: true, nomination: nom };
  }

  async placeBid(leagueId: string, nominationId: string, teamId: string, bidAmount: number) {
    const { data: nom } = await this.supabase
      .from('auction_nominations')
      .select('id, current_high_bid, current_high_bidder_team_id, expires_at')
      .eq('id', nominationId).eq('status', 'active').single();

    if (!nom) return { success: false, error: 'Nomination not found or already closed.' };
    if (bidAmount <= nom.current_high_bid) return { success: false, error: `Bid must be higher than current bid of $${nom.current_high_bid}.` };

    const { data: budget } = await this.supabase
      .from('auction_budgets').select('remaining_budget, players_won')
      .eq('league_id', leagueId).eq('team_id', teamId).single();
    if (!budget) return { success: false, error: 'Budget not found.' };

    const { data: league } = await this.supabase.from('leagues').select('roster_size').eq('id', leagueId).single();
    const rosterSize = league?.roster_size ?? 21;
    const slotsRemaining = rosterSize - budget.players_won - 1;
    const reserveNeeded = Math.max(0, slotsRemaining);
    const maxBid = budget.remaining_budget - reserveNeeded;
    if (bidAmount > maxBid) return { success: false, error: `Maximum bid is $${maxBid}.` };

    const { error: bidErr } = await this.supabase.from('auction_bids').insert({
      league_id: leagueId, nomination_id: nominationId, team_id: teamId, bid_amount: bidAmount,
    });
    if (bidErr) return { success: false, error: bidErr.message };

    const updateFields: Record<string, unknown> = { current_high_bid: bidAmount, current_high_bidder_team_id: teamId };
    if (nom.expires_at) {
      const remaining = new Date(nom.expires_at).getTime() - Date.now();
      if (remaining <= 10000) updateFields.expires_at = new Date(Date.now() + 15000).toISOString();
    }
    await this.supabase.from('auction_nominations').update(updateFields).eq('id', nominationId);

    return { success: true };
  }

  async closeNomination(leagueId: string, sessionId: string, nominationId: string) {
    const { data: nom } = await this.supabase
      .from('auction_nominations')
      .select('id, player_id, current_high_bid, current_high_bidder_team_id, status')
      .eq('id', nominationId).single();

    if (!nom || nom.status !== 'active') return { success: false, error: 'Nomination not found or already closed.' };

    const winnerTeamId = nom.current_high_bidder_team_id;
    const winAmount = nom.current_high_bid;

    await this.supabase.from('auction_nominations').update({ status: 'sold' }).eq('id', nominationId);

    if (!winnerTeamId) return { success: true };

    const { data: budget } = await this.supabase
      .from('auction_budgets').select('remaining_budget, players_won')
      .eq('league_id', leagueId).eq('team_id', winnerTeamId).single();

    if (budget) {
      await this.supabase.from('auction_budgets').update({
        remaining_budget: budget.remaining_budget - winAmount,
        players_won: budget.players_won + 1,
      }).eq('league_id', leagueId).eq('team_id', winnerTeamId);
    }

    const { data: session } = await this.supabase.from('draft_sessions').select('settings').eq('id', sessionId).single();
    const totalNoms = (session?.settings as Record<string, unknown>)?.total_nominations as number ?? 1;

    await this.supabase.from('draft_picks').insert({
      league_id: leagueId, team_id: winnerTeamId, player_id: nom.player_id,
      round_number: 1, pick_number: totalNoms, draft_session_id: sessionId,
    });

    const settings = session?.settings as Record<string, unknown>;
    const order = (settings?.nomination_order ?? []) as string[];
    const nextIndex = (((settings?.current_nominator_index as number) ?? 0) + 1) % order.length;
    await this.supabase.from('draft_sessions').update({ settings: { ...settings, current_nominator_index: nextIndex } }).eq('id', sessionId);

    return { success: true, winner_team_id: winnerTeamId, amount: winAmount };
  }

  async getBidHistory(nominationId: string) {
    // Limit to last 25 bids — clients poll this every 5-7s during active
    // nominations, so returning the full history is wasteful when a
    // nomination receives many bids.
    const { data, error } = await this.supabase
      .from('auction_bids')
      .select(COLUMNS.AUCTION_BID)
      .eq('nomination_id', nominationId)
      .order('bid_amount', { ascending: false })
      .limit(25);
    return { bids: data ?? [], error };
  }

  async getAuctionBudgets(leagueId: string) {
    const { data, error } = await this.supabase
      .from('auction_budgets')
      .select(COLUMNS.AUCTION_BUDGET)
      .eq('league_id', leagueId)
      .order('remaining_budget', { ascending: false });
    return { budgets: data ?? [], error };
  }
}

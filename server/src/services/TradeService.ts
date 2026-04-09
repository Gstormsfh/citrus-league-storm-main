import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS, CURRENT_SEASON } from '@citrus/shared';
import { LeagueMembershipService } from './LeagueMembershipService';

/**
 * TradeService — Server-side trade management with DI Supabase client.
 *
 * Extracted from apps/web/src/services/TradeService.ts.
 * Supports all 3 review types: none, commissioner, league_vote.
 */
export class TradeService {
  private supabase: SupabaseClient;
  private membership: LeagueMembershipService;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.membership = new LeagueMembershipService(supabase);
  }

  /** Verify the caller is a member of the league that a trade belongs to */
  async verifyTradeAccess(tradeId: string, userId: string): Promise<{ leagueId: string | null; error: string | null }> {
    const { data } = await this.supabase
      .from('trade_offers')
      .select('league_id')
      .eq('id', tradeId)
      .single();

    if (!data) return { leagueId: null, error: 'Trade not found' };

    const isMember = await this.membership.verifyMembership(data.league_id, userId);
    if (!isMember) return { leagueId: null, error: 'Not a member of this league' };

    return { leagueId: data.league_id, error: null };
  }

  /** Get all trades for a league — enriched with team names and player summaries */
  async getLeagueTrades(leagueId: string, status?: string) {
    let query = this.supabase
      .from('trade_offers')
      .select(COLUMNS.TRADE)
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error || !data) return { trades: [], error };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trades = data as any[];
    if (trades.length === 0) return { trades: [], error: null };

    // Collect distinct team ids and player ids for enrichment
    const teamIds = new Set<string>();
    const playerIds = new Set<string>();
    for (const t of trades) {
      if (t.from_team_id) teamIds.add(String(t.from_team_id));
      if (t.to_team_id) teamIds.add(String(t.to_team_id));
      for (const p of (t.offered_player_ids || [])) playerIds.add(String(p));
      for (const p of (t.requested_player_ids || [])) playerIds.add(String(p));
    }

    const [teamsResult, playersResult] = await Promise.all([
      this.supabase
        .from('teams')
        .select('id, team_name')
        .in('id', Array.from(teamIds)),
      playerIds.size > 0
        ? this.supabase
            .from('player_directory')
            .select('player_id, full_name, position_code, team_abbrev')
            .eq('season', CURRENT_SEASON)
            .in('player_id', Array.from(playerIds).map((id) => parseInt(id, 10)).filter((n) => !isNaN(n)))
        : Promise.resolve({ data: [] as Array<{ player_id: number; full_name: string; position_code: string; team_abbrev: string }> }),
    ]);

    const teamMap = new Map<string, string>();
    for (const t of (teamsResult.data || [])) {
      teamMap.set(String((t as { id: string }).id), (t as { team_name: string }).team_name);
    }
    const playerMap = new Map<string, { player_id: number; full_name: string; position_code: string; team_abbrev: string }>();
    for (const p of (playersResult.data || [])) {
      playerMap.set(
        String((p as { player_id: number }).player_id),
        p as { player_id: number; full_name: string; position_code: string; team_abbrev: string },
      );
    }

    const enriched = trades.map((t) => ({
      ...t,
      from_team_name: teamMap.get(String(t.from_team_id)) || 'Unknown Team',
      to_team_name: teamMap.get(String(t.to_team_id)) || 'Unknown Team',
      offered_players: (t.offered_player_ids || [])
        .map((id: unknown) => playerMap.get(String(id)))
        .filter(Boolean),
      requested_players: (t.requested_player_ids || [])
        .map((id: unknown) => playerMap.get(String(id)))
        .filter(Boolean),
    }));

    return { trades: enriched, error: null };
  }

  /** Create a trade offer with validation */
  async createTradeOffer(
    leagueId: string,
    fromTeamId: string,
    toTeamId: string,
    offeredPlayerIds: number[],
    requestedPlayerIds: number[],
    userId: string,
    message?: string,
  ) {
    if (String(fromTeamId) === String(toTeamId)) {
      return { success: false, error: 'Cannot trade with yourself' };
    }

    // Verify user owns the from_team AND both teams belong to this league
    const { data: teamsRows } = await this.supabase
      .from('teams')
      .select('id, owner_id, league_id')
      .in('id', [fromTeamId, toTeamId]);

    const fromTeam = (teamsRows || []).find((t: { id: string }) => String(t.id) === String(fromTeamId));
    const toTeam = (teamsRows || []).find((t: { id: string }) => String(t.id) === String(toTeamId));

    if (!fromTeam || fromTeam.owner_id !== userId) {
      return { success: false, error: 'You do not own the offering team' };
    }
    if (!toTeam) {
      return { success: false, error: 'Target team not found' };
    }
    if (String(fromTeam.league_id) !== String(leagueId) || String(toTeam.league_id) !== String(leagueId)) {
      return { success: false, error: 'Both teams must belong to this league' };
    }

    // Verify all offered players are actually on the from-team roster
    if (offeredPlayerIds.length > 0) {
      const { data: ownedRows } = await this.supabase
        .from('roster_assignments')
        .select('player_id')
        .eq('league_id', leagueId)
        .eq('team_id', fromTeamId)
        .in('player_id', offeredPlayerIds.map(String));
      const ownedSet = new Set((ownedRows || []).map((r: { player_id: string | number }) => String(r.player_id)));
      const missing = offeredPlayerIds.filter((p) => !ownedSet.has(String(p)));
      if (missing.length > 0) {
        return { success: false, error: `Offered players not on your roster: ${missing.join(', ')}` };
      }
    }
    // Verify all requested players are actually on the to-team roster
    if (requestedPlayerIds.length > 0) {
      const { data: toRows } = await this.supabase
        .from('roster_assignments')
        .select('player_id')
        .eq('league_id', leagueId)
        .eq('team_id', toTeamId)
        .in('player_id', requestedPlayerIds.map(String));
      const toSet = new Set((toRows || []).map((r: { player_id: string | number }) => String(r.player_id)));
      const missing = requestedPlayerIds.filter((p) => !toSet.has(String(p)));
      if (missing.length > 0) {
        return { success: false, error: `Requested players not on target roster: ${missing.join(', ')}` };
      }
    }

    // Check league settings for best ball (trades not allowed)
    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .single();

    if (league?.settings?.scoring_format === 'best-ball') {
      return { success: false, error: 'Trades are not allowed in Best Ball leagues' };
    }

    // Check trade deadline
    if (league?.settings?.trade_deadline) {
      const deadline = new Date(league.settings.trade_deadline);
      if (new Date() > deadline) {
        return { success: false, error: 'Trade deadline has passed' };
      }
    }

    // Calculate expiration
    const expirationDays = league?.settings?.trade_expiration_days || 7;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expirationDays);

    const { data, error } = await this.supabase
      .from('trade_offers')
      .insert({
        league_id: leagueId,
        from_team_id: fromTeamId,
        to_team_id: toTeamId,
        offered_player_ids: offeredPlayerIds,
        requested_player_ids: requestedPlayerIds,
        message,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
      })
      .select(COLUMNS.TRADE)
      .single();

    return { success: !error, error: error?.message, tradeId: (data as unknown as Record<string, unknown>)?.id as string | undefined };
  }

  /** Accept a trade offer with review routing */
  async acceptTradeOffer(tradeId: string, userId: string) {
    // Get the trade
    const { data: tradeData, error: tradeError } = await this.supabase
      .from('trade_offers')
      .select(COLUMNS.TRADE)
      .eq('id', tradeId)
      .eq('status', 'pending')
      .single();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trade = tradeData as any;
    if (tradeError || !trade) {
      return { success: false, error: 'Trade not found or already processed' };
    }

    // Verify user owns the to_team
    const { data: toTeam } = await this.supabase
      .from('teams')
      .select('owner_id')
      .eq('id', trade.to_team_id)
      .single();

    if (toTeam?.owner_id !== userId) {
      return { success: false, error: 'You are not the recipient of this trade' };
    }

    // Check roster size limits for both teams
    const { data: league } = await this.supabase
      .from('leagues')
      .select('roster_size, trade_review_type, trade_review_period_hours')
      .eq('id', trade.league_id)
      .single();

    const maxRoster = league?.roster_size || 22; // matches process_roster_move RPC

    const { count: fromCount } = await this.supabase
      .from('roster_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', String(trade.from_team_id))
      .eq('league_id', String(trade.league_id));

    const { count: toCount } = await this.supabase
      .from('roster_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', String(trade.to_team_id))
      .eq('league_id', String(trade.league_id));

    const offeredCount = Array.isArray(trade.offered_player_ids) ? trade.offered_player_ids.length : 0;
    const requestedCount = Array.isArray(trade.requested_player_ids) ? trade.requested_player_ids.length : 0;

    const newFromSize = (fromCount || 0) - offeredCount + requestedCount;
    const newToSize = (toCount || 0) - requestedCount + offeredCount;

    if (newFromSize > maxRoster || newToSize > maxRoster) {
      return { success: false, error: 'Trade would exceed roster size limit' };
    }

    // Check if review is required
    const reviewType = league?.trade_review_type || 'none';

    if (reviewType !== 'none') {
      return this.submitTradeForReview(tradeId, String(trade.league_id));
    }

    // Execute trade immediately — pass all 6 args required by execute_trade RPC
    const { data: rpcData, error } = await this.supabase.rpc('execute_trade', {
      p_trade_id: tradeId,
      p_league_id: String(trade.league_id),
      p_from_team_id: String(trade.from_team_id),
      p_to_team_id: String(trade.to_team_id),
      p_offered_player_ids: (trade.offered_player_ids || []).map((p: unknown) => String(p)),
      p_requested_player_ids: (trade.requested_player_ids || []).map((p: unknown) => String(p)),
    });

    if (error) {
      return { success: false, error: error.message };
    }
    // execute_trade returns JSONB { success, error } — surface inner failure
    const result = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
    if (result && result.success === false) {
      return { success: false, error: result.error || 'Trade execution failed' };
    }

    // Mark the trade offer as accepted (execute_trade only moves rosters)
    await this.supabase
      .from('trade_offers')
      .update({ status: 'accepted', processed_at: new Date().toISOString() })
      .eq('id', tradeId);

    return { success: true };
  }

  /** Reject a trade offer */
  async rejectTradeOffer(tradeId: string, userId: string) {
    const { data: trade } = await this.supabase
      .from('trade_offers')
      .select('to_team_id')
      .eq('id', tradeId)
      .eq('status', 'pending')
      .single();

    if (!trade) {
      return { success: false, error: 'Trade not found or already processed' };
    }

    // Verify user owns the to_team
    const { data: team } = await this.supabase
      .from('teams')
      .select('owner_id')
      .eq('id', trade.to_team_id)
      .single();

    if (team?.owner_id !== userId) {
      return { success: false, error: 'Only the trade recipient can reject' };
    }

    const { error } = await this.supabase
      .from('trade_offers')
      .update({ status: 'rejected', processed_at: new Date().toISOString() })
      .eq('id', tradeId);

    return { success: !error, error: error?.message };
  }

  /** Cancel a trade offer (proposer only) */
  async cancelTradeOffer(tradeId: string, userId: string) {
    const { data: trade } = await this.supabase
      .from('trade_offers')
      .select('from_team_id')
      .eq('id', tradeId)
      .eq('status', 'pending')
      .single();

    if (!trade) {
      return { success: false, error: 'Trade not found or already processed' };
    }

    const { data: team } = await this.supabase
      .from('teams')
      .select('owner_id')
      .eq('id', trade.from_team_id)
      .single();

    if (team?.owner_id !== userId) {
      return { success: false, error: 'Only the trade proposer can cancel' };
    }

    const { error } = await this.supabase
      .from('trade_offers')
      .update({ status: 'cancelled', processed_at: new Date().toISOString() })
      .eq('id', tradeId);

    return { success: !error, error: error?.message };
  }

  /** Submit trade for review (commissioner or league vote) */
  async submitTradeForReview(tradeId: string, leagueId: string) {
    const { data: league } = await this.supabase
      .from('leagues')
      .select('trade_review_type, trade_review_period_hours')
      .eq('id', leagueId)
      .single();

    const reviewType = league?.trade_review_type || 'none';
    if (reviewType === 'none') {
      return { success: true, reviewType: 'none' };
    }

    const reviewHours = league?.trade_review_period_hours || 48;
    const reviewEndsAt = new Date();
    reviewEndsAt.setHours(reviewEndsAt.getHours() + reviewHours);

    const { error } = await this.supabase
      .from('trade_offers')
      .update({
        status: 'under_review',
        review_type: reviewType,
        review_ends_at: reviewEndsAt.toISOString(),
      })
      .eq('id', tradeId);

    if (!error) {
      await this.supabase.rpc('notify_league_members', {
        p_league_id: leagueId,
        p_message: 'A trade has been submitted for review.',
        p_title: 'Trade Under Review',
      });
    }

    return { success: !error, reviewType, error: error?.message };
  }

  /** Submit a vote on a trade */
  async submitTradeVote(tradeOfferId: string, voterTeamId: string, vote: 'approve' | 'veto') {
    const { data, error } = await this.supabase.rpc('submit_trade_vote', {
      p_trade_offer_id: tradeOfferId,
      p_voter_team_id: voterTeamId,
      p_vote: vote,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return {
      success: true,
      vetoCount: result?.veto_count || 0,
      approveCount: result?.approve_count || 0,
      votesNeeded: result?.votes_needed || 0,
      isVetoed: result?.is_vetoed || false,
      error: null,
    };
  }

  /** Get votes on a trade */
  async getTradeVotes(tradeOfferId: string) {
    const { data, error } = await this.supabase
      .from('trade_votes')
      .select('voter_team_id, vote, created_at')
      .eq('trade_offer_id', tradeOfferId);

    return {
      votes: (data || []).map((v: { voter_team_id: string; vote: string; created_at: string }) => ({
        voterTeamId: v.voter_team_id,
        vote: v.vote,
        createdAt: v.created_at,
      })),
      error,
    };
  }

  /** Commissioner decision on a trade */
  async commissionerDecision(
    tradeId: string,
    leagueId: string,
    decision: 'approve' | 'veto',
    commissionerId: string,
  ) {
    await this.membership.requireCommissioner(leagueId, commissionerId);

    if (decision === 'veto') {
      const { error } = await this.supabase
        .from('trade_offers')
        .update({ status: 'vetoed', processed_at: new Date().toISOString() })
        .eq('id', tradeId);

      if (!error) {
        await this.supabase.rpc('notify_league_members', {
          p_league_id: leagueId,
          p_message: 'A trade has been vetoed by the commissioner.',
          p_title: 'Trade Vetoed',
        });
      }

      return { success: !error, error: error?.message };
    }

    // Approve: execute the trade — fetch trade payload to pass all 6 RPC args
    const { data: tradeRow, error: fetchErr } = await this.supabase
      .from('trade_offers')
      .select('league_id, from_team_id, to_team_id, offered_player_ids, requested_player_ids')
      .eq('id', tradeId)
      .single();

    if (fetchErr || !tradeRow) {
      return { success: false, error: 'Trade not found' };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tr = tradeRow as any;
    const { data: rpcData, error } = await this.supabase.rpc('execute_trade', {
      p_trade_id: tradeId,
      p_league_id: String(tr.league_id),
      p_from_team_id: String(tr.from_team_id),
      p_to_team_id: String(tr.to_team_id),
      p_offered_player_ids: (tr.offered_player_ids || []).map((p: unknown) => String(p)),
      p_requested_player_ids: (tr.requested_player_ids || []).map((p: unknown) => String(p)),
    });

    if (error) {
      return { success: false, error: error.message };
    }
    const result = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
    if (result && result.success === false) {
      return { success: false, error: result.error || 'Trade execution failed' };
    }

    await this.supabase
      .from('trade_offers')
      .update({ status: 'accepted', processed_at: new Date().toISOString() })
      .eq('id', tradeId);

    return { success: true };
  }

  /** Get trade review settings for a league */
  async getTradeReviewSettings(leagueId: string) {
    const { data, error } = await this.supabase
      .from('leagues')
      .select('trade_review_type, trade_review_period_hours, trade_veto_threshold')
      .eq('id', leagueId)
      .single();

    return {
      reviewType: data?.trade_review_type || 'none',
      reviewPeriodHours: data?.trade_review_period_hours || 48,
      vetoThreshold: data?.trade_veto_threshold || 0.5,
      error,
    };
  }

  /** Update trade review settings (commissioner only) */
  async updateTradeReviewSettings(
    leagueId: string,
    commissionerId: string,
    settings: {
      trade_review_type: 'none' | 'commissioner' | 'league_vote';
      trade_review_period_hours: number;
      trade_veto_threshold: number;
    },
  ) {
    await this.membership.requireCommissioner(leagueId, commissionerId);

    const { error } = await this.supabase
      .from('leagues')
      .update({
        trade_review_type: settings.trade_review_type,
        trade_review_period_hours: settings.trade_review_period_hours,
        trade_veto_threshold: settings.trade_veto_threshold,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leagueId);

    if (!error) {
      await this.supabase.rpc('notify_league_members', {
        p_league_id: leagueId,
        p_message: 'Trade review settings have been updated.',
        p_title: 'Trade Settings Updated',
      });
    }

    return { success: !error, error };
  }
}

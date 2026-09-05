import { SupabaseClient } from '@supabase/supabase-js';
import { isPastTradeDeadline, lockedTeamForTrade } from '../lib/leagueRules';
import { getSupabaseAdmin } from '../lib/supabase';
import { COLUMNS, getCurrentSeason, logger } from '@citrus/shared';
import { LeagueMembershipService } from './LeagueMembershipService';

/**
 * The only trade statuses a commissioner decision can still act on.
 *
 * T4 (2026-09-03): commissionerDecision selected the trade by id alone, with no
 * status guard, so approve or veto would act on a trade that was already
 * rejected, cancelled, expired, vetoed or executed. The sharp form is a
 * commissioner who is also one of the two trading teams forcing through a deal
 * the other side explicitly rejected - and with the execute_trade commissioner
 * allowance added the same day, that path now reaches the rosters.
 *
 * 'pending' is the review-type = 'none' league where the commissioner steps in
 * anyway; 'under_review' is the review workflow's own state. Everything else in
 * trade_offers_status_check is terminal.
 */
const COMMISSIONER_DECIDABLE_STATUSES = ['pending', 'under_review'];

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
            .eq('season', getCurrentSeason())
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

    // 2026-08-24: CreateLeague writes camelCase `scoringFormat` — the old
    // snake_case-only read meant this rule NEVER fired for real best-ball
    // leagues. Accept both spellings.
    const fmt = league?.settings?.scoringFormat ?? league?.settings?.scoring_format;
    if (fmt === 'best-ball') {
      return { success: false, error: 'Trades are not allowed in Best Ball leagues' };
    }

    // SETTINGS-ENFORCEMENT (2026-08-16) — the old check read
    // settings.trade_deadline, a key NOTHING writes; CreateLeague writes
    // tradeDeadlineWeek (a matchup week). Enforce both forms; the week
    // form compares against the league's current matchup week, failing
    // OPEN if the schedule can't be resolved. Pure logic + tests:
    // lib/leagueRules.isPastTradeDeadline.
    {
      let currentWeek: number | null = null;
      try {
        const nowIso = new Date().toISOString();
        const { data: wk } = await this.supabase
          .from('matchups')
          .select('week_number')
          .eq('league_id', leagueId)
          .lte('week_start_date', nowIso)
          .order('week_number', { ascending: false })
          .limit(1)
          .maybeSingle();
        currentWeek = typeof wk?.week_number === 'number' ? wk.week_number : null;
      } catch {
        currentWeek = null;
      }
      if (isPastTradeDeadline(league?.settings ?? {}, new Date(), currentWeek)) {
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

    // NOTIFICATIONS (2026-08-16) — the top gap from the audit: the
    // recipient was never told a trade offer arrived. Targeted insert to
    // the to-team's owner (AI teams have no owner → skip). Non-blocking:
    // a notification failure must never fail the trade itself.
    if (!error && toTeam.owner_id) {
      try {
        await this.supabase.from('notifications').insert({
          league_id: leagueId,
          user_id: toTeam.owner_id,
          // TYPE (2026-09-04 TestFlight audit). Was 'trade_offer', which
          // notifications_type_check rejects (ADD, DROP, WAIVER, TRADE,
          // CHAT, SYSTEM only), so the 23514 came back in the `error`
          // field this call never reads and the catch below never saw it.
          // The recipient has not been told about a trade offer once since
          // this shipped on 2026-08-16, which is the exact gap it was
          // written to close.
          type: 'TRADE',
          title: 'New Trade Offer',
          message: 'You received a trade offer. Review it in the Trade Center.',
          metadata: {
            trade_offer_id: (data as unknown as Record<string, unknown>)?.id ?? null,
            from_team_id: fromTeamId,
          },
        });
      } catch { /* non-critical */ }
    }

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

    // OFFER-EXPIRY FIX (2026-08-23, found during launch QA): expires_at
    // was written on every proposal (league setting, default 7 days) but
    // NOTHING ever read it — a stale offer stayed acceptable forever,
    // long after the proposer's roster context changed. Enforce it at
    // the accept gate and mark the row so the history is honest. The
    // hourly sweep (scheduled.ts) expires lingering rows too; this
    // in-path check covers the gap between sweeps.
    if (trade.expires_at && new Date(trade.expires_at as string).getTime() < Date.now()) {
      await this.supabase
        .from('trade_offers')
        .update({ status: 'expired', processed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', tradeId)
        .eq('status', 'pending');
      return { success: false, error: 'This trade offer has expired' };
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
      .select('roster_size, trade_review_type, trade_review_period_hours, allow_trades_during_games')
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

    // SETTINGS PASS-THROUGH (2026-09-05): allow_trades_during_games was a
    // stored toggle nothing read. OFF means a trade that moves a player
    // whose team is on the ice waits until the games are over (Yahoo's
    // behaviour). Same shape as the waiver game lock, and the same rule:
    // any data problem fails OPEN. Pure logic: lib/leagueRules.lockedTeamForTrade.
    if (league?.allow_trades_during_games === false) {
      try {
        const playerIds = [...(trade.offered_player_ids || []), ...(trade.requested_player_ids || [])]
          .map((p: unknown) => Number(p))
          .filter((n: number) => Number.isFinite(n) && n > 0);
        if (playerIds.length) {
          const admin = getSupabaseAdmin();
          const { data: dir } = await admin
            .from('player_directory')
            .select('player_id, team_abbrev, season')
            .in('player_id', playerIds)
            .order('season', { ascending: false });
          const teamOf = new Map<number, string>();
          for (const r of (dir ?? []) as Array<{ player_id: number; team_abbrev: string | null }>) {
            if (r.team_abbrev && !teamOf.has(r.player_id)) teamOf.set(r.player_id, r.team_abbrev);
          }
          const abbrevs = Array.from(new Set(teamOf.values()));
          if (abbrevs.length) {
            const today = new Date().toISOString().slice(0, 10);
            const { data: games } = await admin
              .from('nhl_games')
              .select('status, game_date, game_time, home_team, away_team')
              .eq('game_date', today)
              .or(abbrevs.map((a) => `home_team.eq.${a},away_team.eq.${a}`).join(','));
            const locked = lockedTeamForTrade(abbrevs, games ?? [], Date.now());
            if (locked) {
              return {
                success: false,
                error: `${locked}'s game has started. This league holds trades with a player on the ice until the games are over; accept it after tonight's games.`,
              };
            }
          }
        }
      } catch (lockErr) {
        logger.warn('[acceptTradeOffer] game-lock check failed open:', lockErr);
      }
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

    // submit_trade_vote is RETURNS TABLE(success, message, ...), so supabase-js
    // hands back an ARRAY of rows and reports its own refusals in
    // row.success / row.message rather than in `error`. The old code read
    // neither: it reported every call that did not throw as a successful vote,
    // which would have masked the ownership refusal added on 2026-09-03 (T3)
    // and has always masked 'Trade is not under review', 'Cannot vote on a
    // trade you are involved in' and 'Review period has ended' as successes.
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    const row = (Array.isArray(parsed) ? parsed[0] : parsed) as
      | {
          success?: boolean;
          message?: string;
          veto_count?: number;
          approve_count?: number;
          votes_needed?: number;
          is_vetoed?: boolean;
        }
      | null
      | undefined;

    if (!row) {
      return { success: false, error: 'Vote failed' };
    }
    if (row.success === false) {
      return { success: false, error: row.message || 'Vote failed' };
    }

    return {
      success: true,
      vetoCount: row.veto_count || 0,
      approveCount: row.approve_count || 0,
      votesNeeded: row.votes_needed || 0,
      isVetoed: row.is_vetoed || false,
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

    // T4 (2026-09-03): read the trade FIRST, for both branches, and refuse
    // unless it is still awaiting a decision. This used to be an approve-only
    // fetch keyed on id with no status filter, so a commissioner could approve
    // a trade the recipient had already rejected, or veto one that had already
    // executed.
    const { data: tradeRow, error: fetchErr } = await this.supabase
      .from('trade_offers')
      .select('league_id, from_team_id, to_team_id, offered_player_ids, requested_player_ids, status')
      .eq('id', tradeId)
      .single();

    if (fetchErr || !tradeRow) {
      return { success: false, error: 'Trade not found' };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tr = tradeRow as any;

    // leagueId arrives in the request body, and requireCommissioner above was
    // checked against it. If the trade belongs to a different league, that
    // check proved nothing about this trade.
    if (String(tr.league_id) !== String(leagueId)) {
      return { success: false, error: 'Trade does not belong to this league' };
    }

    if (!COMMISSIONER_DECIDABLE_STATUSES.includes(String(tr.status))) {
      return {
        success: false,
        error: `Trade is already ${tr.status}; a commissioner decision no longer applies`,
      };
    }

    if (decision === 'veto') {
      // The .in() repeats the guard at the write, so a concurrent reject or
      // cancel between the read above and this update cannot be overwritten.
      const { error } = await this.supabase
        .from('trade_offers')
        .update({ status: 'vetoed', processed_at: new Date().toISOString() })
        .eq('id', tradeId)
        .in('status', COMMISSIONER_DECIDABLE_STATUSES);

      if (!error) {
        await this.supabase.rpc('notify_league_members', {
          p_league_id: leagueId,
          p_message: 'A trade has been vetoed by the commissioner.',
          p_title: 'Trade Vetoed',
        });
      }

      return { success: !error, error: error?.message };
    }

    // Approve: execute the trade — all 6 args come off the row read above.
    //
    // RESIDUAL RACE, NOT FIXED HERE: if the recipient rejects between the read
    // above and execute_trade returning, the rosters have already moved and the
    // status write below is what makes the record agree with them - so it is
    // deliberately NOT guarded by .in(). Closing the window properly means
    // moving the trade_offers status transition inside execute_trade's
    // transaction, which changes that RPC's contract and belongs in its own
    // change.
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
      /** Matchup week after which trades close; 0 = none. Merged into settings JSONB. */
      tradeDeadlineWeek?: number;
    },
  ) {
    await this.membership.requireCommissioner(leagueId, commissionerId);

    const update: Record<string, unknown> = {
      trade_review_type: settings.trade_review_type,
      trade_review_period_hours: settings.trade_review_period_hours,
      trade_veto_threshold: settings.trade_veto_threshold,
      updated_at: new Date().toISOString(),
    };
    if (typeof settings.tradeDeadlineWeek === 'number') {
      // The deadline lives in settings JSONB (isPastTradeDeadline reads
      // settings.tradeDeadlineWeek). Merge, never replace, the document.
      const { data: row, error: readErr } = await this.supabase.from('leagues').select('settings').eq('id', leagueId).single();
      if (readErr) return { success: false, error: readErr };
      const current = (row?.settings && typeof row.settings === 'object' ? row.settings : {}) as Record<string, unknown>;
      update.settings = { ...current, tradeDeadlineWeek: settings.tradeDeadlineWeek };
    }

    const { error } = await this.supabase.from('leagues').update(update).eq('id', leagueId);

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

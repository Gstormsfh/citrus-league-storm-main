import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS, logger } from '@citrus/shared';
import { LeagueMembershipService } from './LeagueMembershipService';
import { withResilience } from '../lib/resilientSupabase';

/**
 * DraftService — Server-side draft management with DI Supabase client.
 *
 * Extracted from apps/web/src/services/DraftService.ts.
 * Realtime subscriptions stay in the web app — this handles request/response operations.
 */
export class DraftService {
  private supabase: SupabaseClient;
  private membership: LeagueMembershipService;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.membership = new LeagueMembershipService(supabase);
  }

  /** Get or find the active draft session for a league */
  async getActiveDraftSession(leagueId: string) {
    // Check league draft status
    const { data: league } = await this.supabase
      .from('leagues')
      .select('draft_status')
      .eq('id', leagueId)
      .single();

    // If draft not started, return a new session ID
    if (!league || league.draft_status === 'not_started' || league.draft_status === 'queued') {
      return { sessionId: crypto.randomUUID(), error: null };
    }

    // Look for session from existing picks
    const { data: existingPick } = await this.supabase
      .from('draft_picks')
      .select('draft_session_id')
      .eq('league_id', leagueId)
      .is('deleted_at', null)
      .order('picked_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingPick?.draft_session_id) {
      return { sessionId: existingPick.draft_session_id, error: null };
    }

    // Look for session from draft order
    const { data: existingOrder } = await this.supabase
      .from('draft_order')
      .select('draft_session_id')
      .eq('league_id', leagueId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingOrder?.draft_session_id) {
      return { sessionId: existingOrder.draft_session_id, error: null };
    }

    return { sessionId: crypto.randomUUID(), error: null };
  }

  /** Get draft picks for a league, optionally filtered by session */
  async getDraftPicks(leagueId: string, sessionId?: string) {
    let query = this.supabase
      .from('draft_picks')
      .select(COLUMNS.DRAFT_PICK)
      .eq('league_id', leagueId)
      .is('deleted_at', null)
      .order('pick_number', { ascending: true });

    if (sessionId) {
      query = query.eq('draft_session_id', sessionId);
    }

    const { data, error } = await query;
    return { picks: data || [], error };
  }

  /** Get draft order for a specific round */
  async getDraftOrder(leagueId: string, roundNumber: number, sessionId?: string) {
    let query = this.supabase
      .from('draft_order')
      .select(COLUMNS.DRAFT_ORDER)
      .eq('league_id', leagueId)
      .eq('round_number', roundNumber)
      .is('deleted_at', null);

    if (sessionId) {
      query = query.eq('draft_session_id', sessionId);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return { order: data || null, error };
  }

  /** Hard delete all draft data for a league */
  async hardDeleteDraft(leagueId: string) {
    await this.supabase.from('draft_picks').delete().eq('league_id', leagueId);
    await this.supabase.from('draft_order').delete().eq('league_id', leagueId);
    await this.supabase
      .from('leagues')
      .update({ draft_status: 'not_started' })
      .eq('id', leagueId);

    return { error: null };
  }

  /** Get draft state: league info, picks, and order */
  async getDraftState(leagueId: string) {
    const [leagueResult, picksResult, orderResult] = await Promise.all([
      this.supabase
        .from('leagues')
        .select('id, draft_status, settings, scheduled_draft_time, draft_rounds')
        .eq('id', leagueId)
        .single(),
      this.supabase
        .from('draft_picks')
        .select(COLUMNS.DRAFT_PICK)
        .eq('league_id', leagueId)
        .is('deleted_at', null)
        .order('pick_number', { ascending: true }),
      this.supabase
        .from('draft_order')
        .select(COLUMNS.DRAFT_ORDER)
        .eq('league_id', leagueId)
        .order('round_number', { ascending: true }),
    ]);

    return {
      league: leagueResult.data,
      picks: picksResult.data || [],
      order: orderResult.data || [],
      error: leagueResult.error || picksResult.error || orderResult.error,
    };
  }

  /** Make a draft pick with validation */
  async makePick(
    leagueId: string,
    teamId: string,
    playerId: string | number,
    roundNumber: number,
    pickNumber: number,
    sessionId?: string,
    teamsCount?: number,
  ) {
    // Validate player not already drafted AND pick number not used in parallel
    const [{ data: existing }, { data: existingPick }] = await Promise.all([
      this.supabase
        .from('draft_picks')
        .select('id')
        .eq('league_id', leagueId)
        .eq('player_id', playerId)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle(),
      this.supabase
        .from('draft_picks')
        .select('id')
        .eq('league_id', leagueId)
        .eq('pick_number', pickNumber)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle(),
    ]);

    if (existing) {
      return { pick: null, error: 'Player already drafted', isComplete: false };
    }
    if (existingPick) {
      return { pick: null, error: 'Pick number already used', isComplete: false };
    }

    // Try RPC first, fallback to direct insert
    let pick: Record<string, unknown> | null = null;
    let error: { message?: string } | null = null;

    // Wrap the primary pick-submission RPC with circuit breaker + retry.
    // April 10: single Supabase blips killed picks with no recovery. Now transient
    // 429/5xx/network failures retry with backoff (100ms → 300ms), and repeated
    // infrastructure failures trip the breaker to fail-fast instead of piling up.
    // Domain errors like "already drafted" are NOT retried — they pass through.
    const { data: rpcResult, error: rpcError } = await withResilience(
      () => this.supabase.rpc('make_draft_pick', {
        p_league_id: leagueId,
        p_team_id: teamId,
        p_player_id: String(playerId),
        p_round_number: roundNumber,
        p_pick_number: pickNumber,
        p_draft_session_id: sessionId || null,
      }),
      { label: 'draft.makePick.rpc' },
    );

    if (rpcError) {
      // RPC may fail with a race-condition message from the DB function.
      // Surface these as clean 400s instead of falling through to a raw insert
      // that would hit the same unique constraint and return an opaque Postgres error.
      const rpcMsg = rpcError.message || '';
      if (rpcMsg.includes('already drafted') || rpcMsg.includes('already taken')) {
        return { pick: null, error: rpcMsg, isComplete: false };
      }

      // Fallback to direct insert for non-conflict RPC errors.
      // Same resilience treatment — transient blips retried, DB unique-constraint
      // errors pass through unchanged.
      const { data: insertResult, error: insertError } = await withResilience(
        () => this.supabase
          .from('draft_picks')
          .insert({
            league_id: leagueId,
            team_id: teamId,
            player_id: String(playerId),
            pick_number: pickNumber,
            round_number: roundNumber,
            draft_session_id: sessionId,
          })
          .select(COLUMNS.DRAFT_PICK)
          .single(),
        { label: 'draft.makePick.fallbackInsert' },
      );

      pick = insertResult as unknown as Record<string, unknown>;
      error = insertError;
    } else {
      pick = rpcResult as Record<string, unknown> | null;
    }

    if (error) {
      // Translate unique constraint violations into user-friendly messages
      const errMsg = (error.message || String(error));
      if (errMsg.includes('idx_draft_picks_unique_player') || errMsg.includes('unique_player')) {
        return { pick: null, error: 'Player already drafted', isComplete: false };
      }
      if (errMsg.includes('idx_draft_picks_unique_pick') || errMsg.includes('unique_pick')) {
        // Race condition: client computed pickNumber=N based on stale state, but another
        // pick landed under pickNumber=N between our check and our insert. Our player
        // MAY have been accepted under a different pick_number by the RPC's advance-and-retry
        // path. Check before surfacing a user-facing error — silently accept if the player
        // is now drafted (realtime will reconcile the client state).
        const { data: ourPick } = await this.supabase
          .from('draft_picks')
          .select('id, pick_number, round_number')
          .eq('league_id', leagueId)
          .eq('player_id', String(playerId))
          .is('deleted_at', null)
          .maybeSingle();
        if (ourPick) {
          logger.log('makePick: recovered from pick-number race', { leagueId, playerId, actualPick: ourPick.pick_number });
          return { pick: ourPick as Record<string, unknown>, error: null, isComplete: false };
        }
        return { pick: null, error: 'Pick number already used', isComplete: false };
      }
      return { pick: null, error: errMsg, isComplete: false };
    }

    // Run league status update + completion check in parallel
    // Status update is idempotent; completion check is independent
    let isComplete = false;
    const statusUpdatePromise: Promise<void> = (async () => {
      await this.supabase
        .from('leagues')
        .update({ draft_status: 'in_progress' })
        .eq('id', leagueId)
        .in('draft_status', ['not_started', 'queued']);
    })();

    const postPickTasks: Promise<void>[] = [statusUpdatePromise];

    if (teamsCount) {
      const completionPromise: Promise<void> = (async () => {
        const { data: completionResult, error: completionError } = await this.supabase.rpc(
          'complete_draft_and_sync',
          {
            p_league_id: leagueId,
            p_draft_session_id: sessionId || null,
            p_teams_count: teamsCount,
          },
        );
        if (completionError) {
          logger.error('Draft completion check failed', { leagueId, error: completionError.message });
        } else {
          isComplete = completionResult?.is_complete ?? false;
        }
      })();
      postPickTasks.push(completionPromise);
    }

    await Promise.all(postPickTasks);

    return { pick, error: null, isComplete };
  }

  /** Start the draft (commissioner only) */
  async startDraft(leagueId: string, userId: string) {
    await this.membership.requireCommissioner(leagueId, userId);

    const { data, error } = await this.supabase
      .from('leagues')
      .update({ draft_status: 'in_progress' })
      .eq('id', leagueId)
      .select('id, draft_status')
      .single();

    return { league: data, error };
  }

  /** Initialize draft order (snake or linear) */
  async initializeDraftOrder(
    leagueId: string,
    teams: Array<{ id: string }>,
    totalRounds: number,
    customTeamOrder?: string[],
    draftType?: string,
  ) {
    // Hard-delete existing orders
    await this.supabase
      .from('draft_order')
      .delete()
      .eq('league_id', leagueId);

    const sessionId = crypto.randomUUID();
    const isLinear = draftType === 'linear';
    const teamOrder = customTeamOrder || teams.map((t) => t.id);

    const orders: { league_id: string; round_number: number; team_order: string[]; draft_session_id: string }[] = [];
    for (let round = 1; round <= totalRounds; round++) {
      const roundOrder = !isLinear && round % 2 === 0
        ? [...teamOrder].reverse()
        : [...teamOrder];

      orders.push({
        league_id: leagueId,
        round_number: round,
        team_order: roundOrder,
        draft_session_id: sessionId,
      });
    }

    const { error } = await this.supabase
      .from('draft_order')
      .insert(orders);

    return { error, sessionId };
  }

  /** Reset draft (nuclear - deletes all picks and orders) */
  async resetDraft(leagueId: string) {
    // Try RPC first
    const { error: rpcError } = await this.supabase.rpc('nuclear_reset_draft', {
      p_league_id: leagueId,
    });

    if (rpcError) {
      // Fallback to direct deletes
      await this.supabase.from('draft_picks').delete().eq('league_id', leagueId);
      await this.supabase.from('draft_order').delete().eq('league_id', leagueId);
      await this.supabase.from('team_lineups').delete().eq('league_id', leagueId);
      await this.supabase.from('roster_assignments').delete().eq('league_id', leagueId);
    }

    // Reset league status
    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .single();

    const settings = league?.settings || {};
    delete settings.timerStartedAt;

    await this.supabase
      .from('leagues')
      .update({ draft_status: 'not_started', settings })
      .eq('id', leagueId);

    return { error: null, newSessionId: crypto.randomUUID() };
  }

  /** Undo the last draft pick */
  async undoLastPick(leagueId: string) {
    const { data: lastPickData } = await this.supabase
      .from('draft_picks')
      .select(COLUMNS.DRAFT_PICK)
      .eq('league_id', leagueId)
      .is('deleted_at', null)
      .order('pick_number', { ascending: false })
      .limit(1)
      .single();

    const lastPick = lastPickData as any;
    if (!lastPick) {
      return { undone: null, error: 'No picks to undo' };
    }

    const { error } = await this.supabase
      .from('draft_picks')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', lastPick.id);

    return { undone: error ? null : lastPick, error };
  }

  /** Autopick the next player for a team */
  async autopickForTeam(
    leagueId: string,
    teamId: string,
    sessionId: string,
    roundNumber: number,
    pickNumber: number,
  ) {
    const { data, error } = await this.supabase.rpc('autopick_next_player', {
      p_league_id: leagueId,
      p_team_id: teamId,
      p_draft_session_id: sessionId,
      p_round_number: roundNumber,
      p_pick_number: pickNumber,
    });

    if (error) {
      return { playerId: null, playerName: null, position: null, pickId: null, error };
    }

    // `autopick_next_player` is declared RETURNS TABLE (verified against prod
    // 2026-09-03: `TABLE(picked_player_id integer, player_name text, "position"
    // text, pick_id uuid)`), so PostgREST hands back an ARRAY of rows, and the
    // player column is `picked_player_id` — not `player_id`.
    //
    // Both of those were wrong here. `result` was the array itself, so
    // `result?.player_id` read a property off an Array and every one of the
    // four fields resolved to null on every autopick. The pick still landed,
    // because the RPC does the insert itself and nothing downstream needed the
    // return value to commit it — which is exactly why this survived 391
    // autopicks in production without anyone noticing.
    //
    // What it cost: routes/draft.ts guards the realtime fanout on
    // `if (result.pickId && result.playerId)`, so the autopick broadcast NEVER
    // fired. Every other manager's board stayed stale until something else
    // refetched it. On a board where autopicks outnumber manual picks 391 to
    // 68, that is most of the draft going out silently.
    //
    // The array unwrap is kept tolerant because a single-row RETURNS TABLE can
    // arrive either way depending on how the call is made; the column name is
    // NOT tolerant, because it was checked against the live catalog and
    // accepting both spellings would just re-hide the next rename.
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    return {
      playerId: row?.picked_player_id ?? null,
      playerName: row?.player_name ?? null,
      position: row?.position ?? null,
      pickId: row?.pick_id ?? null,
      error: null,
    };
  }

  /** Run full autopick draft */
  async runFullAutopickDraft(leagueId: string) {
    const { data, error } = await this.supabase.rpc('run_full_autopick_draft', {
      p_league_id: leagueId,
    });

    if (error) {
      return { picks: [], error };
    }

    // Sync roster assignments after autopick draft
    const { error: syncError } = await this.supabase.rpc('sync_roster_assignments_for_league', {
      p_league_id: leagueId,
    });

    if (syncError) {
      logger.error('Roster sync failed after autopick draft', { leagueId, error: syncError.message });
    }

    const picks = (data || []).map((row: { round_number: number; pick_number: number; team_id: string; player_id: number; player_name?: string }) => ({
      round: row.round_number,
      pick: row.pick_number,
      teamId: row.team_id,
      playerId: row.player_id,
      playerName: row.player_name,
    }));

    return { picks, error: null };
  }

  /** Save/get draft snapshot */
  async saveDraftSnapshot(
    leagueId: string,
    draftSessionId: string,
    snapshotData: Record<string, any>,
    userId: string,
  ) {
    const { data, error } = await this.supabase
      .from('draft_snapshots')
      .insert({
        league_id: leagueId,
        draft_session_id: draftSessionId,
        snapshot_data: snapshotData,
        created_by: userId,
      })
      .select(COLUMNS.DRAFT_SNAPSHOT)
      .single();

    return { snapshotId: (data as any)?.id || null, error };
  }

  async getDraftSnapshot(leagueId: string) {
    const { data, error } = await this.supabase
      .from('draft_snapshots')
      .select(COLUMNS.DRAFT_SNAPSHOT)
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return { snapshot: data, error };
  }

  /** Save/get autopick rankings */
  async saveAutopickRankings(
    leagueId: string | null,
    teamId: string | null,
    rankings: Array<{ playerId: number; rank: number; positionCode: string }>,
  ) {
    const rows = rankings.map((r) => ({
      league_id: leagueId,
      team_id: teamId,
      player_id: r.playerId,
      rank: r.rank,
      position_code: r.positionCode,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await this.supabase
      .from('player_autopick_rankings')
      .upsert(rows, { onConflict: 'league_id,team_id,player_id' });

    return { error };
  }

  /** Delete ALL draft data across all leagues (admin only) */
  async deleteAllDraftData() {
    // Count before deletion (parallel)
    const [{ count: picksCountBefore }, { count: ordersCountBefore }, { count: leaguesCount }] =
      await Promise.all([
        this.supabase.from('draft_picks').select(COLUMNS.COUNT, { count: 'exact', head: true }),
        this.supabase.from('draft_order').select(COLUMNS.COUNT, { count: 'exact', head: true }),
        this.supabase.from('leagues').select(COLUMNS.COUNT, { count: 'exact', head: true }),
      ]);

    // Batch delete — one DELETE per table instead of N DELETEs per league.
    // The old loop iterated every league and issued sequential deletes,
    // meaning 100 leagues = 200+ serial round-trips to Supabase.
    // RLS is evaluated per-row regardless, so a single unscoped DELETE
    // with admin/service role achieves the same result in 2 round-trips.
    await Promise.all([
      this.supabase.from('draft_picks').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
      this.supabase.from('draft_order').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    ]);

    await this.supabase
      .from('leagues')
      .update({ draft_status: 'not_started' })
      .in('draft_status', ['in_progress', 'completed']);

    return {
      deletedCounts: {
        picks: picksCountBefore || 0,
        orders: ordersCountBefore || 0,
        leagues: leaguesCount || 0,
      },
    };
  }

  async getAutopickRankings(leagueId: string, teamId?: string) {
    let query = this.supabase
      .from('player_autopick_rankings')
      .select('player_id, rank, position_code, tier')
      .eq('league_id', leagueId)
      .order('rank', { ascending: true });

    if (teamId) {
      query = query.eq('team_id', teamId);
    } else {
      query = query.is('team_id', null);
    }

    const { data, error } = await query;
    return {
      rankings: (data || []).map((r: { player_id: number; rank: number; position_code: string; tier?: number }) => ({
        playerId: r.player_id,
        rank: r.rank,
        positionCode: r.position_code,
        tier: r.tier || 1,
      })),
      error,
    };
  }
}

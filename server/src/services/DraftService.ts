import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS } from '@citrus/shared';
import { LeagueMembershipService } from './LeagueMembershipService';

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
    // Check player not already drafted
    const { data: existing } = await this.supabase
      .from('draft_picks')
      .select('id')
      .eq('league_id', leagueId)
      .eq('player_id', playerId)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return { pick: null, error: 'Player already drafted', isComplete: false };
    }

    // Check for duplicate pick number
    const { data: existingPick } = await this.supabase
      .from('draft_picks')
      .select('id')
      .eq('league_id', leagueId)
      .eq('pick_number', pickNumber)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    if (existingPick) {
      return { pick: null, error: 'Pick number already used', isComplete: false };
    }

    // Try RPC first, fallback to direct insert
    let pick: any = null;
    let error: any = null;

    const { data: rpcResult, error: rpcError } = await this.supabase.rpc('make_draft_pick', {
      p_league_id: leagueId,
      p_team_id: teamId,
      p_player_id: parseInt(String(playerId), 10),
      p_round_number: roundNumber,
      p_pick_number: pickNumber,
      p_draft_session_id: sessionId || null,
    });

    if (rpcError) {
      // Fallback to direct insert
      const { data: insertResult, error: insertError } = await this.supabase
        .from('draft_picks')
        .insert({
          league_id: leagueId,
          team_id: teamId,
          player_id: parseInt(String(playerId), 10),
          pick_number: pickNumber,
          round_number: roundNumber,
          draft_session_id: sessionId,
        })
        .select(COLUMNS.DRAFT_PICK)
        .single();

      pick = insertResult;
      error = insertError;
    } else {
      pick = rpcResult;
    }

    if (error) {
      return { pick: null, error: error.message || error, isComplete: false };
    }

    // Update league status from not_started to in_progress
    await this.supabase
      .from('leagues')
      .update({ draft_status: 'in_progress' })
      .eq('id', leagueId)
      .in('draft_status', ['not_started', 'queued']);

    // Check if draft is complete
    let isComplete = false;
    if (teamsCount) {
      const { data: league } = await this.supabase
        .from('leagues')
        .select('draft_rounds')
        .eq('id', leagueId)
        .single();

      const totalPicks = teamsCount * (league?.draft_rounds || 21);
      const { count } = await this.supabase
        .from('draft_picks')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .is('deleted_at', null);

      if (count && count >= totalPicks) {
        isComplete = true;
        await this.supabase
          .from('leagues')
          .update({ draft_status: 'completed' })
          .eq('id', leagueId);

        // Sync roster assignments
        await this.supabase.rpc('sync_roster_assignments_for_league', {
          p_league_id: leagueId,
        });
      }
    }

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

    const orders: any[] = [];
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

    const result = typeof data === 'string' ? JSON.parse(data) : data;
    return {
      playerId: result?.player_id || null,
      playerName: result?.player_name || null,
      position: result?.position || null,
      pickId: result?.pick_id || null,
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

    // Sync roster assignments
    await this.supabase.rpc('sync_roster_assignments_for_league', {
      p_league_id: leagueId,
    });

    const picks = (data || []).map((row: any) => ({
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
      rankings: (data || []).map((r: any) => ({
        playerId: r.player_id,
        rank: r.rank,
        positionCode: r.position_code,
        tier: r.tier || 1,
      })),
      error,
    };
  }
}

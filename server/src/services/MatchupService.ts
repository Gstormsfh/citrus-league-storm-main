import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS, logger } from '@citrus/shared';
import { getSupabaseAdmin } from '../lib/supabase';

/**
 * MatchupService — Server-side matchup management with DI Supabase client.
 *
 * Extracted from apps/web/src/services/MatchupService.ts.
 * Complex roster building and score calculation stays here;
 * pure transform functions stay in the web app.
 */
export class MatchupService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /** Get all matchups for a league (optionally filtered by week) */
  async getLeagueMatchups(leagueId: string, weekNumber?: number) {
    let query = this.supabase
      .from('matchups')
      .select(COLUMNS.MATCHUP)
      .eq('league_id', leagueId)
      .order('week_number', { ascending: true });

    if (weekNumber !== undefined) {
      query = query.eq('week_number', weekNumber);
    }

    const { data, error } = await query;
    return { matchups: data || [], error };
  }

  /** Get a single matchup by ID */
  async getMatchup(matchupId: string) {
    const { data, error } = await this.supabase
      .from('matchups')
      .select(COLUMNS.MATCHUP)
      .eq('id', matchupId)
      .single();

    return { matchup: data, error };
  }

  /** Get matchup with lines (pre-calculated player stats) */
  async getMatchupWithLines(matchupId: string) {
    const [matchupResult, linesResult] = await Promise.all([
      this.supabase
        .from('matchups')
        .select(COLUMNS.MATCHUP)
        .eq('id', matchupId)
        .single(),
      this.supabase
        .from('fantasy_matchup_lines')
        .select(COLUMNS.MATCHUP_LINES)
        .eq('matchup_id', matchupId),
    ]);

    if (matchupResult.error) {
      return { matchup: null, lines: [], error: matchupResult.error };
    }

    return {
      matchup: matchupResult.data,
      lines: linesResult.data || [],
      error: null,
    };
  }

  /** Get matchup scores (lines sorted by points) */
  async getMatchupScores(matchupId: string) {
    const { data, error } = await this.supabase
      .from('fantasy_matchup_lines')
      .select(COLUMNS.MATCHUP_LINES)
      .eq('matchup_id', matchupId)
      .order('total_points', { ascending: false });

    return { scores: data || [], error };
  }

  /** Get user's matchup for a specific week */
  async getUserMatchup(leagueId: string, userId: string, weekNumber: number) {
    // Find user's team
    const { data: team } = await this.supabase
      .from('teams')
      .select('id')
      .eq('league_id', leagueId)
      .eq('owner_id', userId)
      .maybeSingle();

    if (!team) {
      return { matchup: null, error: 'Team not found' };
    }

    const { data, error } = await this.supabase
      .from('matchups')
      .select(COLUMNS.MATCHUP)
      .eq('league_id', leagueId)
      .eq('week_number', weekNumber)
      .or(`team1_id.eq.${team.id},team2_id.eq.${team.id}`)
      .maybeSingle();

    return { matchup: data, error };
  }

  /** Get roster player IDs for a team (source of truth: roster_assignments) */
  async getRosterPlayerIds(teamId: string, leagueId: string) {
    // Use admin client to bypass RLS — critical for AI teams (owner_id = NULL)
    // whose roster_assignments are not visible through user-scoped clients.
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('roster_assignments')
      .select('player_id')
      .eq('team_id', teamId)
      .eq('league_id', leagueId);

    const ids = (data || []).map((r: any) => String(r.player_id));
    console.log(`[getRosterPlayerIds] team=${teamId.slice(0,8)} count=${ids.length}${error ? ' ERROR: ' + error.message : ''}`);
    return ids;
  }

  /** Get matchup history between two teams */
  async getMatchupHistory(leagueId: string, team1Id: string, team2Id: string | null) {
    if (!team2Id) return { matchups: [], error: null };

    const { data: forward } = await this.supabase
      .from('matchups')
      .select(COLUMNS.MATCHUP)
      .eq('league_id', leagueId)
      .eq('team1_id', team1Id)
      .eq('team2_id', team2Id)
      .in('status', ['completed', 'final']);

    const { data: reverse } = await this.supabase
      .from('matchups')
      .select(COLUMNS.MATCHUP)
      .eq('league_id', leagueId)
      .eq('team1_id', team2Id)
      .eq('team2_id', team1Id)
      .in('status', ['completed', 'final']);

    const all = [...(forward || []), ...(reverse || [])];
    all.sort((a: any, b: any) => a.week_number - b.week_number);

    return { matchups: all, error: null };
  }

  /** Generate round-robin matchups for a league */
  async generateMatchupsForLeague(
    leagueId: string,
    teams: Array<{ id: string }>,
    fantasyWeeks: Array<{ week_number: number; start_date: string; end_date: string }>,
    forceRegenerate = false,
  ) {
    if (forceRegenerate) {
      await this.supabase.from('matchups').delete().eq('league_id', leagueId);
    }

    const numTeams = teams.length;
    const numRounds = numTeams % 2 === 0 ? numTeams - 1 : numTeams;
    const matchups: any[] = [];

    for (const week of fantasyWeeks) {
      const pairings = this.getRoundRobinPairings(week.week_number, teams, numRounds);
      for (const pair of pairings) {
        if (!pair.team2) continue; // Skip bye weeks
        matchups.push({
          league_id: leagueId,
          week_number: week.week_number,
          team1_id: pair.team1.id,
          team2_id: pair.team2.id,
          week_start_date: week.start_date,
          week_end_date: week.end_date,
          status: 'scheduled',
        });
      }
    }

    if (matchups.length === 0) {
      return { error: null };
    }

    const { error } = await this.supabase.from('matchups').insert(matchups);
    return { error };
  }

  /** Circle Method round-robin scheduling */
  private getRoundRobinPairings(
    weekNumber: number,
    teams: Array<{ id: string }>,
    numRounds: number,
  ) {
    const n = teams.length;
    const adjustedWeek = ((weekNumber - 1) % numRounds);

    // Create rotating array (first team is fixed)
    const rotatingTeams = teams.slice(1);
    const rotated = [
      ...rotatingTeams.slice(adjustedWeek % rotatingTeams.length),
      ...rotatingTeams.slice(0, adjustedWeek % rotatingTeams.length),
    ];

    const allTeams = [teams[0], ...rotated];
    const pairings: Array<{ team1: { id: string }; team2: { id: string } | null }> = [];
    const halfCount = Math.floor(n / 2);

    for (let i = 0; i < halfCount; i++) {
      pairings.push({
        team1: allTeams[i],
        team2: allTeams[n - 1 - i] || null,
      });
    }

    // Handle odd number of teams (bye week)
    if (n % 2 !== 0) {
      pairings.push({ team1: allTeams[halfCount], team2: null });
    }

    return pairings;
  }

  /** Delete all matchups for a league */
  async deleteAllMatchupsForLeague(leagueId: string) {
    const { error } = await this.supabase
      .from('matchups')
      .delete()
      .eq('league_id', leagueId);

    return { error };
  }

  /** Update all matchup scores via RPC */
  async updateMatchupScores(leagueId?: string) {
    const { data, error } = await this.supabase.rpc('update_all_matchup_scores', {
      p_league_id: leagueId || null,
    });

    return { data, error };
  }

  /** Get playoff bracket */
  async getPlayoffBracket(leagueId: string) {
    const { data: league } = await this.supabase
      .from('leagues')
      .select('settings')
      .eq('id', leagueId)
      .single();

    const playoffSettings = league?.settings?.playoffs || {};

    const { data: teams } = await this.supabase
      .from('teams')
      .select(COLUMNS.TEAM_SLIM)
      .eq('league_id', leagueId);

    const { data: matchups } = await this.supabase
      .from('matchups')
      .select(COLUMNS.MATCHUP)
      .eq('league_id', leagueId)
      .gte('week_number', playoffSettings.startWeek || 999)
      .order('week_number', { ascending: true });

    return {
      teams: teams || [],
      matchups: matchups || [],
      settings: playoffSettings,
      error: null,
    };
  }

  /**
   * Build a default lineup from roster_assignments + player_directory and
   * persist it to team_lineups so the INSERT trigger fires.
   * Returns true if a lineup was created, false if no roster players found.
   */
  private async buildAndSaveDefaultLineup(
    admin: ReturnType<typeof getSupabaseAdmin>,
    teamId: string,
    leagueId: string,
  ): Promise<boolean> {
    // Get all players assigned to this team
    const { data: assignments, error: assignErr } = await admin
      .from('roster_assignments')
      .select('player_id')
      .eq('team_id', teamId)
      .eq('league_id', leagueId);

    if (assignErr) {
      console.error('[buildDefaultLineup] roster_assignments query error:', assignErr);
      return false;
    }
    if (!assignments || assignments.length === 0) {
      console.error('[buildDefaultLineup] No roster_assignments for team', teamId);
      return false;
    }

    const playerIds = assignments.map((a: { player_id: number }) => a.player_id);
    console.log('[buildDefaultLineup] Found', playerIds.length, 'roster players for team', teamId);

    // Get position info from player_directory — MUST filter by current season
    // to avoid duplicate rows (one per season per player)
    const CURRENT_SEASON = 2025;
    const { data: players, error: pdErr } = await admin
      .from('player_directory')
      .select('player_id, position_code, is_goalie')
      .in('player_id', playerIds)
      .eq('season', CURRENT_SEASON);

    if (pdErr) {
      console.error('[buildDefaultLineup] player_directory query error:', pdErr);
      return false;
    }
    if (!players || players.length === 0) {
      console.error('[buildDefaultLineup] No player_directory rows for season', CURRENT_SEASON, '— trying without season filter');
      // Fallback: get latest row per player without season filter
      const { data: fallbackPlayers } = await admin
        .from('player_directory')
        .select('player_id, position_code, is_goalie')
        .in('player_id', playerIds)
        .order('season', { ascending: false });

      if (!fallbackPlayers || fallbackPlayers.length === 0) {
        console.error('[buildDefaultLineup] No player_directory rows at all');
        return false;
      }
      // Deduplicate — keep first row per player_id (latest season)
      const seen = new Set<number>();
      const dedupedPlayers = fallbackPlayers.filter((p: { player_id: number }) => {
        if (seen.has(p.player_id)) return false;
        seen.add(p.player_id);
        return true;
      });
      return this.buildLineupFromPlayers(admin, teamId, leagueId, dedupedPlayers);
    }

    return this.buildLineupFromPlayers(admin, teamId, leagueId, players);
  }

  /**
   * Helper: Given a list of unique players, build starters/bench and save to team_lineups.
   */
  private async buildLineupFromPlayers(
    admin: ReturnType<typeof getSupabaseAdmin>,
    teamId: string,
    leagueId: string,
    players: Array<{ player_id: number; position_code: string; is_goalie: boolean }>,
  ): Promise<boolean> {
    const slotsNeeded: Record<string, number> = { C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 1 };
    const slotsFilled: Record<string, number> = { C: 0, LW: 0, RW: 0, D: 0, G: 0, UTIL: 0 };
    const starters: number[] = [];
    const bench: number[] = [];
    const slotAssignments: Record<string, string> = {};

    const getPos = (p: { position_code: string; is_goalie: boolean }): string => {
      if (p.is_goalie || p.position_code === 'G') return 'G';
      const code = (p.position_code || '').toUpperCase();
      if (code === 'C') return 'C';
      if (code === 'LW' || code === 'L') return 'LW';
      if (code === 'RW' || code === 'R') return 'RW';
      if (code === 'D') return 'D';
      return 'UTIL';
    };

    for (const player of players) {
      const pos = getPos(player);
      let assigned = false;

      if (pos !== 'UTIL' && slotsFilled[pos] < (slotsNeeded[pos] || 0)) {
        slotsFilled[pos]++;
        assigned = true;
        slotAssignments[String(player.player_id)] = `slot-${pos}-${slotsFilled[pos]}`;
      } else if (pos !== 'G' && slotsFilled['UTIL'] < slotsNeeded['UTIL']) {
        slotsFilled['UTIL']++;
        assigned = true;
        slotAssignments[String(player.player_id)] = 'slot-UTIL';
      }

      if (assigned) {
        starters.push(player.player_id);
      } else {
        bench.push(player.player_id);
      }
    }

    if (starters.length === 0) {
      console.error('[buildLineupFromPlayers] No starters generated for team', teamId);
      return false;
    }

    console.log('[buildLineupFromPlayers] Built lineup:', starters.length, 'starters,', bench.length, 'bench for team', teamId);

    // Save to team_lineups via admin (bypasses RLS for AI teams)
    const { error: upsertErr } = await admin
      .from('team_lineups')
      .upsert(
        {
          team_id: teamId,
          league_id: leagueId,
          starters,
          bench,
          ir: [],
          slot_assignments: slotAssignments,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'league_id,team_id' },
      );

    if (upsertErr) {
      console.error('[buildLineupFromPlayers] team_lineups upsert error:', upsertErr);
      return false;
    }

    console.log('[buildLineupFromPlayers] Saved team_lineups for team', teamId);
    return true;
  }

  /**
   * Backfill fantasy_daily_rosters for a team if any dates are missing.
   * This handles AI teams (or any team) whose lineup was INSERTed but the
   * auto-sync trigger only populated today+future dates, leaving past dates empty.
   *
   * If no team_lineups entry exists (common for AI teams), falls back to
   * roster_assignments + player_directory to build a default lineup, then
   * persists it to team_lineups so the INSERT trigger can fire for future matchups.
   *
   * Uses admin client to bypass RLS (AI teams have owner_id = NULL).
   */
  private async backfillDailyRostersIfMissing(
    teamId: string,
    matchupId: string,
    leagueId: string,
    weekStart: string,
    weekEnd: string,
  ) {
    const admin = getSupabaseAdmin();

    // Try team_lineups first
    const { data: lineup } = await admin
      .from('team_lineups')
      .select('starters, bench, ir, slot_assignments')
      .eq('team_id', teamId)
      .eq('league_id', leagueId)
      .maybeSingle();

    // If no team_lineups entry, build one from roster_assignments
    if (!lineup?.starters || lineup.starters.length === 0) {
      const built = await this.buildAndSaveDefaultLineup(admin, teamId, leagueId);
      if (!built) return;
      // Re-read after save (trigger may have created some daily rosters)
    }

    // Re-read lineup (may have just been created above)
    const { data: finalLineup } = await admin
      .from('team_lineups')
      .select('starters, bench, ir, slot_assignments')
      .eq('team_id', teamId)
      .eq('league_id', leagueId)
      .maybeSingle();

    if (!finalLineup?.starters || finalLineup.starters.length === 0) return;

    // Generate all dates in the matchup week
    const dates: string[] = [];
    const start = new Date(weekStart + 'T00:00:00');
    const end = new Date(weekEnd + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }

    // Check which (player_id, roster_date) combos already exist
    const { data: existingRecords } = await admin
      .from('fantasy_daily_rosters')
      .select('roster_date, player_id')
      .eq('team_id', teamId)
      .eq('matchup_id', matchupId);

    const existingKeys = new Set(
      (existingRecords || []).map((r: { player_id: number; roster_date: string }) =>
        `${r.player_id}_${r.roster_date}`
      ),
    );

    // Build rows only for missing (player, date) combos
    const rows: Array<{
      league_id: string;
      team_id: string;
      matchup_id: string;
      player_id: number;
      roster_date: string;
      slot_type: string;
      slot_id: string | null;
      is_locked: boolean;
    }> = [];
    const slotAssignments = finalLineup.slot_assignments || {};
    const today = new Date().toISOString().split('T')[0];

    const addRows = (playerIds: number[] | string[], slotType: string, useSlot: boolean) => {
      for (const pid of playerIds || []) {
        const playerId = typeof pid === 'string' ? parseInt(pid, 10) : pid;
        for (const date of dates) {
          if (existingKeys.has(`${playerId}_${date}`)) continue;
          rows.push({
            league_id: leagueId,
            team_id: teamId,
            matchup_id: matchupId,
            player_id: playerId,
            roster_date: date,
            slot_type: slotType,
            slot_id: useSlot ? (slotAssignments[String(playerId)] || null) : null,
            is_locked: date < today, // Lock past dates
          });
        }
      }
    };

    addRows(finalLineup.starters, 'active', true);
    addRows(finalLineup.bench || [], 'bench', false);
    addRows(finalLineup.ir || [], 'ir', true);

    if (rows.length > 0) {
      console.log('[backfillDailyRosters] Inserting', rows.length, 'rows for team', teamId);
      const { error: upsertErr } = await admin
        .from('fantasy_daily_rosters')
        .upsert(rows, {
          onConflict: 'team_id,matchup_id,player_id,roster_date',
          ignoreDuplicates: true,
        });
      if (upsertErr) {
        console.error('[backfillDailyRosters] upsert error:', upsertErr);
      }
    } else {
      console.log('[backfillDailyRosters] No missing rows for team', teamId);
    }
  }

  /**
   * Ensure both teams in a matchup have team_lineups and fantasy_daily_rosters.
   * Called from the Matchup page BEFORE loading any roster data.
   * Handles AI teams that never had a lineup saved (RLS-blocked on frontend).
   */
  async ensureMatchupRosters(matchupId: string) {
    console.log('[ensureMatchupRosters] START for matchup:', matchupId);
    const admin = getSupabaseAdmin();

    const { data: matchup, error: matchupError } = await admin
      .from('matchups')
      .select('team1_id, team2_id, week_start_date, week_end_date, league_id')
      .eq('id', matchupId)
      .single();

    if (matchupError || !matchup) {
      console.error('[ensureMatchupRosters] Matchup not found:', matchupId, matchupError);
      return { initialized: 0 };
    }

    let initialized = 0;
    const teamIds = [matchup.team1_id, matchup.team2_id].filter(Boolean);

    for (const teamId of teamIds) {
      // Check if team_lineups exists
      const { data: lineup } = await admin
        .from('team_lineups')
        .select('starters')
        .eq('team_id', teamId)
        .eq('league_id', matchup.league_id)
        .maybeSingle();

      if (!lineup?.starters || (Array.isArray(lineup.starters) && lineup.starters.length === 0)) {
        console.log('[ensureMatchupRosters] No lineup for team', teamId, '— building from roster_assignments');
        const created = await this.buildAndSaveDefaultLineup(admin, teamId, matchup.league_id);
        if (created) {
          initialized++;
          console.log('[ensureMatchupRosters] Created lineup for team', teamId);
        } else {
          console.error('[ensureMatchupRosters] Failed to create lineup for team', teamId, '— no roster_assignments?');
        }
      }

      // Backfill fantasy_daily_rosters for any missing dates
      await this.backfillDailyRostersIfMissing(
        teamId, matchupId, matchup.league_id,
        matchup.week_start_date, matchup.week_end_date,
      );
    }

    return { initialized };
  }

  /** Get daily matchup scores via RPC (calls once per team, returns combined results) */
  async calculateDailyMatchupScores(matchupId: string) {
    // Use admin client for RPC calls — ensures SECURITY DEFINER functions
    // work correctly regardless of user JWT context. Critical for AI teams
    // (owner_id = NULL) whose fantasy_daily_rosters may not be visible
    // through user-scoped PostgREST connections.
    const admin = getSupabaseAdmin();

    // The RPC requires team_id + week dates, so look up the matchup first
    const { data: matchup, error: matchupError } = await admin
      .from('matchups')
      .select('team1_id, team2_id, week_start_date, week_end_date, league_id')
      .eq('id', matchupId)
      .single();

    if (matchupError || !matchup) {
      return { data: null, error: matchupError || { message: 'Matchup not found' } };
    }

    // Backfill fantasy_daily_rosters for teams missing entries (e.g. AI teams)
    await Promise.all([
      this.backfillDailyRostersIfMissing(
        matchup.team1_id, matchupId, matchup.league_id,
        matchup.week_start_date, matchup.week_end_date,
      ),
      matchup.team2_id
        ? this.backfillDailyRostersIfMissing(
            matchup.team2_id, matchupId, matchup.league_id,
            matchup.week_start_date, matchup.week_end_date,
          )
        : Promise.resolve(),
    ]);

    // Call the RPC for each team in parallel using admin client
    const [team1Result, team2Result] = await Promise.all([
      admin.rpc('calculate_daily_matchup_scores', {
        p_matchup_id: matchupId,
        p_team_id: matchup.team1_id,
        p_week_start: matchup.week_start_date,
        p_week_end: matchup.week_end_date,
      }),
      matchup.team2_id
        ? admin.rpc('calculate_daily_matchup_scores', {
            p_matchup_id: matchupId,
            p_team_id: matchup.team2_id,
            p_week_start: matchup.week_start_date,
            p_week_end: matchup.week_end_date,
          })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (team1Result.error) {
      console.error('[calculateDailyMatchupScores] team1 RPC error:', team1Result.error);
      return { data: null, error: team1Result.error };
    }
    if (team2Result.error) {
      console.error('[calculateDailyMatchupScores] team2 RPC error:', team2Result.error);
      return { data: null, error: team2Result.error };
    }

    // Log RPC results for debugging AI team scoring issues
    const team1Sum = (team1Result.data || []).reduce((s: number, r: any) => s + parseFloat(r.daily_score || 0), 0);
    const team2Sum = (team2Result.data || []).reduce((s: number, r: any) => s + parseFloat(r.daily_score || 0), 0);
    console.log(`[calculateDailyMatchupScores] matchup=${matchupId} team1=${matchup.team1_id} sum=${team1Sum.toFixed(1)} team2=${matchup.team2_id} sum=${team2Sum.toFixed(1)}`);

    // Combine results with team_id attached (frontend filters by team_id)
    const combined = [
      ...(team1Result.data || []).map((row: any) => ({ ...row, team_id: matchup.team1_id })),
      ...(team2Result.data || []).map((row: any) => ({ ...row, team_id: matchup.team2_id })),
    ];

    return { data: combined, error: null };
  }

  /** Get matchup stats for players via RPC */
  async getMatchupStats(playerIds: number[], startDate: string, endDate: string) {
    const { data, error } = await this.supabase.rpc('get_matchup_stats', {
      p_player_ids: playerIds,
      p_start_date: startDate,
      p_end_date: endDate,
    });

    const statsMap = new Map<number, any>();
    for (const row of data || []) {
      statsMap.set(row.player_id, row);
    }

    return { statsMap, error };
  }

  /** Get daily projections for players on a date */
  async getDailyProjections(playerIds: number[], targetDate: string) {
    const { data, error } = await this.supabase.rpc('get_daily_projections', {
      p_player_ids: playerIds,
      p_target_date: targetDate,
    });

    const projMap = new Map<number, any>();
    for (const row of data || []) {
      projMap.set(row.player_id, row);
    }

    return { projMap, error };
  }

  /** Get daily lineup via RPC */
  async getDailyLineup(teamId: string, matchupId: string, date: string) {
    // Use admin client to bypass RLS — ensures AI team lineups are visible
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.rpc('get_daily_lineup', {
      p_team_id: teamId,
      p_matchup_id: matchupId,
      p_date: date,
    });

    return { lineup: data || [], error };
  }

  /** Auto-complete matchups and update scores */
  async autoCompleteMatchups() {
    const { error } = await this.supabase.rpc('auto_complete_matchups');
    return { success: !error, error: error?.message };
  }

  /** H2H Category results via RPC */
  async getH2HCategoryResults(
    leagueId: string,
    matchupId: string,
    team1Id: string,
    team2Id: string,
    weekStart: string,
    weekEnd: string,
    categories: string[],
  ) {
    const { data, error } = await this.supabase.rpc('calculate_h2h_category_matchup', {
      p_league_id: leagueId,
      p_matchup_id: matchupId,
      p_team1_id: team1Id,
      p_team2_id: team2Id,
      p_week_start: weekStart,
      p_week_end: weekEnd,
      p_categories: categories,
    });

    return { results: data || [], error };
  }

  /** Roto standings via RPC */
  async getRotoStandings(leagueId: string, categories: string[], throughWeek?: number) {
    const { data, error } = await this.supabase.rpc('calculate_roto_standings', {
      p_league_id: leagueId,
      p_categories: categories,
      p_through_week: throughWeek || null,
    });

    return { standings: data || [], error };
  }

  /** PPG standings via RPC */
  async getPPGStandings(leagueId: string, throughWeek?: number) {
    const { data, error } = await this.supabase.rpc('calculate_ppg_standings', {
      p_league_id: leagueId,
      p_through_week: throughWeek || null,
    });

    return { standings: data || [], error };
  }

  /** Get daily game stats for players on a specific date */
  async getDailyGameStats(playerIds: number[], gameDate: string) {
    const { data, error } = await this.supabase.rpc('get_daily_game_stats', {
      p_player_ids: playerIds,
      p_game_date: gameDate,
    });

    return { stats: data || [], error };
  }

  /** Get frozen daily roster entries for a team/matchup/date */
  async getFrozenRoster(teamId: string, matchupId: string, date: string) {
    // Use admin client to bypass RLS — ensures AI team rosters are visible
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('fantasy_daily_rosters')
      .select('player_id, slot_type, slot_id')
      .eq('team_id', teamId)
      .eq('matchup_id', matchupId)
      .eq('roster_date', date);

    return { roster: data || [], error };
  }

  /** Get all frozen roster entries for a matchup (multiple dates) */
  async getFrozenRosterBatch(matchupId: string, dates: string[]) {
    const admin = getSupabaseAdmin();

    // First, try to backfill any teams missing entries (e.g. AI teams)
    const { data: matchup } = await admin
      .from('matchups')
      .select('team1_id, team2_id, week_start_date, week_end_date, league_id')
      .eq('id', matchupId)
      .single();

    if (matchup) {
      await Promise.all([
        this.backfillDailyRostersIfMissing(
          matchup.team1_id, matchupId, matchup.league_id,
          matchup.week_start_date, matchup.week_end_date,
        ),
        matchup.team2_id
          ? this.backfillDailyRostersIfMissing(
              matchup.team2_id, matchupId, matchup.league_id,
              matchup.week_start_date, matchup.week_end_date,
            )
          : Promise.resolve(),
      ]);
    }

    // Fetch frozen roster entries
    const { data: entries, error } = await admin
      .from('fantasy_daily_rosters')
      .select('player_id, team_id, roster_date, slot_type, slot_id')
      .eq('matchup_id', matchupId)
      .in('roster_date', dates);

    if (error || !entries || entries.length === 0) {
      return { entries: entries || [], error };
    }

    // Join with player_directory to return player details.
    // This eliminates the need for frontend enrichment, which fails for
    // AI teams whose roster_assignments are blocked by RLS.
    const uniquePlayerIds = [...new Set(entries.map((e: any) => Number(e.player_id)))];

    const { data: players } = await admin
      .from('player_directory')
      .select('player_id, full_name, position_code, is_goalie, team_abbrev, headshot_url')
      .in('player_id', uniquePlayerIds);

    const playerMap = new Map<number, any>();
    (players || []).forEach((p: any) => {
      playerMap.set(Number(p.player_id), p);
    });

    // Enrich entries with player details
    const enrichedEntries = entries.map((entry: any) => {
      const player = playerMap.get(Number(entry.player_id));
      return {
        ...entry,
        // Player details (used by frontend to render without enrichment)
        player_name: player?.full_name || '',
        player_position: player?.position_code || '',
        player_team: player?.team_abbrev || '',
        player_team_abbreviation: player?.team_abbrev || '',
        player_headshot_url: player?.headshot_url || '',
        player_is_goalie: player?.is_goalie || false,
      };
    });

    const withNames = enrichedEntries.filter((e: any) => e.player_name);
    console.log(`[getFrozenRosterBatch] entries=${entries.length} playerDir=${players?.length || 0} enriched=${withNames.length}`);
    return { entries: enrichedEntries, error };
  }

  /** Lock completed days in fantasy_daily_rosters */
  async lockCompletedDays() {
    // Find all games that are 'final' (completed)
    const { data: finalGames, error: gamesError } = await this.supabase
      .from('nhl_games')
      .select('game_date')
      .eq('status', 'final');

    if (gamesError || !finalGames?.length) {
      return { lockedCount: 0, error: gamesError };
    }

    const gameDates = [...new Set(finalGames.map((g: any) => g.game_date))];

    const { data: updated, error: updateError } = await this.supabase
      .from('fantasy_daily_rosters')
      .update({
        is_locked: true,
        locked_at: new Date().toISOString(),
      })
      .in('roster_date', gameDates)
      .eq('is_locked', false)
      .select('player_id');

    return { lockedCount: updated?.length || 0, error: updateError };
  }

  /** Get matchup score job status */
  async getJobStatus() {
    const [matchupResult, lockedResult, recentResult] = await Promise.all([
      this.supabase
        .from('matchups')
        .select('*', { count: 'exact', head: true })
        .in('status', ['scheduled', 'in_progress']),
      this.supabase
        .from('fantasy_daily_rosters')
        .select('*', { count: 'exact', head: true })
        .eq('is_locked', true),
      this.supabase
        .from('matchups')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      lastRun: recentResult.data?.updated_at || null,
      totalMatchups: matchupResult.count || 0,
      lockedDays: lockedResult.count || 0,
    };
  }
}

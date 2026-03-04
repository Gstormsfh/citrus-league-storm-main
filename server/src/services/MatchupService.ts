import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS } from '@citrus/shared';

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
    const { data } = await this.supabase
      .from('roster_assignments')
      .select('player_id')
      .eq('team_id', teamId)
      .eq('league_id', leagueId);

    return (data || []).map((r: any) => String(r.player_id));
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
   * Backfill fantasy_daily_rosters for a team if no entries exist.
   * This handles AI teams (or any team) whose lineup was INSERTed but the
   * auto-sync trigger (UPDATE-only) never fired.
   */
  private async backfillDailyRostersIfMissing(
    teamId: string,
    matchupId: string,
    leagueId: string,
    weekStart: string,
    weekEnd: string,
  ) {
    // Check if ANY entries exist for this team in this matchup
    const { count } = await this.supabase
      .from('fantasy_daily_rosters')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .eq('matchup_id', matchupId);

    if (count && count > 0) return; // Already has entries

    // No entries — read current lineup from team_lineups and backfill
    const { data: lineup } = await this.supabase
      .from('team_lineups')
      .select('starters, bench, ir, slot_assignments')
      .eq('team_id', teamId)
      .eq('league_id', leagueId)
      .maybeSingle();

    if (!lineup?.starters || lineup.starters.length === 0) return;

    // Generate date range for the matchup week
    const dates: string[] = [];
    const start = new Date(weekStart + 'T00:00:00');
    const end = new Date(weekEnd + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }

    // Build rows for all dates × all players (starters, bench, IR)
    const rows: any[] = [];
    const slotAssignments = lineup.slot_assignments || {};

    for (const date of dates) {
      for (const playerId of lineup.starters) {
        rows.push({
          league_id: leagueId,
          team_id: teamId,
          matchup_id: matchupId,
          player_id: typeof playerId === 'string' ? parseInt(playerId, 10) : playerId,
          roster_date: date,
          slot_type: 'active',
          slot_id: slotAssignments[String(playerId)] || null,
          is_locked: false,
        });
      }
      for (const playerId of (lineup.bench || [])) {
        rows.push({
          league_id: leagueId,
          team_id: teamId,
          matchup_id: matchupId,
          player_id: typeof playerId === 'string' ? parseInt(playerId, 10) : playerId,
          roster_date: date,
          slot_type: 'bench',
          slot_id: null,
          is_locked: false,
        });
      }
      for (const playerId of (lineup.ir || [])) {
        rows.push({
          league_id: leagueId,
          team_id: teamId,
          matchup_id: matchupId,
          player_id: typeof playerId === 'string' ? parseInt(playerId, 10) : playerId,
          roster_date: date,
          slot_type: 'ir',
          slot_id: slotAssignments[String(playerId)] || null,
          is_locked: false,
        });
      }
    }

    if (rows.length > 0) {
      await this.supabase
        .from('fantasy_daily_rosters')
        .upsert(rows, { onConflict: 'team_id,matchup_id,player_id,roster_date' });
    }
  }

  /** Get daily matchup scores via RPC (calls once per team, returns combined results) */
  async calculateDailyMatchupScores(matchupId: string) {
    // The RPC requires team_id + week dates, so look up the matchup first
    const { data: matchup, error: matchupError } = await this.supabase
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

    // Call the RPC for each team in parallel
    const [team1Result, team2Result] = await Promise.all([
      this.supabase.rpc('calculate_daily_matchup_scores', {
        p_matchup_id: matchupId,
        p_team_id: matchup.team1_id,
        p_week_start: matchup.week_start_date,
        p_week_end: matchup.week_end_date,
      }),
      matchup.team2_id
        ? this.supabase.rpc('calculate_daily_matchup_scores', {
            p_matchup_id: matchupId,
            p_team_id: matchup.team2_id,
            p_week_start: matchup.week_start_date,
            p_week_end: matchup.week_end_date,
          })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (team1Result.error) return { data: null, error: team1Result.error };
    if (team2Result.error) return { data: null, error: team2Result.error };

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
    const { data, error } = await this.supabase.rpc('get_daily_lineup', {
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
    const { data, error } = await this.supabase
      .from('fantasy_daily_rosters')
      .select('player_id, slot_type, slot_id')
      .eq('team_id', teamId)
      .eq('matchup_id', matchupId)
      .eq('roster_date', date);

    return { roster: data || [], error };
  }

  /** Get all frozen roster entries for a matchup (multiple dates) */
  async getFrozenRosterBatch(matchupId: string, dates: string[]) {
    // First, try to backfill any teams missing entries (e.g. AI teams)
    const { data: matchup } = await this.supabase
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

    const { data, error } = await this.supabase
      .from('fantasy_daily_rosters')
      .select('player_id, team_id, roster_date, slot_type, slot_id')
      .eq('matchup_id', matchupId)
      .in('roster_date', dates);

    return { entries: data || [], error };
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

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

  /** Get daily matchup scores via RPC */
  async calculateDailyMatchupScores(matchupId: string) {
    const { data, error } = await this.supabase.rpc('calculate_daily_matchup_scores', {
      p_matchup_id: matchupId,
    });

    return { data, error };
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

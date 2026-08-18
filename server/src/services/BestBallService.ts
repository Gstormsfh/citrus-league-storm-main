import { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentSeason } from '@citrus/shared';

export class BestBallService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async triggerOptimization(leagueId: string, date: string) {
    const { data, error } = await this.supabase.rpc('optimize_best_ball_daily_rosters', {
      p_league_id: leagueId, p_roster_date: date,
    });
    if (error) return { results: [], error: error.message };
    const results = (data || []).map((row: { team_id: string; players_optimized: number; total_points: number }) => ({
      team_id: row.team_id, players_optimized: row.players_optimized, total_points: row.total_points,
    }));
    return { results };
  }

  async triggerWeekOptimization(leagueId: string, weekStartDate: string, weekEndDate: string) {
    const [sy, sm, sd] = weekStartDate.split('-').map(Number);
    const [ey, em, ed] = weekEndDate.split('-').map(Number);
    const start = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    let daysOptimized = 0;

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const { error } = await this.triggerOptimization(leagueId, dateStr);
      if (!error) daysOptimized++;
    }

    return { daysOptimized };
  }

  /** Get weekly best ball data for a team (lineup, roster, player positions, weekly stats) */
  async getWeeklyBestBallData(leagueId: string, teamId: string, weekNumber: number) {
    const season = getCurrentSeason();

    // Get team lineup
    const { data: lineup } = await this.supabase
      .from('team_lineups')
      .select('starters, bench, ir')
      .eq('league_id', leagueId)
      .eq('team_id', teamId)
      .maybeSingle();

    // Get roster assignments
    const { data: assignments } = await this.supabase
      .from('roster_assignments')
      .select('player_id')
      .eq('league_id', leagueId)
      .eq('team_id', teamId);

    if (!assignments || assignments.length === 0) {
      return { lineup: null, playerIds: [], players: [], weeklyStats: [] };
    }

    const playerIds = assignments.map((a: { player_id: number }) => a.player_id);

    // Get player positions
    const { data: players } = await this.supabase
      .from('player_directory')
      .select('player_id, position_code, eligible_positions')
      .eq('season', season)
      .in('player_id', playerIds.map(Number));

    // Get weekly stats
    const { data: weeklyStats } = await this.supabase
      .from('player_weekly_stats')
      .select('player_id, goals, assists, shots_on_goal, blocks, hits, pim, ppp, shp, plus_minus, wins, saves, shutouts, goals_against')
      .eq('week_number', weekNumber)
      .in('player_id', playerIds.map(Number));

    return {
      lineup,
      playerIds,
      players: players || [],
      weeklyStats: weeklyStats || [],
    };
  }

  /** Get all teams in a league (for league-wide best ball calculation) */
  async getLeagueTeamIds(leagueId: string) {
    const { data: teams } = await this.supabase
      .from('teams')
      .select('id')
      .eq('league_id', leagueId);

    return teams || [];
  }
}

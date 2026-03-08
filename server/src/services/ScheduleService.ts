import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS } from '@citrus/shared';

/**
 * ScheduleService — Server-side NHL schedule queries with DI Supabase client.
 *
 * Extracted from apps/web/src/services/ScheduleService.ts.
 */
export class ScheduleService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /** Get NHL games for a date range */
  async getGamesForDateRange(startDate: string, endDate: string) {
    const { data, error } = await this.supabase
      .from('nhl_games')
      .select(COLUMNS.NHL_GAME)
      .gte('game_date', startDate)
      .lte('game_date', endDate)
      .order('game_date', { ascending: true })
      .order('game_time', { ascending: true });

    return { games: data || [], error };
  }

  /** Get NHL games for multiple teams (batch) */
  async getGamesForTeams(teamAbbrevs: string[], startDate?: string, endDate?: string) {
    const normalizedTeams = teamAbbrevs.map((t) => t.toUpperCase());
    const orConditions = normalizedTeams
      .flatMap((t) => [`home_team.eq.${t}`, `away_team.eq.${t}`])
      .join(',');

    let query = this.supabase
      .from('nhl_games')
      .select(COLUMNS.NHL_GAME)
      .or(orConditions)
      .order('game_date', { ascending: true });

    if (startDate) query = query.gte('game_date', startDate);
    if (endDate) query = query.lte('game_date', endDate);

    const { data, error } = await query;

    // Group by team
    const gamesByTeam = new Map<string, any[]>();
    for (const team of normalizedTeams) {
      gamesByTeam.set(team, []);
    }
    for (const game of (data || []) as any[]) {
      for (const team of normalizedTeams) {
        if (game.home_team === team || game.away_team === team) {
          gamesByTeam.get(team)?.push(game);
        }
      }
    }

    return { gamesByTeam, error };
  }

  /** Get NHL games for a single team */
  async getGamesForTeam(teamAbbrev: string, startDate?: string, endDate?: string) {
    const team = teamAbbrev.toUpperCase();
    let query = this.supabase
      .from('nhl_games')
      .select(COLUMNS.NHL_GAME)
      .or(`home_team.eq.${team},away_team.eq.${team}`)
      .order('game_date', { ascending: true });

    if (startDate) query = query.gte('game_date', startDate);
    if (endDate) query = query.lte('game_date', endDate);

    const { data, error } = await query;
    return { games: data || [], error };
  }

  /** Get next game for a specific team from today forward */
  async getNextGameForTeam(teamAbbrev: string) {
    const team = teamAbbrev.toUpperCase();
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await this.supabase
      .from('nhl_games')
      .select(COLUMNS.NHL_GAME)
      .or(`home_team.eq.${team},away_team.eq.${team}`)
      .gte('game_date', today)
      .in('status', ['Scheduled', 'Live', 'Final'])
      .order('game_date', { ascending: true })
      .limit(1)
      .maybeSingle();

    return { game: data, error };
  }

  /** Batch check if teams have games on a specific date */
  async hasGamesOnDateBatch(teamAbbrevs: string[], targetDate: string) {
    const normalizedTeams = teamAbbrevs.map((t) => t.toUpperCase());
    const orConditions = normalizedTeams
      .flatMap((t) => [`home_team.eq.${t}`, `away_team.eq.${t}`])
      .join(',');

    const { data } = await this.supabase
      .from('nhl_games')
      .select('home_team, away_team')
      .eq('game_date', targetDate)
      .or(orConditions);

    const result = new Map<string, boolean>();
    for (const team of normalizedTeams) {
      result.set(team, false);
    }
    for (const game of data || []) {
      if (result.has(game.home_team)) result.set(game.home_team, true);
      if (result.has(game.away_team)) result.set(game.away_team, true);
    }

    return result;
  }

  /** Get games for teams on a specific date */
  async getGamesForTeamsOnDate(teamAbbrevs: string[], targetDate: string) {
    const normalizedTeams = teamAbbrevs.map((t) => t.toUpperCase());
    const orConditions = normalizedTeams
      .flatMap((t) => [`home_team.eq.${t}`, `away_team.eq.${t}`])
      .join(',');

    const { data } = await this.supabase
      .from('nhl_games')
      .select(COLUMNS.NHL_GAME)
      .eq('game_date', targetDate)
      .or(orConditions);

    const result = new Map<string, any>();
    for (const team of normalizedTeams) {
      result.set(team, null);
    }
    for (const game of (data || []) as any[]) {
      for (const team of normalizedTeams) {
        if ((game.home_team === team || game.away_team === team) && !result.get(team)) {
          result.set(team, game);
        }
      }
    }

    return result;
  }

  /** Get fantasy week definitions */
  async getFantasyWeeks() {
    const { data, error } = await this.supabase
      .from('fantasy_weeks')
      .select(COLUMNS.FANTASY_WEEK)
      .order('week_number', { ascending: true });

    return { weeks: data || [], error };
  }

  /** Get remaining games in a week for a team */
  async getGamesRemainingInWeek(teamAbbrev: string, weekStart: string, weekEnd: string) {
    const team = teamAbbrev.toUpperCase();
    const today = new Date().toISOString().split('T')[0];

    const { data } = await this.supabase
      .from('nhl_games')
      .select('game_id')
      .or(`home_team.eq.${team},away_team.eq.${team}`)
      .gte('game_date', today > weekStart ? today : weekStart)
      .lte('game_date', weekEnd)
      .in('status', ['Scheduled', 'Live']);

    return data?.length || 0;
  }

  /** Get total games in a week for a team */
  async getTotalGamesInWeek(teamAbbrev: string, weekStart: string, weekEnd: string) {
    const team = teamAbbrev.toUpperCase();

    const { data } = await this.supabase
      .from('nhl_games')
      .select('game_id')
      .or(`home_team.eq.${team},away_team.eq.${team}`)
      .gte('game_date', weekStart)
      .lte('game_date', weekEnd);

    return data?.length || 0;
  }
}

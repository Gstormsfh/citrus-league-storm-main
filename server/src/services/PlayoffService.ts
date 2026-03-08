import { SupabaseClient } from '@supabase/supabase-js';
import { CURRENT_SEASON } from '@citrus/shared';

export class PlayoffService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async getBracket(leagueId: string) {
    const { data: bracket, error: bracketError } = await this.supabase
      .from('playoff_brackets')
      .select('id, league_id, season, bracket_size, status, current_round, total_rounds, seeding_method, reseed_each_round, consolation_enabled, two_week_matchups, champion_team_id, runner_up_team_id, third_place_team_id, generated_by, started_at, completed_at, created_at, updated_at')
      .eq('league_id', leagueId)
      .eq('season', CURRENT_SEASON)
      .maybeSingle();

    if (bracketError) return { bracket: null, seeds: [], series: [], error: bracketError };
    if (!bracket) return { bracket: null, seeds: [], series: [], error: null };

    const [seedsResult, seriesResult] = await Promise.all([
      this.supabase.from('playoff_seeds').select('id, bracket_id, team_id, seed_number, regular_season_wins, regular_season_losses, regular_season_ties, regular_season_points_for, source, created_at')
        .eq('bracket_id', bracket.id).order('seed_number', { ascending: true }),
      this.supabase.from('playoff_series').select('id, bracket_id, round_number, match_number, bracket_position, home_seed, away_seed, home_team_id, away_team_id, home_score, away_score, winner_team_id, loser_team_id, status, matchup_week_1, matchup_week_2, winner_advances_to, winner_slot, loser_drops_to, loser_slot, created_at, updated_at')
        .eq('bracket_id', bracket.id).order('round_number', { ascending: true }).order('match_number', { ascending: true }),
    ]);

    return {
      bracket,
      seeds: seedsResult.data ?? [],
      series: seriesResult.data ?? [],
      error: seedsResult.error || seriesResult.error,
    };
  }

  async generateBracket(leagueId: string, options: {
    consolationEnabled?: boolean; twoWeekMatchups?: boolean; reseedEachRound?: boolean; seedingMethod?: string;
  } = {}) {
    const { data, error } = await this.supabase.rpc('generate_playoff_bracket', {
      p_league_id: leagueId,
      p_consolation_enabled: options.consolationEnabled ?? false,
      p_two_week_matchups: options.twoWeekMatchups ?? false,
      p_reseed_each_round: options.reseedEachRound ?? false,
      p_seeding_method: options.seedingMethod ?? 'standings',
    });
    if (error) return { result: null, error };
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    if (result?.error) return { result: null, error: new Error(result.error) };
    return { result, error: null };
  }

  async advanceRound(bracketId: string) {
    const { data, error } = await this.supabase.rpc('advance_playoff_round', { p_bracket_id: bracketId });
    if (error) return { result: null, error };
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    if (result?.error) return { result: null, error: new Error(result.error) };
    return { result, error: null };
  }

  async resetBracket(leagueId: string) {
    const { data, error } = await this.supabase.rpc('reset_playoff_bracket', { p_league_id: leagueId });
    if (error) return { error };
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    if (result?.error) return { error: new Error(result.error) };
    return { error: null };
  }

  async getPlayoffPicture(leagueId: string) {
    const { data, error } = await this.supabase.rpc('get_playoff_picture', { p_league_id: leagueId });
    if (error) return { picture: null, error };
    const result = typeof data === 'string' ? JSON.parse(data) : data;
    if (result?.error) return { picture: null, error: new Error(result.error) };
    return { picture: result, error: null };
  }
}

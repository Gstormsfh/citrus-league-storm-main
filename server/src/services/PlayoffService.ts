import { SupabaseClient } from '@supabase/supabase-js';
import { CURRENT_SEASON, COLUMNS } from '@citrus/shared';
import { getSupabaseAdmin } from '../lib/supabase';

export class PlayoffService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async getBracket(leagueId: string) {
    // Auto-generate bracket if conditions are met (regular season complete,
    // fantasy league, draft completed, no bracket yet). Uses service role so
    // it bypasses the commissioner auth check. Fire-and-forget on errors —
    // we never want auto-gen failures to block reads.
    try {
      const admin = getSupabaseAdmin();
      await admin.rpc('auto_generate_playoff_bracket', { p_league_id: leagueId });
    } catch {
      // Admin client may be unavailable in dev; ignore.
    }

    const { data: bracket, error: bracketError } = await this.supabase
      .from('playoff_brackets')
      .select(COLUMNS.PLAYOFF_BRACKET)
      .eq('league_id', leagueId)
      .eq('season', CURRENT_SEASON)
      .maybeSingle();

    if (bracketError) return { bracket: null, seeds: [], series: [], error: bracketError };
    if (!bracket) return { bracket: null, seeds: [], series: [], error: null };

    const [seedsResult, seriesResult] = await Promise.all([
      this.supabase.from('playoff_seeds').select(COLUMNS.PLAYOFF_SEED)
        .eq('bracket_id', (bracket as any).id).order('seed_number', { ascending: true }),
      this.supabase.from('playoff_series').select(COLUMNS.PLAYOFF_SERIES)
        .eq('bracket_id', (bracket as any).id).order('round_number', { ascending: true }).order('match_number', { ascending: true }),
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

/**
 * Reads the season tables, runs the pure record-book computation, and
 * replaces the league's computed/imported trophies. Manual trophies (source
 * = 'manual') are never touched by a recompute. Old rows are retired, not
 * deleted.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeTrophies, type SeasonRow, type TeamRow, type MatchupRow, type TrophyRow } from '../../import/trophies';

const SEASON_COLUMNS = 'season, scoring_type, champion_member_id, runner_up_member_id, regular_winner_id, is_verified_by_bracket, is_finished';
const TEAM_COLUMNS = 'season, member_id, team_name, rank, wins, losses, ties, points_for, points_against, made_playoffs, playoff_finish, playoff_seed';
const MATCHUP_COLUMNS = 'season, week, home_member_id, away_member_id, home_score, away_score, home_cat_wins, home_cat_losses, home_cat_ties, category_results, is_playoff, is_consolation, is_championship, winner_member_id, is_tie';
const TROPHY_COLUMNS = 'id, league_id, season, member_id, trophy_key, rank, value, detail, source, computed_from_job_id, computed_at, display_name, icon_key, is_hidden, retired_at';

export interface TrophyRecord extends TrophyRow {
  id: string; league_id: string; computed_from_job_id: string | null; computed_at: string;
  display_name: string | null; icon_key: string | null; is_hidden: boolean; retired_at: string | null;
}

export class TrophyService {
  constructor(private readonly supabase: SupabaseClient) {}

  async loadInput(leagueId: string): Promise<{ seasons: SeasonRow[]; teams: TeamRow[]; matchups: MatchupRow[] }> {
    const [s, t, m] = await Promise.all([
      this.supabase.from('league_seasons').select(SEASON_COLUMNS).eq('league_id', leagueId),
      this.supabase.from('league_season_teams').select(TEAM_COLUMNS).eq('league_id', leagueId),
      this.supabase.from('league_season_matchups').select(MATCHUP_COLUMNS).eq('league_id', leagueId),
    ]);
    if (s.error) throw new Error(`league_seasons read failed: ${s.error.message}`);
    if (t.error) throw new Error(`league_season_teams read failed: ${t.error.message}`);
    if (m.error) throw new Error(`league_season_matchups read failed: ${m.error.message}`);
    return { seasons: (s.data ?? []) as SeasonRow[], teams: (t.data ?? []) as TeamRow[], matchups: (m.data ?? []) as MatchupRow[] };
  }

  /** Recompute and replace. Returns the number of live trophy rows written. */
  async recompute(leagueId: string, jobId: string | null): Promise<number> {
    const input = await this.loadInput(leagueId);
    const rows = computeTrophies(input);

    // Retire every non-manual live row, then insert the new set.
    const { error: rErr } = await this.supabase
      .from('league_trophies')
      .update({ retired_at: new Date().toISOString() })
      .eq('league_id', leagueId)
      .is('retired_at', null)
      .neq('source', 'manual');
    if (rErr) throw new Error(`league_trophies retire failed: ${rErr.message}`);

    if (!rows.length) return 0;
    const inserts = rows.map((r) => ({
      league_id: leagueId, season: r.season, member_id: r.member_id, trophy_key: r.trophy_key,
      rank: r.rank, value: r.value, detail: r.detail, source: r.source, computed_from_job_id: jobId,
    }));
    const { error: iErr } = await this.supabase.from('league_trophies').insert(inserts);
    if (iErr) throw new Error(`league_trophies insert failed: ${iErr.message}`);
    return inserts.length;
  }

  /** Live trophies for the trophy room. Hidden ones are still returned; the client decides. */
  async list(leagueId: string): Promise<TrophyRecord[]> {
    const { data, error } = await this.supabase
      .from('league_trophies')
      .select(TROPHY_COLUMNS)
      .eq('league_id', leagueId)
      .is('retired_at', null)
      .order('season', { ascending: false });
    if (error) throw new Error(`league_trophies read failed: ${error.message}`);
    return (data ?? []) as TrophyRecord[];
  }

  /** Commissioner renames, re-icons, or hides. Never changes the fact. */
  async decorate(leagueId: string, trophyId: string, patch: { display_name?: string | null; icon_key?: string | null; is_hidden?: boolean }): Promise<void> {
    const { error } = await this.supabase.from('league_trophies').update(patch).eq('league_id', leagueId).eq('id', trophyId);
    if (error) throw new Error(`league_trophies update failed: ${error.message}`);
  }

  /** A trophy the data cannot know: the year the trophy got lost, a side bet. */
  async addManual(leagueId: string, input: { season: number | null; member_id: string | null; display_name: string; detail?: Record<string, unknown>; icon_key?: string | null }): Promise<void> {
    const { error } = await this.supabase.from('league_trophies').insert({
      league_id: leagueId, season: input.season, member_id: input.member_id, trophy_key: 'custom',
      display_name: input.display_name, detail: input.detail ?? {}, icon_key: input.icon_key ?? null, source: 'manual',
    });
    if (error) throw new Error(`league_trophies insert failed: ${error.message}`);
  }
}

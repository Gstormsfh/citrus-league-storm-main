import { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentSeason } from '@citrus/shared';

/**
 * Service for the *NHL* playoff bracket state — distinct from PlayoffService,
 * which deals with fantasy-league playoff brackets.
 *
 * Used to drive dynamic eligibility for the playoff roster pool: as NHL teams
 * get eliminated through the rounds, the draftable player pool shrinks to
 * just the alive teams. Existing rosters are never modified — already-drafted
 * players stay regardless of their team's status; the filter only narrows
 * what *new* picks are allowed.
 */
export class NhlPlayoffStateService {
  private supabase: SupabaseClient;
  // 30-second in-memory cache. Bracket state changes at most once per game,
  // and players draft over minutes, so a short TTL is fine and avoids per-
  // request DB hits during a busy draft room.
  private static cache: Map<number, { abbrevs: string[]; expiresAt: number }> = new Map();
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Returns the set of NHL team abbreviations whose teams are still alive
   * in the playoffs for the given season.
   *
   * "Alive" = appears in any series whose `series_status` is not 'final'
   * (still in-progress or pending), OR is the winner of a completed series
   * (winners advance to the next round, so they remain alive).
   *
   * If the bracket isn't populated yet (pre-playoffs), returns an empty
   * array. Callers should treat that as "no filter active".
   */
  async getAliveTeamAbbreviations(season: number = getCurrentSeason()): Promise<string[]> {
    const cached = NhlPlayoffStateService.cache.get(season);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.abbrevs;
    }

    // Pull every series row + a teams lookup. The series table holds team
    // IDs; we resolve to abbreviations via nhl_teams.
    const { data: seriesRows, error: seriesErr } = await this.supabase
      .from('nhl_playoff_series')
      .select('high_seed_team_id, low_seed_team_id, winner_team_id, series_status')
      .eq('season', season);

    if (seriesErr || !seriesRows) {
      // Don't blow up the caller — return empty so the route falls back
      // to "no filter applied".
      return [];
    }

    // Two-pass scan: collect candidate "alive" teams (winners of finals +
    // both participants of pending/active series) AND the explicit losers
    // of every final series. A team that won an earlier round but lost a
    // later one (e.g. PHI: beat PIT in R1, lost to CAR in R2) gets added
    // by the first scan and must be removed by the second — otherwise the
    // set monotonically grows and eliminated teams stay "alive" forever.
    const aliveIds = new Set<number>();
    const eliminatedIds = new Set<number>();
    for (const s of seriesRows) {
      const status = (s.series_status as string) || 'pending';
      const high = s.high_seed_team_id as number | null;
      const low = s.low_seed_team_id as number | null;
      const winner = s.winner_team_id as number | null;

      if (status === 'final') {
        if (winner != null) {
          aliveIds.add(winner);
          // Loser = the participant that isn't the winner. Both seeds
          // must be present for us to know who lost.
          const loser = winner === high ? low : winner === low ? high : null;
          if (loser != null) eliminatedIds.add(loser);
        }
      } else {
        // pending or in-progress — both teams (if known) are still alive.
        if (high != null) aliveIds.add(high);
        if (low != null) aliveIds.add(low);
      }
    }
    // Apply elimination: a team that lost any final series is OUT,
    // regardless of how many earlier series they won.
    for (const id of eliminatedIds) aliveIds.delete(id);

    if (aliveIds.size === 0) {
      // No bracket populated yet — return empty (caller treats as "no filter").
      NhlPlayoffStateService.cache.set(season, {
        abbrevs: [],
        expiresAt: Date.now() + NhlPlayoffStateService.CACHE_TTL_MS,
      });
      return [];
    }

    const { data: teamRows, error: teamsErr } = await this.supabase
      .from('nhl_teams')
      .select('team_id, abbreviation')
      .in('team_id', Array.from(aliveIds));

    if (teamsErr || !teamRows) return [];

    const abbrevs = teamRows
      .map((t: { abbreviation: string | null }) => t.abbreviation)
      .filter((a): a is string => !!a);

    NhlPlayoffStateService.cache.set(season, {
      abbrevs,
      expiresAt: Date.now() + NhlPlayoffStateService.CACHE_TTL_MS,
    });
    return abbrevs;
  }

  /** Test/admin helper: clear the cache (e.g. after a series flips). */
  static clearCache(): void {
    NhlPlayoffStateService.cache.clear();
  }
}

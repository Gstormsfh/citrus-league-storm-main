/**
 * SeasonPhaseService — "is there hockey right now", read once from the
 * schedule and handed to every screen that would otherwise guess.
 *
 * The derivation lives in `@citrus/shared` (`seasonPhase.ts`) so the browser
 * and this server cannot disagree about what an offseason is. This class is
 * only the READ: three cheap, index-covered probes against `nhl_games`.
 *
 * WHY IT IS ITS OWN SERVICE, not a field on the scores response.
 * `ScoresService` already computes the nearest dates, but it does so only on
 * the empty-day path of one screen and it is an expensive call — the
 * scoreboard read pulls games, teams, projections, the directory, actuals and
 * (with a league) rosters and scoring settings. Roster, Matchup, Standings
 * and Stormy all need the schedule fact and none of them wants that payload.
 *
 * COST. Three `limit(1)` reads on `nhl_games (game_date)`, plus one exact
 * count for today. `nhl_games` is 2,738 rows in production today and grows by
 * ~1,400 a season, so each probe is an index scan returning one row. The
 * response is identical for every caller on a given day, which is what makes
 * the long client cache in `useSeasonStatus` safe and keeps this off the hot
 * path entirely.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getTodayMST, type ScheduleFacts } from '@citrus/shared';

/**
 * How far to look for the nearest day with games. The offseason gap measured
 * on 2026-09-02 is 107 days (2026-06-14 → 2026-09-29), so a window has to
 * clear that comfortably or the offseason itself would read as "nothing
 * scheduled, ever". 400 days also spans a full season plus an offseason, so
 * the lookback always finds the previous season's last game.
 */
const LOOKUP_WINDOW_DAYS = 400;

/** 'YYYY-MM-DD' ± n days, calendar arithmetic at UTC midnight. */
function shiftDay(day: string, delta: number): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  const d = new Date(t + delta * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export class SeasonPhaseService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * The schedule facts for `today` (MT). Never throws: a read failure yields
   * a null result and the caller returns an error, because the client's
   * `unknown` phase renders the app's normal self rather than an offseason
   * state. Guessing here is the one outcome worth avoiding — telling a user
   * in January that the season is over is worse than telling them nothing.
   */
  async getScheduleFacts(
    today: string = getTodayMST(),
  ): Promise<{ result: ScheduleFacts | null; error: { message: string } | null }> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
      return { result: null, error: { message: 'date must be YYYY-MM-DD' } };
    }

    const floor = shiftDay(today, -LOOKUP_WINDOW_DAYS);
    const ceil = shiftDay(today, LOOKUP_WINDOW_DAYS);

    const [todayRes, beforeRes, afterRes] = await Promise.all([
      // Exact count, no rows: the UI needs "are there any", not which.
      this.supabase
        .from('nhl_games')
        .select('game_id', { count: 'exact', head: true })
        .eq('game_date', today),
      this.supabase
        .from('nhl_games')
        .select('game_date, game_type')
        .gte('game_date', floor)
        .lte('game_date', today)
        .order('game_date', { ascending: false })
        .limit(1),
      this.supabase
        .from('nhl_games')
        .select('game_date, game_type')
        .gt('game_date', today)
        .lte('game_date', ceil)
        .order('game_date', { ascending: true })
        .limit(1),
    ]);

    const firstError = todayRes.error || beforeRes.error || afterRes.error;
    if (firstError) {
      return { result: null, error: { message: firstError.message } };
    }

    const pick = (res: { data: unknown }): { date: string | null; type: string | null } => {
      const list = (res.data ?? []) as Array<{ game_date?: string; game_type?: string | null }>;
      const row = list[0];
      if (!row || typeof row.game_date !== 'string') return { date: null, type: null };
      return { date: row.game_date, type: row.game_type ?? null };
    };

    const last = pick(beforeRes);
    const next = pick(afterRes);

    return {
      result: {
        today,
        gamesToday: todayRes.count ?? 0,
        lastGameDate: last.date,
        lastGameType: last.type,
        nextGameDate: next.date,
        nextGameType: next.type,
      },
      error: null,
    };
  }
}

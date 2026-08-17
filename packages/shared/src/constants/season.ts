/**
 * Central season configuration — single source of truth for all season-dependent values.
 *
 * All values are DERIVED from today's date via the same rule as the SQL
 * public.get_nhl_season_year function: NHL seasons run Oct→Jun, so
 * months 10-12 use the current calendar year and months 1-9 use the
 * previous calendar year. Prior to this file being derived, five files
 * across the codebase carried a literal "2025" that would have silently
 * broken every scoring/projection path on 2026-10-01.
 *
 * ── LIFECYCLE CAVEAT ─────────────────────────────────────────────────
 * The exported `const CURRENT_SEASON` is evaluated ONCE at module load.
 * A long-running Node/Cloud Run process that survives the Oct 1 flip
 * without restart will see the stale value. Two mitigations:
 *   1. Cloud Run auto-cycles instances; a warm instance rarely survives
 *      >24h in practice.
 *   2. For code on the hot path that MUST always see today's value —
 *      call `getCurrentSeason()` per iteration instead of importing
 *      CURRENT_SEASON.
 */

/**
 * Known NHL regular-season start dates, mirrored from
 * `SELECT season, min(game_date) FROM nhl_games WHERE game_type='regular'`.
 *
 * The Oct-1 rule below is wrong whenever a season opens in September. The
 * 2026-27 season opens 2026-09-29, so on Sept 29 and Sept 30 the plain rule
 * returns 2025 and every season-dependent value in the app -- CURRENT_SEASON,
 * SEASON_LABEL, HEADSHOT_SEASON, every stat query -- would be a year stale on
 * opening night.
 *
 * It CANNOT simply become `month >= 8` (September). September 2020 holds real
 * COVID-bubble games correctly filed under season 2019, and a September rule
 * would reclassify them. The schedule is the only ground truth, so known starts
 * are listed and the calendar rule is kept for everything older.
 *
 * Drift is caught by the check_season_boundary gate in the database.
 */
const SEASON_STARTS: ReadonlyArray<{ season: number; start: string }> = [
  { season: 2026, start: '2026-09-29' },
  { season: 2025, start: '2025-10-07' },
];

function _deriveNhlSeasonYear(d: Date = new Date()): number {
  // Local calendar date as YYYY-MM-DD, so the comparison below is a plain
  // string compare and never crosses a timezone boundary.
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (const { season, start } of SEASON_STARTS) {
    if (iso >= start) return season;
  }
  // Older than any schedule we ship: month is 0-indexed in JS; the NHL season
  // year starts in October (month 10 = index 9).
  return d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1;
}

/** Always-fresh NHL season year. Prefer this over CURRENT_SEASON in any
 * long-lived process or hot path that must pick up the Oct 1 flip
 * without a restart. */
export function getCurrentSeason(): number {
  return _deriveNhlSeasonYear();
}

/** The numeric season identifier used in DB queries. Evaluated at module
 * load — see LIFECYCLE CAVEAT above. Use `getCurrentSeason()` when a
 * long-lived process must pick up the Oct 1 flip without restart. */
export const CURRENT_SEASON = _deriveNhlSeasonYear();

/** The calendar year the regular season starts (October). Same value as
 * CURRENT_SEASON — kept as a distinct export for clarity at call sites
 * where the semantic is "October start year." */
export const SEASON_START_YEAR = CURRENT_SEASON;

/** The NHL headshot asset season path segment (e.g. "20252026" for the
 * 2025-26 season). Derived. */
export const HEADSHOT_SEASON = `${CURRENT_SEASON}${CURRENT_SEASON + 1}`;

/** Human-readable season label (e.g. "2025-26"). Derived. */
export const SEASON_LABEL = `${CURRENT_SEASON}-${String((CURRENT_SEASON + 1) % 100).padStart(2, '0')}`;

/** Default test date fallback used by services when VITE_TEST_DATE is not set.
 * Derived to a mid-season date (Dec 8) of the current NHL season year. */
export const DEFAULT_TEST_DATE = `${CURRENT_SEASON}-12-08`;

/**
 * Build the NHL headshot URL for a player.
 * Falls back to null if team or playerId is missing.
 */
export function getHeadshotUrl(teamAbbrev: string | null | undefined, playerId: number | string | null | undefined): string | null {
  if (!teamAbbrev || !playerId) return null;
  return `https://assets.nhle.com/mugs/nhl/${HEADSHOT_SEASON}/${teamAbbrev}/${playerId}.png`;
}

/**
 * Number of REGULAR-SEASON games for a given NHL season.
 *
 * Mirrors the SQL `public.get_season_game_count(season)`. 2026-27 is an
 * 84-game season; every earlier season in our data is 82.
 *
 * Kept as an explicit map rather than a derived rule because the NHL sets
 * this per season by agreement, not by formula. A wrong value here does not
 * throw — it silently zeroes every rest-of-season projection once a player
 * passes the assumed game count, in the final week, when leagues are decided.
 */
const SEASON_GAME_COUNTS: Record<number, number> = {
  2026: 84,
};

/** Regular-season game count for `season`. Defaults to 82. */
export function getSeasonGameCount(season: number): number {
  return SEASON_GAME_COUNTS[season] ?? 82;
}

/** Regular-season start date (YYYY-MM-DD) for `season`, or null if we don't
 * ship that season's schedule. Sourced from SEASON_STARTS above, which mirrors
 * `SELECT season, min(game_date) FROM nhl_games WHERE game_type='regular'`. */
export function getSeasonStartDate(season: number): string | null {
  return SEASON_STARTS.find((s) => s.season === season)?.start ?? null;
}

/**
 * The next regular season that has NOT started yet, with a day count — or null
 * once we are on/after the most recent known start.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * The marketing homepage previously hardcoded three live-event claims:
 * a hero reading "Stanley Cup Playoffs · Live now", a CTA band reading
 * "7 Games Tonight · Puck drops 7pm ET", and "Season starts Oct 8". None
 * had any date logic. On 2026-08-14 the site was advertising a playoff run
 * that ended in June, games that were not being played, and a start date
 * two weeks later than the schedule (real first game: 2026-09-29).
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────
 * It does not report whether the playoffs are live. Playoff windows are set
 * by the NHL per season and are not derivable from a regular-season start
 * date. Guessing them reproduces the exact bug this replaced. Any surface
 * that needs live playoff state must read `nhl_playoff_series`, not the
 * calendar.
 */
export function getUpcomingSeasonStart(
  d: Date = new Date(),
): { season: number; start: string; daysUntil: number } | null {
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // SEASON_STARTS is newest-first; take the oldest entry still in the future.
  const future = SEASON_STARTS.filter((s) => s.start > iso).sort((a, b) => (a.start < b.start ? -1 : 1));
  const next = future[0];
  if (!next) return null;
  // Whole days between two calendar dates, timezone-free: compare UTC midnights
  // built from the date parts, so DST transitions cannot shift the count.
  const toUtc = (ymd: string) => {
    const [y, m, day] = ymd.split('-').map(Number);
    return Date.UTC(y, m - 1, day);
  };
  const daysUntil = Math.round((toUtc(next.start) - toUtc(iso)) / 86_400_000);
  return { season: next.season, start: next.start, daysUntil };
}

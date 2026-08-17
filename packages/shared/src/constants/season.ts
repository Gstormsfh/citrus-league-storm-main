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
 * Seasons that open BEFORE October, keyed by season year, as a local ISO date.
 *
 * The month rule below encodes "NHL seasons start in October". That is true of
 * every season in this codebase's history and false for the next one: 2026-27
 * opens 2026-09-29, and 8 regular-season games are played before October 1.
 * Without this map, CURRENT_SEASON reads 2025 on opening night and again on
 * Sept 30, flipping only on Oct 1 -- so for the first two days of the season
 * every season-scoped query asks for the previous one. player_directory holds
 * 805 players for 2026 and 1,076 for 2025; the default-lineup builder would
 * have been handed the wrong universe on the busiest night of the year.
 *
 * Explicit map rather than a derived rule, for the same reason
 * SEASON_GAME_COUNTS is one: the NHL sets this per season by agreement, and a
 * wrong value does not throw -- it silently returns last season's data.
 *
 * The SQL side does not need this map. public.get_current_season() reads the
 * loaded fixture list directly, which is strictly better; the browser cannot,
 * so it gets the table.
 */
const SEASON_START_DATES: Record<number, string> = {
  2026: '2026-09-29',
};

/** Local-calendar ISO date. Deliberately local, not UTC, to stay on the same
 * basis as the getMonth()/getFullYear() rule below. */
function _localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function _deriveNhlSeasonYear(d: Date = new Date()): number {
  // Month is 0-indexed in JS; NHL season year starts in October (month
  // 10 = index 9).
  const byCalendar = d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1;

  // If the NEXT season has an explicit early start and we are on or past it,
  // that season has begun regardless of the month.
  const nextStart = SEASON_START_DATES[byCalendar + 1];
  if (nextStart && _localISODate(d) >= nextStart) {
    return byCalendar + 1;
  }

  return byCalendar;
}

/** Always-fresh NHL season year. Prefer this over CURRENT_SEASON in any
 * long-lived process or hot path that must pick up the Oct 1 flip
 * without a restart. */
export function getCurrentSeason(): number {
  return _deriveNhlSeasonYear();
}

/**
 * The NHL season year for an arbitrary date.
 *
 * Exported so the rule can be tested at a specific date. Until 2026-08-11
 * there was no such entry point -- getCurrentSeason() takes no argument and
 * always reads the clock -- which is the direct reason the "seasons start in
 * October" assumption survived into a season that starts in September. A rule
 * you cannot evaluate at a date you choose is a rule you cannot test.
 */
export function getSeasonYearForDate(d: Date): number {
  return _deriveNhlSeasonYear(d);
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

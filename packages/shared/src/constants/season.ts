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

function _deriveNhlSeasonYear(d: Date = new Date()): number {
  // Month is 0-indexed in JS; NHL season year starts in October (month
  // 10 = index 9).
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

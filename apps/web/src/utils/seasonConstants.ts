/**
 * Central season configuration — single source of truth for all season-dependent values.
 *
 * Update these at the start of each NHL season. Every file that previously
 * hardcoded "2025" or "20242025" now imports from here.
 */

/** The numeric season identifier used in DB queries (e.g. `.eq('season', CURRENT_SEASON)`) */
export const CURRENT_SEASON = 2025;

/** The NHL headshot asset season path segment (e.g. "20252026" for the 2025-26 season) */
export const HEADSHOT_SEASON = '20252026';

/** The calendar year the regular season starts (October) */
export const SEASON_START_YEAR = 2025;

/** Human-readable season label (e.g. "2025-26") */
export const SEASON_LABEL = '2025-26';

/** Default test date fallback used by services when VITE_TEST_DATE is not set */
export const DEFAULT_TEST_DATE = '2025-12-08';

/**
 * Build the NHL headshot URL for a player.
 * Falls back to null if team or playerId is missing.
 */
export function getHeadshotUrl(teamAbbrev: string | null | undefined, playerId: number | string | null | undefined): string | null {
  if (!teamAbbrev || !playerId) return null;
  return `https://assets.nhle.com/mugs/nhl/${HEADSHOT_SEASON}/${teamAbbrev}/${playerId}.png`;
}

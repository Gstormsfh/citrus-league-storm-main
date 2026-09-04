/**
 * POSITION ELIGIBILITY (2026-09-03): the one reader for
 * `player_directory.eligible_positions`.
 *
 * THE COLUMN IS TEXT, NOT AN ARRAY. Migration 20260301000000 added it as a
 * comma-separated string ("C,LW", primary first) and
 * scripts/utilities/sync_rosters.py writes it that way. The web client has
 * always split it (usePreloadedPlayers.ts, apps/web BestBallService.ts). The
 * server typed the same cell `string[]` and called `.map` on it
 * (LineupService.saveLineup, PlayerService.buildPlayer). For every player
 * whose cell is non-null that is a TypeError on a string, and in the lineup
 * save the surrounding catch then failed the WHOLE position map open. Read on
 * 2026-09-03: staging 787 of 2,035 directory rows non-null, production 797 of
 * 1,909. The 2026-08-23 position-match fix was therefore live only for the
 * players with a NULL cell and silently off for the rest.
 *
 * Contract, so both sides agree:
 *   - accepts the text form, an array (test fixtures; a future text[] column),
 *     or null/undefined;
 *   - trims, upper-cases, dedupes, drops blanks; folds the NHL boxscore codes
 *     L and R to LW and RW;
 *   - the listed primary position (`position_code`) is ALWAYS included and
 *     comes first. The sync ranks positions by games played and can leave the
 *     API's listed position out entirely: 13 staging rows and 9 production
 *     rows carry a single eligible position that differs from position_code.
 *     Without the union those players would be refused their own slot;
 *   - nothing usable gives [], and every caller fails OPEN on [].
 */

/** What a `player_directory.eligible_positions` cell may arrive as. */
export type EligiblePositionsRaw = string | readonly string[] | null | undefined;

/** The columns a position read takes from player_directory. */
export interface PlayerDirectoryEligibilityRow {
  player_id: number;
  full_name?: string | null;
  position_code: string | null;
  eligible_positions: EligiblePositionsRaw;
}

const BOXSCORE_CODES: Record<string, string> = { L: 'LW', R: 'RW' };

function positionCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const code = raw.trim().toUpperCase();
  return BOXSCORE_CODES[code] ?? code;
}

/**
 * Every position the player may start at, primary first: ['C'] or ['C', 'LW'].
 */
export function parseEligiblePositions(raw: EligiblePositionsRaw, primary?: string | null): string[] {
  const out: string[] = [];
  const push = (value: unknown) => {
    const code = positionCode(value);
    if (code && !out.includes(code)) out.push(code);
  };
  push(primary);
  if (typeof raw === 'string') {
    for (const part of raw.split(',')) push(part);
  } else if (Array.isArray(raw)) {
    for (const part of raw) push(part);
  }
  return out;
}

/** "C/LW" for a dual-eligible player, "C" for a single one, "" for nothing. */
export function formatEligiblePositions(positions: readonly string[]): string {
  return positions.join('/');
}

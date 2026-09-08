/**
 * In-progress runs, kept on the device.
 *
 * A phone on a congested network will reload, background, lose signal and
 * come back. Losing four guesses to a refresh would be the single most
 * infuriating thing the suite could do, so the run is written to
 * localStorage after every guess and restored on mount.
 *
 * THIS IS NOT THE SCORE. Nothing here is trusted for points: the server
 * re-grades the submitted guess sequence against `game_day_puzzle_log`
 * (see `game_day_submit_daily_player`). This is a convenience store for the
 * player's own device, and a tampered entry buys nothing but a wrong local
 * render.
 *
 * The key includes the puzzle id, so yesterday's run never bleeds into
 * today's, and old keys are swept on load rather than accumulating forever
 * in a browser that plays every day for a season.
 */
import { logger } from '@/utils/logger';

const PREFIX = 'citrus.gameday.';
const KEEP_DAYS = 3;

export interface StoredRun {
  puzzle_id: string;
  /** Roster indices, in the order they were guessed. */
  guesses: number[];
  finished: boolean;
  won: boolean;
  /** Set once the server has accepted the run, so it is not submitted twice. */
  submitted: boolean;
}

function keyFor(puzzleId: string): string {
  return `${PREFIX}${puzzleId}`;
}

export function loadRun(puzzleId: string): StoredRun | null {
  try {
    const raw = localStorage.getItem(keyFor(puzzleId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRun;
    // A stored run for a different puzzle is not this puzzle's run, however
    // it got here.
    if (parsed?.puzzle_id !== puzzleId || !Array.isArray(parsed.guesses)) return null;
    return parsed;
  } catch (err) {
    logger.warn('Game Day: could not read a stored run', err);
    return null;
  }
}

export function saveRun(run: StoredRun): void {
  try {
    localStorage.setItem(keyFor(run.puzzle_id), JSON.stringify(run));
  } catch (err) {
    // Private browsing and full quotas both land here. The game keeps
    // working; it just forgets on refresh, which beats crashing.
    logger.warn('Game Day: could not persist the run', err);
  }
}

/** Drops stored runs older than the keep window. Safe to call on every mount. */
export function pruneOldRuns(today: string): void {
  try {
    const cutoff = new Date(`${today}T00:00:00Z`).getTime() - KEEP_DAYS * 86400000;
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const date = key.slice(key.lastIndexOf(':') + 1);
      const at = new Date(`${date}T00:00:00Z`).getTime();
      if (Number.isFinite(at) && at < cutoff) localStorage.removeItem(key);
    }
  } catch (err) {
    logger.warn('Game Day: could not prune stored runs', err);
  }
}

/**
 * Fetching an emitted puzzle.
 *
 * This is the burst path. Near-zero traffic, then thousands of phones on
 * congested mobile networks asking for the same file within a few minutes.
 * Everything here is shaped by that:
 *
 *   * the request goes to a CDN edge, never to our API server or Postgres;
 *   * it is a plain GET of a static, dated JSON file, so it is cacheable by
 *     every layer between the phone and the origin;
 *   * there is no auth on the read. A puzzle is public; the player's
 *     identity only matters when they finish one.
 *
 * FALLING BACK TO YESTERDAY. The client computes today's date itself rather
 * than asking an index file "what is the latest puzzle?", because an index
 * is mutable and would need a short TTL, which is exactly the object you do
 * not want in front of a burst. The cost of that choice is one edge case: if
 * the morning's cron has not landed yet, today's file 404s. Rather than show
 * an error to someone who opened the app at 4am, we drop back one day. A
 * played-yesterday puzzle is a far better experience than a dead screen, and
 * the date is displayed so nobody is misled about which puzzle they are on.
 */
import {
  GAME_DAY_SCHEMA_VERSION,
  gameDayPuzzleDate,
  gameDayShiftDate,
  type GameDayArtifact,
  type GameDayGameKey,
} from '@citrus/shared';

const BUCKET = 'game-day-artifacts';

/**
 * Derived from the Supabase URL the app already has, so standing the suite
 * up needs no new environment variable and no CSP change — `firebase.json`
 * already allows `https://*.supabase.co` in connect-src. `VITE_GAME_DAY_CDN`
 * overrides it if the artifacts ever move to their own host.
 */
export function gameDayCdnBase(): string {
  const override = import.meta.env.VITE_GAME_DAY_CDN as string | undefined;
  if (override) return override.replace(/\/$/, '');
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}`;
}

export function gameDayArtifactUrl(game: GameDayGameKey, puzzleDate: string): string {
  return `${gameDayCdnBase()}/gameday/v${GAME_DAY_SCHEMA_VERSION}/${game}/${puzzleDate}.json`;
}

export class GameDayArtifactMissing extends Error {
  constructor(public readonly game: GameDayGameKey, public readonly triedDates: string[]) {
    super(`No ${game} puzzle found for ${triedDates.join(' or ')}`);
    this.name = 'GameDayArtifactMissing';
  }
}

async function fetchOne<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  const response = await fetch(url, { signal, cache: 'default' });
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) {
    throw new Error(`Game Day artifact fetch failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export interface LoadedArtifact<A> {
  artifact: A;
  /** True when today's puzzle was not up yet and yesterday's was served. */
  isFallback: boolean;
}

export async function loadGameDayArtifact<P>(
  game: GameDayGameKey,
  options: { date?: string; signal?: AbortSignal } = {},
): Promise<LoadedArtifact<GameDayArtifact<GameDayGameKey, P>>> {
  const today = options.date ?? gameDayPuzzleDate();
  const yesterday = gameDayShiftDate(today, -1);

  const first = await fetchOne<GameDayArtifact<GameDayGameKey, P>>(
    gameDayArtifactUrl(game, today),
    options.signal,
  );
  if (first) return { artifact: first, isFallback: false };

  // Only ever one step back. Walking further would quietly serve a week-old
  // puzzle and hide a broken cron for days.
  const second = await fetchOne<GameDayArtifact<GameDayGameKey, P>>(
    gameDayArtifactUrl(game, yesterday),
    options.signal,
  );
  if (second) return { artifact: second, isFallback: true };

  throw new GameDayArtifactMissing(game, [today, yesterday]);
}

import type { NHLGame } from '@/services/ScheduleService';
import { ScheduleService } from '@/services/ScheduleService';

/**
 * GAME-DAY LINE FROM THE SCHEDULE (2026-09-01, audit R9)
 *
 * The roster row's second line used to be built from `player.nextGame`,
 * which the page fills from TODAY's schedule only, and then patched with the
 * literal `'Game'` when the opponent was unknown — so every row on any other
 * day read "EDM · Game", and a future day borrowed today's opponent and
 * face-off time. This module derives the line for the SELECTED date from the
 * schedule rows the page already fetches, and says nothing rather than
 * printing a placeholder.
 *
 * Pure functions over plain data — the page does the fetching.
 */

export type RowGameStatus = 'scheduled' | 'live' | 'intermission' | 'final';

export interface RowGame {
  status: RowGameStatus;
  /** "3-2", home score first — the short form the status chip prints. */
  score?: string;
  /**
   * "vs BOS" / "@ NYR". Absent when the schedule has no such game — the row
   * then prints nothing in that position, never a stand-in word.
   */
  opponent?: string;
  /** "7:00 PM" in the manager's timezone, while the game is still ahead. */
  gameTime?: string;
}

/** The game a team plays on `date` (YYYY-MM-DD), or null. */
export function gameOnDate(games: readonly NHLGame[] | undefined, date: string): NHLGame | null {
  if (!games || !date) return null;
  return games.find((g) => (g.game_date || '').split('T')[0] === date) ?? null;
}

/**
 * What the row prints for one team's game on the selected date.
 *
 * - `vs`/`@` comes from which side of the fixture the team is on; a game the
 *   team is not part of yields null (the schedule row was for someone else).
 * - A past day still marked `scheduled` reads as final — the feed lags the
 *   clock, the calendar does not.
 * - A postponed game is no game: nothing to start, nothing to print.
 */
export function rowGameFor(
  game: NHLGame | null | undefined,
  team: string,
  opts: { targetDate: string; todayStr: string; timezone: string },
): RowGame | null {
  if (!game || !team) return null;
  if (game.status === 'postponed') return null;

  const info = ScheduleService.getGameInfo(game, team, opts.timezone);
  if (!info) return null;

  let raw = String(game.status || 'scheduled').toLowerCase();
  if (opts.targetDate < opts.todayStr && raw === 'scheduled') raw = 'final';
  const status: RowGameStatus =
    raw === 'live' || raw === 'intermission' || raw === 'final' ? raw : 'scheduled';

  return {
    status,
    score: status === 'scheduled' ? undefined : `${game.home_score ?? 0}-${game.away_score ?? 0}`,
    opponent: info.opponent,
    gameTime: info.time,
  };
}

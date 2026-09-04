/**
 * Formatting for the scores screen. Pure functions, no React, so the rules
 * that decide what a row is allowed to SAY are unit-testable on their own.
 *
 * House voice rule: no em dashes in any user-facing string in this file.
 */

import {
  gameStateLabel,
  isFinalMinute,
  isIntermission,
  type GameState,
  type ScoreboardGame,
  type ScoresPlayerLine,
} from '@citrus/shared';
import { formatTimeMST, getTodayMST } from '@/utils/timezoneUtils';

/**
 * The right-hand status text for a row.
 *
 * Scheduled games print their start time, which is the single piece of
 * information someone looking at a game that has not begun actually wants.
 * Everything else defers to `gameStateLabel`, the shared vocabulary, so the
 * server and the browser cannot drift on what "Final/OT" means.
 *
 * A scheduled game with no `game_time` prints the shared vocabulary's word
 * for that state rather than a fabricated puck drop, so the wording cannot
 * drift from what the server believes.
 */
export function rowStatusText(game: ScoreboardGame): string {
  if (game.state === 'scheduled') {
    return game.startsAt
      ? formatTimeMST(game.startsAt)
      : gameStateLabel(game.state, game.period, game.periodTime);
  }
  return gameStateLabel(game.state, game.period, game.periodTime);
}

/** The tone a row's status column is painted in. */
export type StatusTone = 'live' | 'urgent' | 'final' | 'scheduled' | 'muted';

export function statusTone(game: ScoreboardGame): StatusTone {
  if (game.state === 'live') {
    return isFinalMinute(game.state, game.period, game.periodTime) ? 'urgent' : 'live';
  }
  if (game.state === 'final') return 'final';
  if (game.state === 'scheduled') return 'scheduled';
  return 'muted';
}

/** True when the row should carry the pulsing live dot. */
export function showsLivePulse(game: ScoreboardGame): boolean {
  return game.state === 'live' && !isIntermission(game.periodTime);
}

/**
 * Which side, if either, is ahead. Null whenever there is no score to compare,
 * which includes every scheduled game, so nothing gets emphasised on the
 * strength of a 0-0 the server has already nulled out.
 */
export function leadingSide(game: ScoreboardGame): 'home' | 'away' | null {
  const { homeScore, awayScore } = game;
  if (homeScore === null || awayScore === null) return null;
  if (homeScore === awayScore) return null;
  return homeScore > awayScore ? 'home' : 'away';
}

/** One decimal, or a plain dot when there is no number to show. */
export function formatPoints(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '.';
  return value.toFixed(1);
}

/** Team display name, falling back to the abbreviation we always have. */
export function teamDisplayName(team: { abbrev: string; city: string | null; name: string | null }): string {
  return team.name ?? team.abbrev;
}

/** Full club name when `nhl_teams` carries one, else just the abbreviation. */
export function teamFullName(team: { abbrev: string; city: string | null; name: string | null }): string {
  if (team.city && team.name) return `${team.city} ${team.name}`;
  return team.name ?? team.abbrev;
}

/** Ice time as M:SS. Zero seconds reads as "0:00", which is a real value. */
export function formatToi(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '.';
  const m = Math.floor(seconds / 60);
  const s = Math.abs(Math.round(seconds % 60));
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The one-line summary under a game row.
 *
 * Deliberately says nothing when there is nothing true to say. A game with no
 * projections gets an empty string and the caller omits the element, rather
 * than printing "0 players" as though we had looked and found none.
 */
export function citrusSummaryText(game: ScoreboardGame): string {
  const citrus = game.citrus;
  if (!citrus || citrus.projectedPlayers === 0) return '';

  if (citrus.myCount !== null && citrus.myCount > 0) {
    // "1 of your players": the set is plural however many are in the game.
    return `${citrus.myCount} of your players in this one`;
  }
  if (citrus.rosteredCount !== null && citrus.rosteredCount > 0) {
    const noun = citrus.rosteredCount === 1 ? 'player' : 'players';
    return `${citrus.rosteredCount} rostered ${noun} in your league`;
  }
  return `${citrus.projectedPlayers} projected`;
}

/**
 * Whether to warn that a goalie is unconfirmed.
 *
 * `starter_confirmed` is false on all 66,024 season-2026 projection rows, so
 * the app cannot say who starts. When two goalies from the same club appear
 * in a panel, saying so out loud is more useful than silently ranking one
 * above the other and letting the reader infer a start that is not known.
 */
export function hasUnconfirmedGoalieDuel(players: ScoresPlayerLine[]): boolean {
  const byTeam = new Map<string, number>();
  for (const p of players) {
    if (!p.isGoalie || !p.teamAbbrev) continue;
    byTeam.set(p.teamAbbrev, (byTeam.get(p.teamAbbrev) ?? 0) + 1);
  }
  for (const count of byTeam.values()) if (count > 1) return true;
  return false;
}

/** One entry in the date strip. */
export interface StripDay {
  /** YYYY-MM-DD. */
  date: string;
  /** 'MON' etc. */
  weekday: string;
  /** Day of month, no leading zero. */
  day: string;
  isToday: boolean;
}

/** Shift a YYYY-MM-DD string by whole days without dragging a timezone in. */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, (m || 1) - 1, d || 1) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The date strip window.
 *
 * Copied from theScore and the CBS Sports NHL scoreboard: a horizontal run of
 * days you scroll rather than a picker you open. Asymmetric on purpose, with
 * more days ahead than behind, because a scores screen is used to plan the
 * night as often as to check last night.
 */
export function buildDateStrip(anchor: string, back = 3, forward = 10): StripDay[] {
  const today = getTodayMST();
  const out: StripDay[] = [];
  for (let offset = -back; offset <= forward; offset++) {
    const date = shiftDate(anchor, offset);
    // Parsed as UTC noon so the weekday cannot slip a day either way.
    const dt = new Date(`${date}T12:00:00Z`);
    out.push({
      date,
      weekday: dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase(),
      day: String(dt.getUTCDate()),
      isToday: date === today,
    });
  }
  return out;
}

/** "Today", "Yesterday", "Tomorrow", or a spelled-out date for anything else. */
export function friendlyDateLabel(date: string): string {
  const today = getTodayMST();
  if (date === today) return 'Today';
  if (date === shiftDate(today, -1)) return 'Yesterday';
  if (date === shiftDate(today, 1)) return 'Tomorrow';
  const dt = new Date(`${date}T12:00:00Z`);
  return dt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Short form for the empty state's jump buttons. */
export function shortDateLabel(date: string): string {
  const dt = new Date(`${date}T12:00:00Z`);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Sort key so live games sit above scheduled, and both above finals. */
const STATE_WEIGHT: Record<GameState, number> = {
  live: 0,
  scheduled: 1,
  postponed: 2,
  final: 3,
  unknown: 4,
};

/**
 * Order for the day's list.
 *
 * Live first, then upcoming by puck drop, then finals. This is the ONE place
 * the list departs from theScore, which keeps strict chronological order all
 * day. Chronological is right when every game is live at once on a Saturday;
 * it is wrong at 9pm when the only live game is buried under six finals. The
 * ordering is computed once per fetch, not per tick, so rows do not shuffle
 * under a thumb mid-scroll.
 */
export function compareGames(a: ScoreboardGame, b: ScoreboardGame): number {
  const w = STATE_WEIGHT[a.state] - STATE_WEIGHT[b.state];
  if (w !== 0) return w;
  const at = a.startsAt ?? '';
  const bt = b.startsAt ?? '';
  if (at !== bt) return at < bt ? -1 : 1;
  return a.gameId - b.gameId;
}

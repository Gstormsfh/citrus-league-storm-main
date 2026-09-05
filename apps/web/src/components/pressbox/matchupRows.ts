/**
 * MATCHUP PAYLOAD -> PRESS BOX MATCHUP ROW (2026-09-04).
 *
 * Pure, for the same reason `rosterRows.ts` is: the page keeps the fetching,
 * the row keeps the pixels, and the mapping — which is where the edge cases
 * live — gets tests.
 *
 * WHAT IT REFUSES TO INVENT, same rule as the roster:
 *
 *   * A meta line for a player with no game. The artboard's rows always have
 *     one because the mock always has a game; a real week does not, and an
 *     empty string beats "No game" invented at this layer.
 *   * A points figure before the game starts. `points` is null until the
 *     status says In Game or Final, so the row prints its dash rather than a
 *     zero that looks like a bad night.
 *   * A period. `MatchupPlayer` carries a status of `In Game` / `Final` /
 *     null and no period, so a live line reads `vs TOR LIVE`, never `3RD`.
 */
import type { MatchupPlayer } from '@/components/matchup/types';
import { ScheduleService } from '@/services/ScheduleService';

import type { PressBoxMatchupPlayer } from './MatchupRow';

/** Last name only: the matchup column is half a phone wide. */
export const lastName = (full: string): string => full.trim().split(/\s+/).slice(-1)[0] || full;

/**
 * The game this player's team plays on the selected date, or undefined.
 *
 * THIS, not `player.status`, is what says whether anything has happened.
 * `MatchupPlayer.status` is `In Game` / `Final` / null, and the producers
 * routinely leave it null while the GAME row carries the truth — the harness
 * fixture does exactly that, and reading the wrong field printed a dash on
 * every row of a slate with two live games and two finals in it. `PlayerCard`
 * has always derived it from the game; so does this.
 */
export function gameFor(p: MatchupPlayer, selectedDate: string | null | undefined) {
  return (p.games ?? []).find((g) => (g.game_date || '').split('T')[0] === selectedDate);
}

/** True once the game has started: live, in intermission, or final. */
export function hasHappened(p: MatchupPlayer, selectedDate: string | null | undefined): boolean {
  const status = String(gameFor(p, selectedDate)?.status ?? '').toLowerCase();
  if (status === 'live' || status === 'final' || status === 'intermission') return true;
  return p.status === 'In Game' || p.status === 'Final';
}

/**
 * `P2` -> `2ND`. The artboard's live line reads `vs TOR 3RD`, and the game row
 * DOES carry the period — `NHLGame.period` — so this is a real value, not the
 * invented one the roster row correctly refuses. When the feed gives no
 * period the line falls back to `LIVE`, which is still true.
 */
const PERIOD: Record<string, string> = { P1: '1ST', P2: '2ND', P3: '3RD', OT: 'OT', SO: 'SO' };
export const periodLabel = (raw: string | null | undefined): string | undefined => {
  const key = String(raw ?? '').trim().toUpperCase();
  if (!key) return undefined;
  return PERIOD[key] ?? (/^[123]$/.test(key) ? PERIOD[`P${key}`] : undefined);
};

/**
 * `COL 4-2 VGK` -> `4-2`. `getGameInfo` returns the score with both team
 * codes, which is right for a scoreboard and wrong for a 105px meta line —
 * the artboard prints `FINAL 4–2`, and the two codes are already implied by
 * the opponent token beside it.
 */
export const bareScore = (score: string | null | undefined): string | undefined => {
  const m = String(score ?? '').match(/(\d+)\s*[-–]\s*(\d+)/);
  return m ? `${m[1]}-${m[2]}` : undefined;
};

/** `vs TOR 3RD · 1G 2A`, `FINAL 4-2 · 2A`, `@ DAL 8:30 PM`. Empty when unknown. */
export function matchupMetaLine(
  p: MatchupPlayer,
  selectedDate: string | null | undefined,
  timezone = 'America/Denver',
): string | undefined {
  const game = gameFor(p, selectedDate);
  const info = game ? ScheduleService.getGameInfo(game, p.team, timezone) : undefined;
  const raw = String(game?.status ?? '').toLowerCase();
  const final = raw === 'final' || p.status === 'Final';
  const live = !final && (raw === 'live' || raw === 'intermission' || p.status === 'In Game');

  const head = final
    ? ['FINAL', bareScore(info?.score)].filter(Boolean).join(' ')
    : [info?.opponent, live ? (periodLabel(game?.period) ?? 'LIVE') : info?.time]
        .filter(Boolean)
        .join(' ');

  // Counting stats, only once something has happened. `matchupStats` is the
  // day's line; `stats` is the season's, and printing the season on a row
  // that says LIVE is the kind of thing nobody notices until it is wrong.
  const s = p.matchupStats;
  const parts: string[] = [];
  if ((live || final) && s) {
    if (s.goals) parts.push(`${s.goals}G`);
    if (s.assists) parts.push(`${s.assists}A`);
    if (s.sog) parts.push(`${s.sog}S`);
  }

  const out = [head, parts.join(' ')].filter(Boolean).join(' · ');
  return out || undefined;
}

export function toMatchupRowPlayer(
  p: MatchupPlayer | null,
  selectedDate: string | null | undefined,
  dailyStatsMap?: Map<number, { daily_total_points?: number }>,
): PressBoxMatchupPlayer | null {
  if (!p) return null;
  const live = hasHappened(p, selectedDate);
  const actual = dailyStatsMap?.get(p.id)?.daily_total_points ?? p.daily_total_points;
  return {
    id: p.id,
    name: lastName(p.name),
    image: p.image,
    team: p.team,
    teamAbbreviation: p.team,
    metaLine: matchupMetaLine(p, selectedDate),
    isLiveOrFinal: live,
    points: live ? (actual ?? 0) : null,
    projection: p.daily_projection?.total_projected_points ?? null,
  };
}

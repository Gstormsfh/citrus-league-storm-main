/**
 * THE ROW'S SECOND LINE AND ITS POSITION RANK (2026-09-05, artboard 4a).
 *
 * The artboard's pool row reads `D · COL · 90 PTS · 26:10 · BYE 9` under
 * the name and `TIER 2 · D1` under the projection. This is the part of
 * that the data supports: last season's points and TOI per game for a
 * skater, wins and save percentage for a goalie, and the player's rank at
 * his position in the pool's own projection order. Not drawn: BYE (the
 * NHL has none a fantasy week cares about) and TIER (no tiering model
 * exists; a gap-based one would be an invented number).
 */
import type { Player } from '@/services/PlayerService';
import { positionChipKey } from '@/components/roster/positionChip';

const toi = (seconds: number, games: number): string | null => {
  if (!(seconds > 0) || !(games > 0)) return null;
  const perGame = seconds / games;
  const m = Math.floor(perGame / 60);
  const s = Math.round(perGame - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/** `90 PTS · 26:10` for a skater, `36 W · .917` for a goalie; null with no season behind it. */
export function draftPoolSeasonLine(p: Player): string | null {
  const gp = Number(p.games_played ?? 0);
  if (!(gp > 0)) return null;
  if (p.position === 'G') {
    const parts: string[] = [];
    if (typeof p.wins === 'number') parts.push(`${p.wins} W`);
    if (typeof p.save_percentage === 'number' && p.save_percentage > 0) {
      parts.push(p.save_percentage < 1 ? p.save_percentage.toFixed(3).replace(/^0/, '') : `${p.save_percentage.toFixed(1)}%`);
    }
    return parts.length ? parts.join(' · ') : null;
  }
  const parts: string[] = [];
  if (typeof p.points === 'number') parts.push(`${p.points} PTS`);
  const t = toi(Number(p.icetime_seconds ?? 0), gp);
  if (t) parts.push(t);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Position rank for every player from an overall ordering: the first D in
 * the order is D1, and so on. Forwards rank within their own position (C,
 * LW, RW), the way the artboard prints `LW3`. Keys are player ids.
 */
export function positionRanks(orderedIds: string[], positionOf: (id: string) => string | null | undefined): Map<string, string> {
  const counts = new Map<string, number>();
  const out = new Map<string, string>();
  for (const id of orderedIds) {
    const key = positionChipKey(positionOf(id));
    if (!key) continue;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    out.set(id, `${key}${n}`);
  }
  return out;
}

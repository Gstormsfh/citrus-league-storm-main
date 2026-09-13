import { isEligibleForPosition } from '@citrus/shared';
import { assignMaxWeight } from '@/components/roster/autoLineup';
import type { Player } from '@/services/PlayerService';

/** Fill compatible slots without spending a dual-eligible player on the only
 * slot a teammate can fill. Maximize filled slots, then existing points. */
export function assignDepthChart(players: Player[], counts: Record<string, number>) {
  const unique = [...new Map(players.map(p => [p.id, p])).values()];
  const slots = Object.entries(counts).flatMap(([position, count]) =>
    Array.from({ length: Math.max(0, Math.floor(count)) }, (_, slotIndex) => ({ position, slotIndex })));
  const pointBound = unique.reduce((sum, p) => sum + Math.abs(Number(p.points) || 0), 0) + 1;
  const weights = slots.map(slot => [
    ...unique.map(p => isEligibleForPosition(p, slot.position)
      ? pointBound + (Number(p.points) || 0) : -1e12),
    ...slots.map(() => 0),
  ]);
  const starters: Array<{ player: Player; position: string; slotIndex: number }> = [];
  assignMaxWeight(weights).forEach((column, row) => {
    if (column < unique.length && weights[row][column] > 0)
      starters.push({ player: unique[column], ...slots[row] });
  });
  const selected = new Set(starters.map(s => s.player.id));
  return { starters, bench: unique.filter(p => !selected.has(p.id)).sort((a, b) => b.points - a.points) };
}


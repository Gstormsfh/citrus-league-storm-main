/**
 * Slot id -> the chip classes the roster rows wear for that position.
 *
 * Derived from positionChip's posColor / posRingColor (one map, two
 * consumers) so the sheets read as the SAME chips the rows carry and a
 * colour edit lands everywhere at once. Pure module (no component) so
 * react-refresh keeps hot-swapping the sheets that import it.
 */
import { posColor, posRingColor, POSITION_CHIP_FALLBACK, POSITION_RING_FALLBACK } from './positionChip';

function chipForPosition(pos: string): string | null {
  const fill = posColor[pos];
  const ring = posRingColor[pos];
  return fill && ring ? `${fill} ${ring}` : null;
}

/**
 * LOCKED CHIP (2026-09-01, Sleeper parity audit R5). A player whose game has
 * started keeps his row fully legible — name, opponent, live line, points —
 * and only the chip changes: neutral fill, muted label, lock glyph. The old
 * treatment dimmed the whole row to 60%, which made the players actually
 * scoring right now the hardest ones to read.
 */
export const LOCKED_CHIP = 'bg-white/10 text-white/55 ring-white/15';

export function chipClassFor(slotId: string): string {
  if (slotId === 'bench-grid') return 'bg-white/10 text-pastel-cream ring-white/20';
  if (slotId.startsWith('ir-slot-')) return 'bg-red-500/15 text-red-400 ring-red-500/30';
  const m = /^slot-([A-Z]+)/.exec(slotId);
  return (m && chipForPosition(m[1])) || `${POSITION_CHIP_FALLBACK} ${POSITION_RING_FALLBACK}`;
}

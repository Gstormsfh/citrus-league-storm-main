import { buildSlotConfig } from './slotConfig';
import { resolveFantasyPosition, type PositionType } from '@/utils/rosterUtils';

interface SlotPlayer {
  id: string | number;
  position: string;
  eligible_positions?: string[];
}

/** Preserve legal placements, canonicalize legacy UTIL, and ignore bench metadata. */
export function repairSlotAssignments(
  starters: SlotPlayer[],
  assignments: Record<string, string>,
  positionType: PositionType,
  rosterSlots?: Record<string, number>,
  reserved: Set<string> = new Set(),
): Record<string, string> {
  const config = buildSlotConfig(positionType, rosterSlots);
  const used = new Set(reserved);
  const result: Record<string, string> = {};
  const fits = (player: SlotPlayer, slot: string) => {
    const positions: string[] = (player.eligible_positions?.length ? player.eligible_positions : [player.position])
      .map(p => resolveFantasyPosition(p, positionType));
    const pos = config.labels[slot];
    return pos === 'UTIL' ? !positions.includes('G') : positions.includes(pos);
  };
  // Reserve explicit valid placements before repairing aliases or holes.
  for (const player of starters) {
    const id = String(player.id), slot = assignments[id];
    if (config.allSlots.includes(slot) && !used.has(slot) && fits(player, slot)) {
      result[id] = slot;
      used.add(slot);
    }
  }
  for (const player of starters) {
    const id = String(player.id);
    if (result[id]) continue;
    const prior = assignments[id];
    const candidates = prior?.startsWith('slot-UTIL')
      ? [...config.utilSlots, ...config.allSlots.filter(s => !config.utilSlots.includes(s))]
      : config.allSlots;
    const slot = candidates.find(s => !used.has(s) && fits(player, s));
    if (slot) { result[id] = slot; used.add(slot); }
  }
  return result;
}

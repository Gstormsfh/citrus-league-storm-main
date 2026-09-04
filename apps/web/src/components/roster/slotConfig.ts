/**
 * WHAT SLOTS A LEAGUE HAS — one definition (2026-09-04).
 *
 * Lifted verbatim out of `MobileRosterList.tsx`, where it had been a private
 * function, so the Press Box roster can read the same slot plan instead of
 * carrying a second copy of it. Two definitions of "what slots does this
 * league have" is not a style problem: it is a correctness one. The two would
 * agree on the day they were written and disagree the first time a league
 * setting grows a slot, and the symptom would be a player who is in a slot on
 * one surface and homeless on the other.
 *
 * Pure, and deliberately so: no React, no services, no imports beyond the
 * position-type union. That is what lets the Press Box adapter be tested
 * without a network.
 *
 * The logic is unchanged from the original, down to the two shapes of UTIL
 * slot id (`slot-UTIL` when there is exactly one, `slot-UTIL-n` when there are
 * several) — that asymmetry is load-bearing for existing `slotAssignments`
 * rows in production and must not be "tidied".
 */
import type { PositionType } from '@/utils/rosterUtils';

export interface SlotConfig {
  /** `slot-C-1` -> `C`. What the row's chip prints. */
  labels: Record<string, string>;
  /** Every starter slot id, in render order. */
  allSlots: string[];
  forwardSlots: string[];
  defenseSlots: string[];
  goalieSlots: string[];
  utilSlots: string[];
}

/** Slot label map and slot arrays, from position type and league roster slots. */
export function buildSlotConfig(
  positionType: PositionType = 'individual',
  rosterSlots?: Record<string, number>,
): SlotConfig {
  const labels: Record<string, string> = {};
  const allSlots: string[] = [];

  const posKeys = positionType === 'forward'
    ? ['F', 'D', 'G']
    : ['C', 'LW', 'RW', 'D', 'G'];

  const defaults: Record<string, number> = positionType === 'forward'
    ? { F: 6, D: 4, G: 2, UTIL: 1 }
    : { C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 1 };

  for (const pos of posKeys) {
    const count = rosterSlots?.[pos] ?? defaults[pos] ?? 0;
    for (let i = 1; i <= count; i++) {
      const slotId = `slot-${pos}-${i}`;
      labels[slotId] = pos;
      allSlots.push(slotId);
    }
  }

  // UTIL slot
  const utilCount = rosterSlots?.UTIL ?? defaults.UTIL ?? 1;
  for (let i = 0; i < utilCount; i++) {
    const slotId = utilCount === 1 ? 'slot-UTIL' : `slot-UTIL-${i + 1}`;
    labels[slotId] = 'UTIL';
    allSlots.push(slotId);
  }

  // Group by section
  const forwardSlots = positionType === 'forward'
    ? allSlots.filter(s => s.startsWith('slot-F-'))
    : allSlots.filter(s => s.startsWith('slot-LW-') || s.startsWith('slot-C-') || s.startsWith('slot-RW-'));
  const defenseSlots = allSlots.filter(s => s.startsWith('slot-D-'));
  const goalieSlots = allSlots.filter(s => s.startsWith('slot-G-'));
  const utilSlots = allSlots.filter(s => s.startsWith('slot-UTIL'));

  return { labels, allSlots, forwardSlots, defenseSlots, goalieSlots, utilSlots };
}

export default buildSlotConfig;

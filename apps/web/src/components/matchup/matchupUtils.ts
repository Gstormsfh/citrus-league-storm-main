import { MatchupPlayer } from "./types";

export interface PositionGroup {
  position: string;
  userPlayers: (MatchupPlayer | null)[];
  opponentPlayers: (MatchupPlayer | null)[];
  scoreDiffs: (number | undefined)[];
}

// Standard slot order matching TeamCard structure
const standardSlotOrder: Array<{ slot: string; position: string }> = [
  { slot: 'slot-C-1', position: 'C' },
  { slot: 'slot-C-2', position: 'C' },
  { slot: 'slot-RW-1', position: 'RW' },
  { slot: 'slot-RW-2', position: 'RW' },
  { slot: 'slot-LW-1', position: 'LW' },
  { slot: 'slot-LW-2', position: 'LW' },
  { slot: 'slot-D-1', position: 'D' },
  { slot: 'slot-D-2', position: 'D' },
  { slot: 'slot-D-3', position: 'D' },
  { slot: 'slot-D-4', position: 'D' },
  { slot: 'slot-G-1', position: 'G' },
  { slot: 'slot-G-2', position: 'G' },
  { slot: 'slot-UTIL', position: 'UTIL' },
];

// Helper to normalize position for grouping
const normalizePosition = (position: string): string => {
  const pos = position?.toUpperCase() || '';
  if (pos.includes('C') && !pos.includes('LW') && !pos.includes('RW')) return 'C';
  if (pos.includes('LW') || pos === 'L' || pos === 'LEFT' || pos === 'LEFTWING') return 'LW';
  if (pos.includes('RW') || pos === 'R' || pos === 'RIGHT' || pos === 'RIGHTWING') return 'RW';
  if (pos.includes('D')) return 'D';
  if (pos.includes('G')) return 'G';
  return 'UTIL';
};

// Format position for display
const formatPositionForDisplay = (position: string): string => {
  const pos = position?.toUpperCase() || '';
  if (pos === 'UTIL' || pos === 'UTILITY') return 'Util';
  if (pos === 'L' || pos === 'LEFT' || pos === 'LEFTWING') return 'LW';
  if (pos === 'R' || pos === 'RIGHT' || pos === 'RIGHTWING') return 'RW';
  if (pos.includes('LW')) return 'LW';
  if (pos.includes('RW')) return 'RW';
  if (pos.includes('C') && !pos.includes('LW') && !pos.includes('RW')) return 'C';
  if (pos.includes('D')) return 'D';
  if (pos.includes('G')) return 'G';
  return position;
};

/**
 * Auto-assign starters to slots by position when slot assignments are missing.
 * This handles AI teams whose fantasy_daily_rosters entries have null slot_id,
 * as well as any race condition where slot assignments haven't loaded yet.
 */
const autoAssignSlots = (
  starters: MatchupPlayer[]
): Record<string, string> => {
  const slotsNeeded: Record<string, number> = { C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 1 };
  const slotsFilled: Record<string, number> = { C: 0, LW: 0, RW: 0, D: 0, G: 0, UTIL: 0 };
  const assignments: Record<string, string> = {};

  starters.forEach(player => {
    const pos = normalizePosition(player.position);
    if (pos !== 'UTIL' && slotsFilled[pos] < (slotsNeeded[pos] || 0)) {
      slotsFilled[pos]++;
      assignments[String(player.id)] = `slot-${pos}-${slotsFilled[pos]}`;
    } else if (pos !== 'G' && slotsFilled['UTIL'] < slotsNeeded['UTIL']) {
      slotsFilled['UTIL']++;
      assignments[String(player.id)] = 'slot-UTIL';
    }
    // If all slots for this position are full, player just won't be assigned
    // (overflow — shouldn't happen with correct roster sizes)
  });

  return assignments;
};

/**
 * Groups players by position and slot, matching user team vs opponent team
 */
export const organizeMatchupData = (
  userStarters: MatchupPlayer[],
  opponentStarters: MatchupPlayer[],
  userSlotAssignments: Record<string, string>,
  opponentSlotAssignments: Record<string, string>
): PositionGroup[] => {
  // Auto-assign slots when assignments are missing/empty but starters exist.
  // This handles: AI teams with null slot_id in DB, race conditions on date switch, etc.
  const effectiveUserSlots = (
    userStarters.length > 0 &&
    !userStarters.some(p => userSlotAssignments[String(p.id)])
  ) ? autoAssignSlots(userStarters) : userSlotAssignments;

  const effectiveOpponentSlots = (
    opponentStarters.length > 0 &&
    !opponentStarters.some(p => opponentSlotAssignments[String(p.id)])
  ) ? autoAssignSlots(opponentStarters) : opponentSlotAssignments;

  // Create maps of slot -> player for both teams
  const userSlotToPlayer = new Map<string, MatchupPlayer>();
  const opponentSlotToPlayer = new Map<string, MatchupPlayer>();

  userStarters.forEach(player => {
    const slot = effectiveUserSlots[String(player.id)];
    if (slot) {
      userSlotToPlayer.set(slot, player);
    }
  });

  opponentStarters.forEach(player => {
    const slot = effectiveOpponentSlots[String(player.id)];
    if (slot) {
      opponentSlotToPlayer.set(slot, player);
    }
  });

  // Group slots by position
  const positionGroups = new Map<string, Array<{ slot: string; position: string }>>();
  
  standardSlotOrder.forEach(({ slot, position }) => {
    const normalizedPos = normalizePosition(position);
    if (!positionGroups.has(normalizedPos)) {
      positionGroups.set(normalizedPos, []);
    }
    positionGroups.get(normalizedPos)!.push({ slot, position });
  });

  // Build PositionGroup array
  const result: PositionGroup[] = [];

  // Order positions for display
  const positionOrder = ['C', 'LW', 'RW', 'D', 'G', 'UTIL'];
  
  positionOrder.forEach(pos => {
    const slots = positionGroups.get(pos);
    if (!slots || slots.length === 0) return;

    const userPlayers: (MatchupPlayer | null)[] = [];
    const opponentPlayers: (MatchupPlayer | null)[] = [];
    const scoreDiffs: (number | undefined)[] = [];

    slots.forEach(({ slot }) => {
      const userPlayer = userSlotToPlayer.get(slot) || null;
      const opponentPlayer = opponentSlotToPlayer.get(slot) || null;

      userPlayers.push(userPlayer);
      opponentPlayers.push(opponentPlayer);

      // Calculate score difference
      const userPoints = userPlayer?.points || 0;
      const opponentPoints = opponentPlayer?.points || 0;
      scoreDiffs.push(userPoints - opponentPoints);
    });

    result.push({
      position: formatPositionForDisplay(pos),
      userPlayers,
      opponentPlayers,
      scoreDiffs
    });
  });

  return result;
};


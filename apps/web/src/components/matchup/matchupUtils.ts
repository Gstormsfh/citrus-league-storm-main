import { MatchupPlayer } from "./types";
import { resolveFantasyPosition, type PositionType } from "@/utils/rosterUtils";
import { buildSlotConfig } from "@/components/roster/slotConfig";

export interface PositionGroup {
  position: string;
  userPlayers: (MatchupPlayer | null)[];
  opponentPlayers: (MatchupPlayer | null)[];
  scoreDiffs: (number | undefined)[];
}

/**
 * THE LEAGUE'S SLOTS, NOT A FIXED LIST (2026-09-10). Until today this file
 * carried its own two slot lists (2C/2LW/2RW/4D/2G/UTIL and 6F/4D/2G/UTIL)
 * and Matchup.tsx never passed a position type, so every matchup rendered
 * the individual-position list: an F/D/G league saw C, C, LW, LW, RW rows
 * with "No player assigned" under every one of them while its Roster page
 * showed a full F/D/G lineup for the same day. The slot plan now comes from
 * buildSlotConfig, the one definition the roster surfaces already share, so
 * a commissioner's roster settings (3 C, 5 D, 2 UTIL, whatever they set)
 * shape the comparison too.
 */
function getSlotOrder(
  positionType: PositionType = 'individual',
  rosterSlots?: Record<string, number>,
): Array<{ slot: string; position: string }> {
  const config = buildSlotConfig(positionType, rosterSlots);
  return config.allSlots.map((slot) => ({ slot, position: config.labels[slot] }));
}

// Helper to normalize position for grouping
const normalizePosition = (position: string, positionType: PositionType = 'individual'): string => {
  // The slot label 'F' is a real position in an F/D/G league; the shared
  // resolver only knows the five NHL codes and would file it under OTHER.
  if (positionType === 'forward' && (position || '').toUpperCase() === 'F') return 'F';
  const result = resolveFantasyPosition(position, positionType);
  return result === 'OTHER' ? 'UTIL' : result;
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
  starters: MatchupPlayer[],
  positionType: PositionType = 'individual',
  rosterSlots?: Record<string, number>,
): Record<string, string> => {
  const config = buildSlotConfig(positionType, rosterSlots);
  // Open slot ids per position, in render order; UTIL keeps its own list
  // because its ids are `slot-UTIL` or `slot-UTIL-n` (see slotConfig.ts).
  const open = new Map<string, string[]>();
  for (const slot of config.allSlots) {
    const label = config.labels[slot];
    if (!open.has(label)) open.set(label, []);
    open.get(label)!.push(slot);
  }
  const assignments: Record<string, string> = {};

  starters.forEach(player => {
    const pos = normalizePosition(player.position, positionType);
    const own = pos !== 'UTIL' ? open.get(pos) : undefined;
    if (own && own.length > 0) {
      assignments[String(player.id)] = own.shift()!;
      return;
    }
    const util = open.get('UTIL');
    if (pos !== 'G' && util && util.length > 0) {
      assignments[String(player.id)] = util.shift()!;
    }
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
  opponentSlotAssignments: Record<string, string>,
  positionType: PositionType = 'individual',
  rosterSlots?: Record<string, number>,
): PositionGroup[] => {
  // Auto-assign slots when assignments are missing/empty but starters exist.
  const effectiveUserSlots = (
    userStarters.length > 0 &&
    !userStarters.some(p => userSlotAssignments[String(p.id)])
  ) ? autoAssignSlots(userStarters, positionType, rosterSlots) : userSlotAssignments;

  const effectiveOpponentSlots = (
    opponentStarters.length > 0 &&
    !opponentStarters.some(p => opponentSlotAssignments[String(p.id)])
  ) ? autoAssignSlots(opponentStarters, positionType, rosterSlots) : opponentSlotAssignments;

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
  const slotOrder = getSlotOrder(positionType, rosterSlots);
  const positionGroups = new Map<string, Array<{ slot: string; position: string }>>();

  slotOrder.forEach(({ slot, position }) => {
    const normalizedPos = normalizePosition(position, positionType);
    if (!positionGroups.has(normalizedPos)) {
      positionGroups.set(normalizedPos, []);
    }
    positionGroups.get(normalizedPos)!.push({ slot, position });
  });

  // Build PositionGroup array
  const result: PositionGroup[] = [];

  // Order positions for display
  const positionOrder = positionType === 'forward'
    ? ['F', 'D', 'G', 'UTIL']
    : ['C', 'LW', 'RW', 'D', 'G', 'UTIL'];
  
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


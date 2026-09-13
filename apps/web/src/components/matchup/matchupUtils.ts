import { matchEligibleSlots } from '@citrus/shared';
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
  return matchOpenSlots(starters, config.allSlots, config.labels);
};

function matchOpenSlots(players: MatchupPlayer[], slots: string[], labels: Record<string, string>): Record<string, string> {
  const assignments: Record<string, string> = {};
  for (const [slot, player] of matchEligibleSlots(players, slots.map(s => labels[s])))
    assignments[String(players[player].id)] = slots[slot];
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

  // Older saved lineups use slot-UTIL for each utility starter even when
  // the league has multiple UTIL slots. Seat those aliases in open utility
  // slots without changing persisted membership or overwriting explicit slots.
  const resolveSavedSlots = (players: MatchupPlayer[], assignments: Record<string, string>) => {
    const config = buildSlotConfig(positionType, rosterSlots);
    const { utilSlots } = config;
    const resolved = { ...assignments };
    const reserved = new Set(players.map(p => assignments[String(p.id)]));
    const open = utilSlots.filter(slot => !reserved.has(slot));
    for (const player of players) {
      if (utilSlots.length > 1 && assignments[String(player.id)] === 'slot-UTIL' && open.length > 0) {
        resolved[String(player.id)] = open.shift()!;
      }
    }
    // A captured historical active row can have no slot while its peers do.
    // Keep explicit placements, then use the same position/UTIL fallback as
    // the all-unassigned path, limited to still-open configured slots.
    const occupied = new Set(players.map(p => resolved[String(p.id)]));
    Object.assign(resolved, matchOpenSlots(
      players.filter(p => !resolved[String(p.id)]),
      config.allSlots.filter(slot => !occupied.has(slot)), config.labels,
    ));
    return resolved;
  };
  const userSlots = resolveSavedSlots(userStarters, effectiveUserSlots);
  const opponentSlots = resolveSavedSlots(opponentStarters, effectiveOpponentSlots);

  // Create maps of slot -> player for both teams
  const userSlotToPlayer = new Map<string, MatchupPlayer>();
  const opponentSlotToPlayer = new Map<string, MatchupPlayer>();

  userStarters.forEach(player => {
    const slot = userSlots[String(player.id)];
    if (slot) {
      userSlotToPlayer.set(slot, player);
    }
  });

  opponentStarters.forEach(player => {
    const slot = opponentSlots[String(player.id)];
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


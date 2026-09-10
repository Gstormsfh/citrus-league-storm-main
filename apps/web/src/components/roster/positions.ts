/**
 * A player's own positions, for every roster row that names them (2026-09-03,
 * WORLD_CLASS_READINESS gap A: multi-position eligibility).
 *
 * The row chip is the SLOT (C1, UTIL, BN), not the player, so a C/LW player
 * sitting in UTIL or on the bench never said he could play LW; the Fill sheet
 * offered him for an LW spot with no word on why. The desktop card already
 * prints "C/LW"; this is the same reading, lifted out so the mobile rows and
 * the three sheets print the identical string.
 *
 * Same union the server applies on save (parseEligiblePositions in
 * @citrus/shared): the listed position always counts, first, and whatever
 * `eligible_positions` adds comes after. A pure module, not an export from
 * a component file, for react-refresh (see slotLabel.ts).
 */
import type { HockeyPlayer } from './HockeyPlayerCard';
import { positionChipKey } from './positionChip';
import type { PositionType } from '@/utils/rosterUtils';

type Positioned = Pick<HockeyPlayer, 'position' | 'eligible_positions'>;

/** Every position the player may start at, as chip keys, primary first: ['C'] or ['C', 'LW']. */
export function playerPositions(p: Positioned, positionType: PositionType = 'individual'): string[] {
  const out: string[] = [];
  const push = (raw: string | null | undefined) => {
    const key = positionChipKey(raw, positionType);
    // UTIL is a slot, never a position a player holds.
    if (key && key !== 'UTIL' && !out.includes(key)) out.push(key);
  };
  push(p.position);
  for (const e of p.eligible_positions ?? []) push(e);
  return out;
}

/** "C/LW" for a player who can start at two positions, "C" for everyone else. */
export function playerPositionsLabel(p: Positioned, positionType: PositionType = 'individual'): string {
  return playerPositions(p, positionType).join('/');
}

/**
 * The label only when it says something the slot chip does not: a player
 * with more than one position. Empty for everyone else, so single-position
 * rows print exactly what they printed before.
 */
export function multiPositionLabel(p: Positioned, positionType: PositionType = 'individual'): string {
  // An F/D/G league folds a C/LW player's two positions onto one F, so the
  // label empties itself there — which is right: in that league his
  // eligibility says nothing his slot chip does not already say.
  const positions = playerPositions(p, positionType);
  return positions.length > 1 ? positions.join('/') : '';
}

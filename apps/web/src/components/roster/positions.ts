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

type Positioned = Pick<HockeyPlayer, 'position' | 'eligible_positions'>;

/** Every position the player may start at, as chip keys, primary first: ['C'] or ['C', 'LW']. */
export function playerPositions(p: Positioned): string[] {
  const out: string[] = [];
  const push = (raw: string | null | undefined) => {
    const key = positionChipKey(raw);
    // UTIL is a slot, never a position a player holds.
    if (key && key !== 'UTIL' && !out.includes(key)) out.push(key);
  };
  push(p.position);
  for (const e of p.eligible_positions ?? []) push(e);
  return out;
}

/** "C/LW" for a player who can start at two positions, "C" for everyone else. */
export function playerPositionsLabel(p: Positioned): string {
  return playerPositions(p).join('/');
}

/**
 * The label only when it says something the slot chip does not: a player
 * with more than one position. Empty for everyone else, so single-position
 * rows print exactly what they printed before.
 */
export function multiPositionLabel(p: Positioned): string {
  const positions = playerPositions(p);
  return positions.length > 1 ? positions.join('/') : '';
}

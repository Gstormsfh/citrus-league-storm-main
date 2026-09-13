/** Shared reader for directory CSV evidence and transported eligibility arrays.
 * Includes the listed primary, normalizes aliases, and keeps goalie/skater
 * families separate. Empty evidence stays empty; each caller owns its policy
 * for missing identity data.
 */

/** What a `player_directory.eligible_positions` cell may arrive as. */
export type EligiblePositionsRaw = string | readonly string[] | null | undefined;

/** The columns a position read takes from player_directory. */
export interface PlayerDirectoryEligibilityRow {
  player_id: number;
  full_name?: string | null;
  position_code: string | null;
  eligible_positions: EligiblePositionsRaw;
}

const POSITION_ALIASES: Record<string, string> = {
  L: 'LW', LEFT: 'LW', LEFTWING: 'LW', 'LEFT WING': 'LW',
  R: 'RW', RIGHT: 'RW', RIGHTWING: 'RW', 'RIGHT WING': 'RW',
  CENTER: 'C', CENTRE: 'C', DEFENSE: 'D', DEFENCE: 'D',
  DEFENSEMAN: 'D', DEFENCEMAN: 'D', GOALIE: 'G', GOALTENDER: 'G', FORWARD: 'F',
};
const POSITIONS = new Set(['C', 'LW', 'RW', 'D', 'G', 'F']);

/** A player position, never a lineup slot such as UTIL, BN or IR. */
export function normalizeHockeyPosition(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const value = raw.trim().toUpperCase();
  const code = POSITION_ALIASES[value] ?? value;
  return POSITIONS.has(code) ? code : '';
}

/** Normalize existing evidence, without earning or granting new positions. */
export function parseEligiblePositions(raw: unknown, primary?: unknown): string[] {
  const out: string[] = [];
  const push = (value: unknown) => {
    const code = normalizeHockeyPosition(value);
    if (code && !out.includes(code)) out.push(code);
  };
  push(primary);
  if (typeof raw === 'string') raw.split(/[,/]/).forEach(push);
  else if (Array.isArray(raw)) raw.forEach(push);
  // A valid listed primary determines the family. Without one, mixed evidence
  // is ambiguous: retain skater evidence instead of granting a goalie slot.
  if (normalizeHockeyPosition(primary) === 'G') return ['G'];
  return out.some(p => p !== 'G') ? out.filter(p => p !== 'G') : out;
}

export interface EligiblePlayer {
  position?: string | null;
  eligible_positions?: EligiblePositionsRaw;
}

export function playerEligiblePositions(player: EligiblePlayer): string[] {
  return parseEligiblePositions(player.eligible_positions, player.position);
}

/** F/W/UTIL are compatible slots or filters; they never grant C/LW/RW. */
export function isEligibleForPosition(player: EligiblePlayer, slot: string): boolean {
  const target = slot.trim().toUpperCase();
  if (target === 'ALL') return true;
  const positions = playerEligiblePositions(player);
  if (target === 'UTIL') return positions.some(p => p !== 'G');
  if (target === 'F' || target === 'FORWARD') return positions.some(p => ['C', 'LW', 'RW', 'F'].includes(p));
  if (target === 'W' || target === 'WINGERS') return positions.some(p => p === 'LW' || p === 'RW');
  const position = normalizeHockeyPosition(target);
  return !!position && positions.includes(position);
}

export function playerEligiblePositionsLabel(player: EligiblePlayer, positionType: 'individual' | 'forward' = 'individual'): string {
  const positions = playerEligiblePositions(player).map(p =>
    positionType === 'forward' && ['C', 'LW', 'RW'].includes(p) ? 'F' : p);
  return formatEligiblePositions([...new Set(positions)]);
}

/** "C/LW" for a dual-eligible player. */
export function formatEligiblePositions(positions: readonly string[]): string {
  return positions.join('/');
}


/** Maximum-cardinality matching for missing slot assignments. Input order
 * breaks ties; callers pass only unassigned players and available slots. */
export function matchEligibleSlots<T extends EligiblePlayer>(players: readonly T[], slots: readonly string[]): Map<number, number> {
  const occupants = new Map<number, number>();
  const visit = (playerIndex: number, seen: Set<number>): boolean => {
    for (let slot = 0; slot < slots.length; slot++) {
      if (seen.has(slot) || !isEligibleForPosition(players[playerIndex], slots[slot])) continue;
      seen.add(slot);
      const current = occupants.get(slot);
      if (current === undefined || visit(current, seen)) {
        occupants.set(slot, playerIndex);
        return true;
      }
    }
    return false;
  };
  players.forEach((_, index) => visit(index, new Set()));
  return occupants;
}

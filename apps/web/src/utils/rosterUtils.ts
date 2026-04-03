import { MatchupPlayer } from "@/components/matchup/types";
import { NHLGame } from "@/services/ScheduleService";
import { getTodayMST } from "@/utils/timezoneUtils";

// ============================================================================
// Position Types
// ============================================================================

export type PositionType = 'individual' | 'forward';
export type IndividualPosition = 'C' | 'LW' | 'RW' | 'D' | 'G';
export type ForwardPosition = 'F' | 'D' | 'G';
export type FantasyPosition = IndividualPosition | ForwardPosition;

// ============================================================================
// Default Roster Slot Configurations
// ============================================================================

/** Default roster slots for individual (C/LW/RW/D/G) leagues */
export const DEFAULT_ROSTER_SLOTS: Record<string, number> = {
  C: 2,
  LW: 2,
  RW: 2,
  D: 4,
  G: 2,
  UTIL: 1,
};

/** Default roster slots for F/D/G leagues */
export const DEFAULT_FDG_ROSTER_SLOTS: Record<string, number> = {
  F: 6,
  D: 4,
  G: 2,
  UTIL: 1,
};

// Keep backward-compatible reference
const ROSTER_SLOTS = DEFAULT_ROSTER_SLOTS;

/**
 * Build a roster slots config from league settings, falling back to defaults.
 * League commissioners can override via leagues.settings.rosterSlots.
 */
export function getRosterSlots(
  leagueRosterSlots?: Record<string, number> | null,
  positionType: PositionType = 'individual'
): Record<string, number> {
  if (leagueRosterSlots && Object.keys(leagueRosterSlots).length > 0) {
    return leagueRosterSlots;
  }
  return positionType === 'forward' ? DEFAULT_FDG_ROSTER_SLOTS : DEFAULT_ROSTER_SLOTS;
}

// ============================================================================
// Centralized Position Resolution
// ============================================================================

/**
 * Normalize a raw position string to a standard abbreviation.
 * Returns the individual position (C/LW/RW/D/G) regardless of league type.
 * Use resolveFantasyPosition() when you need league-aware position mapping.
 */
function normalizePosition(position: string): 'C' | 'LW' | 'RW' | 'D' | 'G' | 'OTHER' {
  const pos = position?.toUpperCase() || '';

  if (['C', 'CENTRE', 'CENTER'].includes(pos)) return 'C';
  if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(pos)) return 'LW';
  if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(pos)) return 'RW';
  if (['D', 'DEFENCE', 'DEFENSE'].includes(pos)) return 'D';
  if (['G', 'GOALIE'].includes(pos)) return 'G';

  return 'OTHER';
}

/**
 * Resolve a raw position string to a fantasy slot position based on league position type.
 * - 'individual' mode: C/LW/RW/D/G (standard)
 * - 'forward' mode: C/LW/RW → F, D → D, G → G (F/D/G format)
 */
export function resolveFantasyPosition(
  rawPosition: string,
  positionType: PositionType = 'individual'
): FantasyPosition | 'OTHER' {
  const normalized = normalizePosition(rawPosition);
  if (normalized === 'OTHER') return 'OTHER';

  if (positionType === 'forward') {
    if (normalized === 'C' || normalized === 'LW' || normalized === 'RW') return 'F';
    return normalized; // D or G
  }

  return normalized;
}

/**
 * Get the ordered list of starter slot position codes for a position type.
 */
export function getSlotPositions(positionType: PositionType = 'individual'): string[] {
  return positionType === 'forward'
    ? ['F', 'D', 'G', 'UTIL']
    : ['C', 'LW', 'RW', 'D', 'G', 'UTIL'];
}

/**
 * Get which raw positions can fill a given slot code.
 * For example, in F/D/G mode, 'F' slot accepts C/LW/RW players.
 * UTIL always accepts all skaters (not G).
 */
export function getSlotEligiblePositions(
  slotCode: string,
  positionType: PositionType = 'individual'
): string[] {
  const slot = slotCode.toUpperCase();

  if (slot === 'UTIL') {
    return positionType === 'forward'
      ? ['C', 'LW', 'RW', 'F', 'D']
      : ['C', 'LW', 'RW', 'D'];
  }
  if (slot === 'F') return ['C', 'LW', 'RW', 'F'];
  if (slot === 'D') return ['D'];
  if (slot === 'G') return ['G'];
  if (slot === 'C') return ['C'];
  if (slot === 'LW') return ['LW'];
  if (slot === 'RW') return ['RW'];

  return [];
}

/**
 * Check if a raw position is a forward (C/LW/RW).
 */
export function isForwardPosition(position: string): boolean {
  const normalized = normalizePosition(position);
  return normalized === 'C' || normalized === 'LW' || normalized === 'RW';
}

// Check if a game is in the future (not final or postponed)
function isGameRemaining(game: NHLGame, todayStr: string): boolean {
  const gameDate = game.game_date?.split('T')[0] || '';
  const status = game.status?.toLowerCase() || 'scheduled';

  // Game is remaining if:
  // 1. It's today or future
  // 2. Status is not 'final' or 'postponed'
  return gameDate >= todayStr && status !== 'final' && status !== 'postponed';
}

/**
 * Calculate the total number of fantasy-eligible games remaining for a roster,
 * respecting position slot limits on a per-day basis.
 */
export function calculateEligibleGamesRemaining(
  starters: MatchupPlayer[],
  positionType: PositionType = 'individual',
  rosterSlots?: Record<string, number>
): number {
  const todayStr = getTodayMST();
  const slots = rosterSlots || (positionType === 'forward' ? DEFAULT_FDG_ROSTER_SLOTS : ROSTER_SLOTS);

  // Group games by date
  const gamesByDate = new Map<string, MatchupPlayer[]>();

  starters.forEach(player => {
    if (!player.games || !Array.isArray(player.games)) return;

    player.games.forEach(game => {
      if (!isGameRemaining(game, todayStr)) return;

      const gameDate = game.game_date?.split('T')[0];
      if (!gameDate) return;

      if (!gamesByDate.has(gameDate)) {
        gamesByDate.set(gameDate, []);
      }
      gamesByDate.get(gameDate)!.push(player);
    });
  });

  // For each date, calculate eligible starters (respecting position limits)
  let totalEligibleGames = 0;

  gamesByDate.forEach((players) => {
    // Group players by resolved position
    const playersByPosition: Record<string, MatchupPlayer[]> = {};
    const posKeys = positionType === 'forward' ? ['F', 'D', 'G'] : ['C', 'LW', 'RW', 'D', 'G'];
    for (const key of posKeys) playersByPosition[key] = [];

    players.forEach(player => {
      const pos = resolveFantasyPosition(player.position, positionType);
      if (pos !== 'OTHER' && playersByPosition[pos]) {
        playersByPosition[pos].push(player);
      }
    });

    // Count eligible players per position (up to slot limits)
    let eligibleOnThisDate = 0;
    const overflow: MatchupPlayer[] = [];

    for (const pos of posKeys) {
      const playersAtPos = playersByPosition[pos] || [];
      const limit = slots[pos] || 0;

      eligibleOnThisDate += Math.min(playersAtPos.length, limit);

      // Track overflow players (skaters only - not goalies)
      if (pos !== 'G' && playersAtPos.length > limit) {
        overflow.push(...playersAtPos.slice(limit));
      }
    }

    // Fill UTIL slot with overflow skaters if available
    const utilSlots = slots.UTIL || 0;
    if (overflow.length > 0 && utilSlots > 0) {
      eligibleOnThisDate += Math.min(overflow.length, utilSlots);
    }

    totalEligibleGames += eligibleOnThisDate;
  });

  return totalEligibleGames;
}

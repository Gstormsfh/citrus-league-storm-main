import { MatchupPlayer } from "@/components/matchup/types";
import { NHLGame } from "@/services/ScheduleService";
import { getTodayMST } from "@/utils/timezoneUtils";

// Roster slot configuration
const ROSTER_SLOTS = {
  C: 2,
  LW: 2,
  RW: 2,
  D: 4,
  G: 2,
  UTIL: 1, // Can be filled by any skater (C, LW, RW, D)
};

// Normalize position strings to standard abbreviations
function normalizePosition(position: string): 'C' | 'LW' | 'RW' | 'D' | 'G' | 'OTHER' {
  const pos = position?.toUpperCase() || '';
  
  if (['C', 'CENTRE', 'CENTER'].includes(pos)) return 'C';
  if (['LW', 'LEFT WING', 'LEFTWING', 'L'].includes(pos)) return 'LW';
  if (['RW', 'RIGHT WING', 'RIGHTWING', 'R'].includes(pos)) return 'RW';
  if (['D', 'DEFENCE', 'DEFENSE'].includes(pos)) return 'D';
  if (['G', 'GOALIE'].includes(pos)) return 'G';
  
  return 'OTHER';
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
export function calculateEligibleGamesRemaining(starters: MatchupPlayer[]): number {
  const todayStr = getTodayMST();
  
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
  
  gamesByDate.forEach((players, date) => {
    // Group players by position
    const playersByPosition = {
      C: [] as MatchupPlayer[],
      LW: [] as MatchupPlayer[],
      RW: [] as MatchupPlayer[],
      D: [] as MatchupPlayer[],
      G: [] as MatchupPlayer[],
    };
    
    players.forEach(player => {
      const pos = normalizePosition(player.position);
      if (pos !== 'OTHER' && playersByPosition[pos]) {
        playersByPosition[pos].push(player);
      }
    });
    
    // Count eligible players per position (up to slot limits)
    let eligibleOnThisDate = 0;
    let overflow: MatchupPlayer[] = [];
    
    // Count each position up to its limit
    (['C', 'LW', 'RW', 'D', 'G'] as const).forEach(pos => {
      const playersAtPos = playersByPosition[pos];
      const limit = ROSTER_SLOTS[pos];
      
      eligibleOnThisDate += Math.min(playersAtPos.length, limit);
      
      // Track overflow players (skaters only - not goalies)
      if (pos !== 'G' && playersAtPos.length > limit) {
        overflow.push(...playersAtPos.slice(limit));
      }
    });
    
    // Fill UTIL slot with overflow skaters if available
    if (overflow.length > 0) {
      eligibleOnThisDate += Math.min(overflow.length, ROSTER_SLOTS.UTIL);
    }
    
    totalEligibleGames += eligibleOnThisDate;
  });
  
  return totalEligibleGames;
}


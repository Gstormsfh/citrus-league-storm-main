import { PlayerService, Player } from '@/services/PlayerService';
import { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';

/**
 * Helper to format TOI from seconds
 */
const formatTOI = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

/**
 * Helper to format TOI per game from total seconds and games played
 */
const formatTOIPerGame = (totalSeconds: number, gamesPlayed: number): string => {
  if (gamesPlayed === 0) return '0:00';
  const avgSeconds = totalSeconds / gamesPlayed;
  return formatTOI(avgSeconds);
};

/**
 * Fetch fresh season stats for a player and convert to HockeyPlayer format
 * This ensures all pages (Roster, FreeAgents, Matchup) use the same data source
 * and stat mapping, providing consistent player stats across the app.
 * 
 * @param playerId - Player ID (string or number)
 * @returns HockeyPlayer with season stats, or null if player not found
 */
export async function getPlayerWithSeasonStats(
  playerId: string | number
): Promise<HockeyPlayer | null> {
  try {
    // Fetch fresh season stats from PlayerService (uses NHL.com official stats)
    const players = await PlayerService.getPlayersByIds([String(playerId)]);
    const player = players.find(p => Number(p.id) === Number(playerId));
    
    if (!player) {
      console.warn(`[playerStatsHelper] Player ${playerId} not found`);
      return null;
    }

    // Map Player type to HockeyPlayer format
    // CRITICAL: Use NHL.com official stats exclusively (no PBP fallback)
    // This ensures player cards match NHL.com exactly
    
    // Handle PPP/SHP - check both powerPlayPoints/shortHandedPoints AND ppp/shp
    const powerPlayPoints = player.ppp !== undefined && player.ppp !== null ? player.ppp : 0;
    const shortHandedPoints = player.shp !== undefined && player.shp !== null ? player.shp : 0;

    const hockeyPlayer: HockeyPlayer = {
      id: player.id,
      name: player.full_name,
      position: player.position,
      number: parseInt(player.jersey_number || '0'),
      starter: false,
      stats: {
        // Skater stats
        gamesPlayed: player.games_played || 0,
        goals: player.goals || 0,
        assists: player.assists || 0,
        points: player.points || 0,
        plusMinus: player.plus_minus || 0,
        shots: player.shots || 0,
        hits: player.hits || 0,
        blockedShots: player.blocks || 0,
        xGoals: player.xGoals || 0,
        powerPlayPoints: powerPlayPoints,
        shortHandedPoints: shortHandedPoints,
        pim: player.pim || 0,
        toi: player.icetime_seconds 
          ? formatTOIPerGame(player.icetime_seconds, player.games_played || 1)
          : '0:00',
        // Goalie stats
        wins: player.wins || 0,
        losses: player.losses || 0,
        otl: player.ot_losses || 0,
        gaa: player.goals_against_average || 0,
        savePct: player.save_percentage || 0,
        shutouts: player.shutouts || 0,
        saves: player.saves || 0,
        goalsAgainst: player.goals_against || 0,
        goalsSavedAboveExpected: player.goalsSavedAboveExpected || 0
      },
      team: player.team,
      teamAbbreviation: player.team,
      status: player.status === 'injured' ? 'IR' : null,
      roster_status: player.roster_status,
      is_ir_eligible: player.is_ir_eligible,
      image: player.headshot_url || undefined,
      projectedPoints: (player.points || 0) / 20
    };

    return hockeyPlayer;
  } catch (error) {
    console.error(`[playerStatsHelper] Error fetching season stats for player ${playerId}:`, error);
    return null;
  }
}


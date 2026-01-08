import { supabase } from '@/integrations/supabase/client';
import { getTodayMST, getTodayMSTDate } from '@/utils/timezoneUtils';

// Test mode: Controlled via VITE_TEST_MODE environment variable
const TEST_MODE = import.meta.env.VITE_TEST_MODE === 'true';
const TEST_DATE = import.meta.env.VITE_TEST_DATE || '2025-12-08';

// Helper to get "today" in Mountain Time - uses test date if in test mode
function getTodayString(): string {
  if (TEST_MODE) {
    return TEST_DATE;
  }
  return getTodayMST();
}

// Helper to get "today" as Date object in Mountain Time
function getTodayDate(): Date {
  if (TEST_MODE) {
    const date = new Date(TEST_DATE + 'T00:00:00');
    return date;
  }
  return getTodayMSTDate();
}

export type GameStatus = 'not_started' | 'live' | 'final';

export interface PlayerLockInfo {
  isLocked: boolean;
  gameStatus: GameStatus;
  gameTime?: string;
  gameDate?: string;
}

/**
 * GameLockService - Determines if players can be moved based on game start times
 * 
 * A player is locked if their team's game has started (game_time < now).
 * This is checked per-player, not per-date, allowing flexibility to move
 * players whose games haven't started even if other players are locked.
 */
export const GameLockService = {
  /**
   * Check if a specific player's game has started for a given date
   * @param playerId - Player ID to check
   * @param teamAbbrev - Team abbreviation (e.g., 'EDM', 'TOR')
   * @param targetDate - Date to check (defaults to today)
   * @returns PlayerLockInfo with lock status and game information
   */
  async isPlayerLocked(
    playerId: string | number,
    teamAbbrev: string,
    targetDate?: Date
  ): Promise<PlayerLockInfo> {
    try {
      const dateToCheck = targetDate || getTodayDate();
      const dateStr = dateToCheck.toISOString().split('T')[0];
      const now = new Date();

      // Get game for this team on the target date
      const { data: games, error } = await supabase
        .from('nhl_games')
        .select('game_time, status, game_date')
        .eq('game_date', dateStr)
        .or(`home_team.eq.${teamAbbrev},away_team.eq.${teamAbbrev}`)
        .in('status', ['scheduled', 'live', 'final'])
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[GameLockService] Error checking game status:', error);
        // Fail open - allow moves if we can't determine status
        return { isLocked: false, gameStatus: 'not_started' };
      }

      if (!games) {
        // No game scheduled for this date
        return { isLocked: false, gameStatus: 'not_started' };
      }

      const game = games as any;
      const gameStatus = game.status as 'scheduled' | 'live' | 'final';

      // If game is already final, player is locked
      if (gameStatus === 'final') {
        return {
          isLocked: true,
          gameStatus: 'final',
          gameTime: game.game_time,
          gameDate: game.game_date
        };
      }

      // If game is live, player is locked
      if (gameStatus === 'live') {
        return {
          isLocked: true,
          gameStatus: 'live',
          gameTime: game.game_time,
          gameDate: game.game_date
        };
      }

      // If game is scheduled, check if game_time has passed
      if (gameStatus === 'scheduled' && game.game_time) {
        const gameStart = new Date(game.game_time);
        if (gameStart < now) {
          // Game time has passed but status hasn't updated yet - lock the player
          return {
            isLocked: true,
            gameStatus: 'live', // Treat as live if time has passed
            gameTime: game.game_time,
            gameDate: game.game_date
          };
        }
      }

      // Game is scheduled and hasn't started yet
      return {
        isLocked: false,
        gameStatus: 'not_started',
        gameTime: game.game_time,
        gameDate: game.game_date
      };
    } catch (error) {
      console.error('[GameLockService] Exception checking player lock:', error);
      // Fail open - allow moves on error
      return { isLocked: false, gameStatus: 'not_started' };
    }
  },

  /**
   * Get game status for a team on a specific date
   * @param teamAbbrev - Team abbreviation
   * @param date - Date to check (defaults to today)
   * @returns GameStatus
   */
  async getPlayerGameStatus(
    teamAbbrev: string,
    date?: Date
  ): Promise<GameStatus> {
    const lockInfo = await this.isPlayerLocked(0, teamAbbrev, date);
    return lockInfo.gameStatus;
  },

  /**
   * Get locked player IDs from an array of players
   * @param players - Array of players with id and team/teamAbbreviation
   * @param targetDate - Date to check (defaults to today)
   * @returns Set of locked player IDs (as strings)
   */
  async getLockedPlayerIds(
    players: Array<{ id: string | number; team?: string; teamAbbreviation?: string }>,
    targetDate?: Date
  ): Promise<Set<string>> {
    const lockedIds = new Set<string>();
    const now = Date.now();

    // Batch check games for all unique teams
    const uniqueTeams = new Set<string>();
    players.forEach(p => {
      const team = p.teamAbbreviation || p.team || '';
      if (team && team.length === 3) {
        uniqueTeams.add(team);
      }
    });

    if (uniqueTeams.size === 0) {
      return lockedIds;
    }

    const dateToCheck = targetDate || getTodayDate();
    const dateStr = dateToCheck.toISOString().split('T')[0];

    // Batch fetch all games for these teams on this date
    const teamList = Array.from(uniqueTeams);
    const orConditions = teamList
      .map(team => `home_team.eq.${team},away_team.eq.${team}`)
      .join(',');

    const { data: games, error } = await supabase
      .from('nhl_games')
      .select('game_time, status, home_team, away_team, game_date')
      .eq('game_date', dateStr)
      .or(orConditions)
      .in('status', ['scheduled', 'live', 'final']);

    if (error) {
      console.error('[GameLockService] Error batch checking games:', error);
      return lockedIds;
    }

    // Build map of team -> game info
    const teamGameMap = new Map<string, { gameTime?: string; status: string }>();
    (games || []).forEach((game: any) => {
      if (teamList.includes(game.home_team)) {
        teamGameMap.set(game.home_team, { gameTime: game.game_time, status: game.status });
      }
      if (teamList.includes(game.away_team)) {
        teamGameMap.set(game.away_team, { gameTime: game.game_time, status: game.status });
      }
    });

    // Check each player
    for (const player of players) {
      const team = player.teamAbbreviation || player.team || '';
      if (!team || team.length !== 3) continue;

      const gameInfo = teamGameMap.get(team);
      if (!gameInfo) {
        // No game scheduled - not locked
        continue;
      }

      const gameStatus = gameInfo.status as 'scheduled' | 'live' | 'final';

      // If game is final or live, player is locked
      if (gameStatus === 'final' || gameStatus === 'live') {
        lockedIds.add(String(player.id));
        continue;
      }

      // If game is scheduled, check if game_time has passed
      if (gameStatus === 'scheduled' && gameInfo.gameTime) {
        const gameStart = new Date(gameInfo.gameTime);
        if (gameStart.getTime() < now) {
          // Game time has passed - lock the player
          lockedIds.add(String(player.id));
        }
      }
    }

    return lockedIds;
  }
};


import { scheduleApi } from '@/api/schedule';
import { getTodayMST, getTodayMSTDate } from '@/utils/timezoneUtils';
import { DEFAULT_TEST_DATE } from '@/utils/seasonConstants';
import { logger } from '@/utils/logger';

// Test mode: Controlled via VITE_TEST_MODE environment variable
const TEST_MODE = import.meta.env.VITE_TEST_MODE === 'true';
const TEST_DATE = import.meta.env.VITE_TEST_DATE || DEFAULT_TEST_DATE;

function getTodayString(): string {
  if (TEST_MODE) return TEST_DATE;
  return getTodayMST();
}

function getTodayDate(): Date {
  if (TEST_MODE) return new Date(TEST_DATE + 'T00:00:00');
  return getTodayMSTDate();
}

export type GameStatus = 'not_started' | 'live' | 'final';

export interface PlayerLockInfo {
  isLocked: boolean;
  gameStatus: GameStatus;
  gameTime?: string;
  gameDate?: string;
}

interface GameRow {
  game_time: string | null;
  status: string;
  home_team: string;
  away_team: string;
  game_date: string;
}

/**
 * GameLockService - Determines if players can be moved based on game start times.
 * Uses schedule API instead of direct Supabase calls.
 */
export const GameLockService = {
  async isPlayerLocked(
    _playerId: string | number,
    teamAbbrev: string,
    targetDate?: Date
  ): Promise<PlayerLockInfo> {
    try {
      const dateToCheck = targetDate || getTodayDate();
      const dateStr = `${dateToCheck.getFullYear()}-${String(dateToCheck.getMonth() + 1).padStart(2, '0')}-${String(dateToCheck.getDate()).padStart(2, '0')}`;
      const now = new Date();

      const response = await scheduleApi.getGames({ date: dateStr, team: teamAbbrev });
      const games = (response.data || []) as GameRow[];
      const game = games[0];

      if (!game) {
        return { isLocked: false, gameStatus: 'not_started' };
      }

      const gameStatus = game.status as 'scheduled' | 'live' | 'final';

      if (gameStatus === 'final') {
        return { isLocked: true, gameStatus: 'final', gameTime: game.game_time ?? undefined, gameDate: game.game_date };
      }

      if (gameStatus === 'live') {
        return { isLocked: true, gameStatus: 'live', gameTime: game.game_time ?? undefined, gameDate: game.game_date };
      }

      if (gameStatus === 'scheduled' && game.game_time) {
        const gameStart = new Date(game.game_time);
        if (gameStart < now) {
          return { isLocked: true, gameStatus: 'live', gameTime: game.game_time, gameDate: game.game_date };
        }
      }

      return { isLocked: false, gameStatus: 'not_started', gameTime: game.game_time ?? undefined, gameDate: game.game_date };
    } catch (error) {
      logger.error('[GameLockService] Exception checking player lock:', error);
      return { isLocked: false, gameStatus: 'not_started' };
    }
  },

  async getPlayerGameStatus(teamAbbrev: string, date?: Date): Promise<GameStatus> {
    const lockInfo = await this.isPlayerLocked(0, teamAbbrev, date);
    return lockInfo.gameStatus;
  },

  async getLockedPlayerIds(
    players: Array<{ id: string | number; team?: string; teamAbbreviation?: string }>,
    targetDate?: Date
  ): Promise<Set<string>> {
    const lockedIds = new Set<string>();
    const now = Date.now();

    const uniqueTeams = new Set<string>();
    players.forEach(p => {
      const team = p.teamAbbreviation || p.team || '';
      if (team && team.length === 3) uniqueTeams.add(team);
    });

    if (uniqueTeams.size === 0) return lockedIds;

    const dateToCheck = targetDate || getTodayDate();
    const dateStr = `${dateToCheck.getFullYear()}-${String(dateToCheck.getMonth() + 1).padStart(2, '0')}-${String(dateToCheck.getDate()).padStart(2, '0')}`;

    try {
      const teamList = Array.from(uniqueTeams);
      const response = await scheduleApi.getGamesForTeams(teamList, dateStr, dateStr);
      const gamesMap = (response.data || {}) as Record<string, GameRow[]>;

      // Build team -> game info map
      const teamGameMap = new Map<string, { gameTime?: string; status: string }>();
      for (const [team, games] of Object.entries(gamesMap)) {
        if (Array.isArray(games) && games.length > 0) {
          teamGameMap.set(team, { gameTime: games[0].game_time ?? undefined, status: games[0].status });
        }
      }

      // Also handle flat array response format
      if (Array.isArray(response.data)) {
        (response.data as GameRow[]).forEach((game: GameRow) => {
          if (teamList.includes(game.home_team)) {
            teamGameMap.set(game.home_team, { gameTime: game.game_time ?? undefined, status: game.status });
          }
          if (teamList.includes(game.away_team)) {
            teamGameMap.set(game.away_team, { gameTime: game.game_time ?? undefined, status: game.status });
          }
        });
      }

      for (const player of players) {
        const team = player.teamAbbreviation || player.team || '';
        if (!team || team.length !== 3) continue;

        const gameInfo = teamGameMap.get(team);
        if (!gameInfo) continue;

        const gameStatus = gameInfo.status as 'scheduled' | 'live' | 'final';
        if (gameStatus === 'final' || gameStatus === 'live') {
          lockedIds.add(String(player.id));
          continue;
        }

        if (gameStatus === 'scheduled' && gameInfo.gameTime) {
          const gameStart = new Date(gameInfo.gameTime);
          if (gameStart.getTime() < now) {
            lockedIds.add(String(player.id));
          }
        }
      }
    } catch (error) {
      logger.error('[GameLockService] Error batch checking games:', error);
    }

    return lockedIds;
  }
};

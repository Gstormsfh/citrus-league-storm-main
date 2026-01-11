import { ScheduleService, NHLGame } from '@/services/ScheduleService';
import { LeagueService } from '@/services/LeagueService';
import { Player } from '@/services/PlayerService';
import { getDraftCompletionDate, getFirstWeekStartDate, getCurrentWeekNumber, getWeekStartDate, getWeekEndDate } from './weekCalculator';

export interface PlayerWithSchedule extends Player {
  gamesThisWeek: number;
  gameDays: string[];
  projectedPoints?: number; // Optional weekly projected points
}

export interface WeekDates {
  weekStart: Date;
  weekEnd: Date;
}

/**
 * Calculate week dates (calendar week or matchup week based on league)
 */
export async function calculateWeekDates(
  leagueId?: string,
  userId?: string
): Promise<WeekDates> {
  // Test mode controlled via VITE_TEST_MODE environment variable (defaults to false)
  const TEST_MODE = import.meta.env.VITE_TEST_MODE === 'true';
  const TEST_DATE = import.meta.env.VITE_TEST_DATE || '2025-12-08';
  
  const getTodayDate = () => {
    if (TEST_MODE) {
      const date = new Date(TEST_DATE + 'T00:00:00');
      date.setHours(0, 0, 0, 0);
      return date;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  };

  // Default to calendar week
  const today = getTodayDate();
  const dayOfWeek = today.getDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  let weekStart = new Date(today);
  weekStart.setDate(today.getDate() - daysFromMonday);
  weekStart.setHours(0, 0, 0, 0);
  let weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  // Try to use matchup week if user is logged in and has a league
  if (userId && leagueId) {
    try {
      const { league: leagueData, error: leagueError } = await LeagueService.getLeague(leagueId);
      if (!leagueError && leagueData && leagueData.draft_status === 'completed') {
        const draftCompletionDate = getDraftCompletionDate(leagueData);
        if (draftCompletionDate) {
          const firstWeekStart = getFirstWeekStartDate(draftCompletionDate);
          const currentWeek = getCurrentWeekNumber(firstWeekStart);
          weekStart = getWeekStartDate(currentWeek, firstWeekStart);
          weekEnd = getWeekEndDate(currentWeek, firstWeekStart);
        }
      }
    } catch (error) {
      // Silently fall back to calendar week if league fetch fails
      console.warn('Could not fetch league data for matchup week calculation, using calendar week:', error);
    }
  }

  return { weekStart, weekEnd };
}

/**
 * Batch fetch games for multiple teams in parallel
 * Returns a map of team abbreviation -> games array
 */
export async function fetchGamesForTeams(
  teams: string[],
  weekStart: Date,
  weekEnd: Date
): Promise<Map<string, NHLGame[]>> {
  const uniqueTeams = [...new Set(teams)];
  
  // Batch fetch games for all teams in parallel
  const teamGamesPromises = uniqueTeams.map(team => 
    ScheduleService.getGamesForTeamInWeek(team, weekStart, weekEnd)
      .then(({ games, error }) => {
        if (error) {
          console.warn(`Error fetching games for ${team}:`, error);
          return { team, games: [] };
        }
        return { team, games: games || [] };
      })
      .catch((error) => {
        console.warn(`Exception fetching games for ${team}:`, error);
        return { team, games: [] };
      })
  );

  const teamGamesResults = await Promise.all(teamGamesPromises);
  const teamGamesMap = new Map<string, NHLGame[]>();
  teamGamesResults.forEach(({ team, games }) => {
    teamGamesMap.set(team, games);
  });

  return teamGamesMap;
}

/**
 * Calculate games this week and game days for a player
 */
export function calculatePlayerSchedule(
  player: Player,
  teamGamesMap: Map<string, NHLGame[]>
): { gamesThisWeek: number; gameDays: string[] } {
  const games = teamGamesMap.get(player.team) || [];
  const count = games.length;
  
  // Get day abbreviations for each game
  const gameDays = games.map(game => {
    const gameDate = new Date(game.game_date);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return dayNames[gameDate.getDay()];
  });

  return {
    gamesThisWeek: count,
    gameDays: [...new Set(gameDays)] // Remove duplicates
  };
}

/**
 * Calculate schedule maximizers for a list of players
 * Returns players with gamesThisWeek and gameDays added
 */
export async function calculateScheduleMaximizers(
  players: Player[],
  leagueId?: string,
  userId?: string,
  limit: number = 200
): Promise<PlayerWithSchedule[]> {
  try {
    // Limit to top players by points to reduce query load
    const topPlayers = [...players]
      .sort((a, b) => (b.points || 0) - (a.points || 0))
      .slice(0, limit);

    // Calculate week dates
    const { weekStart, weekEnd } = await calculateWeekDates(leagueId, userId);

    // Get unique teams to batch queries
    const uniqueTeams = [...new Set(topPlayers.map(p => p.team))];

    // Batch fetch games for all teams
    const teamGamesMap = await fetchGamesForTeams(uniqueTeams, weekStart, weekEnd);

    // Calculate games for each player
    const maximizers: PlayerWithSchedule[] = topPlayers.map(player => {
      const schedule = calculatePlayerSchedule(player, teamGamesMap);
      return {
        ...player,
        ...schedule
      };
    });

    // Sort by games count (descending), then by points (descending)
    maximizers.sort((a, b) => {
      if (b.gamesThisWeek !== a.gamesThisWeek) {
        return b.gamesThisWeek - a.gamesThisWeek;
      }
      return (b.points || 0) - (a.points || 0);
    });

    return maximizers;
  } catch (error) {
    console.error('Error calculating schedule maximizers:', error);
    return [];
  }
}

/**
 * Get total NHL games per day for a date range
 * Returns a map of date string (YYYY-MM-DD) -> game count
 */
export async function getGamesPerDay(
  startDate: Date,
  endDate: Date
): Promise<Map<string, number>> {
  try {
    const { games } = await ScheduleService.getGamesForDateRange(startDate, endDate);
    
    const gamesPerDay = new Map<string, number>();
    
    games.forEach(game => {
      const gameDate = game.game_date.split('T')[0]; // Get YYYY-MM-DD
      const current = gamesPerDay.get(gameDate) || 0;
      gamesPerDay.set(gameDate, current + 1);
    });

    return gamesPerDay;
  } catch (error) {
    console.error('Error getting games per day:', error);
    return new Map();
  }
}

/**
 * Get roster games per day (for your team's players)
 * Returns a map of date string (YYYY-MM-DD) -> game count for your roster
 */
export async function getRosterGamesPerDay(
  rosterPlayers: Player[],
  startDate: Date,
  endDate: Date
): Promise<Map<string, number>> {
  try {
    const uniqueTeams = [...new Set(rosterPlayers.map(p => p.team))];
    const teamGamesMap = await fetchGamesForTeams(uniqueTeams, startDate, endDate);
    
    const rosterGamesPerDay = new Map<string, number>();
    
    rosterPlayers.forEach(player => {
      const games = teamGamesMap.get(player.team) || [];
      games.forEach(game => {
        const gameDate = game.game_date.split('T')[0]; // Get YYYY-MM-DD
        const current = rosterGamesPerDay.get(gameDate) || 0;
        rosterGamesPerDay.set(gameDate, current + 1);
      });
    });

    return rosterGamesPerDay;
  } catch (error) {
    console.error('Error getting roster games per day:', error);
    return new Map();
  }
}

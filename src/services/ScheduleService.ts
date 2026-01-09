import { supabase } from '@/integrations/supabase/client';
import { withTimeout } from '@/utils/promiseUtils';
import { getTodayMST, getTodayMSTDate } from '@/utils/timezoneUtils';
import { COLUMNS } from '@/utils/queryColumns';

// Test mode: Controlled via VITE_TEST_MODE environment variable
// Set VITE_TEST_MODE=true in .env to use test date for development
// Defaults to false (uses actual current date) for production
const TEST_MODE = import.meta.env.VITE_TEST_MODE === 'true';
const TEST_DATE = import.meta.env.VITE_TEST_DATE || '2025-12-08';

// Helper to get "today" in Mountain Time - uses test date if in test mode
function getTodayString(): string {
  if (TEST_MODE) {
    return TEST_DATE;
  }
  return getTodayMST(); // Use MST instead of UTC
}

// Helper to get "today" as Date object in Mountain Time
function getTodayDate(): Date {
  if (TEST_MODE) {
    const date = new Date(TEST_DATE + 'T00:00:00');
    return date;
  }
  return getTodayMSTDate(); // Use MST instead of local time
}

export interface NHLGame {
  id: string;
  game_id: number;
  game_date: string;
  game_time: string | null;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  status: 'scheduled' | 'live' | 'final' | 'postponed';
  period: string | null;
  period_time: string | null;
  venue: string | null;
  season: number;
  game_type: 'regular' | 'playoff' | 'preseason';
}

export interface GameInfo {
  opponent: string; // e.g., "vs BOS" or "@ NYR"
  time?: string; // e.g., "7:00 PM"
  score?: string; // e.g., "EDM 4-2"
  period?: string; // e.g., "3rd 12:45"
  date?: string; // Game date
}

export const ScheduleService = {
  /**
   * Get games for a specific date range
   */
  async getGamesForDateRange(
    startDate: Date,
    endDate: Date
  ): Promise<{ games: NHLGame[]; error: any }> {
    try {
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('nhl_games')
        .select(COLUMNS.NHL_GAME)
        .gte('game_date', startStr)
        .lte('game_date', endStr)
        .order('game_date', { ascending: true })
        .order('game_time', { ascending: true });

      if (error) {
        // If table doesn't exist, return empty array (schedule not loaded yet)
        if (error.message?.includes('does not exist') || error.message?.includes('relation')) {
          console.warn('nhl_games table does not exist yet. Run the migration and fetch script.');
          return { games: [], error: null };
        }
        throw error;
      }
      return { games: data || [], error: null };
    } catch (error) {
      console.error('Error fetching games for date range:', error);
      return { games: [], error };
    }
  },

  /**
   * Get games for multiple teams at once (batch query for performance)
   * Returns a map of team abbreviation -> games array
   */
  async getGamesForTeams(
    teamAbbrevs: string[],
    startDate?: Date,
    endDate?: Date
  ): Promise<{ gamesByTeam: Map<string, NHLGame[]>; error: any }> {
    try {
      if (teamAbbrevs.length === 0) {
        return { gamesByTeam: new Map(), error: null };
      }

      // CRITICAL: Normalize all team abbreviations to uppercase for consistent matching
      // Database stores teams in uppercase, so we need to match that
      const normalizedTeams = teamAbbrevs.map(t => t.toUpperCase());

      // Build OR condition for all teams (using uppercase)
      // Format: (home_team.eq.TEAM1,away_team.eq.TEAM1),(home_team.eq.TEAM2,away_team.eq.TEAM2),...
      const orConditions = normalizedTeams
        .map(team => `home_team.eq.${team},away_team.eq.${team}`)
        .join(',');

      let query = supabase
        .from('nhl_games')
        .select(COLUMNS.NHL_GAME)
        .or(orConditions)
        .order('game_date', { ascending: true })
        .order('game_time', { ascending: true });

      if (startDate) {
        query = query.gte('game_date', startDate.toISOString().split('T')[0]);
      }
      if (endDate) {
        query = query.lte('game_date', endDate.toISOString().split('T')[0]);
      }

      let data: any = null;
      let error: any = null;
      try {
        const result = await withTimeout(query, 10000, 'getGamesForTeams query timeout');
        data = result.data;
        error = result.error;
      } catch (timeoutError: any) {
        console.error('[ScheduleService.getGamesForTeams] Query timeout:', timeoutError);
        error = timeoutError;
      }
      
      if (error) {
        if (error.message?.includes('does not exist') || error.message?.includes('relation')) {
          console.warn('nhl_games table does not exist yet. Run the migration and fetch script.');
          return { gamesByTeam: new Map(), error: null };
        }
        if (error.message?.includes('timeout')) {
          console.error('[ScheduleService.getGamesForTeams] Query timed out after 10s');
          return { gamesByTeam: new Map(), error };
        }
        throw error;
      }

      // Group games by team (using uppercase keys for consistent lookup)
      const gamesByTeam = new Map<string, NHLGame[]>();
      normalizedTeams.forEach(team => {
        gamesByTeam.set(team, []);
      });

      (data || []).forEach((game: NHLGame) => {
        // Database stores teams in uppercase, so direct matching works
        const homeTeam = (game.home_team || '').toUpperCase();
        const awayTeam = (game.away_team || '').toUpperCase();
        
        if (homeTeam && gamesByTeam.has(homeTeam)) {
          gamesByTeam.get(homeTeam)!.push(game);
        }
        if (awayTeam && gamesByTeam.has(awayTeam)) {
          gamesByTeam.get(awayTeam)!.push(game);
        }
      });

      return { gamesByTeam, error: null };
    } catch (error) {
      console.error('Error fetching games for teams:', error);
      return { gamesByTeam: new Map(), error };
    }
  },

  /**
   * Get games for a specific team
   */
  async getGamesForTeam(
    teamAbbrev: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{ games: NHLGame[]; error: any }> {
    try {
      let query = supabase
        .from('nhl_games')
        .select(COLUMNS.NHL_GAME)
        .or(`home_team.eq.${teamAbbrev},away_team.eq.${teamAbbrev}`)
        .order('game_date', { ascending: true })
        .order('game_time', { ascending: true });

      if (startDate) {
        query = query.gte('game_date', startDate.toISOString().split('T')[0]);
      }
      if (endDate) {
        query = query.lte('game_date', endDate.toISOString().split('T')[0]);
      }

      const { data, error } = await query;
      if (error) {
        // If table doesn't exist, return empty array
        if (error.message?.includes('does not exist') || error.message?.includes('relation')) {
          console.warn('nhl_games table does not exist yet. Run the migration and fetch script.');
          return { games: [], error: null };
        }
        throw error;
      }
      return { games: data || [], error: null };
    } catch (error) {
      console.error('Error fetching games for team:', error);
      return { games: [], error };
    }
  },

  /**
   * Get next game for a team (including today's games)
   */
  async getNextGameForTeam(teamAbbrev: string): Promise<{ game: NHLGame | null; error: any }> {
    try {
      const todayStr = getTodayString();

      const { data, error } = await supabase
        .from('nhl_games')
        .select(COLUMNS.NHL_GAME)
        .or(`home_team.eq.${teamAbbrev},away_team.eq.${teamAbbrev}`)
        .gte('game_date', todayStr)
        .in('status', ['scheduled', 'live', 'final'])
        .order('game_date', { ascending: true })
        .order('game_time', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        // If table doesn't exist, return null
        if (error.message?.includes('does not exist') || error.message?.includes('relation')) {
          return { game: null, error: null };
        }
        throw error;
      }
      return { game: data || null, error: null };
    } catch (error) {
      console.error('Error fetching next game:', error);
      return { game: null, error };
    }
  },

  /**
   * Get games for a team within a week (Monday-Sunday)
   */
  async getGamesForTeamInWeek(
    teamAbbrev: string,
    weekStart: Date,
    weekEnd: Date
  ): Promise<{ games: NHLGame[]; error: any }> {
    return this.getGamesForTeam(teamAbbrev, weekStart, weekEnd);
  },

  /**
   * Get game info formatted for display
   * @param game - The NHL game object
   * @param playerTeam - The player's team abbreviation
   * @param timezone - User's timezone (e.g., 'America/Denver' for Mountain Time). Defaults to 'America/Denver'
   */
  getGameInfo(game: NHLGame | null, playerTeam: string, timezone: string = 'America/Denver'): GameInfo | undefined {
    if (!game) return undefined;

    // CRITICAL: Verify the player's team is actually in this game
    // Don't show game info if the player's team doesn't match home or away
    const isHome = game.home_team === playerTeam;
    const isAway = game.away_team === playerTeam;
    
    if (!isHome && !isAway) {
      // Player's team is not in this game - don't show game info
      return undefined;
    }
    
    const opponent = isHome ? game.away_team : game.home_team;
    const opponentPrefix = isHome ? 'vs' : '@';

    const gameInfo: GameInfo = {
      opponent: `${opponentPrefix} ${opponent}`,
      date: game.game_date
    };

    // Check if game is today
    const todayStr = getTodayString();
    const isToday = game.game_date === todayStr;
    
    // CRITICAL: If game date is in the past and status is "scheduled", treat it as final
    // This handles cases where database hasn't been updated yet
    const isPastDate = game.game_date < todayStr;
    const effectiveStatus = (isPastDate && game.status === 'scheduled') ? 'final' : game.status;

    // Always try to add time if game_time exists (for scheduled or upcoming games)
    if (game.game_time) {
      try {
        const gameTime = new Date(game.game_time);
        // Only show time for scheduled games or today's games that aren't final
        if (game.status === 'scheduled' || (isToday && game.status !== 'final')) {
          // Convert to user's timezone
          gameInfo.time = gameTime.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: timezone
          });
        }
      } catch (e) {
        console.warn('Error parsing game time:', e);
      }
    }

    // Add score and period ONLY if:
    // 1. Game is live or final (never show scores for scheduled games)
    // 2. Scores are available (not null/undefined)
    // 3. For live games, don't show 0-0 (game might not have started yet)
    // 4. For final games, always show score (even if 0-0, which is rare but possible)
    // Use effectiveStatus to handle past games marked as scheduled
    if (effectiveStatus === 'live' || effectiveStatus === 'final') {
      const homeScore = game.home_score;
      const awayScore = game.away_score;
      
      // Only show score if both scores are available
      if (homeScore !== null && homeScore !== undefined && 
          awayScore !== null && awayScore !== undefined) {
        
        // NEVER show 0-0 scores - it's impossible for a hockey game to end 0-0
        // If scores are 0-0, the game either:
        // 1. Hasn't started yet (scheduled) - shouldn't show score anyway
        // 2. Just started (live) - wait until someone scores
        // 3. Data is incorrect - don't show wrong data
        // Only show score if at least one team has scored
        const shouldShowScore = homeScore !== 0 || awayScore !== 0;
        
        if (shouldShowScore) {
          // Format score with player's team first
          if (isHome) {
            gameInfo.score = `${playerTeam} ${homeScore}-${awayScore} ${opponent}`;
          } else {
            gameInfo.score = `${playerTeam} ${awayScore}-${homeScore} ${opponent}`;
          }
        }
        
        if (effectiveStatus === 'live' && game.period) {
          gameInfo.period = game.period;
          if (game.period_time) {
            gameInfo.period += ` ${game.period_time}`;
          }
        }
      }
    }

    // For scheduled games today, ensure we show the time
    if (isToday && game.status === 'scheduled' && !gameInfo.time && game.game_time) {
      // Try again to parse time
      try {
        const gameTime = new Date(game.game_time);
        gameInfo.time = gameTime.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: timezone
        });
      } catch (e) {
        // If time parsing fails, at least we have opponent
      }
    }

    return gameInfo;
  },

  /**
   * Batch check if multiple teams have games today
   * Returns a map of team abbreviation -> boolean
   */
  async hasGamesTodayBatch(teamAbbrevs: string[]): Promise<Map<string, boolean>> {
    return this.hasGamesOnDateBatch(teamAbbrevs, getTodayString());
  },

  /**
   * Batch check if multiple teams have games on a specific date
   * Returns a map of team abbreviation -> boolean
   */
  async hasGamesOnDateBatch(teamAbbrevs: string[], targetDate: string): Promise<Map<string, boolean>> {
    try {
      if (teamAbbrevs.length === 0) {
        return new Map();
      }

      const orConditions = teamAbbrevs
        .map(team => `home_team.eq.${team},away_team.eq.${team}`)
        .join(',');

      const { data: games, error } = await supabase
        .from('nhl_games')
        .select('home_team, away_team')
        .or(orConditions)
        .eq('game_date', targetDate)
        .in('status', ['scheduled', 'live', 'final']);

      if (error) {
        if (error.message?.includes('does not exist') || error.message?.includes('relation')) {
          return new Map(teamAbbrevs.map(team => [team, false]));
        }
        console.error('Error checking games on date batch:', error);
        return new Map(teamAbbrevs.map(team => [team, false]));
      }

      // Build set of teams with games on that date
      const teamsWithGames = new Set<string>();
      (games || []).forEach((game: { home_team: string; away_team: string }) => {
        if (teamAbbrevs.includes(game.home_team)) teamsWithGames.add(game.home_team);
        if (teamAbbrevs.includes(game.away_team)) teamsWithGames.add(game.away_team);
      });

      // Return map
      return new Map(teamAbbrevs.map(team => [team, teamsWithGames.has(team)]));
    } catch (error) {
      console.error('Error checking games on date batch:', error);
      return new Map(teamAbbrevs.map(team => [team, false]));
    }
  },

  /**
   * Batch get games for multiple teams on a specific date
   * Returns a map of team abbreviation -> game (or null)
   */
  async getGamesForTeamsOnDate(teamAbbrevs: string[], targetDate: string): Promise<Map<string, NHLGame | null>> {
    try {
      if (teamAbbrevs.length === 0) {
        return new Map();
      }

      const orConditions = teamAbbrevs
        .map(team => `home_team.eq.${team},away_team.eq.${team}`)
        .join(',');

      const { data: games, error } = await supabase
        .from('nhl_games')
        .select(COLUMNS.NHL_GAME)
        .or(orConditions)
        .eq('game_date', targetDate)
        .in('status', ['scheduled', 'live', 'final'])
        .order('game_time', { ascending: true });

      if (error) {
        if (error.message?.includes('does not exist') || error.message?.includes('relation')) {
          return new Map(teamAbbrevs.map(team => [team, null]));
        }
        console.error('Error fetching games for date batch:', error);
        return new Map(teamAbbrevs.map(team => [team, null]));
      }

      // Find game for each team on this date
      const gamesMap = new Map<string, NHLGame | null>();
      teamAbbrevs.forEach(team => {
        const game = (games || []).find(
          (g: NHLGame) => g.home_team === team || g.away_team === team
        ) || null;
        gamesMap.set(team, game);
      });

      return gamesMap;
    } catch (error) {
      console.error('Error fetching games for date batch:', error);
      return new Map(teamAbbrevs.map(team => [team, null]));
    }
  },

  /**
   * Batch get next games for multiple teams
   * Returns a map of team abbreviation -> game
   */
  async getNextGamesForTeams(teamAbbrevs: string[]): Promise<Map<string, NHLGame | null>> {
    try {
      if (teamAbbrevs.length === 0) {
        return new Map();
      }

      const todayStr = getTodayString();
      const orConditions = teamAbbrevs
        .map(team => `home_team.eq.${team},away_team.eq.${team}`)
        .join(',');

      const { data: games, error } = await supabase
        .from('nhl_games')
        .select(COLUMNS.NHL_GAME)
        .or(orConditions)
        .gte('game_date', todayStr)
        .in('status', ['scheduled', 'live', 'final'])
        .order('game_date', { ascending: true })
        .order('game_time', { ascending: true });

      if (error) {
        if (error.message?.includes('does not exist') || error.message?.includes('relation')) {
          return new Map(teamAbbrevs.map(team => [team, null]));
        }
        console.error('Error fetching next games batch:', error);
        return new Map(teamAbbrevs.map(team => [team, null]));
      }

      // Find next game for each team
      const nextGames = new Map<string, NHLGame | null>();
      teamAbbrevs.forEach(team => {
        const teamGame = (games || []).find((g: NHLGame) => 
          g.home_team === team || g.away_team === team
        );
        nextGames.set(team, teamGame || null);
      });

      return nextGames;
    } catch (error) {
      console.error('Error fetching next games batch:', error);
      return new Map(teamAbbrevs.map(team => [team, null]));
    }
  },

  /**
   * Check if a team has a game today
   */
  async hasGameToday(teamAbbrev: string): Promise<boolean> {
    try {
      // Get today's date in YYYY-MM-DD format (uses test date if in test mode)
      const todayStr = getTodayString();
      
      // Query for games on today's date
      const { data: games, error } = await supabase
        .from('nhl_games')
        .select(COLUMNS.NHL_GAME)
        .or(`home_team.eq.${teamAbbrev},away_team.eq.${teamAbbrev}`)
        .eq('game_date', todayStr)
        .in('status', ['scheduled', 'live', 'final']);

      if (error) {
        // If table doesn't exist, return false
        if (error.message?.includes('does not exist') || error.message?.includes('relation')) {
          console.warn('nhl_games table does not exist yet. Run the migration and fetch script.');
          return false;
        }
        console.error('Error checking if team has game today:', error);
        return false;
      }

      return (games || []).length > 0;
    } catch (error) {
      console.error('Error checking if team has game today:', error);
      return false;
    }
  },

  /**
   * Get number of games remaining for a team in a week
   */
  async getGamesRemainingInWeek(
    teamAbbrev: string,
    weekStart: Date,
    weekEnd: Date
  ): Promise<number> {
    const { games } = await this.getGamesForTeamInWeek(teamAbbrev, weekStart, weekEnd);
    const today = getTodayDate();
    today.setHours(0, 0, 0, 0);

    return games.filter(g => {
      const gameDate = new Date(g.game_date);
      gameDate.setHours(0, 0, 0, 0);
      return gameDate >= today && (g.status === 'scheduled' || g.status === 'live');
    }).length;
  },

  /**
   * Get total number of games for a team in a week (including completed games)
   */
  async getTotalGamesInWeek(
    teamAbbrev: string,
    weekStart: Date,
    weekEnd: Date
  ): Promise<number> {
    const { games } = await this.getGamesForTeamInWeek(teamAbbrev, weekStart, weekEnd);
    return games.length;
  },

  /**
   * Get games for a team in the current week (Monday-Sunday)
   */
  async getGamesThisWeek(teamAbbrev: string): Promise<{ games: NHLGame[]; count: number }> {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert to Monday = 0
    
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - daysFromMonday);
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    
    const { games } = await this.getGamesForTeamInWeek(teamAbbrev, weekStart, weekEnd);
    return { games, count: games.length };
  },

  /**
   * Get player's game status for matchup display
   */
  async getPlayerGameStatus(
    teamAbbrev: string,
    gameDate?: Date
  ): Promise<'Yet to Play' | 'In Game' | 'Final'> {
    try {
      if (!gameDate) {
        const { game } = await this.getNextGameForTeam(teamAbbrev);
        if (!game) return 'Yet to Play';
        gameDate = new Date(game.game_date);
      }

      const { games } = await this.getGamesForTeam(teamAbbrev);
      const game = games.find(g => {
        const gDate = new Date(g.game_date);
        gDate.setHours(0, 0, 0, 0);
        const checkDate = new Date(gameDate!);
        checkDate.setHours(0, 0, 0, 0);
        return gDate.getTime() === checkDate.getTime();
      });

      if (!game) return 'Yet to Play';
      if (game.status === 'live') return 'In Game';
      if (game.status === 'final') return 'Final';
      return 'Yet to Play';
    } catch (error) {
      console.error('Error getting player game status:', error);
      return 'Yet to Play';
    }
  }
};
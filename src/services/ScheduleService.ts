import { supabase } from '@/integrations/supabase/client';

// Test mode: Controlled via VITE_TEST_MODE environment variable
// Set VITE_TEST_MODE=true in .env to use test date for development
// Defaults to false (uses actual current date) for production
const TEST_MODE = import.meta.env.VITE_TEST_MODE === 'true';
const TEST_DATE = import.meta.env.VITE_TEST_DATE || '2025-12-08';

// Helper to get "today" - uses test date if in test mode
function getTodayString(): string {
  if (TEST_MODE) {
    return TEST_DATE;
  }
  return new Date().toISOString().split('T')[0];
}

// Helper to get "today" as Date object
function getTodayDate(): Date {
  if (TEST_MODE) {
    const date = new Date(TEST_DATE + 'T00:00:00');
    return date;
  }
  return new Date();
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
        .select('*')
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

      // Build OR condition for all teams
      // Format: (home_team.eq.TEAM1,away_team.eq.TEAM1),(home_team.eq.TEAM2,away_team.eq.TEAM2),...
      const orConditions = teamAbbrevs
        .map(team => `home_team.eq.${team},away_team.eq.${team}`)
        .join(',');

      let query = supabase
        .from('nhl_games')
        .select('*')
        .or(orConditions)
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
        if (error.message?.includes('does not exist') || error.message?.includes('relation')) {
          console.warn('nhl_games table does not exist yet. Run the migration and fetch script.');
          return { gamesByTeam: new Map(), error: null };
        }
        throw error;
      }

      // Group games by team
      const gamesByTeam = new Map<string, NHLGame[]>();
      teamAbbrevs.forEach(team => {
        gamesByTeam.set(team, []);
      });

      (data || []).forEach((game: NHLGame) => {
        if (game.home_team && gamesByTeam.has(game.home_team)) {
          gamesByTeam.get(game.home_team)!.push(game);
        }
        if (game.away_team && gamesByTeam.has(game.away_team)) {
          gamesByTeam.get(game.away_team)!.push(game);
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
        .select('*')
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
        .select('*')
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

    const isHome = game.home_team === playerTeam;
    const opponent = isHome ? game.away_team : game.home_team;
    const opponentPrefix = isHome ? 'vs' : '@';

    const gameInfo: GameInfo = {
      opponent: `${opponentPrefix} ${opponent}`,
      date: game.game_date
    };

    // Check if game is today
    const todayStr = getTodayString();
    const isToday = game.game_date === todayStr;

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

    // Add score and period if live or final
    if (game.status === 'live' || game.status === 'final') {
      const homeScore = game.home_score || 0;
      const awayScore = game.away_score || 0;
      gameInfo.score = `${game.home_team} ${homeScore}-${awayScore} ${game.away_team}`;
      
      if (game.status === 'live' && game.period) {
        gameInfo.period = game.period;
        if (game.period_time) {
          gameInfo.period += ` ${game.period_time}`;
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
        .select('home_team, away_team')
        .or(orConditions)
        .eq('game_date', todayStr)
        .in('status', ['scheduled', 'live', 'final']);

      if (error) {
        if (error.message?.includes('does not exist') || error.message?.includes('relation')) {
          return new Map(teamAbbrevs.map(team => [team, false]));
        }
        console.error('Error checking games today batch:', error);
        return new Map(teamAbbrevs.map(team => [team, false]));
      }

      // Build set of teams with games today
      const teamsWithGames = new Set<string>();
      (games || []).forEach((game: { home_team: string; away_team: string }) => {
        if (teamAbbrevs.includes(game.home_team)) teamsWithGames.add(game.home_team);
        if (teamAbbrevs.includes(game.away_team)) teamsWithGames.add(game.away_team);
      });

      // Return map
      return new Map(teamAbbrevs.map(team => [team, teamsWithGames.has(team)]));
    } catch (error) {
      console.error('Error checking games today batch:', error);
      return new Map(teamAbbrevs.map(team => [team, false]));
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
        .select('*')
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
        .select('*')
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
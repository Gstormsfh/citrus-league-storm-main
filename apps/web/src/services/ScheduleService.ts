import { supabase } from '@/integrations/supabase/client';
import { withTimeout } from '@/utils/promiseUtils';
import { getTodayMST, getTodayMSTDate } from '@/utils/timezoneUtils';
import { COLUMNS } from '@/utils/queryColumns';
import type { PostgrestError } from '@supabase/supabase-js';
import { DEFAULT_TEST_DATE } from '@/utils/seasonConstants';
import { logger } from '@/utils/logger';
import { scheduleApi } from '@/api/schedule';

// Test mode: Controlled via VITE_TEST_MODE environment variable
// Set VITE_TEST_MODE=true in .env to use test date for development
// Defaults to false (uses actual current date) for production
const TEST_MODE = import.meta.env.VITE_TEST_MODE === 'true';
const TEST_DATE = import.meta.env.VITE_TEST_DATE || DEFAULT_TEST_DATE;

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

// ─── Request deduplication cache ───────────────────────────────────
// Prevents identical in-flight HTTP requests from being duplicated.
// Each entry caches the promise for a pending request; once resolved
// the entry is kept for CACHE_TTL_MS so subsequent calls get instant results.
const CACHE_TTL_MS = 30_000; // 30 seconds
const requestCache = new Map<string, { promise: Promise<any>; timestamp: number }>();

function getCachedOrFetch<T>(cacheKey: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = requestCache.get(cacheKey);
  if (existing && Date.now() - existing.timestamp < CACHE_TTL_MS) {
    return existing.promise as Promise<T>;
  }
  const promise = fetcher().finally(() => {
    // Remove stale entries after TTL
    setTimeout(() => {
      const entry = requestCache.get(cacheKey);
      if (entry && entry.promise === promise) {
        requestCache.delete(cacheKey);
      }
    }, CACHE_TTL_MS);
  });
  requestCache.set(cacheKey, { promise, timestamp: Date.now() });
  return promise;
}

/**
 * Check if a cached team-schedule entry exists for a WIDER date range.
 * If found, we can filter from that superset instead of making a new API call.
 * Returns the cached promise or null.
 */
function findCachedTeamsSuperset(
  teamsKey: string,
  startStr: string,
  endStr: string,
): { promise: Promise<any>; key: string } | null {
  // Only works for bounded ranges (both start and end must be set)
  if (!startStr || !endStr) return null;

  for (const [key, entry] of requestCache.entries()) {
    if (Date.now() - entry.timestamp >= CACHE_TTL_MS) continue;
    if (!key.startsWith('teams:')) continue;

    // Parse cache key format: "teams:TEAM_LIST:START:END"
    const firstColon = key.indexOf(':');
    const secondColon = key.indexOf(':', firstColon + 1);
    const thirdColon = key.indexOf(':', secondColon + 1);
    if (thirdColon === -1) continue; // No end date in cached entry

    const cachedTeamsKey = key.slice(firstColon + 1, secondColon);
    const cachedStart = key.slice(secondColon + 1, thirdColon);
    const cachedEnd = key.slice(thirdColon + 1);

    // Same teams + wider (or equal) date range = superset
    if (cachedTeamsKey === teamsKey && cachedEnd && cachedStart <= startStr && cachedEnd >= endStr) {
      return { promise: entry.promise, key };
    }
  }
  return null;
}

export const ScheduleService = {
  /** Clear the schedule request cache (useful after mutations) */
  clearCache() {
    requestCache.clear();
  },

  /**
   * Get games for a specific date range
   */
  async getGamesForDateRange(
    startDate: Date,
    endDate: Date
  ): Promise<{ games: NHLGame[]; error: PostgrestError | null }> {
    const formatDateLocal = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const startStr = formatDateLocal(startDate);
    const endStr = formatDateLocal(endDate);
    const cacheKey = `dateRange:${startStr}:${endStr}`;

    return getCachedOrFetch(cacheKey, async () => {
      try {
        const response = await scheduleApi.getGames({ startDate: startStr, endDate: endStr });
        return { games: response.data || [], error: null };
      } catch (error) {
        logger.error('Error fetching games for date range:', error);
        return { games: [], error: error as PostgrestError };
      }
    });
  },

  /**
   * Get games for multiple teams at once (batch query for performance)
   * Returns a map of team abbreviation -> games array
   */
  async getGamesForTeams(
    teamAbbrevs: string[],
    startDate?: Date,
    endDate?: Date
  ): Promise<{ gamesByTeam: Map<string, NHLGame[]>; error: PostgrestError | null }> {
    if (teamAbbrevs.length === 0) {
      return { gamesByTeam: new Map(), error: null };
    }

    const normalizedTeams = teamAbbrevs.map(t => t.toUpperCase()).sort();
    const formatDateLocal = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const startStr = startDate ? formatDateLocal(startDate) : '';
    const endStr = endDate ? formatDateLocal(endDate) : '';
    const teamsKey = normalizedTeams.join(',');
    const cacheKey = `teams:${teamsKey}:${startStr}:${endStr}`;

    // Check for a cached superset (same teams, wider date range) — avoids redundant API calls
    const superset = findCachedTeamsSuperset(teamsKey, startStr, endStr);
    if (superset && superset.key !== cacheKey) {
      return superset.promise.then((result: { gamesByTeam: Map<string, NHLGame[]>; error: PostgrestError | null }) => {
        if (result.error) return result;
        // Filter cached superset data to the requested date range
        const filtered = new Map<string, NHLGame[]>();
        result.gamesByTeam.forEach((games, team) => {
          filtered.set(team, games.filter(g => {
            const gameDate = (g.game_date || '').split('T')[0];
            return gameDate >= startStr && gameDate <= endStr;
          }));
        });
        return { gamesByTeam: filtered, error: null };
      });
    }

    return getCachedOrFetch(cacheKey, async () => {
      try {
        const response = await scheduleApi.getGamesForTeams(
          normalizedTeams,
          startStr || undefined,
          endStr || undefined,
        );

        const gamesByTeam = new Map<string, NHLGame[]>();
        const data = response.data || {};
        normalizedTeams.forEach(team => {
          gamesByTeam.set(team, data[team] || []);
        });

        return { gamesByTeam, error: null };
      } catch (error) {
        logger.error('Error fetching games for teams:', error);
        return { gamesByTeam: new Map(), error: error as PostgrestError };
      }
    });
  },

  /**
   * Get games for a specific team
   */
  async getGamesForTeam(
    teamAbbrev: string,
    startDate?: Date | string,
    endDate?: Date | string
  ): Promise<{ games: NHLGame[]; error: PostgrestError | null }> {
    const formatDateLocal = (d: Date | string) => {
      if (typeof d === 'string') return d;
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const startStr = startDate ? formatDateLocal(startDate) : '';
    const endStr = endDate ? formatDateLocal(endDate) : '';
    const cacheKey = `team:${teamAbbrev.toUpperCase()}:${startStr}:${endStr}`;

    return getCachedOrFetch(cacheKey, async () => {
      try {
        const response = await scheduleApi.getGames({
          team: teamAbbrev,
          startDate: startStr || undefined,
          endDate: endStr || undefined,
        });
        return { games: response.data || [], error: null };
      } catch (error) {
        logger.error('Error fetching games for team:', error);
        return { games: [], error: error as PostgrestError };
      }
    });
  },

  /**
   * Get next game for a team (including today's games)
   */
  async getNextGameForTeam(teamAbbrev: string): Promise<{ game: NHLGame | null; error: PostgrestError | null }> {
    try {
      const response = await scheduleApi.getNextGame(teamAbbrev);
      return { game: response.data || null, error: null };
    } catch (error) {
      logger.error('Error fetching next game:', error);
      return { game: null, error: error as PostgrestError };
    }
  },

  /**
   * Get games for a team within a week (Sunday-Saturday)
   */
  async getGamesForTeamInWeek(
    teamAbbrev: string,
    weekStart: Date,
    weekEnd: Date
  ): Promise<{ games: NHLGame[]; error: PostgrestError | null }> {
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
        logger.warn('Error parsing game time:', e);
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

      // Use the batch API endpoint
      const { gamesByTeam } = await this.getGamesForTeams(
        teamAbbrevs,
        new Date(targetDate + 'T00:00:00'),
        new Date(targetDate + 'T00:00:00')
      );

      return new Map(teamAbbrevs.map(team => [
        team,
        (gamesByTeam.get(team.toUpperCase()) || []).length > 0
      ]));
    } catch (error) {
      logger.error('Error checking games on date batch:', error);
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

      const { gamesByTeam } = await this.getGamesForTeams(
        teamAbbrevs,
        new Date(targetDate + 'T00:00:00'),
        new Date(targetDate + 'T00:00:00')
      );

      const gamesMap = new Map<string, NHLGame | null>();
      teamAbbrevs.forEach(team => {
        const teamGames = gamesByTeam.get(team.toUpperCase()) || [];
        gamesMap.set(team, teamGames[0] || null);
      });

      return gamesMap;
    } catch (error) {
      logger.error('Error fetching games for date batch:', error);
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

      // Use a 7-day window instead of unbounded — bounds data transfer and
      // enables superset cache matching with full-week schedule queries.
      const todayStr = getTodayString();
      const endDate = new Date(todayStr + 'T00:00:00');
      endDate.setDate(endDate.getDate() + 7);
      const { gamesByTeam } = await this.getGamesForTeams(
        teamAbbrevs,
        new Date(todayStr + 'T00:00:00'),
        endDate,
      );

      const nextGames = new Map<string, NHLGame | null>();
      teamAbbrevs.forEach(team => {
        const teamGames = gamesByTeam.get(team.toUpperCase()) || [];
        nextGames.set(team, teamGames[0] || null);
      });

      return nextGames;
    } catch (error) {
      logger.error('Error fetching next games batch:', error);
      return new Map(teamAbbrevs.map(team => [team, null]));
    }
  },

  /**
   * Check if a team has a game today
   */
  async hasGameToday(teamAbbrev: string): Promise<boolean> {
    try {
      const todayStr = getTodayString();
      const { games } = await this.getGamesForTeam(teamAbbrev, todayStr, todayStr);
      return games.length > 0;
    } catch (error) {
      logger.error('Error checking if team has game today:', error);
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

    // Use string comparison to avoid timezone issues with new Date("YYYY-MM-DD") UTC parsing
    const todayStr = getTodayMST();
    return games.filter(g => {
      if (!g || !g.game_date) return false;
      const gameDateStr = g.game_date.split('T')[0];
      return gameDateStr >= todayStr && (g.status === 'scheduled' || g.status === 'live');
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
   * Get games for a team in the current week (Sunday-Saturday)
   */
  async getGamesThisWeek(teamAbbrev: string): Promise<{ games: NHLGame[]; count: number }> {
    const today = getTodayMSTDate();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const daysFromSunday = dayOfWeek; // Sunday = 0, so offset is just dayOfWeek

    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - daysFromSunday);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6); // Saturday
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
        // Append T00:00:00 to force local-time parsing (avoid UTC midnight shift)
        gameDate = new Date(game.game_date.split('T')[0] + 'T00:00:00');
      }

      const { games } = await this.getGamesForTeam(teamAbbrev);
      // Use string comparison to avoid timezone issues with new Date("YYYY-MM-DD") UTC parsing
      const checkDateStr = gameDate.getFullYear() + '-' +
        String(gameDate.getMonth() + 1).padStart(2, '0') + '-' +
        String(gameDate.getDate()).padStart(2, '0');
      const game = games.find(g => {
        const gDateStr = (g.game_date || '').split('T')[0];
        return gDateStr === checkDateStr;
      });

      if (!game) return 'Yet to Play';
      if (game.status === 'live') return 'In Game';
      if (game.status === 'final') return 'Final';
      return 'Yet to Play';
    } catch (error) {
      logger.error('Error getting player game status:', error);
      return 'Yet to Play';
    }
  }
};
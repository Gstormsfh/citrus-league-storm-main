/**
 * DataCacheService - Centralized caching layer for Supabase data
 * 
 * Purpose: Reduce egress by caching frequently-accessed data with TTL
 * 
 * Scalability: At 10,000 users, this prevents:
 * - Repeated fetches of the same player data
 * - Redundant team/roster lookups
 * - Duplicate matchup queries
 * 
 * Cache hit = 0 egress cost, Cache miss = single fetch
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

// Default TTLs (in milliseconds)
const TTL = {
  SHORT: 30 * 1000,        // 30 seconds - for live scores
  MEDIUM: 2 * 60 * 1000,   // 2 minutes - for roster/lineup data
  LONG: 5 * 60 * 1000,     // 5 minutes - for player stats
  VERY_LONG: 15 * 60 * 1000, // 15 minutes - for static data
  SESSION: 60 * 60 * 1000   // 1 hour - for rarely-changing data
} as const;

class DataCacheServiceClass {
  private cache = new Map<string, CacheEntry<any>>();
  private pendingRequests = new Map<string, Promise<any>>();

  /**
   * Get data from cache or fetch it
   * Uses request deduplication - multiple simultaneous requests for same key share one fetch
   */
  async getOrFetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = TTL.MEDIUM
  ): Promise<T> {
    // Check cache first
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Check if there's already a pending request for this key
    // This prevents duplicate fetches when multiple components request same data
    if (this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key) as Promise<T>;
    }

    // Create the fetch promise
    const fetchPromise = fetchFn().then(data => {
      this.set(key, data, ttl);
      this.pendingRequests.delete(key);
      return data;
    }).catch(error => {
      this.pendingRequests.delete(key);
      throw error;
    });

    this.pendingRequests.set(key, fetchPromise);
    return fetchPromise;
  }

  /**
   * Get data from cache (returns null if not found or expired)
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set data in cache with TTL
   */
  set<T>(key: string, data: T, ttl: number = TTL.MEDIUM): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(key: string): void {
    this.cache.delete(key);
    this.pendingRequests.delete(key);
  }

  /**
   * Invalidate all entries matching a prefix
   * Useful for invalidating all "player_*" or "team_*" entries
   */
  invalidatePrefix(prefix: string): void {
    const keysToDelete: string[] = [];
    this.cache.forEach((_, key) => {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => {
      this.cache.delete(key);
      this.pendingRequests.delete(key);
    });
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  /**
   * Get cache statistics (for debugging)
   */
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  // Convenience methods for common data types
  getCacheKey = {
    player: (playerId: number | string) => `player_${playerId}`,
    playerStats: (playerId: number | string) => `player_stats_${playerId}`,
    team: (teamId: string) => `team_${teamId}`,
    teamRoster: (teamId: string, leagueId: string) => `team_roster_${leagueId}_${teamId}`,
    lineup: (teamId: string, leagueId: string) => `lineup_${leagueId}_${teamId}`,
    matchup: (matchupId: string) => `matchup_${matchupId}`,
    matchupScores: (matchupId: string) => `matchup_scores_${matchupId}`,
    dailyStats: (matchupId: string, date: string) => `daily_stats_${matchupId}_${date}`,
    weeklyStats: (matchupId: string) => `weekly_stats_${matchupId}`,
    leagueTeams: (leagueId: string) => `league_teams_${leagueId}`,
    frozenScores: (matchupId: string) => `frozen_scores_${matchupId}`,
  };
}

// Export singleton instance
export const DataCacheService = new DataCacheServiceClass();

// Export TTL constants for use in components
export { TTL };


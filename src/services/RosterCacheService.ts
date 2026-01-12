/**
 * RosterCacheService
 * 
 * Manages caching for roster lineup data to prevent stale state issues.
 * When a lineup is saved, this cache is cleared to force a fresh load.
 */

interface RosterCacheEntry {
  starters: string[];
  bench: string[];
  ir: string[];
  slotAssignments: Record<string, string>;
  timestamp: number;
}

const ROSTER_CACHE_TTL = 2 * 60 * 1000; // 2 minutes in milliseconds
const rosterCache = new Map<string, RosterCacheEntry>();

/**
 * Generate cache key from team ID and league ID
 */
const getRosterCacheKey = (teamId: string, leagueId: string): string => {
  return `${leagueId}:${teamId}`;
};

export const RosterCacheService = {
  /**
   * Get cached roster lineup
   */
  get(teamId: string, leagueId: string): RosterCacheEntry | null {
    const key = getRosterCacheKey(teamId, leagueId);
    const cached = rosterCache.get(key);
    
    if (!cached) {
      return null;
    }
    
    const now = Date.now();
    const age = now - cached.timestamp;
    
    if (age > ROSTER_CACHE_TTL) {
      rosterCache.delete(key);
      return null;
    }
    
    return cached;
  },

  /**
   * Set cached roster lineup
   */
  set(
    teamId: string,
    leagueId: string,
    lineup: {
      starters: string[];
      bench: string[];
      ir: string[];
      slotAssignments: Record<string, string>;
    }
  ): void {
    const key = getRosterCacheKey(teamId, leagueId);
    rosterCache.set(key, {
      ...lineup,
      timestamp: Date.now()
    });
  },

  /**
   * Clear roster cache (call this when lineup changes)
   */
  clearCache(teamId?: string, leagueId?: string): void {
    if (teamId && leagueId) {
      // Clear specific team's cache
      const key = getRosterCacheKey(teamId, leagueId);
      rosterCache.delete(key);
    } else if (leagueId) {
      // Clear all caches for a league
      const keysToDelete: string[] = [];
      rosterCache.forEach((_, key) => {
        if (key.startsWith(`${leagueId}:`)) {
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach(key => rosterCache.delete(key));
    } else {
      // Clear all caches
      const size = rosterCache.size;
      rosterCache.clear();
    }
  }
};


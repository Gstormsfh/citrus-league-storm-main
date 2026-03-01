import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Import (no external mocks needed — DataCacheService is a pure in-memory cache)
// =============================================================================

import { DataCacheService, TTL } from '../DataCacheService';

// =============================================================================
// Tests
// =============================================================================

describe('DataCacheService', () => {
  beforeEach(() => {
    DataCacheService.clear();
  });

  // ---------------------------------------------------------------------------
  // TTL constants
  // ---------------------------------------------------------------------------
  describe('TTL constants', () => {
    it('exports expected TTL values', () => {
      expect(TTL.SHORT).toBe(30_000);
      expect(TTL.MEDIUM).toBe(120_000);
      expect(TTL.LONG).toBe(300_000);
      expect(TTL.VERY_LONG).toBe(900_000);
      expect(TTL.SESSION).toBe(3_600_000);
    });
  });

  // ---------------------------------------------------------------------------
  // set / get
  // ---------------------------------------------------------------------------
  describe('set and get', () => {
    it('stores and retrieves a value', () => {
      DataCacheService.set('key1', { foo: 'bar' });

      const result = DataCacheService.get('key1');

      expect(result).toEqual({ foo: 'bar' });
    });

    it('returns null for a key that does not exist', () => {
      const result = DataCacheService.get('nonexistent');

      expect(result).toBeNull();
    });

    it('returns null when entry has expired', () => {
      // Set with a very short TTL
      DataCacheService.set('expire-me', 'data', 1);

      // Fast-forward time
      vi.useFakeTimers();
      vi.advanceTimersByTime(10);

      const result = DataCacheService.get('expire-me');

      expect(result).toBeNull();
      vi.useRealTimers();
    });

    it('returns data within TTL window', () => {
      vi.useFakeTimers();
      DataCacheService.set('within-ttl', 'hello', 5000);

      vi.advanceTimersByTime(3000);
      const result = DataCacheService.get('within-ttl');

      expect(result).toBe('hello');
      vi.useRealTimers();
    });

    it('uses default TTL (MEDIUM) when not specified', () => {
      DataCacheService.set('default-ttl', 'value');

      const result = DataCacheService.get('default-ttl');

      expect(result).toBe('value');
    });
  });

  // ---------------------------------------------------------------------------
  // getOrFetch
  // ---------------------------------------------------------------------------
  describe('getOrFetch', () => {
    it('returns cached value without calling fetchFn', async () => {
      DataCacheService.set('cached', 'cached-data', TTL.LONG);
      const fetchFn = vi.fn().mockResolvedValue('fresh-data');

      const result = await DataCacheService.getOrFetch('cached', fetchFn);

      expect(result).toBe('cached-data');
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('calls fetchFn and caches result on cache miss', async () => {
      const fetchFn = vi.fn().mockResolvedValue('fresh-data');

      const result = await DataCacheService.getOrFetch('miss', fetchFn, TTL.MEDIUM);

      expect(result).toBe('fresh-data');
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Verify it was cached
      const cached = DataCacheService.get('miss');
      expect(cached).toBe('fresh-data');
    });

    it('deduplicates concurrent requests for the same key', async () => {
      let resolvePromise: (val: string) => void;
      const fetchFn = vi.fn().mockReturnValue(
        new Promise<string>((resolve) => { resolvePromise = resolve; })
      );

      // Start two concurrent requests
      const p1 = DataCacheService.getOrFetch('dedup', fetchFn);
      const p2 = DataCacheService.getOrFetch('dedup', fetchFn);

      // Both should share the same pending request
      expect(fetchFn).toHaveBeenCalledTimes(1);

      resolvePromise!('shared-data');

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe('shared-data');
      expect(r2).toBe('shared-data');
    });

    it('propagates errors and cleans up pending request', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('fetch failed'));

      await expect(
        DataCacheService.getOrFetch('error-key', fetchFn)
      ).rejects.toThrow('fetch failed');

      // Should be cleaned up — next call should try again
      const fetchFn2 = vi.fn().mockResolvedValue('retry-data');
      const result = await DataCacheService.getOrFetch('error-key', fetchFn2);
      expect(result).toBe('retry-data');
    });
  });

  // ---------------------------------------------------------------------------
  // invalidate
  // ---------------------------------------------------------------------------
  describe('invalidate', () => {
    it('removes a specific cache entry', () => {
      DataCacheService.set('a', 1);
      DataCacheService.set('b', 2);

      DataCacheService.invalidate('a');

      expect(DataCacheService.get('a')).toBeNull();
      expect(DataCacheService.get('b')).toBe(2);
    });

    it('does not error when invalidating non-existent key', () => {
      expect(() => DataCacheService.invalidate('nope')).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // invalidatePrefix
  // ---------------------------------------------------------------------------
  describe('invalidatePrefix', () => {
    it('removes all entries matching the prefix', () => {
      DataCacheService.set('player_1', 'p1');
      DataCacheService.set('player_2', 'p2');
      DataCacheService.set('team_1', 't1');

      DataCacheService.invalidatePrefix('player_');

      expect(DataCacheService.get('player_1')).toBeNull();
      expect(DataCacheService.get('player_2')).toBeNull();
      expect(DataCacheService.get('team_1')).toBe('t1');
    });

    it('does nothing when no entries match prefix', () => {
      DataCacheService.set('key1', 'val');

      DataCacheService.invalidatePrefix('nonexistent_');

      expect(DataCacheService.get('key1')).toBe('val');
    });
  });

  // ---------------------------------------------------------------------------
  // clear
  // ---------------------------------------------------------------------------
  describe('clear', () => {
    it('removes all cache entries', () => {
      DataCacheService.set('a', 1);
      DataCacheService.set('b', 2);
      DataCacheService.set('c', 3);

      DataCacheService.clear();

      expect(DataCacheService.get('a')).toBeNull();
      expect(DataCacheService.get('b')).toBeNull();
      expect(DataCacheService.get('c')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getStats
  // ---------------------------------------------------------------------------
  describe('getStats', () => {
    it('returns cache size and keys', () => {
      DataCacheService.set('alpha', 1);
      DataCacheService.set('beta', 2);

      const stats = DataCacheService.getStats();

      expect(stats.size).toBe(2);
      expect(stats.keys).toContain('alpha');
      expect(stats.keys).toContain('beta');
    });

    it('returns empty stats when cache is empty', () => {
      const stats = DataCacheService.getStats();

      expect(stats.size).toBe(0);
      expect(stats.keys).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getCacheKey helpers
  // ---------------------------------------------------------------------------
  describe('getCacheKey', () => {
    it('generates correct player key', () => {
      expect(DataCacheService.getCacheKey.player(123)).toBe('player_123');
    });

    it('generates correct playerStats key', () => {
      expect(DataCacheService.getCacheKey.playerStats(456)).toBe('player_stats_456');
    });

    it('generates correct teamRoster key', () => {
      expect(DataCacheService.getCacheKey.teamRoster('team-1', 'league-1'))
        .toBe('team_roster_league-1_team-1');
    });

    it('generates correct matchupScores key', () => {
      expect(DataCacheService.getCacheKey.matchupScores('m-1')).toBe('matchup_scores_m-1');
    });

    it('generates correct dailyStats key', () => {
      expect(DataCacheService.getCacheKey.dailyStats('m-1', '2025-01-15'))
        .toBe('daily_stats_m-1_2025-01-15');
    });

    it('generates correct leagueTeams key', () => {
      expect(DataCacheService.getCacheKey.leagueTeams('league-abc'))
        .toBe('league_teams_league-abc');
    });
  });
});

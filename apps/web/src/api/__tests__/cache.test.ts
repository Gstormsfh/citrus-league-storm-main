import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApiCache, CACHE_TTL } from '../cache';
import type { ApiCache } from '../cache';

describe('createApiCache', () => {
  let cache: ApiCache;

  beforeEach(() => {
    cache = createApiCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('CACHE_TTL', () => {
    it('exports expected TTL values', () => {
      expect(CACHE_TTL.SHORT).toBe(10_000);
      expect(CACHE_TTL.MEDIUM).toBe(30_000);
      expect(CACHE_TTL.LONG).toBe(120_000);
    });
  });

  describe('cached() - basic caching', () => {
    it('calls the fetcher on the first request', async () => {
      const fetcher = vi.fn().mockResolvedValue({ id: 1 });

      const result = await cache.cached('key1', fetcher, CACHE_TTL.MEDIUM);

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ id: 1 });
    });

    it('returns cached data on the second call without re-fetching', async () => {
      const fetcher = vi.fn().mockResolvedValue({ id: 1 });

      await cache.cached('key1', fetcher, CACHE_TTL.MEDIUM);
      const result = await cache.cached('key1', fetcher, CACHE_TTL.MEDIUM);

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ id: 1 });
    });

    it('caches different keys independently', async () => {
      const fetcherA = vi.fn().mockResolvedValue('a');
      const fetcherB = vi.fn().mockResolvedValue('b');

      const resultA = await cache.cached('keyA', fetcherA, CACHE_TTL.MEDIUM);
      const resultB = await cache.cached('keyB', fetcherB, CACHE_TTL.MEDIUM);

      expect(resultA).toBe('a');
      expect(resultB).toBe('b');
      expect(fetcherA).toHaveBeenCalledTimes(1);
      expect(fetcherB).toHaveBeenCalledTimes(1);
    });
  });

  describe('cached() - TTL expiry', () => {
    it('re-fetches after TTL has expired', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce('first')
        .mockResolvedValueOnce('second');

      const first = await cache.cached('key1', fetcher, CACHE_TTL.SHORT);
      expect(first).toBe('first');

      // Advance past the SHORT TTL (10s)
      vi.advanceTimersByTime(CACHE_TTL.SHORT + 1);

      const second = await cache.cached('key1', fetcher, CACHE_TTL.SHORT);
      expect(second).toBe('second');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('returns cached data just before TTL expires', async () => {
      const fetcher = vi.fn().mockResolvedValue('data');

      await cache.cached('key1', fetcher, CACHE_TTL.SHORT);

      // Advance to just before expiry
      vi.advanceTimersByTime(CACHE_TTL.SHORT - 1);

      await cache.cached('key1', fetcher, CACHE_TTL.SHORT);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('cached() - in-flight deduplication', () => {
    it('deduplicates concurrent identical calls into one fetch', async () => {
      let resolvePromise: (value: string) => void;
      const fetcher = vi.fn().mockImplementation(
        () => new Promise<string>((resolve) => { resolvePromise = resolve; })
      );

      const promise1 = cache.cached('key1', fetcher, CACHE_TTL.MEDIUM);
      const promise2 = cache.cached('key1', fetcher, CACHE_TTL.MEDIUM);
      const promise3 = cache.cached('key1', fetcher, CACHE_TTL.MEDIUM);

      // Only one fetch should have been initiated
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Resolve and verify all promises get the same result
      resolvePromise!('shared-result');
      const [r1, r2, r3] = await Promise.all([promise1, promise2, promise3]);

      expect(r1).toBe('shared-result');
      expect(r2).toBe('shared-result');
      expect(r3).toBe('shared-result');
    });

    it('allows a new fetch after the in-flight request completes', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce('first')
        .mockResolvedValueOnce('second');

      await cache.cached('key1', fetcher, CACHE_TTL.SHORT);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Expire the cache
      vi.advanceTimersByTime(CACHE_TTL.SHORT + 1);

      // Now a new fetch should occur since the old one completed and cache expired
      const result = await cache.cached('key1', fetcher, CACHE_TTL.SHORT);
      expect(result).toBe('second');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidate()', () => {
    it('invalidates cache entries matching the prefix', async () => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce('players-1')
        .mockResolvedValueOnce('players-2')
        .mockResolvedValueOnce('leagues-1');

      await cache.cached('players:list', fetcher, CACHE_TTL.LONG);
      await cache.cached('players:detail:5', fetcher, CACHE_TTL.LONG);
      await cache.cached('leagues:standings', fetcher, CACHE_TTL.LONG);

      cache.invalidate('players');

      // Reset the mock to track new calls
      fetcher.mockResolvedValueOnce('players-new-1');
      fetcher.mockResolvedValueOnce('players-new-2');

      // Players keys should re-fetch
      const p1 = await cache.cached('players:list', fetcher, CACHE_TTL.LONG);
      expect(p1).toBe('players-new-1');

      const p2 = await cache.cached('players:detail:5', fetcher, CACHE_TTL.LONG);
      expect(p2).toBe('players-new-2');

      // Leagues key should still be cached (fetcher should not be called again for it)
      const callsBefore = fetcher.mock.calls.length;
      await cache.cached('leagues:standings', fetcher, CACHE_TTL.LONG);
      expect(fetcher.mock.calls.length).toBe(callsBefore);
    });

    it('does not invalidate entries that do not match the prefix', async () => {
      const fetcher = vi.fn().mockResolvedValue('data');

      await cache.cached('teams:list', fetcher, CACHE_TTL.LONG);

      cache.invalidate('players');

      // teams:list should still be cached
      await cache.cached('teams:list', fetcher, CACHE_TTL.LONG);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('also clears in-flight requests matching the prefix', async () => {
      let resolveFirst: (v: string) => void;
      const fetcher = vi.fn().mockImplementation(
        () => new Promise<string>((resolve) => { resolveFirst = resolve; })
      );

      // Start a request but don't resolve it
      const promise1 = cache.cached('players:list', fetcher, CACHE_TTL.LONG);

      // Invalidate while in-flight
      cache.invalidate('players');

      // A new call should trigger a new fetch since in-flight was cleared
      const fetcher2 = vi.fn().mockResolvedValue('fresh');
      const promise2 = cache.cached('players:list', fetcher2, CACHE_TTL.LONG);

      expect(fetcher2).toHaveBeenCalledTimes(1);

      resolveFirst!('stale');
      const result = await promise2;
      expect(result).toBe('fresh');
    });
  });

  describe('clearCache()', () => {
    it('clears all cached entries', async () => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce('a')
        .mockResolvedValueOnce('b')
        .mockResolvedValueOnce('a2')
        .mockResolvedValueOnce('b2');

      await cache.cached('keyA', fetcher, CACHE_TTL.LONG);
      await cache.cached('keyB', fetcher, CACHE_TTL.LONG);

      cache.clearCache();

      const resultA = await cache.cached('keyA', fetcher, CACHE_TTL.LONG);
      const resultB = await cache.cached('keyB', fetcher, CACHE_TTL.LONG);

      expect(resultA).toBe('a2');
      expect(resultB).toBe('b2');
      expect(fetcher).toHaveBeenCalledTimes(4);
    });

    it('clears in-flight requests', async () => {
      let resolve: (v: string) => void;
      const fetcher = vi.fn().mockImplementation(
        () => new Promise<string>((r) => { resolve = r; })
      );

      cache.cached('key1', fetcher, CACHE_TTL.LONG);
      cache.clearCache();

      // A new call should trigger a fresh fetch
      const fetcher2 = vi.fn().mockResolvedValue('new');
      const result = await cache.cached('key1', fetcher2, CACHE_TTL.LONG);

      expect(fetcher2).toHaveBeenCalledTimes(1);
      expect(result).toBe('new');
    });
  });

  describe('error handling', () => {
    it('does not cache failed fetches', async () => {
      const fetcher = vi.fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce('success');

      await expect(cache.cached('key1', fetcher, CACHE_TTL.MEDIUM)).rejects.toThrow('network error');

      // Second call should re-fetch since the error was not cached
      const result = await cache.cached('key1', fetcher, CACHE_TTL.MEDIUM);
      expect(result).toBe('success');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('cleans up in-flight on error so subsequent calls can retry', async () => {
      const fetcher = vi.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce('recovered');

      await expect(cache.cached('key1', fetcher, CACHE_TTL.MEDIUM)).rejects.toThrow('timeout');

      const result = await cache.cached('key1', fetcher, CACHE_TTL.MEDIUM);
      expect(result).toBe('recovered');
    });

    it('propagates the error to all concurrent callers sharing the in-flight request', async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error('server error'));

      const promise1 = cache.cached('key1', fetcher, CACHE_TTL.MEDIUM);
      const promise2 = cache.cached('key1', fetcher, CACHE_TTL.MEDIUM);

      await expect(promise1).rejects.toThrow('server error');
      await expect(promise2).rejects.toThrow('server error');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });
});

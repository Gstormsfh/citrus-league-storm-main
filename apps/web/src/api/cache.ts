/**
 * Shared request deduplication + TTL cache for API client modules.
 *
 * Prevents redundant network calls during React re-renders, StrictMode double-fires,
 * and concurrent component mounts that request the same data.
 *
 * Usage:
 *   const myCache = createApiCache();
 *   const data = await myCache.cached('key', () => apiClient.get('/path'), CACHE_TTL.MEDIUM);
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export const CACHE_TTL = {
  SHORT: 10_000,   // 10s — frequently changing data (live stats, active day)
  MEDIUM: 30_000,  // 30s — semi-stable data (weekly scores, rosters)
  LONG: 120_000,   // 2min — stable data (standings, metadata, player lists)
} as const;

export interface ApiCache {
  /** Dedup + cache wrapper. Identical concurrent calls share one network request. */
  cached<T>(key: string, fetcher: () => Promise<T>, ttl: number): Promise<T>;
  /** Clear all cached entries. */
  clearCache(): void;
  /** Invalidate entries whose key starts with the given prefix. */
  invalidate(prefix: string): void;
}

export function createApiCache(): ApiCache {
  const cache = new Map<string, CacheEntry<unknown>>();
  const inflight = new Map<string, Promise<unknown>>();

  return {
    async cached<T>(key: string, fetcher: () => Promise<T>, ttl: number): Promise<T> {
      // 1) Cache hit?
      const hit = cache.get(key);
      if (hit && hit.expiresAt > Date.now()) {
        return hit.data as T;
      }

      // 2) In-flight dedup
      const pending = inflight.get(key);
      if (pending) return pending as Promise<T>;

      // 3) Fresh fetch
      const promise = fetcher()
        .then((result) => {
          cache.set(key, { data: result, expiresAt: Date.now() + ttl });
          inflight.delete(key);
          return result;
        })
        .catch((err) => {
          inflight.delete(key);
          throw err;
        });

      inflight.set(key, promise);
      return promise;
    },

    clearCache() {
      cache.clear();
      inflight.clear();
    },

    invalidate(prefix: string) {
      for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key);
      }
      for (const key of inflight.keys()) {
        if (key.startsWith(prefix)) inflight.delete(key);
      }
    },
  };
}

// Phase 4.5 chunk 11g.10 sub-step 10b — system_flags read cache.
//
// Short-TTL in-memory cache around the `system_flags` table.
// Used by two enforcement points (defense in depth — per
// PHASE_4_5_PROJECT_PLAN.md Decision Log 2026-05-19):
//
//   1. Main API discovery endpoint (server/src/routes/drafts.ts).
//   2. Persistent engine's LobbyRegistry.getOrCreate path
//      (server/src/draft/LobbyRegistry.ts).
//
// Both check the same flag independently. A toggle takes effect within
// the cache TTL (~5 seconds) at each enforcement point.
//
// The cache is per-process, not distributed. With two processes (main
// API on Cloud Run + draft engine on GCE) each caching independently,
// a flag toggle is observed by both within ~5s. Acceptable for the
// Tier-1 bridging use case (the runbook explicitly says "seconds, not
// minutes"). No coordination layer required.
//
// On read failure (Postgres unavailable, permission denied), the cache
// returns the LAST known value. If we have no last known value, we
// return `false` (fail-open — better to allow drafts than to refuse
// them based on an unverifiable signal). The discovery endpoint logs
// the underlying error; operators rely on standard Postgres health
// monitoring rather than this code path for outage detection.

import type { SupabaseClient } from '@supabase/supabase-js';
import { structuredLogger } from '@citrus/shared';

/**
 * Cache TTL in milliseconds. 5 seconds matches the operations runbook's
 * documented "takes effect within ~5s" semantic. Short enough that
 * on-call toggles feel responsive; long enough that the cache absorbs
 * the discovery endpoint's request rate without hammering Postgres.
 *
 * Override via `SYSTEM_FLAGS_CACHE_TTL_MS` env for tests.
 */
export const SYSTEM_FLAGS_CACHE_TTL_MS = (() => {
  const envVal = process.env.SYSTEM_FLAGS_CACHE_TTL_MS;
  if (envVal !== undefined) {
    const parsed = Number(envVal);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 5000;
})();

interface CacheEntry {
  value: boolean;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Read a boolean flag from `system_flags` with the cache TTL applied.
 *
 * - Cache hit (entry exists AND age < TTL): return cached value.
 * - Cache miss OR expired: query Postgres; update cache; return.
 * - Query failure: return last cached value if any; else `false`.
 *
 * The supabase client passed in determines RLS — use the admin client
 * for engine-side reads (no user context); use a user client for
 * route-handler reads (RLS allows authenticated users to read).
 */
export async function readSystemFlag(
  supabase: SupabaseClient,
  flagName: string,
): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(flagName);
  if (cached && now - cached.fetchedAt < SYSTEM_FLAGS_CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const { data, error } = await supabase
      .from('system_flags')
      .select('flag_value')
      .eq('flag_name', flagName)
      .maybeSingle();
    if (error) {
      structuredLogger.warn('system_flags.read_failed', {
        flagName,
        error: error.message,
        usingCached: cached !== undefined,
      });
      return cached?.value ?? false;
    }
    const value = data?.flag_value === true;
    cache.set(flagName, { value, fetchedAt: now });
    return value;
  } catch (err) {
    structuredLogger.warn(
      'system_flags.read_threw',
      { flagName, usingCached: cached !== undefined },
      err,
    );
    return cached?.value ?? false;
  }
}

/**
 * Test-only: clear the in-memory cache. NOT exported in production
 * scenarios — only tests that toggle flags need to bypass the cache.
 */
export function _clearSystemFlagsCacheForTests(): void {
  cache.clear();
}

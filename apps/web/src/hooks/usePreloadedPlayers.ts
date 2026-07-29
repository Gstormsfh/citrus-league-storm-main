// DR-3 chunk (2026-07-29) — non-blocking player pre-fetch.
//
// Architect ratification 1b: pre-fetch all players on room mount
// (matches v1's proven pattern via PlayerService.getAllPlayers, which
// already carries a 5-min TTL + shared cache). The room shell + cards
// + board render immediately from derived state with `#<id>` fallbacks;
// only the pool shows its own loading state. Never gates the room on
// the player fetch.
//
// Contract:
//   - `playersById`: id → Player map; empty until fetch resolves,
//     then populated in-place (never null; consumers can call `.get()`
//     immediately without an existence check).
//   - `isLoading`: true until the first resolution attempt completes
//     (either success or error). Signals only for surfaces that want
//     to render their own spinner (the pool).
//   - `error`: last error from the fetch attempt, or null. Non-fatal:
//     the room continues to render with `#<id>` fallbacks.

import { useEffect, useMemo, useRef, useState } from 'react';
import { PlayerService, type Player } from '@/services/PlayerService';

export interface UsePreloadedPlayersResult {
  playersById: ReadonlyMap<string, Player>;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Pre-fetch the full player index once per mount. Idempotent per
 * mount — subsequent renders return the same map ref (React can bail
 * on `===` comparison in downstream `useMemo` selectors).
 *
 * The empty map returned pre-resolution is safe to consume: adapters
 * call `.get(id)` which returns undefined for every id, triggering
 * the `#<id>` fallback per contract. The room renders immediately.
 */
export function usePreloadedPlayers(): UsePreloadedPlayersResult {
  const [playersById, setPlayersById] = useState<ReadonlyMap<string, Player>>(
    () => new Map(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    (async () => {
      try {
        const list = await PlayerService.getAllPlayers();
        if (cancelledRef.current) return;
        const map = new Map<string, Player>();
        for (const p of list) map.set(p.id, p);
        setPlayersById(map);
        setError(null);
      } catch (err) {
        if (cancelledRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelledRef.current) setIsLoading(false);
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  return useMemo(
    () => ({ playersById, isLoading, error }),
    [playersById, isLoading, error],
  );
}

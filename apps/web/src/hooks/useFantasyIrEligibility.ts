import { useCallback, useEffect, useState } from 'react';
import { isFantasyIrEligible, type PlayerAvailability } from '@citrus/shared';

const FRESH_FOR_MS = 120_000;
const RETRY_AFTER_FAILURE_MS = 60_000;
type Snapshot = { key: string; byId: Map<string, PlayerAvailability | null> };

/** Maintained roster-only evidence. A newer clear/unknown overrides stored flags;
 * failed refreshes retain the last successful evidence, whose own expiry applies.
 */
export function useFantasyIrEligibility(playerIds: readonly (string | number)[], enabled = true) {
  const key = [...new Set(playerIds.map(String).filter(id => /^\d+$/.test(id) && Number(id) > 0))].sort().join(',');
  const [snapshot, setSnapshot] = useState<Snapshot>({ key: '', byId: new Map() });

  useEffect(() => {
    if (!enabled || !key) return;
    let active = true;
    let pending: AbortController | null = null;
    let refreshedAt: number | null = null;
    let failedAt: number | null = null;
    let requestTimer: ReturnType<typeof setTimeout> | null = null;
    const refresh = async () => {
      if (!active || document.visibilityState === 'hidden' || pending
        || (failedAt !== null && Date.now() - failedAt < RETRY_AFTER_FAILURE_MS)
        || (refreshedAt !== null && Date.now() - refreshedAt < FRESH_FOR_MS)) return;
      const controller = new AbortController();
      pending = controller;
      requestTimer = setTimeout(() => controller.abort(), 15_000);
      try {
        // Lazy import avoids initializing authenticated API machinery for guests.
        const { playerApi } = await import('@/api/players');
        if (!active || controller.signal.aborted) return;
        const rows = await playerApi.getAvailabilityByIds(key.split(','), controller.signal);
        if (!active || controller.signal.aborted) return;
        // A successful response establishes unknown for omitted requested IDs.
        // Never resurrect an older roster injury after a maintained clearance.
        const byId = new Map<string, PlayerAvailability | null>(key.split(',').map(id => [id, null]));
        for (const row of rows) if (byId.has(row.id)) byId.set(row.id, row.availability);
        setSnapshot({ key, byId });
        refreshedAt = Date.now();
        failedAt = null;
      } catch {
        if (active) failedAt = Date.now();
        // Initial failure uses the roster's own dated evidence. A refresh failure
        // keeps the newer snapshot; neither failure invents a clearance.
      } finally {
        if (requestTimer !== null) clearTimeout(requestTimer);
        requestTimer = null;
        if (pending === controller) pending = null;
      }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, FRESH_FOR_MS);
    const visible = () => { void refresh(); };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      pending?.abort();
      if (requestTimer !== null) clearTimeout(requestTimer);
      clearInterval(timer);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [key, enabled]);

  return useCallback((player: { id: string | number; availability?: PlayerAvailability | null }) => {
    const id = String(player.id);
    return isFantasyIrEligible(snapshot.key === key && snapshot.byId.has(id)
      ? snapshot.byId.get(id) : player.availability);
  }, [snapshot, key]);
}

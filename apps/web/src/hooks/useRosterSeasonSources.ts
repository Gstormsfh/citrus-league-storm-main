import { useEffect, useState } from 'react';
import { playerApi } from '@/api/players';
import type { RosterSeasonSources } from '@/components/roster/statViews';

/** Read explicit seasons, never the player directory's offseason stats fallback.
 * Limit concurrency and discard late responses after a roster/season switch. */
export function useRosterSeasonSources(ids: string[], season: number, enabled: boolean) {
  const key = [...new Set(ids)].sort().join(',');
  const [state, setState] = useState<{ key: string; season: number; entries: Map<string, RosterSeasonSources> }>();
  useEffect(() => {
    if (!enabled || !key) return;
    let cancelled = false;
    let inFlight = false;
    const read = async (id: string, year: number) => {
      try {
        const response = await playerApi.getPlayerStats(id, year);
        if (!Array.isArray(response.data)) return undefined;
        if (response.data.length === 0) return null;
        const matches = (response.data as Record<string, unknown>[]).filter(row => row
          && String(row.player_id) === id && (row.season == null || Number(row.season) === year));
        return response.data.length === 1 && matches.length === 1 ? matches[0] : undefined;
      } catch { return undefined; }
    };
    const run = async () => {
      if (inFlight) return;
      inFlight = true;
      const queue = key.split(',');
      const entries = new Map<string, RosterSeasonSources>();
      let ros: Record<string, unknown>[] = [];
      try {
        const response = await playerApi.getRosProjections(2000);
        if (Array.isArray(response.data)) ros = response.data;
      } catch { /* Missing forecast must not hide actuals. */ }
      const projections = new Map<string, Record<string, unknown>>();
      const duplicateIds = new Set<string>();
      for (const row of ros) {
        if (!row || Number(row.season) !== season) continue;
        const id = String(row.player_id);
        if (projections.has(id)) duplicateIds.add(id);
        else projections.set(id, row);
      }
      for (const id of duplicateIds) projections.delete(id);
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (!cancelled && queue.length) {
          const id = queue.shift()!;
          const [actual, prior] = await Promise.all([read(id, season), read(id, season - 1)]);
          entries.set(id, { actual, prior, ros: projections.get(id) });
        }
      }));
      if (!cancelled) setState({ key, season, entries });
      inFlight = false;
    };
    void run();
    const timer = window.setInterval(() => void run(), 60_000);
    const refresh = () => void run();
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [key, season, enabled]);
  return enabled && state?.key === key && state.season === season ? state.entries : undefined;
}

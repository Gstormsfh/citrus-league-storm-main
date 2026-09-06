/**
 * The roster page's week read: see components/pressbox/rosterWeek.ts for
 * what is computed and why. Two requests, both already cached at the api
 * layer, refetched when the week or the roster changes.
 */
import { useEffect, useMemo, useState } from 'react';
import { matchupApi } from '@/api/matchups';
import { playerApi } from '@/api/players';
import { getProjectionsSeason } from '@citrus/shared';
import { getTodayMST } from '@/utils/timezoneUtils';
import { logger } from '@/utils/logger';
import { weekEntries, type ProjectionRowLite, type RosterWeekEntry, type RosterWeekPlayer } from '@/components/pressbox/rosterWeek';

export interface UseRosterWeekArgs {
  enabled: boolean;
  players: RosterWeekPlayer[];
  weekStart: string | null | undefined;
  weekEnd: string | null | undefined;
  /** The league's raw scoring_settings; defaults apply when absent. */
  scoring?: unknown;
}

export interface UseRosterWeekResult {
  entries: Map<string, RosterWeekEntry>;
  loading: boolean;
  ready: boolean;
}

const EMPTY = new Map<string, RosterWeekEntry>();

export function useRosterWeek({ enabled, players, weekStart, weekEnd, scoring }: UseRosterWeekArgs): UseRosterWeekResult {
  const [entries, setEntries] = useState<Map<string, RosterWeekEntry>>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  // A stable key so a re-render with the same roster does not refetch.
  const idsKey = useMemo(
    () => players.map((p) => `${p.id}${p.isGoalie ? 'g' : ''}`).sort().join(','),
    [players],
  );

  useEffect(() => {
    if (!enabled || !weekStart || !weekEnd || players.length === 0) {
      setEntries(EMPTY);
      setReady(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const ids = players.map((p) => Number(p.id)).filter((n) => Number.isFinite(n) && n > 0);
        const [statsRes, projRes] = await Promise.all([
          matchupApi.getMatchupStats(ids, weekStart, weekEnd).catch((err: unknown) => {
            logger.warn('[useRosterWeek] week stats unavailable', err);
            return { data: null };
          }),
          playerApi.getBatchProjections(ids.map(String), { startDate: weekStart, endDate: weekEnd, season: getProjectionsSeason() }).catch((err: unknown) => {
            logger.warn('[useRosterWeek] week projections unavailable', err);
            return { data: null };
          }),
        ]);
        if (cancelled) return;
        const statsData = (statsRes as { data?: unknown }).data;
        const statsRows = statsData && typeof statsData === 'object' ? Object.values(statsData as Record<string, Record<string, number>>) : [];
        const weekStats = new Map<number, Record<string, number>>();
        for (const row of statsRows as Array<Record<string, number>>) {
          if (row && row.player_id != null) weekStats.set(Number(row.player_id), row);
        }
        const projections = (((projRes as { data?: unknown }).data ?? []) as ProjectionRowLite[]);
        setEntries(weekEntries(players, weekStats, projections, getTodayMST(), scoring));
        setReady(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // players is keyed by idsKey; scoring is the league's settings object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, idsKey, weekStart, weekEnd, scoring]);

  return { entries, loading, ready };
}

/**
 * Rostered% / started% across Citrus, keyed by player id. Empty until the
 * aggregate exists on the server (migration 20260905050000).
 */
export function useOwnership(enabled: boolean): Map<string, { rosteredPct: number; startedPct: number }> {
  const [map, setMap] = useState<Map<string, { rosteredPct: number; startedPct: number }>>(new Map());
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    playerApi
      .getOwnership()
      .then((res) => {
        if (cancelled) return;
        const rows = ((res as { data?: unknown }).data ?? []) as Array<{ player_id: string; rostered_pct: number; started_pct: number }>;
        const next = new Map<string, { rosteredPct: number; startedPct: number }>();
        for (const r of rows) next.set(String(r.player_id), { rosteredPct: r.rostered_pct ?? 0, startedPct: r.started_pct ?? 0 });
        setMap(next);
      })
      .catch((err: unknown) => logger.warn('[useOwnership] unavailable', err));
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return map;
}

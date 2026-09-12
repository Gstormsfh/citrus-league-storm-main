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
import { ScheduleService } from '@/services/ScheduleService';
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
    () => players.map((p) => `${p.id}${p.isGoalie ? 'g' : ''}:${p.team ?? ''}`).sort().join(','),
    [players],
  );

  useEffect(() => {
    if (!enabled || !weekStart || !weekEnd || players.length === 0) {
      setEntries(EMPTY);
      setReady(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setReady(false);
    setEntries(EMPTY);
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      setLoading(true);
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
        if (statsData == null || (projRes as { data?: unknown }).data == null) throw new Error('Weekly source data unavailable');
        const statsRows = statsData && typeof statsData === 'object' ? Object.values(statsData as Record<string, Record<string, number>>) : [];
        const weekStats = new Map<number, Record<string, number>>();
        for (const row of statsRows as Array<Record<string, number>>) {
          if (row && row.player_id != null) weekStats.set(Number(row.player_id), row);
        }
        const projections = (((projRes as { data?: unknown }).data ?? []) as ProjectionRowLite[]);
        const missingTeams = players.filter(p => !p.team);
        const hydrated = missingTeams.length ? await playerApi.getPlayersByIds(missingTeams.map(p => String(p.id))) : { data: [] };
        const teamById = new Map(players.filter(p => p.team).map(p => [String(p.id), p.team!.toUpperCase()]));
        for (const player of (hydrated.data ?? []) as Array<{ id?: number | string; player_id?: number | string; team?: string }>) {
          if (player.team) teamById.set(String(player.id ?? player.player_id), player.team.toUpperCase());
        }
        if (players.some(p => !teamById.has(String(p.id)))) throw new Error('Roster team coverage unavailable');
        const schedule = await ScheduleService.getGamesForTeams([...new Set(teamById.values())], new Date(weekStart + 'T12:00:00'), new Date(weekEnd + 'T12:00:00'));
        if (schedule.error) throw schedule.error;
        if (cancelled) return;
        const today = getTodayMST();
        const withGames = projections.map(row => ({ ...row, game: row.game ?? schedule.gamesByTeam.get(teamById.get(String(row.player_id)) ?? '')?.find(game => game.game_date.slice(0, 10) === row.projection_date.slice(0, 10)) }));
        const next = weekEntries(players, weekStats, withGames, today, scoring);
        for (const player of players) {
          const team = teamById.get(String(player.id))!;
          const games = schedule.gamesByTeam.get(team);
          if (!games || games.some(game => {
            const date = game.game_date.slice(0, 10);
            return date >= today && date <= weekEnd && game.status !== 'postponed' && game.status !== 'final' &&
              !projections.some(row => String(row.player_id) === String(player.id) && row.projection_date.slice(0, 10) === date);
          })) next.delete(String(player.id));
        }
        setEntries(next);
        setReady(players.every(player => next.has(String(player.id))));
      } catch (error) {
        logger.warn('[useRosterWeek] league-scored week unavailable', error);
        if (!cancelled) setReady(false);
      } finally {
        inFlight = false;
        if (!cancelled) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 120_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
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

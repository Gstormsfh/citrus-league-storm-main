import { useMemo } from 'react';
import type { DashboardIndexEntry } from '@citrus/shared';
import type { Player } from '@/services/PlayerService';
import { usePlayerDashboardIndex } from './usePlayerDashboardIndex';

export interface UsePreloadedPlayersResult {
  playersById: ReadonlyMap<string, Player>;
  isLoading: boolean;
  error: Error | null;
  reload: () => void;
}

function normalizePosition(position: string | null | undefined): string {
  const value = (position ?? '').toUpperCase().trim();
  return ({ L: 'LW', LEFT: 'LW', LEFTWING: 'LW', R: 'RW', RIGHT: 'RW', RIGHTWING: 'RW',
    CENTRE: 'C', CENTER: 'C', DEFENCE: 'D', DEFENSE: 'D', GOALIE: 'G', GOALTENDER: 'G' } as Record<string, string>)[value] ?? value;
}

/** Adapt the shared API's measured actuals; never substitute forecast counts. */
export function dashboardEntryToPreloadedPlayer(entry: DashboardIndexEntry): Player {
  const position = normalizePosition(entry.position);
  const eligible = entry.eligible_positions?.map(normalizePosition).filter(Boolean) ?? [];
  const goalie = entry.is_goalie;
  const status = entry.roster_status;
  return {
    id: String(entry.id), full_name: entry.name, position,
    eligible_positions: eligible.length ? eligible : position ? [position] : [],
    team: entry.team, jersey_number: entry.jersey == null ? null : String(entry.jersey),
    headshot_url: entry.headshot_url, status, roster_status: status ?? undefined,
    is_ir_eligible: status === 'IR' || status === 'LTIR', last_updated: null,
    stats_season: entry.actuals_season ?? null,
    games_played: entry.gp, goals: entry.goals, assists: entry.assists, points: entry.points,
    plus_minus: entry.plus_minus, shots: entry.sog, hits: entry.hits, blocks: entry.blocks,
    pim: entry.pim, ppp: entry.ppp, shp: entry.shp, icetime_seconds: entry.toi_seconds,
    xGoals: entry.x_goals,
    wins: goalie ? entry.wins : null, losses: goalie ? entry.losses : null,
    ot_losses: goalie ? entry.ot_losses : null, saves: goalie ? entry.saves : null,
    shutouts: goalie ? entry.shutouts : null, goals_against: goalie ? entry.goals_against : null,
    goalie_gp: goalie ? entry.gp : undefined,
    goals_against_average: goalie ? entry.gaa : null,
    save_percentage: goalie ? entry.save_pct : null,
    highDangerSavePct: 0, goalsSavedAboveExpected: goalie ? entry.gsax_regressed ?? 0 : 0,
  };
}

/**
 * V2 identity and actuals use the same API snapshot as its projection index.
 * The shared store owns pagination, refresh, retry and stale-response handling.
 * No direct-table fallback can silently resurrect a second player population.
 */
export function usePreloadedPlayers(): UsePreloadedPlayersResult {
  const { players, loading, error: message, reload } = usePlayerDashboardIndex();
  const playersById = useMemo(() => new Map(players.map((entry) => {
    const player = dashboardEntryToPreloadedPlayer(entry);
    return [player.id, player] as const;
  })), [players]);
  const error = useMemo(() => message ? new Error(message) : null, [message]);
  return useMemo(() => ({ playersById, isLoading: loading, error, reload }),
    [playersById, loading, error, reload]);
}

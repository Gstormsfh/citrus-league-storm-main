import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardIndexEntry } from '@citrus/shared';
import { dashboardEntryToPreloadedPlayer, usePreloadedPlayers } from '../usePreloadedPlayers';
const snapshot = vi.hoisted(() => ({ players: [] as unknown[], loading: true, error: null as string | null, reload: vi.fn() }));
vi.mock('../usePlayerDashboardIndex', () => ({ usePlayerDashboardIndex: () => snapshot }));
vi.mock('@/integrations/supabase/client', () => { throw new Error('V2 must never open an independent database projection path'); });

export function entry(overrides: Partial<DashboardIndexEntry> = {}): DashboardIndexEntry {
  return { id: 1, name: 'Measured Player', team: 'EDM', position: 'C', jersey: 97,
    is_goalie: false, headshot_url: null, roster_status: null, actuals_season: 2025,
    projection_season: 2026, gp: 70, goals: 30, assists: 60, points: 90,
    sog: 200, hits: 40, blocks: 20, pim: 35, ppp: 30, shp: 2, plus_minus: 10,
    x_goals: 28.5, toi_seconds: 80000, wins: 0, losses: 0, ot_losses: 0,
    saves: 0, save_pct: 0, gaa: 0, shutouts: 0, goals_against: 0,
    proj_gp: 83, proj_goals: 999, proj_saves: 9999, ...overrides } as DashboardIndexEntry;
}

beforeEach(() => { snapshot.players = []; snapshot.loading = true; snapshot.error = null; snapshot.reload.mockReset(); });
describe('V2 shared dashboard preload', () => {
  it('exposes an immediately usable empty map and the shared loading state', () => {
    const { result } = renderHook(() => usePreloadedPlayers());
    expect(result.current.playersById.size).toBe(0);
    expect(result.current.isLoading).toBe(true);
  });
  it('maps all server players without a browser pagination cap and preserves memoized identity', () => {
    snapshot.players = Array.from({ length: 1312 }, (_, id) => entry({ id }));
    snapshot.loading = false;
    const { result, rerender } = renderHook(() => usePreloadedPlayers());
    expect(result.current.playersById.size).toBe(1312);
    expect(result.current.playersById.get('1311')?.full_name).toBe('Measured Player');
    const map = result.current.playersById;
    rerender();
    expect(result.current.playersById).toBe(map);
  });
  it('propagates API failures and retries without reading direct tables', () => {
    snapshot.loading = false; snapshot.error = 'API unavailable';
    const { result } = renderHook(() => usePreloadedPlayers());
    expect(result.current.error?.message).toBe('API unavailable');
    expect(result.current.playersById.size).toBe(0);
    result.current.reload();
    expect(snapshot.reload).toHaveBeenCalledOnce();
  });
  it('keeps a last successful shared snapshot on refresh failure', () => {
    snapshot.players = [entry()]; snapshot.loading = false; snapshot.error = 'Refresh failed';
    const { result } = renderHook(() => usePreloadedPlayers());
    expect(result.current.playersById.size).toBe(1);
    expect(result.current.error?.message).toBe('Refresh failed');
  });
  it('preserves measured stats season, real zeroes, eligibility and status', () => {
    const p = dashboardEntryToPreloadedPlayer(entry({ gp: 0, goals: 0, eligible_positions: ['C', 'L'], roster_status: 'IR' }));
    expect(p).toMatchObject({ games_played: 0, goals: 0, stats_season: 2025,
      eligible_positions: ['C', 'LW'], roster_status: 'IR', is_ir_eligible: true, jersey_number: '97' });
    expect(p.goals).not.toBe(999);
  });
  it('does not label unavailable actuals with a forecast or current season', () => {
    expect(dashboardEntryToPreloadedPlayer(entry({ actuals_season: null })).stats_season).toBeNull();
    expect(dashboardEntryToPreloadedPlayer(entry({ actuals_season: undefined })).stats_season).toBeNull();
  });
  it('preserves goalie appearances, scoring categories and measured GSAx', () => {
    const p = dashboardEntryToPreloadedPlayer(entry({ is_goalie: true, position: 'G', gp: 58,
      wins: 35, saves: 1500, goals_against: 150, shutouts: 4, save_pct: .91, gaa: 2.6, gsax_regressed: 12 }));
    expect(p).toMatchObject({ games_played: 58, goalie_gp: 58, wins: 35, saves: 1500,
      goals_against: 150, shutouts: 4, save_percentage: .91, goals_against_average: 2.6,
      goalsSavedAboveExpected: 12 });
  });
});

  it('passes dated evidence independently of stored fantasy eligibility and actual stats', () => {
    const availability = { status: 'out', basis: 'reviewed_report', as_of: '2026-09-10', expires_at: '2026-09-17', source: 'Primary report', revision: 'r1', stale: false } as const;
    const baseline = dashboardEntryToPreloadedPlayer(entry({ roster_status: null }));
    const current = dashboardEntryToPreloadedPlayer(entry({ roster_status: null, availability }));
    expect(current.availability).toEqual(availability);
    expect(current.is_ir_eligible).toBe(false);
    expect({ ...current, availability: undefined }).toEqual(baseline);
  });

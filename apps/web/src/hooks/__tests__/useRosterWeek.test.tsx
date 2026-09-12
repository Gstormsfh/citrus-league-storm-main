import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ stats: vi.fn(), projections: vi.fn(), schedule: vi.fn(), players: vi.fn() }));
vi.mock('@/api/matchups', () => ({ matchupApi: { getMatchupStats: mocks.stats } }));
vi.mock('@/api/players', () => ({ playerApi: { getBatchProjections: mocks.projections, getPlayersByIds: mocks.players } }));
vi.mock('@/utils/timezoneUtils', () => ({ getTodayMST: () => '2026-10-01' }));
vi.mock('@/services/ScheduleService', () => ({ ScheduleService: { getGamesForTeams: mocks.schedule } }));
import { useRosterWeek } from '../useRosterWeek';

const args = { enabled: true, players: [{ id: 1, isGoalie: true }], weekStart: '2026-09-27', weekEnd: '2026-10-03', scoring: { goalie: { saves: 1 } } };
const row = { player_id: 1, projection_date: '2026-10-01', projected_gp: 1,
  projection_basis: 'conditional_on_start', expected_starts: 0.2,
  projected_saves: 30, projected_wins: 0, projected_goals_against: 2, projected_shutouts: 0,
  total_projected_points: 999, game: { status: 'scheduled' } };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.stats.mockResolvedValue({ data: {} });
  mocks.players.mockResolvedValue({ data: [{ id: 1, team: 'NYR' }] });
  mocks.schedule.mockResolvedValue({ gamesByTeam: new Map([['NYR', [{ game_date: '2026-10-01', status: 'scheduled' }]]]), error: null });
  mocks.projections.mockResolvedValue({ data: [row] });
});

describe('roster weekly source readiness', () => {
  it('reports a complete start-aware forecast and reweights when scoring changes', async () => {
    const { result, rerender } = renderHook(({ scoring }) => useRosterWeek({ ...args, scoring }), { initialProps: { scoring: { goalie: { saves: 1 } } } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entries.get('1')?.weekPoints).toBe(6);
    expect(result.current.entries.get('1')?.gamesRemaining).toBe(0.2);
    rerender({ scoring: { goalie: { saves: 2 } } });
    await waitFor(() => expect(result.current.entries.get('1')?.weekPoints).toBe(12));
  });
  it('withholds the team forecast when goalie exposure is unknown', async () => {
    mocks.projections.mockResolvedValue({ data: [{ ...row, projection_basis: 'unknown' }] });
    const { result } = renderHook(() => useRosterWeek(args));
    await waitFor(() => expect(mocks.projections).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(false);
    expect(result.current.entries.has('1')).toBe(false);
  });
  it('does not label a failed projection fetch a complete zero week', async () => {
    mocks.projections.mockRejectedValue(new Error('Offline'));
    const { result } = renderHook(() => useRosterWeek(args));
    await waitFor(() => expect(mocks.projections).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(false);
    expect(result.current.entries.size).toBe(0);
  });
  it('refreshes on focus and preserves prior entries without declaring a failed refresh ready', async () => {
    const { result } = renderHook(() => useRosterWeek(args));
    await waitFor(() => expect(result.current.ready).toBe(true));
    mocks.projections.mockRejectedValue(new Error('Offline'));
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(result.current.ready).toBe(false));
    expect(result.current.entries.get('1')?.weekPoints).toBe(6);
  });

  it('distinguishes a missing scheduled projection from a genuine off day', async () => {
    mocks.projections.mockResolvedValue({ data: [] });
    const { result, rerender } = renderHook(({ scoring }) => useRosterWeek({ ...args, scoring }), { initialProps: { scoring: args.scoring } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ready).toBe(false);
    mocks.schedule.mockResolvedValue({ gamesByTeam: new Map([['NYR', []]]), error: null });
    rerender({ scoring: { goalie: { saves: 2 } } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entries.get('1')?.weekPoints).toBe(0);
  });

});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ stats: vi.fn(), ros: vi.fn() }));
vi.mock('@/api/players', () => ({ playerApi: { getPlayerStats: mocks.stats, getRosProjections: mocks.ros } }));
import { useRosterSeasonSources } from '../useRosterSeasonSources';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stats.mockImplementation(async (id, season) => ({ data: [{ player_id: id, nhl_goals: season === 2026 ? 10 : 50 }] }));
  mocks.ros.mockResolvedValue({ data: [{ player_id: 1, season: 2026, projected_goals: 30 }] });
});
describe('explicit roster season sources', () => {
  it('queries both exact years, does not confuse directory fallback with current actuals', async () => {
    const { result } = renderHook(() => useRosterSeasonSources(['1'], 2026, true));
    await waitFor(() => expect(result.current?.get('1')?.actual?.nhl_goals).toBe(10));
    expect(result.current?.get('1')?.prior?.nhl_goals).toBe(50);
    expect(mocks.stats.mock.calls).toEqual([['1', 2026], ['1', 2025]]);
  });
  it('distinguishes a failed response from no history and keeps actuals on a ROS outage', async () => {
    mocks.ros.mockRejectedValue(new Error('Offline'));
    mocks.stats.mockImplementation(async (_id, season) => { if (season === 2026) throw new Error('Offline'); return { data: [] }; });
    const { result } = renderHook(() => useRosterSeasonSources(['1'], 2026, true));
    await waitFor(() => expect(result.current?.has('1')).toBe(true));
    expect(result.current?.get('1')).toEqual({ actual: undefined, prior: null, ros: undefined });
  });
  it('does not show a former roster or former season while the next read is pending', async () => {
    const { result, rerender } = renderHook(({ ids, season }) => useRosterSeasonSources(ids, season, true), { initialProps: { ids: ['1'], season: 2026 } });
    await waitFor(() => expect(result.current?.has('1')).toBe(true));
    mocks.stats.mockImplementation(() => new Promise(() => {}));
    rerender({ ids: ['2'], season: 2027 });
    expect(result.current).toBeUndefined();
  });
  it('does not perform authenticated season reads on the guest/mobile path', () => {
    renderHook(() => useRosterSeasonSources(['1'], 2026, false));
    expect(mocks.stats).not.toHaveBeenCalled();
    expect(mocks.ros).not.toHaveBeenCalled();
  });
  it.each([
    [{ player_id: '9', nhl_goals: 50 }],
    [{ player_id: '1', season: 2024, nhl_goals: 50 }],
    [{ player_id: '1', nhl_goals: 10 }, { player_id: '1', nhl_goals: 50 }],
    [null],
  ])('does not turn malformed or mismatched actuals into a zero season: %j', async (...rows) => {
    mocks.stats.mockResolvedValue({ data: rows });
    const { result } = renderHook(() => useRosterSeasonSources(['1'], 2026, true));
    await waitFor(() => expect(result.current?.has('1')).toBe(true));
    expect(result.current?.get('1')?.actual).toBeUndefined();
  });
  it('rejects duplicate current forecasts and ignores another season', async () => {
    mocks.ros.mockResolvedValue({ data: [
      { player_id: 1, season: 2026, projected_goals: 30 },
      { player_id: 1, season: 2026, projected_goals: 40 },
      { player_id: 2, season: 2025, projected_goals: 50 },
    ] });
    const { result } = renderHook(() => useRosterSeasonSources(['1', '2'], 2026, true));
    await waitFor(() => expect(result.current?.size).toBe(2));
    expect(result.current?.get('1')?.ros).toBeUndefined();
    expect(result.current?.get('2')?.ros).toBeUndefined();
  });
});

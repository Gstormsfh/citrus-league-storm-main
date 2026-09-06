import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlayerDashboard, type PlayerDashboardPayload } from '../usePlayerDashboard';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/api/client', () => ({ apiClient: { get } }));
afterEach(() => { vi.useRealTimers(); get.mockReset(); });

it('refreshes detail publication and clears an old value while its next request is pending', async () => {
  vi.useFakeTimers();
  const payload: PlayerDashboardPayload = {
    player_id: 17, season: 2025, game_type: 'regular', player: null, shots: [], shots_available: false,
    shots_truncated: false, shots_cap: 5000, seasons: [], gsax: null, talent: null, as_of: null,
    toi_publication: { availability: 'available', value: 20, reason: 'verified', feature_version: 'official-appearance-v2',
      variant: 'official-reconciled', unit: 'minutes_per_appearance', batch_id: 'one', source_observed_at: new Date().toISOString(),
      code_revision: 'a'.repeat(40), metric: 'avg_toi_per_game', model_version: 'none', season: 2025,
      game_type: 'regular', population: 'skaters', source_snapshot_id: 'receipt', data_cutoff: new Date().toISOString() },
  };
  get.mockResolvedValueOnce({ data: payload });
  const { result, unmount } = renderHook(() => usePlayerDashboard(17));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(result.current.data?.toi_publication?.value).toBe(20);
  let resolve!: (value: unknown) => void;
  get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(get).toHaveBeenCalledTimes(2);
  expect(result.current.data?.toi_publication).toMatchObject({ value: null, reason: 'refresh_pending' });
  await act(async () => {
    resolve({ data: { ...payload, toi_publication: { ...payload.toi_publication, value: 21, batch_id: 'two' } } });
    await Promise.resolve();
  });
  expect(result.current.data?.toi_publication).toMatchObject({ value: 21, batch_id: 'two' });
  unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(get).toHaveBeenCalledTimes(2);
});

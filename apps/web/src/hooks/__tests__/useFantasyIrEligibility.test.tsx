import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAvailability } from '@citrus/shared';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/api/client', () => ({ apiClient: { get: mocks.get } }));
import { useFantasyIrEligibility } from '../useFantasyIrEligibility';
const availability = (status: PlayerAvailability['status']): PlayerAvailability => ({ status, basis: 'reviewed_report',
  as_of: '2026-09-12', expires_at: null, maintained: true, review_due_at: '2026-09-17', revision: 'current', source: 'Owner-reviewed record', stale: false });
const player = { id: 1, availability: availability('out'), is_ir_eligible: true };
const response = (status: PlayerAvailability['status'] | null, id = 1) => ({ data: [{ id, availability: status === null ? null : availability(status) }] });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
const flush = async () => { await act(async () => { await vi.dynamicImportSettled(); }); };
const advance = async (ms = 120_000) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); await vi.dynamicImportSettled(); }); };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-13')); mocks.get.mockReset(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); });
afterEach(() => { vi.useRealTimers(); });

describe('fresh roster-scoped IR evidence', () => {
  it('treats successful empty or partial responses as unknown without resurrecting stored injuries', async () => {
    mocks.get.mockResolvedValue({ data: [
      { id: 1, availability: availability('healthy') },
      { id: 2, availability: availability('healthy') },
    ] });
    const { result } = renderHook(() => useFantasyIrEligibility([1, 2])); await flush();
    const second = { ...player, id: 2 };
    expect(result.current(player)).toBe(false);
    expect(result.current(second)).toBe(false);
    mocks.get.mockResolvedValue({ data: [{ id: 2, availability: availability('out') }] });
    await advance();
    expect(result.current(player)).toBe(false);
    expect(result.current(second)).toBe(true);
    mocks.get.mockResolvedValue({ data: [] }); await advance();
    expect(result.current(player)).toBe(false);
    expect(result.current(second)).toBe(false);
  });

  it('requests only normalized roster IDs and never requests the dashboard index', async () => {
    mocks.get.mockResolvedValue({ data: [{ id: 1, availability: availability('healthy') }, { id: 2, availability: availability('out') }, { id: 99, availability: availability('out') }] });
    const { result, rerender } = renderHook(({ ids }) => useFantasyIrEligibility(ids), { initialProps: { ids: [2, '1', 2, 'invalid', 0] } });
    await flush();
    expect(mocks.get).toHaveBeenCalledOnce();
    expect(mocks.get.mock.calls[0][0]).toBe('/api/players/by-ids?ids=1,2');
    expect(result.current(player)).toBe(false);
    expect(result.current({ id: 2 })).toBe(true);
    expect(result.current({ id: 99 })).toBe(false);
    rerender({ ids: ['1', 2] }); await flush();
    expect(mocks.get).toHaveBeenCalledOnce();
  });

  it('deduplicates in-flight focus events, retains fresh evidence while refreshing and observes clears/null/unknown', async () => {
    mocks.get.mockResolvedValue(response('out'));
    const { result } = renderHook(() => useFantasyIrEligibility([1])); await flush();
    expect(result.current(player)).toBe(true);
    const pending = deferred<ReturnType<typeof response>>(); mocks.get.mockReturnValueOnce(pending.promise);
    await advance();
    act(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')); }); await flush();
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(result.current(player)).toBe(true);
    await act(async () => { pending.resolve(response('healthy')); });
    expect(result.current(player)).toBe(false);
    for (const status of ['unknown', null, 'ir', 'ltir', 'injured', 'out'] as const) {
      mocks.get.mockResolvedValue(response(status)); await advance();
      expect(result.current(player)).toBe(status !== 'unknown' && status !== null);
    }
    expect(mocks.get.mock.calls.every(([path]) => path === '/api/players/by-ids?ids=1')).toBe(true);
  });

  it('skips hidden polling and refreshes on visibility/focus once evidence is due', async () => {
    mocks.get.mockResolvedValue(response('out'));
    renderHook(() => useFantasyIrEligibility([1])); await flush();
    act(() => { window.dispatchEvent(new Event('focus')); }); await flush();
    expect(mocks.get).toHaveBeenCalledOnce();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await advance(); expect(mocks.get).toHaveBeenCalledOnce();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); }); await flush();
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('aborts obsolete IDs and ignores a late response even when the transport ignores abort', async () => {
    const first = deferred<ReturnType<typeof response>>();
    mocks.get.mockReturnValueOnce(first.promise).mockResolvedValue(response('healthy', 2));
    const { result, rerender, unmount } = renderHook(({ ids }) => useFantasyIrEligibility(ids), { initialProps: { ids: [1] } }); await flush();
    const signal = mocks.get.mock.calls[0][1].signal as AbortSignal;
    rerender({ ids: [2] }); await flush();
    expect(signal.aborted).toBe(true);
    expect(result.current({ ...player, id: 2 })).toBe(false);
    await act(async () => { first.resolve(response('out', 2)); });
    expect(result.current({ ...player, id: 2 })).toBe(false);
    unmount(); await advance(); expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('does not read empty/disabled scopes and aborts an in-flight read on disable/unmount', async () => {
    const pending = deferred<ReturnType<typeof response>>(); mocks.get.mockReturnValue(pending.promise);
    const { rerender, unmount } = renderHook(({ ids, enabled }) => useFantasyIrEligibility(ids, enabled), { initialProps: { ids: [] as number[], enabled: true } });
    await flush(); expect(mocks.get).not.toHaveBeenCalled();
    rerender({ ids: [1], enabled: false }); await flush(); expect(mocks.get).not.toHaveBeenCalled();
    rerender({ ids: [1], enabled: true }); await flush();
    const first = mocks.get.mock.calls[0][1].signal as AbortSignal;
    rerender({ ids: [1], enabled: false }); expect(first.aborted).toBe(true);
    rerender({ ids: [1], enabled: true }); await flush();
    const second = mocks.get.mock.calls[1][1].signal as AbortSignal;
    unmount(); expect(second.aborted).toBe(true);
    await act(async () => { pending.resolve(response('out')); });
  });

  it('uses dated roster evidence on initial errors and retains the newer snapshot on refresh errors', async () => {
    mocks.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response('healthy'));
    const { result } = renderHook(() => useFantasyIrEligibility([1])); await flush();
    expect(result.current(player)).toBe(true);
    act(() => { window.dispatchEvent(new Event('focus')); }); await flush();
    expect(mocks.get).toHaveBeenCalledOnce();
    await advance(60_000);
    act(() => { window.dispatchEvent(new Event('focus')); }); await flush();
    expect(result.current(player)).toBe(false);
    mocks.get.mockRejectedValue(new Error('offline')); await advance();
    act(() => { window.dispatchEvent(new Event('focus')); }); await flush();
    expect(mocks.get).toHaveBeenCalledTimes(3);
    expect(result.current(player)).toBe(false);
    act(() => { window.dispatchEvent(new Event('focus')); }); await flush();
    expect(mocks.get).toHaveBeenCalledTimes(3);
  });

  it('keeps review reminders distinct from explicit validity expiry', async () => {
    mocks.get.mockResolvedValue(response('out'));
    const { result } = renderHook(() => useFantasyIrEligibility([1])); await flush();
    vi.setSystemTime(new Date('2026-09-18'));
    expect(result.current(player)).toBe(true);
    mocks.get.mockResolvedValue({ data: [{ id: 1, availability: { ...availability('out'), valid_until: '2026-09-17' } }] });
    act(() => { window.dispatchEvent(new Event('focus')); }); await flush();
    expect(result.current(player)).toBe(false);
  });
});

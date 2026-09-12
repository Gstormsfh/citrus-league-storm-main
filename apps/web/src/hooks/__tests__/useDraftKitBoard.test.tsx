import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_KIT_REFRESH_MS, useDraftKitBoard } from '../useDraftKitBoard';
const get = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({ apiClient: { get } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn() } }));
beforeEach(() => { get.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('Draft Kit league requests', () => {
  it('preserves an explicit unscoped board and requests selected league scoring', async () => {
    get.mockResolvedValue({ data: { cards: [] } });
    const { rerender } = renderHook(({ leagueId }) => useDraftKitBoard(leagueId),
      { initialProps: { leagueId: null as string | null } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/draft-kit/board', expect.objectContaining({ signal: expect.any(AbortSignal) })));
    rerender({ leagueId: 'league-a' });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/draft-kit/board?leagueId=league-a', expect.objectContaining({ signal: expect.any(AbortSignal) })));
  });

  it('cannot replace the current league board with a slower previous league response', async () => {
    let finishOld!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce({ data: { cards: [], marker: 'new' } });
    const { result, rerender } = renderHook(({ leagueId }) => useDraftKitBoard(leagueId),
      { initialProps: { leagueId: 'old' } });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    rerender({ leagueId: 'new' });
    await waitFor(() => expect(result.current.board).toMatchObject({ marker: 'new' }));
    await act(async () => { finishOld({ data: { marker: 'old' } }); });
    expect(result.current.board).toMatchObject({ marker: 'new' });
    expect(result.current.loading).toBe(false);
  });

  it('clears the old board when the selected league request fails', async () => {
    get.mockResolvedValueOnce({ data: { cards: [], marker: 'old' } })
      .mockRejectedValueOnce(new Error('League scoring unavailable'));
    const { result, rerender } = renderHook(({ leagueId }) => useDraftKitBoard(leagueId),
      { initialProps: { leagueId: 'old' } });
    await waitFor(() => expect(result.current.board).toBeTruthy());
    rerender({ leagueId: 'new' });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.board).toBeNull();
  });
  it('refreshes every 120 seconds, retains rows on failure, and recovers on focus', async () => {
    vi.useFakeTimers();
    get.mockResolvedValueOnce({ data: { cards: [], marker: 'initial' } })
      .mockRejectedValueOnce(new Error('Temporary outage'))
      .mockResolvedValueOnce({ data: { cards: [], marker: 'fresh' } });
    const { result } = renderHook(() => useDraftKitBoard('league'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.board).toMatchObject({ marker: 'initial' });
    const timestamp = result.current.lastUpdatedAt;
    await act(async () => { await vi.advanceTimersByTimeAsync(DRAFT_KIT_REFRESH_MS); });
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current.board).toMatchObject({ marker: 'initial' });
    expect(result.current.error).toContain('last loaded board');
    expect(result.current.lastUpdatedAt).toBe(timestamp);
    expect(result.current.loading).toBe(false);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(result.current.board).toMatchObject({ marker: 'fresh' });
    expect(result.current.error).toBeNull();
  });

  it('deduplicates focus while refreshing and aborts requests on league change/unmount', async () => {
    get.mockResolvedValueOnce({ data: { cards: [], marker: 'initial' } })
      .mockImplementation(() => new Promise(() => {}));
    const { result, rerender, unmount } = renderHook(({ leagueId }) => useDraftKitBoard(leagueId),
      { initialProps: { leagueId: 'old' } });
    await waitFor(() => expect(result.current.board).toBeTruthy());
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(result.current.refreshing).toBe(true);
    expect(result.current.loading).toBe(false);
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(get).toHaveBeenCalledTimes(2);
    const oldSignal = get.mock.calls[1][1].signal;
    rerender({ leagueId: 'new' });
    expect(oldSignal.aborted).toBe(true);
    expect(result.current.board).toBeNull();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    const newSignal = get.mock.calls[2][1].signal;
    unmount();
    expect(newSignal.aborted).toBe(true);
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('reports canonical readiness only from a matching published backend revision', async () => {
    get.mockResolvedValueOnce({ data: { cards: [], projectionSeason: 2026 } })
      .mockResolvedValueOnce({ data: { cards: [], projectionSeason: 2026,
        projection_source: { kind: 'canonical', readiness: 'published', revision: 'abc', run_id: 'run', season: 2026 } } });
    const { result } = renderHook(() => useDraftKitBoard('league'));
    await waitFor(() => expect(result.current.board).toBeTruthy());
    expect(result.current.canonicalRevision).toBeNull();
    expect(result.current.canonicalReadiness).toBe('unknown');
    await act(async () => { await result.current.reload(); });
    expect(result.current.canonicalRevision).toBe('abc');
    expect(result.current.canonicalReadiness).toBe('published');
  });

  it('ignores a publication revision from a different projection season', async () => {
    get.mockResolvedValue({ data: { cards: [], projectionSeason: 2026,
      projection_source: { kind: 'canonical', readiness: 'published', revision: 'abc', run_id: 'run', season: 2025 } } });
    const { result } = renderHook(() => useDraftKitBoard('league'));
    await waitFor(() => expect(result.current.board).toBeTruthy());
    expect(result.current.canonicalRevision).toBeNull();
    expect(result.current.canonicalReadiness).toBe('unknown');
  });

  it('does not retain a board after explicit membership denial', async () => {
    get.mockResolvedValueOnce({ data: { cards: [] } })
      .mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    const { result } = renderHook(() => useDraftKitBoard('league'));
    await waitFor(() => expect(result.current.board).toBeTruthy());
    await act(async () => { await result.current.reload(); });
    expect(result.current.board).toBeNull();
    expect(result.current.lastUpdatedAt).toBeNull();
    expect(result.current.error).toContain('Could not load');
  });

});

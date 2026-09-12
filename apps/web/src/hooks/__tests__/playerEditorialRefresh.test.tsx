import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/api/client', () => ({ apiClient: { get: mocks.get } }));
vi.mock('@/utils/logger', () => ({ logger: { debug: vi.fn() } }));
import { usePlayerXgHistory } from '@/components/player/usePlayerXgHistory';
import { useCitrusPlayerNotes } from '../useCitrusPlayerNotes';
const writeup = (headline: string) => ({ headline, summary: headline, analysis: 'Analysis', tags: [], hasEnoughData: true, cardNote: headline, cardTone: 'neutral' });
const history = (headline: string) => ({ data: { points: [], writeup: writeup(headline) } });
const news = (id: string) => ({ data: { notes: [], items: [{ id, title: id }] } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { mocks.get.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('player editorial refresh lifecycle', () => {
  it('refetches for changed news/settings revisions, but not stable contents', async () => {
    mocks.get.mockResolvedValue(history('First'));
    const { result, rerender } = renderHook(({ revision }) => usePlayerXgHistory(1, { revision, leagueId: 'a league' }), { initialProps: { revision: JSON.stringify({ news: [], scoring: ['goals'] }) } });
    await waitFor(() => expect(result.current.writeup?.headline).toBe('First'));
    rerender({ revision: JSON.stringify({ news: [], scoring: ['goals'] }) });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith('/api/players/1/xg-history?leagueId=a%20league');
    mocks.get.mockResolvedValue(history('News update'));
    rerender({ revision: JSON.stringify({ news: ['new'], scoring: ['goals'] }) });
    expect(result.current.writeup).toBeNull();
    await waitFor(() => expect(result.current.writeup?.headline).toBe('News update'));
    mocks.get.mockResolvedValue(history('Settings update'));
    rerender({ revision: JSON.stringify({ news: ['new'], scoring: ['blocks'] }) });
    await waitFor(() => expect(result.current.writeup?.headline).toBe('Settings update'));
    expect(mocks.get).toHaveBeenCalledTimes(3);
  });

  it('does not let an old player response overwrite the new player', async () => {
    const old = deferred<ReturnType<typeof history>>();
    mocks.get.mockReturnValueOnce(old.promise).mockResolvedValue(history('New player'));
    const { result, rerender } = renderHook(({ id }) => usePlayerXgHistory(id), { initialProps: { id: 1 } });
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
    rerender({ id: 2 });
    expect(result.current.writeup).toBeNull();
    await waitFor(() => expect(result.current.writeup?.headline).toBe('New player'));
    await act(async () => { old.resolve(history('Old player')); });
    expect(result.current.writeup?.headline).toBe('New player');
  });

  it('retains the server copy during same-context polling and clears on disable', async () => {
    mocks.get.mockResolvedValue(history('Server'));
    const { result, rerender, unmount } = renderHook(({ enabled }) => usePlayerXgHistory(1, { enabled }), { initialProps: { enabled: false } });
    vi.useFakeTimers();
    rerender({ enabled: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.writeup?.headline).toBe('Server');
    expect(vi.getTimerCount()).toBe(1);
    const pending = deferred<ReturnType<typeof history>>();
    mocks.get.mockReturnValue(pending.promise);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(result.current.writeup?.headline).toBe('Server');
    rerender({ enabled: false });
    expect(result.current).toMatchObject({ status: 'idle', writeup: null, points: null });
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { pending.resolve(history('Too late')); });
    expect(result.current.writeup).toBeNull();
    unmount();
  });

  it('rejects malformed writeups even when summary exists', async () => {
    mocks.get.mockResolvedValue({ data: { points: [], writeup: { summary: 'Incomplete', tags: null } } });
    const { result } = renderHook(() => usePlayerXgHistory(1));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.writeup).toBeNull();
  });

  it('hides existing news on player change and ignores an old in-flight response', async () => {
    mocks.get.mockResolvedValueOnce(news('Old'));
    const { result, rerender } = renderHook(({ id }) => useCitrusPlayerNotes(id), { initialProps: { id: 1 } });
    await waitFor(() => expect(result.current.items[0]?.id).toBe('Old'));
    const second = deferred<ReturnType<typeof news>>();
    mocks.get.mockReturnValueOnce(second.promise).mockResolvedValue(news('Third'));
    rerender({ id: 2 });
    expect(result.current.items).toEqual([]);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    rerender({ id: 3 });
    await waitFor(() => expect(result.current.items[0]?.id).toBe('Third'));
    await act(async () => { second.resolve(news('Second')); });
    expect(result.current.items[0]?.id).toBe('Third');
  });

  it('disabling news clears loading, data and its timer even mid-request', async () => {
    const pending = deferred<ReturnType<typeof news>>();
    mocks.get.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(({ enabled }) => useCitrusPlayerNotes(1, enabled), { initialProps: { enabled: false } });
    vi.useFakeTimers();
    rerender({ enabled: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.loading).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    rerender({ enabled: false });
    expect(result.current).toEqual({ items: [], notes: [], loading: false });
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { pending.resolve(news('Late')); });
    expect(result.current).toEqual({ items: [], notes: [], loading: false });
  });

  it('does not fetch or poll invalid player IDs', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ id }) => ({ notes: useCitrusPlayerNotes(id), history: usePlayerXgHistory(id == null ? null : Number(id)) }), { initialProps: { id: '123garbage' as string | null } });
    expect(result.current.notes.loading).toBe(false);
    expect(result.current.history.status).toBe('idle');
    rerender({ id: null });
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('polling real news refreshes assessment once for changed contents without a request loop', async () => {
    let article = 'Initial';
    mocks.get.mockImplementation((path: string) => Promise.resolve(path.includes('/news/') ? news(article) : history(article)));
    const { result, rerender } = renderHook(({ enabled }) => {
      const notes = useCitrusPlayerNotes(1, enabled);
      const assessment = usePlayerXgHistory(1, { enabled, revision: JSON.stringify(notes.items) });
      return { notes, assessment };
    }, { initialProps: { enabled: false } });
    vi.useFakeTimers();
    rerender({ enabled: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.assessment.writeup?.headline).toBe('Initial');
    const initialRequests = mocks.get.mock.calls.length;
    rerender({ enabled: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mocks.get).toHaveBeenCalledTimes(initialRequests);
    article = 'Updated';
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.notes.items[0]?.id).toBe('Updated');
    expect(result.current.assessment.writeup?.headline).toBe('Updated');
    // One news poll, one history poll, at most one follow-up for new news.
    expect(mocks.get.mock.calls.length - initialRequests).toBeLessThanOrEqual(3);
    const stableRequests = mocks.get.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(mocks.get.mock.calls.length - stableRequests).toBe(2);
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/services/LeagueService', () => ({ LeagueService: { getLeague: mock.get } }));
import { useLeagueScoringContext } from '../useLeagueScoringContext';
beforeEach(() => { vi.clearAllMocks(); });
describe('league scoring context refresh', () => {
  it('keeps missing league and seed unavailable without crashing', () => {
    const { result } = renderHook(() => useLeagueScoringContext());
    expect(result.current.ready).toBe(false);
    expect(mock.get).not.toHaveBeenCalled();
  });
  it('withholds scoring until a matching league loads and updates on focus', async () => {
    mock.get.mockResolvedValue({ league: { id: 'a', scoring_settings: { skater: { goals: 1 } } } });
    const { result } = renderHook(() => useLeagueScoringContext('a'));
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.scoring).toEqual({ skater: { goals: 1 } });
    mock.get.mockResolvedValue({ league: { id: 'a', scoring_settings: { skater: { goals: 9 } } } });
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(result.current.scoring).toEqual({ skater: { goals: 9 } }));
  });
  it('applies same-league context edits immediately without a stale cache overwrite', () => {
    const { result, rerender } = renderHook(({ goals }) => useLeagueScoringContext('a', { id: 'a', scoring_settings: { skater: { goals } } } as any), { initialProps: { goals: 1 } });
    rerender({ goals: 5 });
    expect(result.current.scoring).toEqual({ skater: { goals: 5 } });
    expect(mock.get).not.toHaveBeenCalled();
  });
  it('rejects old-league completions after a switch', async () => {
    let old: (value: unknown) => void = () => {};
    mock.get.mockImplementation((id: string) => id === 'a' ? new Promise(resolve => { old = resolve; }) : Promise.resolve({ league: { id: 'b', scoring_settings: { skater: { goals: 2 } } } }));
    const { result, rerender } = renderHook(({ id }) => useLeagueScoringContext(id), { initialProps: { id: 'a' } });
    rerender({ id: 'b' });
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { old({ league: { id: 'a', scoring_settings: { skater: { goals: 99 } } } }); });
    expect(result.current.scoring).toEqual({ skater: { goals: 2 } });
  });
  it('marks a failed refresh unavailable without substituting defaults', async () => {
    mock.get.mockRejectedValue(new Error('Offline'));
    const { result } = renderHook(() => useLeagueScoringContext('a'));
    await waitFor(() => expect(mock.get).toHaveBeenCalled());
    expect(result.current.ready).toBe(false);
  });
  it('does not interpret an unloaded settings field or missing league as defaults', async () => {
    mock.get.mockResolvedValue({ league: { id: 'a' } });
    const { result } = renderHook(() => useLeagueScoringContext('a', { id: 'a' } as any));
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(mock.get).toHaveBeenCalled());
    expect(result.current.ready).toBe(false);
    expect(renderHook(() => useLeagueScoringContext(null)).result.current.ready).toBe(false);
    expect(renderHook(() => useLeagueScoringContext(undefined)).result.current.ready).toBe(false);
    expect(renderHook(() => useLeagueScoringContext(undefined, undefined, true, true)).result.current.ready).toBe(true);
    expect(renderHook(() => useLeagueScoringContext(null, null, true, true)).result.current.ready).toBe(true);
  });
  it('accepts persisted null as an explicitly hydrated default configuration', () => {
    const { result } = renderHook(() => useLeagueScoringContext('a', { id: 'a', scoring_settings: null } as any));
    expect(result.current.ready).toBe(true);
  });

});

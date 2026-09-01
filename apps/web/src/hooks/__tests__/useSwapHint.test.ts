/**
 * FIRST-RUN SWAP HINT (2026-09-01, Sleeper parity audit R2)
 *
 * Contract: the "Tap a position to swap" toast fires ONCE — on the first
 * editable roster a manager ever sees — and never again, across re-renders,
 * remounts and reloads. And a broken localStorage never breaks the roster.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

import { useSwapHint, resetSwapHintForTests, SWAP_HINT_STORAGE_KEY } from '../useSwapHint';

beforeEach(() => {
  toastSpy.mockClear();
  localStorage.removeItem(SWAP_HINT_STORAGE_KEY);
  resetSwapHintForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSwapHint', () => {
  it('fires once on the first editable render and records that it did', () => {
    const { rerender } = renderHook(({ on }: { on: boolean }) => useSwapHint(on), {
      initialProps: { on: true },
    });
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0][0]).toMatchObject({ title: 'Tap a position to swap' });
    expect(localStorage.getItem(SWAP_HINT_STORAGE_KEY)).toBe('1');

    rerender({ on: true });
    rerender({ on: false });
    rerender({ on: true });
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled, then fires when the list becomes editable', () => {
    const { rerender } = renderHook(({ on }: { on: boolean }) => useSwapHint(on), {
      initialProps: { on: false },
    });
    expect(toastSpy).not.toHaveBeenCalled();
    rerender({ on: true });
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  it('stays silent on a later visit once the flag is stored', () => {
    localStorage.setItem(SWAP_HINT_STORAGE_KEY, '1');
    renderHook(() => useSwapHint(true));
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('a second mount in the same page load is silent even if storage was wiped', () => {
    const first = renderHook(() => useSwapHint(true));
    expect(toastSpy).toHaveBeenCalledTimes(1);
    first.unmount();
    localStorage.removeItem(SWAP_HINT_STORAGE_KEY);
    renderHook(() => useSwapHint(true));
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  it('survives a localStorage that throws — shows the hint once, never crashes', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => renderHook(() => useSwapHint(true))).not.toThrow();
    expect(toastSpy).toHaveBeenCalledTimes(1);
    // …and the in-memory guard still caps it for the rest of the page load.
    renderHook(() => useSwapHint(true));
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });
});

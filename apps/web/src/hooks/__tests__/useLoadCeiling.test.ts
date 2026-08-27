// LOAD CEILING (2026-08-27)
//
// Pins the backstop added after the Matchup page shipped an infinite spinner:
// a failed first load left it on "Loading the matchup…" permanently — verified
// in a browser at 24 seconds with no error, no retry and no way out.
//
// What matters here is not that a timer fires. It is the two directions the
// backstop must get right:
//
//   * it must fire when the load never settles — that is the bug;
//   * it must NOT fire when the load settles, including settling late while
//     the clock is still running, because a spurious "we couldn't load this"
//     over a page that loaded fine is its own defect.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLoadCeiling } from '../useLoadCeiling';

const CEILING = 25000;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Stand-in for the page's hasInitializedRef. */
const ref = (settled = false) => ({ current: settled });

describe('useLoadCeiling — fires when the load never settles', () => {
  it('calls onExceeded once the ceiling passes', () => {
    const onExceeded = vi.fn();
    renderHook(() => useLoadCeiling(ref(false), onExceeded, CEILING));

    expect(onExceeded).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CEILING + 1);
    expect(onExceeded).toHaveBeenCalledTimes(1);
  });

  it('stays silent right up to the ceiling', () => {
    // A load that is merely slow must still win; the ceiling is a backstop,
    // not a deadline competing with the real load.
    const onExceeded = vi.fn();
    renderHook(() => useLoadCeiling(ref(false), onExceeded, CEILING));

    vi.advanceTimersByTime(CEILING - 1);
    expect(onExceeded).not.toHaveBeenCalled();
  });

  it('fires only once no matter how long the page stays open', () => {
    const onExceeded = vi.fn();
    renderHook(() => useLoadCeiling(ref(false), onExceeded, CEILING));

    vi.advanceTimersByTime(CEILING * 10);
    expect(onExceeded).toHaveBeenCalledTimes(1);
  });
});

describe('useLoadCeiling — silent when the load settles', () => {
  it('never arms if the load already settled before mount', () => {
    const onExceeded = vi.fn();
    renderHook(() => useLoadCeiling(ref(true), onExceeded, CEILING));

    vi.advanceTimersByTime(CEILING * 2);
    expect(onExceeded).not.toHaveBeenCalled();
  });

  it('does not fire when the load settles WHILE the clock is running', () => {
    // The case that makes the ref load-bearing. A slow-but-successful load
    // finishing at 20s must not then be told it failed at 25s.
    const settled = ref(false);
    const onExceeded = vi.fn();
    renderHook(() => useLoadCeiling(settled, onExceeded, CEILING));

    vi.advanceTimersByTime(20000);
    settled.current = true;             // the load finishes
    vi.advanceTimersByTime(10000);      // clock passes the ceiling

    expect(onExceeded).not.toHaveBeenCalled();
  });

  it('settling one tick before the ceiling still suppresses it', () => {
    const settled = ref(false);
    const onExceeded = vi.fn();
    renderHook(() => useLoadCeiling(settled, onExceeded, CEILING));

    vi.advanceTimersByTime(CEILING - 1);
    settled.current = true;
    vi.advanceTimersByTime(2);

    expect(onExceeded).not.toHaveBeenCalled();
  });
});

describe('useLoadCeiling — lifecycle', () => {
  it('clears the timer on unmount, so a navigated-away page stays quiet', () => {
    const onExceeded = vi.fn();
    const { unmount } = renderHook(() => useLoadCeiling(ref(false), onExceeded, CEILING));

    unmount();
    vi.advanceTimersByTime(CEILING * 2);
    expect(onExceeded).not.toHaveBeenCalled();
  });

  it('does not re-arm on re-render', () => {
    // Mount-once is the whole point: the failure being caught is a page that
    // re-renders repeatedly and never settles. Re-arming per render would
    // push the ceiling forward forever and restore the original bug.
    const onExceeded = vi.fn();
    const { rerender } = renderHook(() => useLoadCeiling(ref(false), onExceeded, CEILING));

    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(3000);
      rerender();
    }
    // 36s of elapsed time across 12 renders — one ceiling, already passed.
    expect(onExceeded).toHaveBeenCalledTimes(1);
  });
});

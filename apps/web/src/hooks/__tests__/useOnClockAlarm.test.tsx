// DR-4 (2026-07-30) — useOnClockAlarm hook tests.
//
// Contract enforced (architect ruling 2026-07-30):
//   - Alarm only fires when tab is HIDDEN (document.hidden === true).
//     If user is looking at the room, sticky action bar is enough.
//   - Title flash stops the instant amIOnClock flips false OR the tab
//     regains focus (visibilitychange).
//   - Autoplay-policy rejections are swallowed silently.
//   - Notification API errors swallowed.
//   - Mute toggle persists to localStorage under
//     `citrus.draft.alarm.muted`.
//
// jsdom does not implement Notification API by default; we don't
// test browser-notification content directly (the hook swallows
// Notification-undefined). We DO test the title-flash, mute
// persistence, and stop-on-visibility contract.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnClockAlarm } from '../useOnClockAlarm';

const ORIGINAL_TITLE = 'Citrus Fantasy';

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  document.title = ORIGINAL_TITLE;
  localStorage.clear();
  // Default: tab visible.
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => false,
  });
});

afterEach(() => {
  document.title = ORIGINAL_TITLE;
  vi.useRealTimers();
  localStorage.clear();
});

describe('useOnClockAlarm — visibility gating', () => {
  it('does NOT flash title when tab is VISIBLE (user is already looking)', () => {
    const { rerender } = renderHook(
      ({ onClock }: { onClock: boolean }) => useOnClockAlarm({ amIOnClock: onClock }),
      { initialProps: { onClock: false } },
    );
    // Tab visible; go on-clock.
    rerender({ onClock: true });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // Title unchanged — no flash while visible.
    expect(document.title).toBe(ORIGINAL_TITLE);
  });

  it('flashes title when tab is HIDDEN at on-clock transition', () => {
    setHidden(true);
    const { rerender } = renderHook(
      ({ onClock }: { onClock: boolean }) => useOnClockAlarm({ amIOnClock: onClock }),
      { initialProps: { onClock: false } },
    );
    rerender({ onClock: true });
    // Interval fires — title alternates.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(document.title).toMatch(/YOUR PICK/);
  });

  it('stops title flash when tab regains focus (visibilitychange)', () => {
    setHidden(true);
    const { rerender } = renderHook(
      ({ onClock }: { onClock: boolean }) => useOnClockAlarm({ amIOnClock: onClock }),
      { initialProps: { onClock: false } },
    );
    rerender({ onClock: true });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(document.title).toMatch(/YOUR PICK/);
    // User tabs back in.
    act(() => {
      setHidden(false);
    });
    // Title restored.
    expect(document.title).toBe(ORIGINAL_TITLE);
  });

  it('stops title flash when amIOnClock flips to false', () => {
    setHidden(true);
    const { rerender } = renderHook(
      ({ onClock }: { onClock: boolean }) => useOnClockAlarm({ amIOnClock: onClock }),
      { initialProps: { onClock: false } },
    );
    rerender({ onClock: true });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(document.title).toMatch(/YOUR PICK/);
    rerender({ onClock: false });
    expect(document.title).toBe(ORIGINAL_TITLE);
  });
});

describe('useOnClockAlarm — mute toggle persistence', () => {
  it('starts unmuted by default', () => {
    const { result } = renderHook(() =>
      useOnClockAlarm({ amIOnClock: false }),
    );
    expect(result.current.muted).toBe(false);
  });

  it('persists muted=true to localStorage', () => {
    const { result } = renderHook(() =>
      useOnClockAlarm({ amIOnClock: false }),
    );
    act(() => {
      result.current.setMuted(true);
    });
    expect(result.current.muted).toBe(true);
    expect(localStorage.getItem('citrus.draft.alarm.muted')).toBe('1');
  });

  it('reads muted=true from localStorage on mount', () => {
    localStorage.setItem('citrus.draft.alarm.muted', '1');
    const { result } = renderHook(() =>
      useOnClockAlarm({ amIOnClock: false }),
    );
    expect(result.current.muted).toBe(true);
  });

  it('clears the localStorage key when setMuted(false)', () => {
    localStorage.setItem('citrus.draft.alarm.muted', '1');
    const { result } = renderHook(() =>
      useOnClockAlarm({ amIOnClock: false }),
    );
    act(() => {
      result.current.setMuted(false);
    });
    expect(localStorage.getItem('citrus.draft.alarm.muted')).toBeNull();
  });
});

describe('useOnClockAlarm — cleanup on unmount', () => {
  it('restores original title on unmount even if title flash was active', () => {
    setHidden(true);
    const { rerender, unmount } = renderHook(
      ({ onClock }: { onClock: boolean }) => useOnClockAlarm({ amIOnClock: onClock }),
      { initialProps: { onClock: false } },
    );
    rerender({ onClock: true });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    unmount();
    expect(document.title).toBe(ORIGINAL_TITLE);
  });
});

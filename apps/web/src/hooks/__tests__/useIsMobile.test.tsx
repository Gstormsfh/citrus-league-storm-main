/**
 * ONE VIEWPORT QUESTION (2026-09-01, Sleeper parity audit M11)
 *
 * Contract: `useIsMobile()` answers "below Tailwind's lg (1024px)?" — the
 * same line index.css's `@media (max-width: 1023px)` block draws — and it
 * answers it correctly on the FIRST render (no desktop-then-phone flash),
 * updates when the viewport crosses the line, and never throws without a
 * window. `isMobileViewport()` is the same answer as a plain read.
 *
 * jsdom has no matchMedia, so the default path here is the `innerWidth`
 * fallback the component tests already rely on; the matchMedia path is
 * exercised with a stub that behaves like a browser's MediaQueryList.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render } from '@testing-library/react';

import { useIsMobile, isMobileViewport, MOBILE_BREAKPOINT } from '../useIsMobile';

let originalWidth: number;
const setWidth = (w: number) =>
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });

/** A MediaQueryList stand-in: `matches` is whatever the test sets, and `flip()` fires 'change'. */
function installMatchMedia(initialMatches: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: initialMatches,
    media: '',
    addEventListener: vi.fn((_: string, cb: () => void) => listeners.add(cb)),
    removeEventListener: vi.fn((_: string, cb: () => void) => listeners.delete(cb)),
    flip(next: boolean) {
      mql.matches = next;
      for (const cb of listeners) cb();
    },
    listenerCount: () => listeners.size,
  };
  const matchMedia = vi.fn(() => mql);
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia });
  return { mql, matchMedia };
}

beforeEach(() => {
  originalWidth = window.innerWidth;
});
afterEach(() => {
  setWidth(originalWidth);
  // jsdom ships without matchMedia; put it back that way.
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe('useIsMobile — the innerWidth fallback (jsdom, no matchMedia)', () => {
  it('the breakpoint is Tailwind lg', () => {
    expect(MOBILE_BREAKPOINT).toBe(1024);
    expect(typeof window.matchMedia).toBe('undefined');
  });

  it('is right on the first render, both sides of the line', () => {
    setWidth(390);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
    setWidth(1023);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
    setWidth(1024);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
    setWidth(1280);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it('follows a resize across the line, in both directions', () => {
    setWidth(1280);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      setWidth(390);
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(true);

    act(() => {
      setWidth(1280);
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(false);
  });

  it('removes its resize listener on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useIsMobile());
    const added = add.mock.calls.find(([type]) => type === 'resize');
    expect(added).toBeTruthy();
    unmount();
    expect(remove.mock.calls.some(([type, cb]) => type === 'resize' && cb === added![1])).toBe(true);
  });

  it('isMobileViewport() is the same answer as a plain read', () => {
    setWidth(390);
    expect(isMobileViewport()).toBe(true);
    setWidth(1024);
    expect(isMobileViewport()).toBe(false);
  });
});

describe('useIsMobile — matchMedia where the browser has it', () => {
  it('asks for (max-width: 1023px) and trusts the answer over innerWidth', () => {
    const { matchMedia } = installMatchMedia(true);
    setWidth(1280); // a lying width: the media query is the authority
    const { result } = renderHook(() => useIsMobile());
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 1023px)');
    expect(result.current).toBe(true);
    expect(isMobileViewport()).toBe(true);
  });

  it('re-renders on the change event and unsubscribes on unmount', () => {
    const { mql } = installMatchMedia(false);
    const { result, unmount } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    expect(mql.listenerCount()).toBe(1);

    act(() => mql.flip(true));
    expect(result.current).toBe(true);

    unmount();
    expect(mql.listenerCount()).toBe(0);
  });

  it('builds ONE MediaQueryList for the page, however many rows ask', () => {
    const { matchMedia, mql } = installMatchMedia(true);
    const Row = () => {
      useIsMobile();
      return null;
    };
    const { rerender } = render(
      <>
        {Array.from({ length: 50 }, (_, i) => (
          <Row key={i} />
        ))}
      </>,
    );
    rerender(
      <>
        {Array.from({ length: 50 }, (_, i) => (
          <Row key={i} />
        ))}
      </>,
    );
    expect(matchMedia).toHaveBeenCalledTimes(1);
    // Every row subscribed to that one list.
    expect(mql.listenerCount()).toBe(50);
  });

  it('a matchMedia that throws falls back to innerWidth rather than crashing the row', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error('not implemented');
      },
    });
    setWidth(390);
    expect(isMobileViewport()).toBe(true);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
  });
});

describe('useIsMobile — one answer for every row', () => {
  it('fifty rows share one subscription each and agree on the first paint', () => {
    setWidth(390);
    const seen: boolean[] = [];
    const Row = () => {
      seen.push(useIsMobile());
      return null;
    };
    render(
      <>
        {Array.from({ length: 50 }, (_, i) => (
          <Row key={i} />
        ))}
      </>,
    );
    expect(seen).toHaveLength(50);
    expect(seen.every((v) => v === true)).toBe(true);
  });
});

import { useSyncExternalStore } from 'react';

/**
 * ONE VIEWPORT QUESTION (2026-09-01, Sleeper parity audit M11).
 *
 * "Is this a phone?" was answered eight times across the matchup and
 * roster slices, four different ways: `PlayerCard.formatPlayerName` read
 * `window.innerWidth` on EVERY render of every row (26 rows × 2 sides ×
 * every live refresh); four tooltip components each carried a private
 * `useIsMobile` that started as `false` and flipped after mount, so the
 * first paint of a phone tooltip was the desktop one; `Roster.tsx` kept
 * the same state with TWO resize listeners; and two more modules had their
 * own `isXViewport()` helper. All of them meant the same line — Tailwind's
 * `lg`, the `@media (max-width: 1023px)` block in index.css — and none of
 * them could be told apart from the stylesheet if that line ever moved.
 * (StormyChatBubble, CapPlayerCard and AppShell still carry the old
 * pattern; they are outside those slices and can move here next.)
 *
 * This is the one answer. `matchMedia` where it exists (real browsers:
 * the change event fires exactly when the query flips, no work on every
 * resize pixel), `innerWidth` where it does not (jsdom, which is also why
 * the component tests can set `window.innerWidth` and render), and a
 * plain `false` when there is no window at all (SSR / a worker).
 *
 * `useSyncExternalStore` rather than state + effect: the first render is
 * already right, so nothing paints desktop-then-phone.
 */

/** Tailwind's `lg` — the line index.css's mobile block draws. */
export const MOBILE_BREAKPOINT = 1024;

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * One MediaQueryList per page, not one per render of every row: the
 * snapshot is read by every card on every render. Keyed on the
 * `matchMedia` function itself so a test that swaps it in gets a fresh
 * list, and a runtime without one gets null.
 */
let cached: { fn: Window['matchMedia']; mql: MediaQueryList | null } | null = null;

function mediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  const fn = window.matchMedia;
  if (cached && cached.fn === fn) return cached.mql;
  let mql: MediaQueryList | null = null;
  try {
    mql = fn.call(window, QUERY);
  } catch {
    // An ancient webview that stubs matchMedia badly — fall back to the width.
    mql = null;
  }
  cached = { fn, mql };
  return mql;
}

/**
 * Below the lg breakpoint right now. A plain function for the few places
 * that want a one-time read outside a component (a `useState` initialiser,
 * an event handler); components should call `useIsMobile()` so they re-render
 * when the viewport crosses the line.
 */
export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  const mql = mediaQuery();
  if (mql) return mql.matches;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const mql = mediaQuery();
  if (mql) {
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // Safari < 14 only has the deprecated pair.
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

const getServerSnapshot = (): boolean => false;

/** True below the lg breakpoint; updates when the viewport crosses it. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileViewport, getServerSnapshot);
}

export default useIsMobile;

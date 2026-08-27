import { useEffect, type MutableRefObject } from 'react';

/**
 * useLoadCeiling — bound a first load so a failure cannot become a permanent
 * spinner.
 *
 * WHY THIS EXISTS (2026-08-27)
 *
 * The Matchup page shipped an infinite spinner. A failed FIRST load left it on
 * "Loading the matchup…" forever — verified in a browser, still spinning at 24
 * seconds, with no error, no retry and no way out, on the page managers open
 * most during a week.
 *
 * Two exits were closed, each by a decision that reads as reasonable alone:
 *
 *   1. the initial-load catch cleared the error and kept `loading` true, to
 *      stop a transient error flashing during a race — which made the
 *      "no data and no error" branch permanent;
 *   2. the error UI was gated on an initialised flag that the same catch path
 *      deliberately never set, so even a surviving error could not render.
 *
 * Suppressing a TRANSIENT error during a race is right. Suppressing a TERMINAL
 * one is how an infinite spinner ships. This is the backstop that tells the
 * difference: whatever the load does, if it has still not settled by the
 * ceiling, the page admits it.
 *
 * Extracted from Matchup.tsx so it can be TESTED. Inline it was unreachable —
 * that page is 5,600 lines and has no page-level test, so a regression would
 * have been invisible exactly the way the original bug was.
 */
export function useLoadCeiling(
  /** Set true by every path that finishes the first load, success or failure.
   *  A ref rather than state on purpose: the timer reads it at fire time, so a
   *  load that settles while the clock runs is seen without re-arming. */
  hasSettledRef: MutableRefObject<boolean>,
  /** Called once, only if the load has not settled by `ms`. */
  onExceeded: () => void,
  ms: number,
): void {
  // Mount-once by design. Re-arming on every dependency change would restart
  // the ceiling each time the page re-rendered, which is the same as having no
  // ceiling at all — the failure this exists to catch is precisely the one
  // where the page keeps re-rendering and never settles.
  useEffect(() => {
    if (hasSettledRef.current) return;
    const id = setTimeout(() => {
      if (hasSettledRef.current) return;
      onExceeded();
    }, ms);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export default useLoadCeiling;

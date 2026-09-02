import { useEffect, useState } from 'react';

/**
 * ONE TICK, SHARED BY EVERY COUNTDOWN ON THE DRAFT SCREEN (2026-09-02).
 *
 * A pure module, no component, so react-refresh keeps working (the reason
 * `phoneRowScale.ts` and `roster/positionChip.ts` stand alone).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS FIXES
 *
 * `DraftTimerV2` (sticky header) and `OnClockActionBar` (the bar over the
 * thumb) each held their own `setInterval(500)` and each rendered
 * `ceil((deadline + offset - Date.now()) / 1000)`. Same deadline, same
 * offset, same rounding, same format — and still two different numbers on
 * screen, because the two intervals START at different moments. Each samples
 * `Date.now()` on its own phase, so for up to half of every second one of
 * them has crossed a whole-second boundary and the other has not.
 *
 * Measured on `harness/draft.html` at 393x852 on 2026-09-02: header 00:27,
 * bar 00:28, in the same screenshot.
 *
 * The 2026-09-01 iPhone-sim pass fixed the ROUNDING (one floored, one
 * ceiled) and the FORMAT (`0:20` against `00:19`), and `draftRoomMobileGuard`
 * pins both. Neither touched the sampling phase, which is the half of the
 * defect that survives when the arithmetic already agrees.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FIX
 *
 * Sample on the DEADLINE'S OWN second boundaries instead of on an arbitrary
 * phase: schedule the next wake for the exact moment the displayed value
 * changes. Every consumer of the same `(deadline, offset)` pair then
 * recomputes at the same instants, so they cannot straddle a boundary in
 * opposite directions.
 *
 * It also halves the work: one wake per displayed second instead of two.
 *
 * `maxIntervalMs` is a ceiling on the gap between samples, not the cadence.
 * It keeps the clock honest if the tab is throttled or the machine sleeps
 * through a boundary, and it is what `DraftTimerV2`'s `tickMs` prop feeds.
 */
export function useCountdownNow(
  deadlineMs: number | null,
  offsetMs: number,
  maxIntervalMs = 500,
): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadlineMs === null || !Number.isFinite(deadlineMs)) return;
    let handle: number | undefined;

    /**
     * NO CUSHION PAST THE BOUNDARY, DELIBERATELY.
     *
     * An earlier cut added 8ms "so the wake lands after the boundary rather
     * than a millisecond short of it". That reintroduced the whole defect at
     * a smaller scale: a component that lands exactly on the boundary and one
     * that lands 8ms later disagree for those 8ms, and a 170ms-stepped test
     * caught it on the first try.
     *
     * Landing exactly on the boundary is correct, not early: the displayed
     * `ceil((deadline - now) / 1000)` changes AT the boundary, so a sample
     * taken there already sees the new value. Real timers fire late, never
     * early, which only ever moves the sample further into the new second;
     * and if one somehow fired a fraction early, the value is unchanged and
     * the next wake is scheduled for the remaining fraction, so it corrects
     * itself in a millisecond.
     *
     * `maxIntervalMs` caps the WAIT, never the boundary: when the boundary is
     * further out than the cap we wake early, recompute, and converge on the
     * boundary exactly. That is what keeps the clock honest through a
     * throttled tab without putting the two components back out of phase.
     */
    const schedule = (from: number) => {
      const untilBoundary = msUntilNextSecondBoundary(deadlineMs + offsetMs, from);
      return Math.max(1, Math.min(untilBoundary, maxIntervalMs));
    };

    const wake = () => {
      const sampledAt = Date.now();
      setNow(sampledAt);
      handle = window.setTimeout(wake, schedule(sampledAt));
    };

    handle = window.setTimeout(wake, schedule(Date.now()));
    return () => {
      if (handle !== undefined) window.clearTimeout(handle);
    };
  }, [deadlineMs, offsetMs, maxIntervalMs]);

  return now;
}

/**
 * Milliseconds from `now` until `ceil((adjustedDeadlineMs - now) / 1000)`
 * next changes value.
 *
 * The displayed second changes whenever `adjustedDeadlineMs - now` crosses a
 * multiple of 1000, so the distance to the next crossing is the remainder of
 * that difference. A remainder of exactly 0 means we are standing on a
 * boundary and the next one is a full second away.
 *
 * Exported for the test, which is the only way to pin an off-by-one here
 * that no screenshot would ever show.
 */
export function msUntilNextSecondBoundary(adjustedDeadlineMs: number, nowMs: number): number {
  const remaining = adjustedDeadlineMs - nowMs;
  // Deadline already passed: the value is pinned at 0 and nothing changes,
  // but we still wake once a second so a new deadline is picked up promptly.
  if (remaining <= 0) return 1000;
  const remainder = remaining % 1000;
  return remainder === 0 ? 1000 : remainder;
}

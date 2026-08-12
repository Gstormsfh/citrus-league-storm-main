// Phase 4.5 chunk 11g.5a — exponential backoff with jitter.
//
// Industry-standard reconnect cadence: each retry doubles the delay
// up to a cap, with ±20% jitter to avoid thundering-herd reconnect
// storms (every client sees the same network blip and would otherwise
// retry simultaneously).
//
// Sleeper / Discord / Slack all use the same general pattern (start
// ~1s, double, cap at 30s, ±10-30% jitter). Constants below are
// calibrated for fantasy-draft volume; chunk 11g.11 load test may
// revisit if real-world reconnect distributions surface a better
// curve.

/** Base delay before first reconnect attempt. */
export const INITIAL_BACKOFF_MS = 1000;

/** Hard cap on delay between attempts. */
export const MAX_BACKOFF_MS = 30000;

/** Each attempt multiplies the previous delay by this factor. */
export const BACKOFF_MULTIPLIER = 2;

/** Jitter range ±20% — random factor in [-0.2, +0.2]. */
export const JITTER_FACTOR = 0.2;

/**
 * ARCHITECT 2026-08-12 (LOBBY-WAIT / inbox E124). Poll interval used
 * ONLY while discovery reports `draft_status = 'not_started'`.
 *
 * This case is categorically different from an error. Nothing is
 * broken: the commissioner simply has not pressed START yet, and the
 * manager is sitting in the room waiting for him. Two consequences
 * follow, and they pull in opposite directions from the error curve:
 *
 *   1. It must NOT escalate. If a manager who opened the room ten
 *      minutes early were on a 30s backoff at the moment of ignition,
 *      he would stare at a dead screen for up to 30 seconds while the
 *      other eleven were already picking. Responsiveness at ignition
 *      is the whole point of the room.
 *   2. It must not hammer. A flat ~1s retry (the pre-fix behaviour)
 *      is 60 requests per minute per waiting client, every one of
 *      them a 409 with a DB read behind it.
 *
 * 3s is the compromise: worst-case 3s of dead air after the
 * commissioner starts, and a fifth of the request volume. Jittered
 * like every other delay so twelve clients don't align on one tick.
 */
export const NOT_STARTED_POLL_MS = 3000;

/**
 * Compute the backoff delay for the given retry attempt. `attempt`
 * is 0-indexed: attempt 0 is the FIRST reconnect (after the initial
 * connection failed), so the first retry waits ~1s, the second ~2s,
 * the third ~4s, etc., capped at 30s.
 *
 * `randomFn` is injectable for deterministic testing — defaults to
 * `Math.random`. Tests pass a seeded RNG to assert exact values.
 *
 * @returns delay in milliseconds, always positive.
 */
export function computeBackoffMs(
  attempt: number,
  randomFn: () => number = Math.random,
): number {
  const baseDelay = Math.min(
    MAX_BACKOFF_MS,
    INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, attempt),
  );
  // jitter in [-JITTER_FACTOR, +JITTER_FACTOR]
  const jitter = (randomFn() * 2 - 1) * JITTER_FACTOR;
  // Keep result strictly positive even if jitter is at the negative
  // extreme — JITTER_FACTOR=0.2 means worst-case multiplier is 0.8,
  // which keeps the value > 0 for any positive baseDelay.
  return Math.max(0, Math.round(baseDelay * (1 + jitter)));
}

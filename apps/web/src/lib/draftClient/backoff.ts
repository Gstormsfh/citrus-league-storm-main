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

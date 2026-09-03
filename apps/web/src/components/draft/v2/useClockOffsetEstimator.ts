// Clock-offset estimator, extracted from DraftTimerV2.tsx (2026-09-03).
//
// A hook is not a component, so exporting it beside one trips
// react-refresh/only-export-components: Vite then cannot hot-swap the timer
// without a full page reload, which during a live draft means losing the
// room's mounted state to edit a label. Same reason PresenceDot's pure half
// moved to presenceStatus.ts.
//
// Body is unchanged, byte for byte.

import { useMemo, useRef, useState } from 'react';

/**
 * Chunk 10c-2 batch 3 C2 helper: rolling clock-offset estimator.
 *
 * Blends every event frame's (clientReceiveTs - serverTs) into an
 * exponential moving average. The first frame seeds the estimate;
 * subsequent frames refine it with alpha=0.3 (heavy smoothing —
 * absorbs per-frame network jitter).
 *
 * Call `updateOffset` from your event handler with `Date.now()` for
 * `clientReceiveMs` and `new Date(frame.timestamp).getTime()` for
 * `serverMs`. Read `offsetMs` inside the timer prop.
 */
/**
 * TIMER-2 (2026-08-12) — largest device clock skew we will believe.
 *
 * Real consumer machines sit within a few seconds of true time. A reading
 * beyond this is not skew, it is a bad input, and acting on it can freeze
 * the draft clock. See the guard in `updateOffset`.
 */
const MAX_PLAUSIBLE_CLOCK_SKEW_MS = 30_000;

export function useClockOffsetEstimator(): {
  offsetMs: number;
  updateOffset: (clientReceiveMs: number, serverMs: number) => void;
} {
  const [offsetMs, setOffsetMs] = useState(0);
  const seededRef = useRef(false);
  const updateOffset = useMemo(
    () => (clientReceiveMs: number, serverMs: number) => {
      const frameOffset = clientReceiveMs - serverMs;
      if (!Number.isFinite(frameOffset)) return;
      // TIMER-2 (2026-08-12) — plausibility guard.
      //
      // This estimator corrects for DEVICE CLOCK SKEW, which is seconds,
      // not minutes: an unsynced consumer machine drifts a few seconds a
      // week, and anything past ~30s means we were handed a timestamp that
      // is not "the server's clock right now".
      //
      // That is exactly what used to happen. Callers seeded it from an
      // EVENT timestamp, so the "offset" became the age of the last pick.
      // A +80s reading pushed the deadline 80s into the future, the
      // display clamp pinned at `pickTimeLimitSec`, and the draft clock
      // froze — field-confirmed on a 600s clock showing a motionless
      // 10:00 while the server had 520s left.
      //
      // The bad callers are fixed (see DraftRoomV2). This guard is the
      // backstop so no future caller can freeze a live draft clock by
      // feeding it the wrong kind of timestamp. Discarding a suspect
      // reading costs at most a few seconds of skew correction; accepting
      // one costs the manager their turn.
      if (Math.abs(frameOffset) > MAX_PLAUSIBLE_CLOCK_SKEW_MS) return;
      setOffsetMs((prev) => {
        if (!seededRef.current) {
          seededRef.current = true;
          return frameOffset;
        }
        // EMA with alpha=0.3 — smooths per-frame jitter, still
        // responsive enough to track slow clock drift over minutes.
        return prev * 0.7 + frameOffset * 0.3;
      });
    },
    [],
  );
  return { offsetMs, updateOffset };
}

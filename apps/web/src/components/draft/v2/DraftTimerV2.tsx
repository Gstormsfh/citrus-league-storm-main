// Phase 4.5 chunk 10c-2 batch 3 C2 (2026-07-28) — v2 draft timer.
//
// Renders a countdown driven EXCLUSIVELY by server truth:
//
//   - Initial deadline from `stateSnapshot.currentPickDeadline`
//     received in the snapshot-on-connect frame.
//   - Re-armed from `pickDeadline` in every subsequent `pick_submitted`
//     event frame (batch 2 wire schema; batch 3 client hookup lives
//     in `draftClientStore.applyEvent`).
//   - Local tick between frames at 500 ms cadence (fine enough for a
//     second-granularity countdown; light on the render cost).
//
// Clock-skew correction:
//
//   Operator observations show ~0.5-0.6 s drift between the client
//   workstation clock and the staging engine. Uncorrected, the
//   countdown would visibly diverge from the engine's actual autopick
//   moment. Correction: on every event frame (which carries the
//   server timestamp), compute `frameOffsetMs = clientReceiveTs -
//   serverTs`. Blend into a rolling EMA. Apply to the deadline as
//   `adjustedDeadlineClientMs = new Date(serverDeadline).getTime() +
//   offsetMs`, then remaining = `adjustedDeadlineClientMs -
//   Date.now()`.
//
// Semantics:
//
//   - Clamped at 0:00 while awaiting the autopick frame (never
//     negative — a "0:00" display with a subtle "Awaiting server…"
//     annotation reads correctly even when the autopick lags a few
//     hundred ms).
//   - Hidden entirely when the snapshot indicates no active deadline
//     (draftStatus in {not_started, completed, cancelled}, or
//     currentPickDeadline is null).
//   - Stale indicator when the WS is not open (server can't push
//     re-arms). Visual: dimmed timer + "reconnecting…" annotation.
//
// v1 `DraftTimer.tsx` is unchanged — the legacy path still serves
// live users via `/draft` and `/draft-room`. This component is only
// rendered from `DraftRoomV2` at `/draft-v2/*`.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Clock, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DraftTimerV2Props {
  /**
   * Server-authoritative deadline for the current pick, as ISO 8601.
   * From `stateSnapshot.currentPickDeadline`. Null while no active
   * pick (not_started / completed / cancelled — component hides).
   */
  currentPickDeadline: string | null;
  /**
   * Draft status from the snapshot. Used to hide the timer for
   * non-active statuses even when `currentPickDeadline` lingers.
   */
  draftStatus: 'not_started' | 'in_progress' | 'paused' | 'completed' | 'cancelled';
  /**
   * True while the WS runner has an active connected socket. When
   * false, the timer renders a stale indicator so operators can see
   * that the countdown is running against a potentially-stale
   * deadline (server can't push re-arms until reconnect).
   */
  wsOpen: boolean;
  /**
   * Rolling estimate of `clientMs - serverMs` at the most-recent
   * event frame receipt. Positive means the client clock runs ahead
   * of the server clock. Adjusts the countdown so it matches the
   * server's true remaining time.
   *
   * See the comment at top of file for the correction math.
   */
  clockOffsetMs: number;
  /**
   * Entry 87 Fix C (CLOCK-DISPLAY-35) — the per-pick countdown
   * window in seconds, extracted from the draft_started event.
   * Authoritative upper bound on the rendered value: even if a
   * stale deadline or an uncorrected clock skew would compute a
   * higher `remainingSec`, the display is clamped to this cap. Null
   * before draft_started has been observed; when null, no clamp is
   * applied and the estimator-corrected raw value renders.
   */
  pickTimeLimitSec?: number | null;
  /**
   * Tick cadence in milliseconds. Default 500. Tests may pass a
   * larger value to reduce re-render churn.
   */
  tickMs?: number;
  /**
   * MOBILE PASS (2026-09-01): 'card' is the original standalone Card
   * (label row + big number). 'compact' is a one-line pill for the
   * sticky header — icon + mm:ss only — so the header fits a phone
   * viewport without burying the player list under chrome. Same
   * countdown math, same role="timer", same aria-label either way.
   */
  variant?: 'card' | 'compact';
}

export const DraftTimerV2 = memo(
  ({
    currentPickDeadline,
    draftStatus,
    wsOpen,
    clockOffsetMs,
    pickTimeLimitSec = null,
    tickMs = 500,
    variant = 'card',
  }: DraftTimerV2Props) => {
    const [now, setNow] = useState(() => Date.now());
    const rafRef = useRef<number | null>(null);

    // Local tick: setInterval at tickMs cadence. Only runs when a
    // deadline is present; short-circuits to a no-op otherwise.
    useEffect(() => {
      if (currentPickDeadline === null) return;
      const handle = window.setInterval(() => {
        setNow(Date.now());
      }, tickMs);
      return () => window.clearInterval(handle);
    }, [currentPickDeadline, tickMs]);

    const remainingSec = useMemo(() => {
      if (currentPickDeadline === null) return null;
      const parsed = new Date(currentPickDeadline).getTime();
      if (Number.isNaN(parsed)) return null;
      const adjustedDeadlineMs = parsed + clockOffsetMs;
      const raw = adjustedDeadlineMs - now;
      // Clamp at 0 — never render a negative countdown. Autopick
      // frame arrives shortly after 0:00 hits.
      //
      // CEIL, not floor (2026-09-01, iPhone sim audit): this component
      // floored while OnClockActionBar ceiled, so the two clocks on
      // screen permanently disagreed by one second (header 00:19, bar
      // 0:20 — screenshotted by the founder). Ceil is the correct
      // countdown convention on top of that: a freshly armed 30s clock
      // reads 00:30 (floor showed 00:29 the instant it armed), and
      // 00:00 renders only once the deadline has truly passed instead
      // of for the entire final second — which matters because 00:00
      // is what triggers the "Awaiting server…" annotation.
      const nonNegative = Math.max(0, Math.ceil(raw / 1000));
      // Entry 87 Fix C — clamp to pick_time_limit_seconds when known.
      // Server truth: a fresh pick's deadline is exactly N seconds
      // from arm, so remaining can never exceed N by construction.
      // Any value above N indicates client-side skew we couldn't
      // fully correct or a stale deadline; the cap ensures the
      // number Garrett sees is honest.
      if (pickTimeLimitSec !== null && pickTimeLimitSec > 0) {
        return Math.min(nonNegative, pickTimeLimitSec);
      }
      return nonNegative;
    }, [currentPickDeadline, clockOffsetMs, now, pickTimeLimitSec]);

    // Hide entirely when there's no active deadline OR the draft
    // isn't in a state that can consume it.
    if (
      currentPickDeadline === null ||
      remainingSec === null ||
      (draftStatus !== 'in_progress' && draftStatus !== 'paused')
    ) {
      return null;
    }

    const minutes = Math.floor(remainingSec / 60);
    const seconds = remainingSec % 60;
    const label = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    // Color hint at low time. Matches v1 DraftTimer's thresholds
    // (green > 33%, orange > 11%, red else) but the v2 component
    // doesn't know pickTimeLimit — use fixed absolute thresholds:
    // > 30s green, > 10s orange, else red.
    const colorClass =
      remainingSec > 30
        ? 'text-green-600'
        : remainingSec > 10
          ? 'text-orange-600'
          : 'text-red-600';

    if (variant === 'compact') {
      return (
        <div
          role="timer"
          aria-label={`Draft timer: ${minutes} minutes ${seconds} seconds remaining${wsOpen ? '' : ' (connection lost)'}`}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1',
            !wsOpen && 'opacity-60',
          )}
        >
          {wsOpen ? (
            <Clock className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          )}
          <span className={cn('text-base font-bold tabular-nums leading-none', colorClass)}>
            {label}
          </span>
        </div>
      );
    }

    return (
      <Card
        className={cn('p-4 min-w-[140px]', !wsOpen && 'opacity-60')}
        role="timer"
        aria-label={`Draft timer: ${minutes} minutes ${seconds} seconds remaining${wsOpen ? '' : ' (connection lost)'}`}
      >
        <div className="flex items-center gap-2 mb-2">
          {wsOpen ? (
            <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
          ) : (
            <WifiOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="text-sm font-medium">
            {wsOpen ? 'Time Left' : 'Reconnecting…'}
          </span>
        </div>
        <div className="text-center">
          <div
            className={cn('text-2xl font-bold tabular-nums', colorClass)}
            aria-hidden="true"
          >
            {label}
          </div>
          {remainingSec === 0 && wsOpen && (
            <div className="mt-1 text-xs text-muted-foreground">
              Awaiting server…
            </div>
          )}
        </div>
      </Card>
    );
  },
);

DraftTimerV2.displayName = 'DraftTimerV2';

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

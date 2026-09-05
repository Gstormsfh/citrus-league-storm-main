import { useMemo, type ReactNode } from 'react';
import { PressBoxDraftPickBar } from '@/components/pressbox/DraftPickBar';
import { useCountdownNow } from './countdownTick';
import { etaLabel, usePickPace } from './pickPace';

/**
 * THE PICK BAR WHEN IT IS NOT YOUR TURN (2026-09-04).
 *
 * Artboard 4a draws the bar on the clock; the handoff says what it reads
 * the rest of the time: `NEXT PICK 4.06 · 11 PICKS AWAY · ~8 MIN` with
 * `QUEUE` as the button. `OnClockActionBar` returns null off the clock and
 * this is the bar that stands in its place, so the bottom edge of the room
 * never goes empty — the one strip a manager glances at between picks says
 * when they are up, how long that is, and offers the one useful thing to
 * do in the meantime.
 *
 *   * THE EYEBROW is the handoff's line. `4.06` is the next pick of mine in
 *     the draft-order matrix, `11 PICKS AWAY` how many land before it, and
 *     the time is MEASURED (`pickPace.ts`): the median gap between the
 *     picks this session has watched land, or the ceiling the pick clock
 *     allows (`≤ 17 MIN`) until two have.
 *   * THE 34px FIGURE is the room's countdown — whoever is on the clock, it
 *     is the same deadline the header timer shows, on the same tick. It
 *     stays sage: grapefruit is for YOUR last ten seconds, and a number
 *     that shouts at you about someone else's clock is noise.
 *   * UNDER IT, whose turn it is: `Top Cheddar is up · Round 3 · Pick 31`.
 *   * THE VERB is `QUEUE` on a phone, where the queue is a tab. On a
 *     desktop the queue is already in the rail beside this bar, and the
 *     button is omitted rather than pointing at something on screen.
 *
 * Same mm:ss format as the on-clock bar and the header; same clamp to the
 * pick window. Every figure here is either from the matrix, from the
 * derived state, or measured on this machine — none is a guess.
 */

export interface OffClockBarProps {
  /** The on-clock deadline, ISO-8601; null renders `--:--`. */
  currentPickDeadline: string | null;
  clockOffsetMs?: number;
  pickTimeLimitSec?: number | null;
  /** Overall number of the pick on the clock. */
  pickNumber: number | null;
  roundNumber: number | null;
  /** Name of the team on the clock, when known. */
  onClockTeamName?: string | null;
  /**
   * The caller's next pick: its overall number and how many picks land
   * before it. `'none'` when the matrix says there are no more; `'unknown'`
   * before the matrix or the caller's team is known — which reads as
   * `NOT YOUR TURN`, never as a claim about picks that may exist.
   */
  nextPick: { number: number; picksAway: number } | 'none' | 'unknown';
  /** Teams per round — turns `myNextPickNumber` into `4.06`. */
  teamCount: number;
  picksMade?: number | null;
  totalPicks?: number | null;
  /** Players in the caller's queue. */
  queueCount?: number;
  /** Present on a phone: the QUEUE button, which opens the tab. */
  onOpenQueue?: () => void;
}

function formatCountdown(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return '00:00';
  const m = Math.floor(secondsRemaining / 60);
  const s = secondsRemaining % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function OffClockBar({
  currentPickDeadline,
  clockOffsetMs = 0,
  pickTimeLimitSec = null,
  pickNumber,
  roundNumber,
  onClockTeamName = null,
  nextPick,
  teamCount,
  picksMade = null,
  totalPicks = null,
  queueCount = 0,
  onOpenQueue,
}: OffClockBarProps) {
  const deadlineMs = useMemo(() => {
    if (!currentPickDeadline) return null;
    const parsed = new Date(currentPickDeadline).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }, [currentPickDeadline]);
  const nowMs = useCountdownNow(deadlineMs, clockOffsetMs);
  const paceSec = usePickPace(picksMade);

  const rawRemainingSec =
    deadlineMs !== null ? Math.max(0, Math.ceil((deadlineMs + clockOffsetMs - nowMs) / 1000)) : null;
  const secondsRemaining =
    rawRemainingSec !== null && pickTimeLimitSec !== null && pickTimeLimitSec > 0
      ? Math.min(rawRemainingSec, pickTimeLimitSec)
      : rawRemainingSec;

  const progress =
    picksMade !== null && totalPicks !== null && totalPicks > 0
      ? Math.min(1, Math.max(0, picksMade / totalPicks))
      : 0;

  let eyebrow: ReactNode = 'Not your turn';
  if (nextPick === 'none') {
    eyebrow = 'No picks left';
  } else if (nextPick !== 'unknown') {
    const { number, picksAway } = nextPick;
    const nextLabel =
      teamCount > 0
        ? `${Math.ceil(number / teamCount)}.${String(((number - 1) % teamCount) + 1).padStart(2, '0')}`
        : `#${number}`;
    const eta = etaLabel(picksAway, paceSec, pickTimeLimitSec);
    eyebrow = (
      <>
        Next pick {nextLabel}
        <span className="ml-1.5 opacity-75">
          &middot; {picksAway} {picksAway === 1 ? 'pick' : 'picks'} away
          {eta ? <> &middot; {eta}</> : null}
        </span>
      </>
    );
  }

  return (
    <div data-testid="off-clock-bar" role="region" aria-label="Waiting for your pick">
      <PressBoxDraftPickBar
        inline
        progress={progress}
        eyebrow={eyebrow}
        clock={secondsRemaining !== null ? formatCountdown(secondsRemaining) : '--:--'}
        clockTestId="off-clock-countdown"
        clockLabel={
          secondsRemaining !== null
            ? `${secondsRemaining} seconds left on the current pick`
            : 'No deadline'
        }
        actionLabel={onOpenQueue ? 'Queue' : undefined}
        actionDetail={
          onOpenQueue ? (queueCount > 0 ? `${queueCount} queued` : 'Set your order') : undefined
        }
        actionTestId="off-clock-queue-button"
        onAction={onOpenQueue}
      >
        <div className="font-barlow text-[12px] leading-[1.4] text-pressbox-text/70" data-testid="off-clock-turn">
          {onClockTeamName ? `${onClockTeamName} is up` : 'On the clock'}
          {pickNumber !== null && roundNumber !== null && (
            <span className="text-pressbox-text/50">
              {' '}
              &middot; Round {roundNumber} &middot; Pick {pickNumber}
            </span>
          )}
        </div>
      </PressBoxDraftPickBar>
    </div>
  );
}

export default OffClockBar;

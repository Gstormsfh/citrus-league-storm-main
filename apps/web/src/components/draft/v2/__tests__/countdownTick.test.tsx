/**
 * `countdownTick` — the shared sampling phase behind both draft countdowns.
 *
 * The defect this module fixes cannot be seen by rendering one component:
 * two clocks each ticked correctly and still disagreed, because their
 * `setInterval`s started at different moments. So the test is on the
 * scheduling arithmetic, plus a render-level proof that two components
 * fed the same inputs land on the same second.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, cleanup } from '@testing-library/react';
import { msUntilNextSecondBoundary } from '../countdownTick';
import { DraftTimerV2 } from '../DraftTimerV2';
import { OnClockActionBar } from '../OnClockActionBar';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('msUntilNextSecondBoundary', () => {
  it('is the distance to the next whole second of the REMAINING time', () => {
    // 30,000ms deadline, sampled at 0: the displayed ceil changes the instant
    // remaining drops below 30,000, which is 0ms away... no: remaining is
    // exactly 30,000, so we are standing on a boundary and the next is 1000
    // away.
    expect(msUntilNextSecondBoundary(30_000, 0)).toBe(1000);
    // 29,400ms remaining: the next crossing is at 29,000, i.e. 400ms out.
    expect(msUntilNextSecondBoundary(30_000, 600)).toBe(400);
    expect(msUntilNextSecondBoundary(30_000, 1)).toBe(999);
  });

  it('keeps waking once a second after the deadline has passed', () => {
    // The value is pinned at 0, but a new deadline has to be picked up
    // promptly, and a wake that never comes is a clock that never restarts.
    expect(msUntilNextSecondBoundary(1000, 5000)).toBe(1000);
    expect(msUntilNextSecondBoundary(1000, 1000)).toBe(1000);
  });

  it('never returns 0, which would busy-loop the scheduler', () => {
    for (let now = 0; now < 3000; now += 7) {
      expect(msUntilNextSecondBoundary(30_000, now)).toBeGreaterThan(0);
    }
  });
});

describe('the header timer and the on-clock bar cannot disagree', () => {
  /**
   * REGRESSION (2026-09-02, measured on `harness/draft.html` at 393x852):
   * header 00:27, bar 00:28, in one screenshot. Both ceiled, both rendered
   * mm:ss, both applied the same offset — and each held its own
   * `setInterval(500)` started at a different moment, so for up to half of
   * every second one had crossed a whole-second boundary and the other had
   * not.
   *
   * THE MOUNTS ARE DELIBERATELY 300ms APART. That is what makes this test
   * bite: two `setInterval(500)`s started together stay in phase forever and
   * agree in every fake-timer test, which is why the original defect
   * survived a suite that already had a "both agree" assertion. In the real
   * room the bar mounts when the manager comes on the clock, long after the
   * header timer did.
   */
  it('renders the same second at every step, even when mounted out of phase', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T18:00:00.000Z'));
    const deadline = '2026-09-28T18:00:30.000Z';

    render(
      <DraftTimerV2
        variant="compact"
        currentPickDeadline={deadline}
        draftStatus="in_progress"
        wsOpen={true}
        clockOffsetMs={0}
        pickTimeLimitSec={30}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(300);
    });
    render(
      <OnClockActionBar
        amIOnClock={true}
        currentPickDeadline={deadline}
        clockOffsetMs={0}
        pickTimeLimitSec={30}
        selectedPlayer={null}
        onDraft={() => {}}
        pickNumber={24}
        roundNumber={2}
      />,
    );

    const barText = () => screen.getByTestId('on-clock-countdown').textContent ?? '';
    // The compact header timer has no testid; `role="timer"` is its contract.
    const headerText = () => screen.getByRole('timer').textContent ?? '';

    // 170ms steps deliberately land either side of whole-second boundaries.
    for (let step = 0; step < 40; step++) {
      const bar = barText();
      const header = headerText();
      expect(header, `step ${step} (t+${step * 170}ms): header "${header}" vs bar "${bar}"`).toBe(
        bar,
      );
      act(() => {
        vi.advanceTimersByTime(170);
      });
    }
  });
});

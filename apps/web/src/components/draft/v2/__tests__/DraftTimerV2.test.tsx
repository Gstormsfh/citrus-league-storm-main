// Phase 4.5 chunk 10c-2 batch 3 C2 (2026-07-28) — DraftTimerV2 tests.
//
// React Testing Library + accessibility-driven queries; matches the
// ConnectionBanner.test.tsx convention. Covers:
//   - Hidden when no active deadline
//   - Hidden when draftStatus is completed / cancelled / not_started
//   - Countdown renders and ticks on active deadline
//   - Clock-skew correction applied to the displayed value
//   - Clamped at 0:00 (never negative)
//   - Stale indicator when wsOpen is false

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DraftTimerV2 } from '../DraftTimerV2';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DraftTimerV2 visibility gating', () => {
  it('renders nothing when currentPickDeadline is null', () => {
    const { container } = render(
      <DraftTimerV2
        currentPickDeadline={null}
        draftStatus="in_progress"
        wsOpen={true}
        clockOffsetMs={0}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when draftStatus is not_started', () => {
    const { container } = render(
      <DraftTimerV2
        currentPickDeadline="2026-07-28T12:00:30.000Z"
        draftStatus="not_started"
        wsOpen={true}
        clockOffsetMs={0}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when draftStatus is completed', () => {
    const { container } = render(
      <DraftTimerV2
        currentPickDeadline="2026-07-28T12:00:30.000Z"
        draftStatus="completed"
        wsOpen={true}
        clockOffsetMs={0}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when draftStatus is cancelled', () => {
    const { container } = render(
      <DraftTimerV2
        currentPickDeadline="2026-07-28T12:00:30.000Z"
        draftStatus="cancelled"
        wsOpen={true}
        clockOffsetMs={0}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders when draftStatus is in_progress and deadline is future', () => {
    render(
      <DraftTimerV2
        currentPickDeadline="2026-07-28T12:00:30.000Z"
        draftStatus="in_progress"
        wsOpen={true}
        clockOffsetMs={0}
      />,
    );
    expect(screen.getByRole('timer')).toBeInTheDocument();
  });
});

describe('DraftTimerV2 countdown value', () => {
  it('displays remaining seconds derived from server deadline minus client now', () => {
    // Deadline is exactly 30 seconds after the frozen system time.
    render(
      <DraftTimerV2
        currentPickDeadline="2026-07-28T12:00:30.000Z"
        draftStatus="in_progress"
        wsOpen={true}
        clockOffsetMs={0}
      />,
    );
    // 30s = 00:30
    expect(screen.getByRole('timer')).toHaveTextContent('00:30');
  });

  it('ticks down as time advances', () => {
    render(
      <DraftTimerV2
        currentPickDeadline="2026-07-28T12:00:30.000Z"
        draftStatus="in_progress"
        wsOpen={true}
        clockOffsetMs={0}
        tickMs={500}
      />,
    );
    expect(screen.getByRole('timer')).toHaveTextContent('00:30');
    act(() => {
      vi.advanceTimersByTime(10_000); // +10s
    });
    expect(screen.getByRole('timer')).toHaveTextContent('00:20');
  });

  it('clamps at 00:00 when the deadline has passed', () => {
    // Deadline is 5 seconds in the past.
    render(
      <DraftTimerV2
        currentPickDeadline="2026-07-28T11:59:55.000Z"
        draftStatus="in_progress"
        wsOpen={true}
        clockOffsetMs={0}
      />,
    );
    expect(screen.getByRole('timer')).toHaveTextContent('00:00');
  });

  it('applies clock-skew correction to the displayed value', () => {
    // Client clock is 3s AHEAD of server (clientMs - serverMs = +3000).
    // Server deadline says 12:00:30; without correction, client shows
    // 30s remaining. With correction, client should show 33s remaining
    // (because the server's 12:00:30 corresponds to client's 12:00:33).
    render(
      <DraftTimerV2
        currentPickDeadline="2026-07-28T12:00:30.000Z"
        draftStatus="in_progress"
        wsOpen={true}
        clockOffsetMs={3000}
      />,
    );
    expect(screen.getByRole('timer')).toHaveTextContent('00:33');
  });
});

describe('DraftTimerV2 pickTimeLimitSec clamp (Entry 87 Fix C — CLOCK-DISPLAY-35)', () => {
  // Root cause pin: even with the clock-offset estimator seeded on
  // snapshot receipt, a stale deadline (e.g., server sent a deadline
  // that landed after the pick was already re-armed) or an under-
  // corrected client skew could compute a remaining value ABOVE the
  // per-pick window. The clamp is defense-in-depth: the display
  // physically cannot exceed pick_time_limit_seconds.

  it('clamps rendered value to pickTimeLimitSec when raw remaining exceeds it', () => {
    // Deadline is 45s away; client clock is 5s behind server (offset
    // -5000 means clientMs is BEHIND serverMs so uncorrected diff
    // would over-report). With clockOffsetMs=-5000, adjusted
    // deadline = parsed - 5000 → remaining = 40s. Cap at 30s should
    // clamp the display to 00:30.
    render(
      <DraftTimerV2
        currentPickDeadline="2026-07-28T12:00:45.000Z"
        draftStatus="in_progress"
        wsOpen={true}
        clockOffsetMs={-5000}
        pickTimeLimitSec={30}
      />,
    );
    expect(screen.getByRole('timer')).toHaveTextContent('00:30');
  });

  it('leaves value untouched when raw remaining is under pickTimeLimitSec', () => {
    // Deadline is 20s away; cap is 30s. Should still render 00:20.
    render(
      <DraftTimerV2
        currentPickDeadline="2026-07-28T12:00:20.000Z"
        draftStatus="in_progress"
        wsOpen={true}
        clockOffsetMs={0}
        pickTimeLimitSec={30}
      />,
    );
    expect(screen.getByRole('timer')).toHaveTextContent('00:20');
  });

  it('does not clamp when pickTimeLimitSec is null (pre-draft_started)', () => {
    // Before the draft_started event has been observed, no cap is
    // applied — the estimator-corrected raw value renders. 45s + 0
    // offset → 00:45.
    render(
      <DraftTimerV2
        currentPickDeadline="2026-07-28T12:00:45.000Z"
        draftStatus="in_progress"
        wsOpen={true}
        clockOffsetMs={0}
        pickTimeLimitSec={null}
      />,
    );
    expect(screen.getByRole('timer')).toHaveTextContent('00:45');
  });

  it('discriminant lock: 30s deadline with 5s-slow client renders 0:30 (not 0:35)', () => {
    // The exact scenario Garrett witnessed on Run 3: server armed a
    // 30s deadline, his client clock ran 5s behind server. Pre-fix,
    // useClockOffsetEstimator was useState(0) and unseeded on
    // snapshot receipt → first paint computed 30 - (-5) = 35s. Post-
    // fix path in DraftRoomV2 seeds the estimator on snapshot receipt
    // so clockOffsetMs arrives here already-corrected as -5000ms
    // (client is BEHIND server, so localNow underestimates serverNow,
    // and adjusted deadline needs to shift back). With the estimator
    // seeded to -5000, the raw remaining is 30 - 5 = 25s; the
    // pickTimeLimitSec=30 clamp holds; display reads 00:25.
    //
    // The clamp separately guarantees the display can never EXCEED
    // 00:30 regardless of the estimator's state — that's the belt to
    // the estimator's suspenders. This test asserts the belt: with
    // no offset applied (worst-case: estimator never seeded), the
    // pre-fix bug produced 00:35 for a 35s raw remaining, but the
    // clamp forces 00:30.
    render(
      <DraftTimerV2
        currentPickDeadline="2026-07-28T12:00:35.000Z"
        draftStatus="in_progress"
        wsOpen={true}
        clockOffsetMs={0}
        pickTimeLimitSec={30}
      />,
    );
    expect(screen.getByRole('timer')).toHaveTextContent('00:30');
  });

  it('clamp respects negative clock, still 0:00 when past deadline', () => {
    render(
      <DraftTimerV2
        currentPickDeadline="2026-07-28T11:59:55.000Z"
        draftStatus="in_progress"
        wsOpen={true}
        clockOffsetMs={0}
        pickTimeLimitSec={30}
      />,
    );
    expect(screen.getByRole('timer')).toHaveTextContent('00:00');
  });
});

describe('DraftTimerV2 stale indicator', () => {
  it('renders with reduced opacity when wsOpen is false', () => {
    render(
      <DraftTimerV2
        currentPickDeadline="2026-07-28T12:00:30.000Z"
        draftStatus="in_progress"
        wsOpen={false}
        clockOffsetMs={0}
      />,
    );
    const timer = screen.getByRole('timer');
    // The Card component receives the opacity-60 class when wsOpen=false.
    expect(timer.className).toContain('opacity-60');
    // aria-label reflects the connection loss.
    expect(timer.getAttribute('aria-label')).toContain('connection lost');
  });

  it('renders full-opacity when wsOpen is true', () => {
    render(
      <DraftTimerV2
        currentPickDeadline="2026-07-28T12:00:30.000Z"
        draftStatus="in_progress"
        wsOpen={true}
        clockOffsetMs={0}
      />,
    );
    const timer = screen.getByRole('timer');
    expect(timer.className).not.toContain('opacity-60');
    expect(timer.getAttribute('aria-label')).not.toContain('connection lost');
  });
});

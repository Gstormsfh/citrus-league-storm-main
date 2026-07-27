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

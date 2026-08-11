// DR-3.1 (2026-07-29) — OnClockActionBar tests.
//
// Contract enforced by these tests:
//   1. Renders NOTHING when off-clock (amIOnClock=false) — off-clock
//      users see no bar at all.
//   2. Renders the bar when on-clock, with:
//        - "You're on the clock" label
//        - Countdown from currentPickDeadline
//        - Selected player name when one is passed
//        - Draft button ENABLED only when selectedPlayer is non-null
//   3. Clicking the enabled Draft button fires onDraft with the
//      selected player (proves the DR-2 submit path plumbing).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { OnClockActionBar } from '../OnClockActionBar';
import type { Player } from '@/services/PlayerService';

afterEach(() => {
  cleanup();
});

function mkPlayer(over: Partial<Player> = {}): Player {
  return {
    id: '8478050',
    full_name: 'Auston Matthews',
    position: 'C',
    eligible_positions: ['C'],
    team: 'TOR',
    jersey_number: null,
    status: null,
    headshot_url: null,
    last_updated: null,
    games_played: 0,
    goals: 0,
    assists: 0,
    points: 0,
    plus_minus: 0,
    shots: 0,
    hits: 0,
    blocks: 0,
    xGoals: 0,
    wins: null,
    losses: null,
    ot_losses: null,
    saves: null,
    goals_against_average: null,
    save_percentage: null,
    highDangerSavePct: 0,
    goalsSavedAboveExpected: 0,
    ...over,
  };
}

describe('OnClockActionBar', () => {
  it('renders nothing when amIOnClock=false', () => {
    const { container } = render(
      <OnClockActionBar
        amIOnClock={false}
        currentPickDeadline={new Date(Date.now() + 60_000).toISOString()}
        selectedPlayer={mkPlayer()}
        onDraft={vi.fn()}
        pickNumber={3}
        roundNumber={1}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('on-clock-action-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('on-clock-draft-button')).not.toBeInTheDocument();
  });

  it('renders the bar with countdown and pick info when on-clock', () => {
    const deadline = new Date(Date.now() + 47_000).toISOString();
    render(
      <OnClockActionBar
        amIOnClock={true}
        currentPickDeadline={deadline}
        selectedPlayer={null}
        onDraft={vi.fn()}
        pickNumber={3}
        roundNumber={1}
      />,
    );
    expect(screen.getByTestId('on-clock-action-bar')).toBeInTheDocument();
    expect(screen.getByText(/you're on the clock/i)).toBeInTheDocument();
    expect(screen.getByText(/round 1/i)).toBeInTheDocument();
    expect(screen.getByText(/pick 3/i)).toBeInTheDocument();
    // Countdown rounds up to seconds — ~47s from now should read 0:47
    // (or 0:46 depending on tick timing; allow either).
    const countdown = screen.getByTestId('on-clock-countdown').textContent ?? '';
    expect(countdown).toMatch(/^0:4[567]$/);
  });

  it('Draft button is DISABLED when no player is selected', () => {
    render(
      <OnClockActionBar
        amIOnClock={true}
        currentPickDeadline={new Date(Date.now() + 60_000).toISOString()}
        selectedPlayer={null}
        onDraft={vi.fn()}
        pickNumber={3}
        roundNumber={1}
      />,
    );
    const btn = screen.getByTestId('on-clock-draft-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/select a player/i)).toBeInTheDocument();
  });

  it('Draft button is ENABLED when a player is selected + shows the name', () => {
    render(
      <OnClockActionBar
        amIOnClock={true}
        currentPickDeadline={new Date(Date.now() + 60_000).toISOString()}
        selectedPlayer={mkPlayer({ full_name: 'Connor McDavid', position: 'C', team: 'EDM' })}
        onDraft={vi.fn()}
        pickNumber={3}
        roundNumber={1}
      />,
    );
    const btn = screen.getByTestId('on-clock-draft-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(screen.getByText(/connor mcdavid/i)).toBeInTheDocument();
    expect(screen.getByText(/\(c · EDM\)/i)).toBeInTheDocument();
  });

  it('clicking the Draft button fires onDraft with the selected player', () => {
    const onDraft = vi.fn();
    const p = mkPlayer({ full_name: 'Draisaitl', id: '8477934' });
    render(
      <OnClockActionBar
        amIOnClock={true}
        currentPickDeadline={new Date(Date.now() + 60_000).toISOString()}
        selectedPlayer={p}
        onDraft={onDraft}
        pickNumber={3}
        roundNumber={1}
      />,
    );
    fireEvent.click(screen.getByTestId('on-clock-draft-button'));
    expect(onDraft).toHaveBeenCalledTimes(1);
    expect(onDraft).toHaveBeenCalledWith(p);
  });

  it('countdown reads 0:00 when the deadline has passed', () => {
    render(
      <OnClockActionBar
        amIOnClock={true}
        currentPickDeadline={new Date(Date.now() - 5_000).toISOString()}
        selectedPlayer={null}
        onDraft={vi.fn()}
        pickNumber={3}
        roundNumber={1}
      />,
    );
    expect(screen.getByTestId('on-clock-countdown').textContent).toBe('0:00');
  });

  // DR-4 F11 fix (2026-07-30) — isSubmitPending guard.
  it('disables Draft button and shows "Submitting…" when isSubmitPending=true', () => {
    render(
      <OnClockActionBar
        amIOnClock={true}
        currentPickDeadline={new Date(Date.now() + 60_000).toISOString()}
        selectedPlayer={mkPlayer()}
        onDraft={vi.fn()}
        pickNumber={3}
        roundNumber={1}
        isSubmitPending={true}
      />,
    );
    const btn = screen.getByTestId('on-clock-draft-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('Submitting…');
  });

  it('does NOT fire onDraft when isSubmitPending=true (defense-in-depth)', () => {
    const onDraft = vi.fn();
    render(
      <OnClockActionBar
        amIOnClock={true}
        currentPickDeadline={new Date(Date.now() + 60_000).toISOString()}
        selectedPlayer={mkPlayer()}
        onDraft={onDraft}
        pickNumber={3}
        roundNumber={1}
        isSubmitPending={true}
      />,
    );
    fireEvent.click(screen.getByTestId('on-clock-draft-button'));
    expect(onDraft).not.toHaveBeenCalled();
  });

  it('renders "—:—" when currentPickDeadline is null', () => {
    render(
      <OnClockActionBar
        amIOnClock={true}
        currentPickDeadline={null}
        selectedPlayer={null}
        onDraft={vi.fn()}
        pickNumber={3}
        roundNumber={1}
      />,
    );
    expect(screen.getByTestId('on-clock-countdown').textContent).toBe('—:—');
  });

  // Entry 87 Fix C (CLOCK-DISPLAY-35) — the bar now consumes the
  // shared clockOffsetMs estimator + pickTimeLimitSec clamp so its
  // countdown matches DraftTimerV2's sticky-header timer.
  describe('Entry 87 Fix C — clock-offset + pickTimeLimitSec clamp', () => {
    it('applies clockOffsetMs to deadline (mirrors DraftTimerV2 math)', () => {
      // Deadline is 30s from now. clockOffsetMs=+3000 means client
      // is 3s ahead of server → adjusted deadline is +3s further out
      // in client time → 33s remaining. formatCountdown → '0:33'.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'));
      try {
        render(
          <OnClockActionBar
            amIOnClock={true}
            currentPickDeadline="2026-08-10T12:00:30.000Z"
            clockOffsetMs={3000}
            selectedPlayer={null}
            onDraft={vi.fn()}
            pickNumber={3}
            roundNumber={1}
          />,
        );
        expect(screen.getByTestId('on-clock-countdown').textContent).toBe('0:33');
      } finally {
        vi.useRealTimers();
      }
    });

    it('clamps rendered value to pickTimeLimitSec when raw exceeds it', () => {
      // Deadline is 45s from now (raw); pickTimeLimitSec=30 caps at
      // 30s → '0:30'.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'));
      try {
        render(
          <OnClockActionBar
            amIOnClock={true}
            currentPickDeadline="2026-08-10T12:00:45.000Z"
            pickTimeLimitSec={30}
            selectedPlayer={null}
            onDraft={vi.fn()}
            pickNumber={3}
            roundNumber={1}
          />,
        );
        expect(screen.getByTestId('on-clock-countdown').textContent).toBe('0:30');
      } finally {
        vi.useRealTimers();
      }
    });

    it('agrees with DraftTimerV2 for the same (deadline, offset, cap) tuple', () => {
      // Same scenario tested in DraftTimerV2's discriminant lock:
      // 35s deadline, 0 offset, 30s cap → 0:30. The two components
      // must render the same value frame-for-frame or the header +
      // sticky bar will show conflicting countdowns.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'));
      try {
        render(
          <OnClockActionBar
            amIOnClock={true}
            currentPickDeadline="2026-08-10T12:00:35.000Z"
            clockOffsetMs={0}
            pickTimeLimitSec={30}
            selectedPlayer={null}
            onDraft={vi.fn()}
            pickNumber={3}
            roundNumber={1}
          />,
        );
        expect(screen.getByTestId('on-clock-countdown').textContent).toBe('0:30');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

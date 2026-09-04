// THE BAR BETWEEN TURNS (2026-09-04).
//
// The handoff says the pick bar never leaves the bottom edge: on the clock
// it is the DRAFT verb, off it it reads `NEXT PICK 4.06 · 11 PICKS AWAY ·
// ~8 MIN` with QUEUE as the button. Before this, `OnClockActionBar`
// returned null off the clock and the edge went empty for eleven picks out
// of twelve. These pin the words, the arithmetic behind them, and the one
// rule about the ETA: it is measured or bounded, never invented.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { OffClockBar } from '../OffClockBar';
import { etaLabel, medianGapSec } from '../pickPace';

afterEach(() => {
  cleanup();
});

const base = {
  currentPickDeadline: null,
  pickNumber: 31,
  roundNumber: 3,
  onClockTeamName: 'Top Cheddar',
  teamCount: 12,
  picksMade: 30,
  totalPicks: 168,
};

describe('OffClockBar', () => {
  it('reads NEXT PICK round.pick · n PICKS AWAY, with the clock ceiling before a pace exists', () => {
    render(
      <OffClockBar {...base} nextPick={{ number: 42, picksAway: 11 }} pickTimeLimitSec={45} />,
    );
    const bar = screen.getByTestId('off-clock-bar');
    // 42 in a 12-team draft is round 4, pick 6.
    expect(bar.textContent).toMatch(/Next pick 4\.06/);
    expect(bar.textContent).toMatch(/11 picks away/);
    // 11 × 45s = 8.25 min, ceiled, and marked as a bound not a measurement.
    expect(bar.textContent).toMatch(/≤ 9 min/);
    expect(screen.getByTestId('off-clock-turn').textContent).toMatch(
      /Top Cheddar is up · Round 3 · Pick 31/,
    );
  });

  it('says NO PICKS LEFT when the matrix has none, and NOT YOUR TURN before it is known', () => {
    const { rerender } = render(<OffClockBar {...base} nextPick="none" />);
    expect(screen.getByTestId('off-clock-bar').textContent).toMatch(/No picks left/);
    rerender(<OffClockBar {...base} nextPick="unknown" />);
    expect(screen.getByTestId('off-clock-bar').textContent).toMatch(/Not your turn/);
    expect(screen.getByTestId('off-clock-bar').textContent).not.toMatch(/picks away/);
  });

  it('offers QUEUE only where the queue is a tab, with the count under it', () => {
    const { rerender } = render(
      <OffClockBar {...base} nextPick={{ number: 42, picksAway: 11 }} queueCount={3} />,
    );
    expect(screen.queryByTestId('off-clock-queue-button')).toBeNull();

    let opened = 0;
    rerender(
      <OffClockBar
        {...base}
        nextPick={{ number: 42, picksAway: 11 }}
        queueCount={3}
        onOpenQueue={() => {
          opened += 1;
        }}
      />,
    );
    const btn = screen.getByTestId('off-clock-queue-button');
    expect(btn.textContent).toMatch(/Queue/);
    expect(btn.textContent).toMatch(/3 queued/);
    fireEvent.click(btn);
    expect(opened).toBe(1);
  });

  it('prints the room clock in the header format and never claims a deadline it lacks', () => {
    const { rerender } = render(<OffClockBar {...base} nextPick="unknown" />);
    expect(screen.getByTestId('off-clock-countdown').textContent).toBe('--:--');
    rerender(
      <OffClockBar
        {...base}
        nextPick="unknown"
        currentPickDeadline={new Date(Date.now() + 65_000).toISOString()}
        pickTimeLimitSec={90}
      />,
    );
    expect(screen.getByTestId('off-clock-countdown').textContent).toMatch(/^0[01]:\d\d$/);
  });
});

describe('pickPace', () => {
  it('medianGapSec needs two stamps and takes the median, not the mean', () => {
    expect(medianGapSec([])).toBeNull();
    expect(medianGapSec([1_000])).toBeNull();
    expect(medianGapSec([0, 10_000])).toBe(10);
    // One manager ran the clock out (300s); the median ignores it.
    expect(medianGapSec([0, 20_000, 40_000, 340_000, 360_000])).toBe(20);
    expect(medianGapSec([0, 10_000, 40_000])).toBe(20);
  });

  it('etaLabel measures, bounds, or says nothing', () => {
    expect(etaLabel(11, 44, null)).toBe('~9 min');
    expect(etaLabel(2, 10, 90)).toBe('<1 min');
    expect(etaLabel(11, null, 45)).toBe('≤ 9 min');
    expect(etaLabel(11, null, null)).toBeNull();
    expect(etaLabel(0, 44, 45)).toBeNull();
  });
});

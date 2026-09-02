// TODAY STRIP (2026-09-01, Sleeper parity audit R1 + R5)
//
// What would be wrong rather than ugly: the strip showing the wrong numbers,
// turning amber for a manager who cannot act (demo, past date), offering
// Auto Lineup outside the amber state, or flashing "0/13 · proj 0.0" while
// projections load. The arithmetic itself is pinned in todaySummary.test.ts;
// this file pins how the strip reads it.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TodayStrip } from '../TodayStrip';
import type { TodaySummary } from '../todaySummary';

const summary = (over: Partial<TodaySummary> = {}): TodaySummary => ({
  startersPlaying: 9,
  starterSlots: 13,
  idleStarters: 2,
  emptySlots: 2,
  benchPlaying: 0,
  projected: 41.62,
  locked: 0,
  needsAttention: false,
  ...over,
});

const strip = () => screen.getByTestId('today-strip');

describe('TodayStrip — what it says', () => {
  it('reads starters / slots, bench with games and the projected total', () => {
    render(<TodayStrip summary={summary({ benchPlaying: 2 })} dayLabel="Today" />);
    expect(screen.getByTestId('strip-starters')).toHaveTextContent('9/13');
    expect(screen.getByTestId('strip-bench')).toHaveTextContent('2');
    expect(screen.getByTestId('strip-proj')).toHaveTextContent('41.6');
    expect(strip()).toHaveTextContent(/starters play/);
    expect(strip()).toHaveTextContent(/on bench with games/);
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('every number is set in the mono face with tabular figures', () => {
    render(<TodayStrip summary={summary({ benchPlaying: 1, locked: 3 })} dayLabel="Today" />);
    for (const id of ['strip-starters', 'strip-bench', 'strip-proj']) {
      const el = screen.getByTestId(id);
      expect(el).toHaveClass('font-jbmono');
      expect(el).toHaveClass('tabular-nums');
    }
  });

  it('singular "a game" for one bench player', () => {
    render(<TodayStrip summary={summary({ benchPlaying: 1 })} dayLabel="Today" />);
    expect(strip()).toHaveTextContent(/1 on bench with a game/);
  });

  it('past days read "played"', () => {
    render(<TodayStrip summary={summary()} dayLabel="Tue Oct 14" tense="past" />);
    expect(strip()).toHaveTextContent(/starters played/);
    expect(strip()).not.toHaveTextContent(/starters play\b/);
  });

  it('folds the locked count in — the blue banner is retired', () => {
    render(<TodayStrip summary={summary({ locked: 3 })} dayLabel="Today" />);
    expect(screen.getByTestId('strip-locked')).toHaveTextContent('3');
    expect(screen.getByTestId('strip-locked')).toHaveTextContent(/locked/);
  });

  it('omits the locked segment when nobody is locked', () => {
    render(<TodayStrip summary={summary({ locked: 0 })} dayLabel="Today" />);
    expect(screen.queryByTestId('strip-locked')).toBeNull();
  });

  it('carries a past day\'s read-only mark when asked — the phone chrome has no Viewing line for it (audit R4)', () => {
    render(<TodayStrip summary={summary()} dayLabel="Tue Oct 14" tense="past" readOnly />);
    expect(screen.getByTestId('strip-readonly')).toHaveTextContent(/read only/);
    expect(strip()).toHaveTextContent(/starters played/);
  });

  it('says nothing about read-only by default, and never while pending', () => {
    const { unmount } = render(<TodayStrip summary={summary()} dayLabel="Tue Oct 14" tense="past" />);
    expect(screen.queryByTestId('strip-readonly')).toBeNull();
    unmount();
    render(<TodayStrip summary={summary()} dayLabel="Tue Oct 14" tense="past" readOnly pending />);
    expect(screen.queryByTestId('strip-readonly')).toBeNull();
  });

  it('shows a pending line instead of zeros while projections load', () => {
    render(
      <TodayStrip
        summary={summary({ startersPlaying: 0, projected: 0, needsAttention: true })}
        dayLabel="Today"
        pending
        editable
        onAutoLineup={() => {}}
      />,
    );
    expect(strip()).toHaveAttribute('data-state', 'pending');
    expect(strip()).toHaveTextContent(/Checking who plays/);
    expect(screen.queryByTestId('strip-starters')).toBeNull();
    expect(screen.queryByRole('button', { name: /auto lineup/i })).toBeNull();
  });
});

describe('TodayStrip — the amber state', () => {
  it('turns amber and offers Auto Lineup when points are on the bench and the manager can act', () => {
    const onAutoLineup = vi.fn();
    render(
      <TodayStrip
        summary={summary({ benchPlaying: 2, needsAttention: true })}
        dayLabel="Today"
        editable
        onAutoLineup={onAutoLineup}
      />,
    );
    expect(strip()).toHaveAttribute('data-state', 'attention');
    expect(strip().className).toMatch(/bg-pastel-orange-soft\/10/);
    expect(strip().className).toMatch(/ring-pastel-orange-soft\/40/);
    fireEvent.click(screen.getByRole('button', { name: /auto lineup/i }));
    expect(onAutoLineup).toHaveBeenCalledTimes(1);
  });

  it('stays calm — no amber, no action — when the manager cannot act (demo, past date, best ball)', () => {
    render(
      <TodayStrip
        summary={summary({ benchPlaying: 2, needsAttention: true })}
        dayLabel="Today"
        editable={false}
        onAutoLineup={() => {}}
      />,
    );
    expect(strip()).toHaveAttribute('data-state', 'calm');
    expect(strip().className).not.toMatch(/orange-soft/);
    expect(screen.queryByRole('button', { name: /auto lineup/i })).toBeNull();
  });

  it('stays calm when nothing needs attention, even though it could act', () => {
    render(
      <TodayStrip
        summary={summary({ benchPlaying: 0, needsAttention: false })}
        dayLabel="Today"
        editable
        onAutoLineup={() => {}}
      />,
    );
    expect(strip()).toHaveAttribute('data-state', 'calm');
    expect(screen.queryByRole('button', { name: /auto lineup/i })).toBeNull();
  });

  it('shows no action button when no handler is wired, even in the amber state', () => {
    render(
      <TodayStrip summary={summary({ benchPlaying: 1, needsAttention: true })} dayLabel="Today" editable />,
    );
    expect(strip()).toHaveAttribute('data-state', 'attention');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

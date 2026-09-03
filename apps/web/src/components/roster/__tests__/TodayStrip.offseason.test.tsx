// TODAY STRIP IN THE OFFSEASON (2026-09-02)
//
// On 2026-09-02 — 27 days before the season opener, 80 days after the last
// game — a drafted roster rendered this strip verbatim:
//
//     TODAY  0/13 starters play · 0 on bench with games · proj 0.0
//
// Every row beneath it correctly said "No Game". The strip contradicted all
// of them, because "proj 0.0" is a claim about a slate, not an absence of
// one: it reads as thirteen starters projected for nothing, i.e. a broken
// lineup. The gate that decides whether the strip renders is roster-shaped
// (`displayRoster.starters.length > 0`), and a drafted roster is thirteen
// real players, so nothing about the list was empty. The schedule was.
//
// What would be WRONG rather than ugly, in order:
//   1. printing any number while no games are scheduled;
//   2. showing an offseason state when we cannot tell (a failed
//      /api/season/status must leave the strip exactly as it is today);
//   3. suppressing the real zero — a manager whose thirteen starters all
//      happen to have the night off is a different, true state;
//   4. offering Auto Lineup, or turning amber, when there is nothing to fix.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TodayStrip } from '../TodayStrip';
import type { TodaySummary } from '../todaySummary';

const summary = (over: Partial<TodaySummary> = {}): TodaySummary => ({
  startersPlaying: 0,
  starterSlots: 13,
  idleStarters: 0,
  emptySlots: 0,
  benchPlaying: 0,
  projected: 0,
  locked: 0,
  needsAttention: false,
  ...over,
});

const strip = () => screen.getByTestId('today-strip');

describe('TodayStrip — dormant schedule', () => {
  it('says where the season went instead of printing zeros', () => {
    render(
      <TodayStrip
        summary={summary()}
        dayLabel="Today"
        seasonDormant
        seasonHeadline="Season opens in 27 days"
      />,
    );

    expect(strip()).toHaveAttribute('data-state', 'dormant');
    expect(screen.getByText('Season opens in 27 days')).toBeInTheDocument();
  });

  it('prints no numbers at all', () => {
    render(<TodayStrip summary={summary()} dayLabel="Today" seasonDormant seasonHeadline="Season opens in 27 days" />);

    // The three number slots are the claims. None may render.
    expect(screen.queryByTestId('strip-starters')).toBeNull();
    expect(screen.queryByTestId('strip-bench')).toBeNull();
    expect(screen.queryByTestId('strip-proj')).toBeNull();
    expect(strip().textContent).not.toMatch(/0\.0/);
    expect(strip().textContent).not.toMatch(/starters play/);
  });

  it('gives the reader somewhere to go', () => {
    // The bar is ScoresEmptyDay: name the state, then offer one tap out.
    render(
      <TodayStrip
        summary={summary()}
        dayLabel="Today"
        seasonDormant
        seasonHeadline="Season opens in 27 days"
        action={<a href="/scores?date=2026-09-29">Opening night</a>}
      />,
    );
    expect(screen.getByRole('link', { name: 'Opening night' })).toHaveAttribute(
      'href',
      '/scores?date=2026-09-29',
    );
  });

  it('offers no Auto Lineup and never turns amber, even when the arithmetic asks', () => {
    const onAutoLineup = vi.fn();
    render(
      <TodayStrip
        summary={summary({ needsAttention: true, benchPlaying: 2, emptySlots: 1 })}
        dayLabel="Today"
        editable
        onAutoLineup={onAutoLineup}
        seasonDormant
        seasonHeadline="Season opens in 27 days"
      />,
    );

    expect(strip()).toHaveAttribute('data-state', 'dormant');
    expect(screen.queryByRole('button', { name: /auto lineup/i })).toBeNull();
  });

  it('falls back to an honest sentence rather than a number when it has no headline', () => {
    render(<TodayStrip summary={summary()} dayLabel="Today" seasonDormant />);
    expect(screen.getByText('No games scheduled')).toBeInTheDocument();
    expect(screen.queryByTestId('strip-proj')).toBeNull();
  });
});

describe('TodayStrip — nothing moves when the season is known or unknown', () => {
  // The failure direction that matters. `seasonDormant` defaults to false, so
  // a failed /api/season/status (phase 'unknown') is indistinguishable from
  // today's behaviour. The opposite default would announce a fake offseason
  // to every user at once on a bad fetch.
  it('renders exactly as before when dormancy is unknown', () => {
    render(<TodayStrip summary={summary({ startersPlaying: 9, projected: 41.62 })} dayLabel="Today" />);

    expect(strip()).toHaveAttribute('data-state', 'calm');
    expect(screen.getByTestId('strip-starters')).toHaveTextContent('9/13');
    expect(screen.getByTestId('strip-proj')).toHaveTextContent('41.6');
  });

  // A real zero is a real state and keeps its zero: thirteen starters who all
  // have the night off during the season is true, and worth saying plainly.
  it('still prints a genuine 0/13 on a dark night inside the season', () => {
    render(<TodayStrip summary={summary()} dayLabel="Today" />);

    expect(strip()).toHaveAttribute('data-state', 'calm');
    expect(screen.getByTestId('strip-starters')).toHaveTextContent('0/13');
    expect(screen.getByTestId('strip-proj')).toHaveTextContent('0.0');
  });

  it('still flashes the pending state while projections load', () => {
    render(<TodayStrip summary={summary()} dayLabel="Today" pending />);
    expect(strip()).toHaveAttribute('data-state', 'pending');
    expect(screen.getByText('Checking who plays…')).toBeInTheDocument();
  });
});

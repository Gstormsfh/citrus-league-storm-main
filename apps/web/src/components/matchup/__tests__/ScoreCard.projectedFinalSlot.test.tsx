// THE HEADER THAT GREW UNDER THE READER (2026-09-03).
//
// `proj 112.4` renders under each score only once the page has summed every
// remaining day's projections - and those seven requests do not resolve until
// AFTER the spinner has come down. So the ScoreCard painted one line shorter
// per side and then grew, taking the day strip and the whole lineup down with
// it. On a phone that is the visible half of "matchup glitches out for the
// first little bit while you try and load up".
//
// `expectedFinalsPending` is the difference between "coming" and "not coming",
// and only the first reserves space. The cases below pin both directions,
// because a slot that renders whenever the finals are absent would leave a
// permanent blank line on every settled week instead.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../WinProbabilityBar', () => ({
  WinProbabilityBar: () => <div data-testid="bar" />,
}));

import { ScoreCard } from '../ScoreCard';

const base = {
  myTeamName: 'Citrus Crushers',
  myTeamRecord: { wins: 2, losses: 1 },
  opponentTeamName: 'Thunder Titans',
  opponentTeamRecord: { wins: 1, losses: 2 },
  myTeamPoints: '41.2',
  opponentTeamPoints: '38.9',
};

describe('ScoreCard - the projected-final line holds its height while it loads', () => {
  it('while the projections are in flight: one reserved slot per side, on each layout', () => {
    render(<ScoreCard {...base} expectedFinalsPending />);
    // Mobile column + desktop column, both sides.
    expect(screen.getAllByTestId('projected-final-slot')).toHaveLength(4);
    // Reserved, not readable: nothing claims a number that does not exist yet.
    expect(screen.queryByText(/^proj 112\.4$/)).toBeNull();
  });

  it('the reserved slot is hidden from assistive tech, not merely empty', () => {
    render(<ScoreCard {...base} expectedFinalsPending />);
    const slot = screen.getAllByTestId('projected-final-slot')[0];
    expect(slot).toHaveAttribute('aria-hidden', 'true');
    // `invisible` is visibility:hidden - it keeps the box, which is the point.
    expect(slot.className).toContain('invisible');
  });

  it('once the finals land the slot is replaced by the numbers, same line count', () => {
    render(
      <ScoreCard
        {...base}
        expectedFinalsPending
        myTeamExpectedFinal={112.4}
        opponentTeamExpectedFinal={104.8}
      />,
    );
    expect(screen.queryAllByTestId('projected-final-slot')).toHaveLength(0);
    expect(screen.getAllByText('proj 112.4')).toHaveLength(2);
    expect(screen.getAllByText('proj 104.8')).toHaveLength(2);
  });

  it('nothing is coming: no reserved slot, so a settled card carries no blank line', () => {
    render(<ScoreCard {...base} expectedFinalsPending={false} />);
    expect(screen.queryAllByTestId('projected-final-slot')).toHaveLength(0);
  });

  it('the default is the old behaviour - a caller that says nothing reserves nothing', () => {
    render(<ScoreCard {...base} />);
    expect(screen.queryAllByTestId('projected-final-slot')).toHaveLength(0);
  });
});

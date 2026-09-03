// "0 LEFT", TWICE PER SIDE, IN THE OFFSEASON (2026-09-02, offseason audit).
//
// On the audit date the schedule holds nothing between 2026-06-14 and
// 2026-09-29, so every starter-game count is zero. The card printed that
// zero four times — a chip per side on mobile, a Calendar badge per side on
// desktop — beside a matchup that cannot be played for 27 days, and handed
// its 50% win chance to a bar that had no way to refuse it.
//
// The count itself was never wrong. "0 left" is a real signal mid-week: the
// week is spent, no starter has a game coming, a lead is safe. It says
// nothing at all when the reason for the zero is an empty calendar.
//
// So the gate is zero AND dormant, and half the cases below exist to prove
// the other combinations did not move: a non-zero count during a break, and
// every count while the season is live or the schedule failed to load
// (`phase === 'unknown'` → isDormant false → today's card, unchanged).
//
// The bar is mocked to a prop recorder, the same way ScoreCard.winChance
// does it, so what the card HANDS it can be asserted here while the bar's
// own suppression stays in WinProbabilityBar.seasonDormant.test.tsx.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../WinProbabilityBar', () => ({
  WinProbabilityBar: (props: { fallbackWinProbability: number; seasonDormant?: boolean; compact?: boolean }) => (
    <div
      data-testid={props.compact ? 'bar-compact' : 'bar-full'}
      data-prob={props.fallbackWinProbability}
      data-dormant={props.seasonDormant ? 'true' : 'false'}
    />
  ),
}));

import { ScoreCard } from '../ScoreCard';

// The offseason matchup exactly as the page builds it: two real teams, two
// real records, no points and no games.
const offseasonProps = {
  myTeamName: 'Citrus Crushers',
  myTeamRecord: { wins: 0, losses: 0 },
  opponentTeamName: 'Thunder Titans',
  opponentTeamRecord: { wins: 0, losses: 0 },
  myTeamPoints: '0.0',
  opponentTeamPoints: '0.0',
  myTeamGamesRemaining: 0,
  opponentTeamGamesRemaining: 0,
};

describe('ScoreCard — "0 left" is withheld only when the schedule is dormant', () => {
  it('offseason: neither the mobile chip nor the desktop badge says "0 left"', () => {
    render(<ScoreCard {...offseasonProps} seasonDormant />);
    expect(screen.queryAllByText('left')).toHaveLength(0);
    expect(screen.queryAllByText('0')).toHaveLength(0);
  });

  it('in season a zero count still renders all four times — the week is done, and that is news', () => {
    render(<ScoreCard {...offseasonProps} seasonDormant={false} />);
    // Mobile chip + desktop badge, both sides.
    expect(screen.getAllByText('left')).toHaveLength(4);
    expect(screen.getAllByText('0')).toHaveLength(4);
  });

  it('phase "unknown" is today\'s card: the caller passes nothing and the counts stay', () => {
    // deriveSeasonStatus leaves isDormant false when the schedule did not
    // load, so a failed fetch renders the ordinary card rather than a
    // fabricated offseason.
    render(<ScoreCard {...offseasonProps} />);
    expect(screen.getAllByText('left')).toHaveLength(4);
  });

  it('a dormant break judges the count, not the season: a non-zero side keeps its chip', () => {
    render(
      <ScoreCard
        {...offseasonProps}
        seasonDormant
        myTeamGamesRemaining={3}
        opponentTeamGamesRemaining={0}
      />,
    );
    expect(screen.getAllByText('3')).toHaveLength(2);
    expect(screen.getAllByText('left')).toHaveLength(2);
    expect(screen.queryAllByText('0')).toHaveLength(0);
  });

  it('a live matchup is untouched: every count, both layouts, both sides', () => {
    render(
      <ScoreCard
        {...offseasonProps}
        myTeamPoints="100.0"
        opponentTeamPoints="80.0"
        myTeamGamesRemaining={3}
        opponentTeamGamesRemaining={5}
        isOwnTeam
      />,
    );
    expect(screen.getAllByText('3')).toHaveLength(2);
    expect(screen.getAllByText('5')).toHaveLength(2);
    expect(screen.getAllByText('left')).toHaveLength(4);
    // The identity ring on the own side survives the gate it now sits behind.
    const mine = screen.getAllByText('3').map((n) => n.parentElement!.className);
    expect(mine.some((c) => /ring-pastel-orange\/30/.test(c))).toBe(true);
  });
});

describe('ScoreCard — the dormancy fact reaches the win-chance bar', () => {
  it('threads seasonDormant to both the compact and the full bar', () => {
    render(<ScoreCard {...offseasonProps} seasonDormant />);
    for (const id of ['bar-compact', 'bar-full']) {
      expect(screen.getByTestId(id).getAttribute('data-dormant')).toBe('true');
    }
  });

  it('defaults to false, so an unwired caller hands the bar exactly what it hands it today', () => {
    render(<ScoreCard {...offseasonProps} />);
    for (const id of ['bar-compact', 'bar-full']) {
      expect(screen.getByTestId(id).getAttribute('data-dormant')).toBe('false');
    }
  });

  it('the card still computes and passes its number — suppression is the bar\'s decision, not a hole here', () => {
    // 0.0 vs 0.0 with no games is winProbabilityFromTotals' `variance <= 0`
    // branch: probability 0.5. The card keeps handing it over so that the
    // moment the schedule wakes up, the bar has a number to draw.
    render(<ScoreCard {...offseasonProps} seasonDormant />);
    expect(Number(screen.getByTestId('bar-compact').getAttribute('data-prob'))).toBe(50);
  });
});

describe('ScoreCard — the offseason card is quieter, not blank', () => {
  it('keeps the teams, the records, the scores and the YOU pill', () => {
    render(<ScoreCard {...offseasonProps} seasonDormant isOwnTeam />);
    expect(screen.getAllByText('Citrus Crushers')).toHaveLength(2);
    expect(screen.getAllByText('Thunder Titans')).toHaveLength(2);
    expect(screen.getAllByText('0-0')).toHaveLength(4);
    expect(screen.getAllByText('0.0')).toHaveLength(4);
    expect(screen.getAllByText('You')).toHaveLength(2);
  });
});

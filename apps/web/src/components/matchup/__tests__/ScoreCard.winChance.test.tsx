// Win chance + projected finals in the header (2026-09-01, Sleeper parity
// audit M1/M2). Companion to ScoreCard.test.tsx (winner colour) and
// ScoreCard.ownTeam.test.tsx (identity pill).
//
// Before this the card fed the bar my / (my + opp) — the share of points
// scored so far — so a 10.5–3.2 lead on Monday morning printed "77%", and
// the mobile header showed name / record / score with no projection and no
// "left to play" anywhere. The bar is mocked to a prop recorder so the
// number the card hands it can be asserted directly.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../WinProbabilityBar', () => ({
  WinProbabilityBar: (props: {
    fallbackWinProbability: number;
    matchupId?: string;
    simulationPerspective?: string;
    compact?: boolean;
  }) => (
    <div
      data-testid={props.compact ? 'bar-compact' : 'bar-full'}
      data-prob={props.fallbackWinProbability}
      data-matchup={props.matchupId ?? ''}
      data-perspective={props.simulationPerspective ?? ''}
    />
  ),
}));

import { ScoreCard } from '../ScoreCard';

const baseProps = {
  myTeamName: 'Storm',
  myTeamRecord: { wins: 5, losses: 2 },
  opponentTeamName: 'Kiwis',
  opponentTeamRecord: { wins: 4, losses: 3 },
  myTeamPoints: '100.0',
  opponentTeamPoints: '80.0',
};

const barProb = (testId: string) =>
  Number(screen.getByTestId(testId).getAttribute('data-prob'));

describe('ScoreCard — win chance is a probability, not a share of points', () => {
  it('hands the bar the caller\'s win chance, rounded to a whole percent', () => {
    render(<ScoreCard {...baseProps} winProbability={57.4} />);
    expect(barProb('bar-compact')).toBe(57);
    expect(barProb('bar-full')).toBe(57);
  });

  it('Monday morning without the page computation: a 10.5–3.2 lead is a coin flip, not 77%', () => {
    render(
      <ScoreCard
        {...baseProps}
        myTeamPoints="10.5"
        opponentTeamPoints="3.2"
        myTeamGamesRemaining={45}
        opponentTeamGamesRemaining={45}
      />,
    );
    const p = barProb('bar-compact');
    expect(p).toBeGreaterThanOrEqual(50);
    expect(p).toBeLessThan(60);
    expect(p).not.toBe(77);
  });

  it('prefers the week-long finals over today\'s slice when deriving its own number', () => {
    render(
      <ScoreCard
        {...baseProps}
        myTeamPoints="10.5"
        opponentTeamPoints="3.2"
        myTeamProjection={4}
        opponentTeamProjection={30}
        myTeamExpectedFinal={101.0}
        opponentTeamExpectedFinal={92.0}
        myTeamGamesRemaining={40}
        opponentTeamGamesRemaining={40}
      />,
    );
    // Today's slice alone would favour the opponent (14.5 vs 33.2); the
    // week-long finals favour me (101 vs 92).
    expect(barProb('bar-compact')).toBeGreaterThan(50);
  });

  it('with nothing left to play the scoreboard is the answer (leading)', () => {
    render(<ScoreCard {...baseProps} />);
    expect(barProb('bar-compact')).toBe(100);
  });

  it('with nothing left to play the scoreboard is the answer (trailing)', () => {
    render(<ScoreCard {...baseProps} myTeamPoints="60.0" opponentTeamPoints="90.0" />);
    expect(barProb('bar-compact')).toBe(0);
  });

  it('threads matchupId and the simulation perspective through to both bars', () => {
    render(<ScoreCard {...baseProps} matchupId="m-1" simulationPerspective="team2" />);
    for (const id of ['bar-compact', 'bar-full']) {
      expect(screen.getByTestId(id).getAttribute('data-matchup')).toBe('m-1');
      expect(screen.getByTestId(id).getAttribute('data-perspective')).toBe('team2');
    }
  });
});

describe('ScoreCard — projected finals and left-to-play in the header', () => {
  it('shows "proj {final}" under each score on both mobile and desktop', () => {
    render(<ScoreCard {...baseProps} myTeamExpectedFinal={112.44} opponentTeamExpectedFinal={96.06} />);
    expect(screen.getAllByText('proj 112.4')).toHaveLength(2);
    expect(screen.getAllByText('proj 96.1')).toHaveLength(2);
  });

  it('the proj line is mono, tabular and on the muted-but-readable floor', () => {
    render(<ScoreCard {...baseProps} myTeamExpectedFinal={112.4} opponentTeamExpectedFinal={96.1} />);
    for (const node of [...screen.getAllByText('proj 112.4'), ...screen.getAllByText('proj 96.1')]) {
      expect(node.className).toMatch(/font-jbmono/);
      expect(node.className).toMatch(/tabular-nums/);
      expect(node.className).toMatch(/text-white\/55/);
      // Neither identity orange nor leader sage: the projection is a fact,
      // not a signal (identity ≠ standing rule).
      expect(node.className).not.toMatch(/text-pastel-orange/);
      expect(node.className).not.toMatch(/text-pastel-sage/);
    }
  });

  it('hides the proj line rather than show a partial number when finals are absent', () => {
    render(<ScoreCard {...baseProps} myTeamProjection={12} opponentTeamProjection={9} />);
    expect(screen.queryAllByText(/^proj /)).toHaveLength(0);
  });

  it('the score nodes keep their contract next to the new line (count, tabular-nums)', () => {
    render(<ScoreCard {...baseProps} myTeamExpectedFinal={112.4} opponentTeamExpectedFinal={96.1} />);
    expect(screen.getAllByText('100.0')).toHaveLength(2);
    expect(screen.getAllByText('80.0')).toHaveLength(2);
    for (const node of screen.getAllByText('100.0')) {
      expect(node.className).toMatch(/tabular-nums/);
      expect(node.className).toMatch(/text-pastel-sage/);
    }
  });

  it('shows "N left" for each side on mobile as well as desktop', () => {
    render(<ScoreCard {...baseProps} myTeamGamesRemaining={3} opponentTeamGamesRemaining={5} />);
    // One chip per layout per side: mobile + desktop = 2 each.
    expect(screen.getAllByText('3')).toHaveLength(2);
    expect(screen.getAllByText('5')).toHaveLength(2);
    expect(screen.getAllByText('left')).toHaveLength(4);
  });

  it('the mobile "left" chip wears the orange identity ring only on the own side', () => {
    const { rerender } = render(
      <ScoreCard {...baseProps} isOwnTeam myTeamGamesRemaining={3} opponentTeamGamesRemaining={5} />,
    );
    const mine = screen.getAllByText('3').map((n) => n.parentElement!.className);
    const theirs = screen.getAllByText('5').map((n) => n.parentElement!.className);
    expect(mine.some((c) => /ring-pastel-orange\/30/.test(c))).toBe(true);
    expect(theirs.some((c) => /ring-pastel-orange/.test(c))).toBe(false);

    rerender(
      <ScoreCard {...baseProps} isOwnTeam={false} myTeamGamesRemaining={3} opponentTeamGamesRemaining={5} />,
    );
    const neutral = screen.getAllByText('3').map((n) => n.parentElement!.className);
    expect(neutral.some((c) => /ring-pastel-orange/.test(c))).toBe(false);
  });

  it('the YOU pill still renders in both clusters alongside the chip', () => {
    render(<ScoreCard {...baseProps} isOwnTeam myTeamGamesRemaining={3} />);
    expect(screen.getAllByText('You')).toHaveLength(2);
  });
});

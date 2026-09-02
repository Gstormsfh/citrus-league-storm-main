// "FINAL" OVER A MATCHUP NOBODY PLAYED (2026-09-02, offseason audit).
//
// On the audit date — 80 days after the last NHL game, 27 before the next —
// the phone's sticky band read:
//
//     0.0        Wk 1 / Final        0.0
//
// The word arrived honestly. `settled` comes from `winProbabilityFromTotals`,
// which returns `settled: true` on its `variance <= 0` branch, and with zero
// starter-games on both sides there is no variance to have. In season that
// branch means "the week is spent". In the offseason it means "no game was
// ever scheduled inside this week" — the same flag for the opposite fact.
//
// The scoreboard is what separates them: a week that was played leaves
// points behind. So the word is withheld only when the schedule is dormant
// AND neither side has scored, which is why the February case below matters
// as much as the September one — an All-Star break sets isDormant while a
// finished 96.1–88.4 week really is final.
//
// Companion to StickyScoreBar.test.tsx, whose "settled: says Final" case
// stays exactly as it was.

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { StickyScoreBar } from '../StickyScoreBar';

// The offseason band as the page builds it: two real teams, a settled
// outlook, and a scoreboard that has never moved.
const offseasonProps = {
  week: 1,
  myTeamName: 'Citrus Crushers',
  myTeamPoints: '0.0',
  opponentTeamName: 'Thunder Titans',
  opponentTeamPoints: '0.0',
  settled: true,
  winProbability: 50,
};

const left = () => screen.getByTestId('sticky-score-left');

describe('StickyScoreBar — "Final" means played and over', () => {
  it('offseason: a settled 0.0–0.0 with a dormant schedule is not final, it is unplayed', () => {
    render(<StickyScoreBar {...offseasonProps} seasonDormant />);
    expect(screen.queryByTestId('sticky-score-final')).toBeNull();
    expect(screen.queryByText('Final')).toBeNull();
  });

  it('and still says nothing about a win chance — no line, no hairline bar, no "—"', () => {
    render(<StickyScoreBar {...offseasonProps} seasonDormant />);
    expect(screen.queryAllByTestId('sticky-score-chance')).toHaveLength(0);
    expect(screen.queryByTestId('sticky-score-chance-bar')).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
  });

  it('the band keeps its shape: both teams, both scores and the week eyebrow stay', () => {
    render(<StickyScoreBar {...offseasonProps} seasonDormant />);
    expect(left()).toHaveTextContent('Citrus Crushers');
    expect(within(left()).getByTestId('sticky-score-points')).toHaveTextContent('0.0');
    expect(screen.getByText('Wk 1')).toBeInTheDocument();
  });

  it('a mid-season break that is genuinely over still says Final — dormant, but played', () => {
    // 2026-02-05 → 2026-02-25, the Milan Olympic break: isDormant is true for
    // twenty days while the week before it finished on the ice.
    render(
      <StickyScoreBar
        {...offseasonProps}
        seasonDormant
        myTeamPoints="96.1"
        opponentTeamPoints="88.4"
      />,
    );
    expect(screen.getByTestId('sticky-score-final')).toHaveTextContent('Final');
  });

  it('one side on the board is enough: a 12.4–0.0 week was played', () => {
    render(<StickyScoreBar {...offseasonProps} seasonDormant myTeamPoints="12.4" />);
    expect(screen.getByTestId('sticky-score-final')).toHaveTextContent('Final');
  });
});

describe('StickyScoreBar — in season and when the schedule is unknown, nothing moves', () => {
  it('a settled in-season week says Final exactly as before', () => {
    render(
      <StickyScoreBar
        {...offseasonProps}
        myTeamPoints="112.4"
        opponentTeamPoints="96.1"
        seasonDormant={false}
      />,
    );
    expect(screen.getByTestId('sticky-score-final')).toHaveTextContent('Final');
  });

  it('phase "unknown": the prop is absent and a settled 0.0–0.0 still says Final', () => {
    // deriveSeasonStatus leaves isDormant false when the schedule did not
    // load. Suppressing on a failed fetch would mean a January outage told
    // every user their season was over; the band shows its ordinary self.
    render(<StickyScoreBar {...offseasonProps} />);
    expect(screen.getByTestId('sticky-score-final')).toHaveTextContent('Final');
  });

  it('a live dormant day (no games tonight, week still open) keeps the chances and drops nothing', () => {
    render(
      <StickyScoreBar
        {...offseasonProps}
        settled={false}
        seasonDormant
        myTeamPoints="45.2"
        opponentTeamPoints="38.8"
        myTeamExpectedFinal={112.4}
        winProbability={62.4}
      />,
    );
    // `settled` is what takes the projections and chances down; dormancy on
    // its own has never had that job and does not acquire it here.
    expect(within(left()).getByTestId('sticky-score-chance')).toHaveTextContent('62% win');
    expect(within(left()).getByTestId('sticky-score-proj')).toHaveTextContent('proj 112.4');
    expect(screen.queryByTestId('sticky-score-final')).toBeNull();
  });
});

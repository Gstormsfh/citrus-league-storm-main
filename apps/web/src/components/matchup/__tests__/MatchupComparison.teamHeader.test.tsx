// Lineup team-header lock (2026-08-25).
//
// Team names used to live ONLY in the ScoreCard at the top of the Matchup
// page. Scroll down into the lineup and both 47% columns were anonymous —
// "which side is mine" had to be remembered rather than read. This header is
// the answer, and it carries the same orange/"You" identity signal as the
// ScoreCard and the Standings own-team row.
//
// As in the ScoreCard tests, the load-bearing case is the NEGATIVE one:
// the "View Matchup" dropdown can put two strangers' teams on screen, and
// the header must not label either of them as the viewer's.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Focus this on the header contract. MatchupPositionGroup pulls in the whole
// PlayerCard tree (tooltips, projections, scoring) which is irrelevant here
// and has its own coverage.
vi.mock('../MatchupPositionGroup', () => ({
  MatchupPositionGroup: () => null,
}));

import { MatchupComparison } from '../MatchupComparison';

const baseProps = {
  userStarters: [],
  opponentStarters: [],
  userSlotAssignments: {},
  opponentSlotAssignments: {},
};

describe('MatchupComparison — lineup team header', () => {
  it('renders both team names over the lineup', () => {
    render(<MatchupComparison {...baseProps} userTeamName="Storm" opponentTeamName="Kiwis" />);
    expect(screen.getByText('Storm')).toBeTruthy();
    expect(screen.getByText('Kiwis')).toBeTruthy();
  });

  it('does NOT claim ownership by default (someone else\'s matchup)', () => {
    render(<MatchupComparison {...baseProps} userTeamName="Storm" opponentTeamName="Kiwis" />);
    expect(screen.queryByText('You')).toBeNull();
    expect(screen.getByText('Storm').className).not.toMatch(/text-pastel-orange/);
  });

  it('marks the left column as yours when isOwnTeam', () => {
    render(
      <MatchupComparison {...baseProps} userTeamName="Storm" opponentTeamName="Kiwis" isOwnTeam />,
    );
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Storm').className).toMatch(/text-pastel-orange-soft/);
    // The opponent is never the highlighted side.
    expect(screen.getByText('Kiwis').className).not.toMatch(/text-pastel-orange/);
  });

  it('omits the header entirely when no names are supplied (no empty bar)', () => {
    const { container } = render(<MatchupComparison {...baseProps} />);
    expect(container.querySelector('.matchup-team-header')).toBeNull();
  });

  it('header grid class is present so it lines up with the 47%/6%/47% rows', () => {
    const { container } = render(
      <MatchupComparison {...baseProps} userTeamName="Storm" opponentTeamName="Kiwis" />,
    );
    expect(container.querySelector('.matchup-team-header')).toBeTruthy();
    expect(container.querySelectorAll('.matchup-team-header-side')).toHaveLength(2);
  });
});

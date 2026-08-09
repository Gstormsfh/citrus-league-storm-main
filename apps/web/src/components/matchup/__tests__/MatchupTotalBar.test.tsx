// Entry 33 U4 condition (2026-08-09) — MatchupTotalBar winner-color contract.
//
// Sibling test to ScoreCard.test.tsx. Locks the semantic upgrade U4
// (commit 0e456e8a) applied: score coloring is now WINNER-BASED
// (leader = text-pastel-sage, trailer = text-white/70, tie = both
// text-white/70) instead of team-based (team1 always sage, team2
// always peach). If a future edit reverts to team-based, this
// catches it in CI.
//
// The dead-then-live variables `team1Leading` / `team2Leading` are
// the load-bearing conditionals; asserting the rendered class is
// how we lock the presentation logic to the intent.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MatchupTotalBar } from '../MatchupTotalBar';

describe('MatchupTotalBar — winner/loser color signal (Entry 33)', () => {
  it('leader carries text-pastel-sage; trailer carries text-white/70 (team1 leading)', () => {
    render(<MatchupTotalBar team1Score={100} team2Score={80} />);
    const leader = screen.getByText('100.0');
    const trailer = screen.getByText('80.0');
    expect(leader.className).toMatch(/text-pastel-sage/);
    expect(leader.className).not.toMatch(/text-white\/70/);
    expect(trailer.className).toMatch(/text-white\/70/);
    expect(trailer.className).not.toMatch(/text-pastel-sage/);
  });

  it('inverted score inverts the accent (team2 leading)', () => {
    render(<MatchupTotalBar team1Score={60} team2Score={90} />);
    const team1Node = screen.getByText('60.0');
    const team2Node = screen.getByText('90.0');
    expect(team1Node.className).toMatch(/text-white\/70/);
    expect(team1Node.className).not.toMatch(/text-pastel-sage/);
    expect(team2Node.className).toMatch(/text-pastel-sage/);
    expect(team2Node.className).not.toMatch(/text-white\/70/);
  });

  it('tied score sends BOTH nodes to text-white/70 (no leader = no accent)', () => {
    render(<MatchupTotalBar team1Score={75.5} team2Score={75.5} />);
    for (const node of screen.getAllByText('75.5')) {
      expect(node.className).toMatch(/text-white\/70/);
      expect(node.className).not.toMatch(/text-pastel-sage/);
    }
  });

  it('emits tabular-nums on both score nodes (rule 1)', () => {
    render(<MatchupTotalBar team1Score={100} team2Score={80} />);
    expect(screen.getByText('100.0').className).toMatch(/tabular-nums/);
    expect(screen.getByText('80.0').className).toMatch(/tabular-nums/);
  });

  it('renders TIED indicator when scores match', () => {
    render(<MatchupTotalBar team1Score={50} team2Score={50} />);
    expect(screen.getByText('TIED')).toBeTruthy();
  });

  it('renders team names (default fallback + prop override)', () => {
    const { rerender } = render(
      <MatchupTotalBar team1Score={10} team2Score={5} />,
    );
    expect(screen.getByText('Team 1')).toBeTruthy();
    expect(screen.getByText('Team 2')).toBeTruthy();

    rerender(
      <MatchupTotalBar
        team1Score={10}
        team2Score={5}
        team1Name="Storm"
        team2Name="Kiwis"
      />,
    );
    expect(screen.getByText('Storm')).toBeTruthy();
    expect(screen.getByText('Kiwis')).toBeTruthy();
  });
});

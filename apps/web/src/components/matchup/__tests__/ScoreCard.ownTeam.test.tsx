// Own-team identity lock (2026-08-25) — companion to ScoreCard.test.tsx's
// winner/loser colour contract.
//
// Two separate questions get answered in the same card and must never share
// a signal:
//   WHO IS THIS?     -> orange + a "You" pill  (this file)
//   WHO'S AHEAD?     -> pastel-sage on the score (ScoreCard.test.tsx)
// Before this, both team badges were identical sage patches told apart only
// by an "H"/"A" letter, so a new user could not tell which side was theirs —
// and a user who was LOSING saw their opponent's score lit up in sage and
// read it as their own.
//
// The load-bearing test here is "does NOT render the badge by default".
// MatchupService.getMatchupDataById falls back to team1 as the "userTeam"
// when the viewer isn't in the matchup (the "View Matchup" dropdown lets you
// watch two strangers play), so a ScoreCard that assumes left == you would
// confidently label a stranger's team as the viewer's.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Same mock rationale as ScoreCard.test.tsx: WinProbabilityBar eagerly
// imports matchupApi -> supabase env vars that aren't set under vitest.
vi.mock('../WinProbabilityBar', () => ({
  WinProbabilityBar: () => null,
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

describe('ScoreCard — own-team identity badge', () => {
  it('does NOT claim ownership by default (viewing someone else\'s matchup)', () => {
    render(<ScoreCard {...baseProps} />);
    expect(screen.queryAllByText('You')).toHaveLength(0);
  });

  it('does NOT claim ownership when isOwnTeam is explicitly false', () => {
    render(<ScoreCard {...baseProps} isOwnTeam={false} />);
    expect(screen.queryAllByText('You')).toHaveLength(0);
  });

  it('renders the "You" pill on BOTH mobile and desktop clusters when isOwnTeam', () => {
    render(<ScoreCard {...baseProps} isOwnTeam />);
    // Card renders both layouts simultaneously (one hidden via responsive utils).
    expect(screen.getAllByText('You')).toHaveLength(2);
  });

  it('the "You" pill wears the app-wide orange identity treatment (matches Standings)', () => {
    render(<ScoreCard {...baseProps} isOwnTeam />);
    for (const pill of screen.getAllByText('You')) {
      expect(pill.className).toMatch(/bg-pastel-orange\/20/);
      expect(pill.className).toMatch(/text-pastel-orange-soft/);
      expect(pill.className).toMatch(/ring-pastel-orange\/40/);
    }
  });

  it('own team name turns orange; the opponent name never does', () => {
    render(<ScoreCard {...baseProps} isOwnTeam />);
    for (const node of screen.getAllByText('Storm')) {
      expect(node.className).toMatch(/text-pastel-orange-soft/);
    }
    for (const node of screen.getAllByText('Kiwis')) {
      expect(node.className).not.toMatch(/text-pastel-orange/);
      expect(node.className).toMatch(/text-pastel-cream/);
    }
  });

  it('a non-owned left team stays cream — orange means "you", not "left"', () => {
    render(<ScoreCard {...baseProps} isOwnTeam={false} />);
    for (const node of screen.getAllByText('Storm')) {
      expect(node.className).not.toMatch(/text-pastel-orange/);
    }
  });

  it('identity accent does not leak into the score cluster (sage still = leader)', () => {
    // Regression guard for the real trap: if "you" were also sage, a losing
    // user's sage-lit OPPONENT score would read as their own score.
    render(<ScoreCard {...baseProps} isOwnTeam myTeamPoints="60.0" opponentTeamPoints="90.0" />);
    for (const node of screen.getAllByText('60.0')) {
      expect(node.className).toMatch(/text-white\/70/);
      expect(node.className).not.toMatch(/text-pastel-sage/);
    }
    for (const node of screen.getAllByText('90.0')) {
      expect(node.className).toMatch(/text-pastel-sage/);
    }
  });

  it('avatars show real team initials, not the meaningless H/A pair', () => {
    render(<ScoreCard {...baseProps} isOwnTeam />);
    // 'S' for Storm and 'K' for Kiwis, once per layout.
    expect(screen.getAllByText('S')).toHaveLength(2);
    expect(screen.getAllByText('K')).toHaveLength(2);
    expect(screen.queryAllByText('H')).toHaveLength(0);
    expect(screen.queryAllByText('A')).toHaveLength(0);
  });

  it('an empty team name degrades to "?" rather than crashing on charAt', () => {
    render(<ScoreCard {...baseProps} myTeamName="" isOwnTeam />);
    expect(screen.getAllByText('?')).toHaveLength(2);
  });
});

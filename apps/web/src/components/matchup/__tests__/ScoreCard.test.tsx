// Entry 30 M-1a (2026-08-09) — ScoreCard hero score contract.
//
// Locks the winning-vs-losing color signal per DESIGN_DIRECTION.md
// rule 1 (confident numbers, tabular-nums) + rule 2 (one accent per
// cluster — sage for the leader, white/70 for the trailer). If a
// future recolor drifts the winner off pastel-sage or the loser off
// white/70, this test catches it before the change ships.
//
// Guards both mobile and desktop score nodes because the ScoreCard
// renders both simultaneously (hidden via responsive utilities).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock WinProbabilityBar — it eagerly imports matchupApi → supabase env
// vars that aren't set in the vitest environment. We only care about
// the ScoreCard score/color contract here; the probability bar has its
// own tests elsewhere.
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

describe('ScoreCard — winner/loser color signal (Entry 30 M-1a)', () => {
  it('renders BOTH mobile and desktop score clusters (one hidden via responsive utils)', () => {
    render(<ScoreCard {...baseProps} />);
    // Each score renders once mobile + once desktop = 2 occurrences.
    expect(screen.getAllByText('100.0')).toHaveLength(2);
    expect(screen.getAllByText('80.0')).toHaveLength(2);
  });

  it('winning score node carries text-pastel-sage; losing carries text-white/70', () => {
    render(<ScoreCard {...baseProps} />);
    const myScores = screen.getAllByText('100.0');
    const oppScores = screen.getAllByText('80.0');

    // My team wins (100 > 80) → both my nodes wear sage
    for (const node of myScores) {
      expect(node.className).toMatch(/text-pastel-sage/);
      expect(node.className).not.toMatch(/text-white\/70/);
    }
    // Opponent loses → both opponent nodes wear white/70
    for (const node of oppScores) {
      expect(node.className).toMatch(/text-white\/70/);
      expect(node.className).not.toMatch(/text-pastel-sage/);
    }
  });

  it('inverted score inverts the accent (opponent wins → opponent wears sage)', () => {
    render(
      <ScoreCard
        {...baseProps}
        myTeamPoints="60.0"
        opponentTeamPoints="90.0"
      />,
    );
    const myScores = screen.getAllByText('60.0');
    const oppScores = screen.getAllByText('90.0');

    for (const node of myScores) {
      expect(node.className).toMatch(/text-white\/70/);
      expect(node.className).not.toMatch(/text-pastel-sage/);
    }
    for (const node of oppScores) {
      expect(node.className).toMatch(/text-pastel-sage/);
      expect(node.className).not.toMatch(/text-white\/70/);
    }
  });

  it('emits tabular-nums on both mobile and desktop score nodes (rule 1)', () => {
    render(<ScoreCard {...baseProps} />);
    for (const node of screen.getAllByText('100.0')) {
      expect(node.className).toMatch(/tabular-nums/);
    }
    for (const node of screen.getAllByText('80.0')) {
      expect(node.className).toMatch(/tabular-nums/);
    }
  });

  it('tied score sends BOTH nodes to text-white/70 (no leader = no accent)', () => {
    render(
      <ScoreCard {...baseProps} myTeamPoints="75.0" opponentTeamPoints="75.0" />,
    );
    for (const node of screen.getAllByText('75.0')) {
      expect(node.className).toMatch(/text-white\/70/);
      expect(node.className).not.toMatch(/text-pastel-sage/);
    }
  });
});

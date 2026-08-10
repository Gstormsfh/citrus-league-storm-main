// Entry 40 A-lite lock (2026-08-10) — WinProbabilityBar winner-signal.
//
// Sibling to ScoreCard.test.tsx + MatchupTotalBar.test.tsx. Locks the
// win-probability visual signal per DESIGN_DIRECTION.md rule 2 (one
// accent per cluster — sage does the alerting here too, via segment
// WIDTH rather than color swap): the pastel-sage bar's inline
// style.width tracks displayProb%, and the pastel-sage/15 ambient
// segment fills the remainder. If a future recolor drifts the winner
// segment off pastel-sage or breaks the width-tracks-probability
// invariant, this test catches it.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the simulation service to avoid supabase env pull (same pattern
// as ScoreCard.test.tsx's WinProbabilityBar mock — but here we need
// the real component with a stubbed service).
vi.mock('@/services/MatchupSimulationService', () => ({
  MatchupSimulationService: {
    getSimulation: vi.fn().mockResolvedValue(null),
    isStale: vi.fn().mockReturnValue(false),
    getConfidenceLevel: vi.fn().mockReturnValue({ label: 'high', color: 'text-pastel-sage' }),
  },
}));

import { WinProbabilityBar } from '../WinProbabilityBar';

describe('WinProbabilityBar — winner-signal width lock (Entry 40 A-lite)', () => {
  it('FULL MODE: sage segment width tracks displayProb%; sage/15 fills remainder', () => {
    const { container } = render(
      <WinProbabilityBar fallbackWinProbability={72} />,
    );
    // Find both segment divs by class fragment. Sage full = winner, sage/15 = ambient.
    const winSeg = container.querySelector('.bg-pastel-sage.relative') as HTMLElement | null;
    const lossSeg = container.querySelector('.bg-pastel-sage\\/15.relative') as HTMLElement | null;
    expect(winSeg).toBeTruthy();
    expect(lossSeg).toBeTruthy();
    // Inline style widths must reflect displayProb (Math.round of fallbackWinProbability).
    expect(winSeg!.style.width).toBe('72%');
    expect(lossSeg!.style.width).toBe('28%');
  });

  it('COMPACT MODE: sage segment width tracks displayProb%; ambient uses flex-grow', () => {
    const { container } = render(
      <WinProbabilityBar fallbackWinProbability={45} compact />,
    );
    // Compact mode's win segment has inline width; ambient uses flex-grow.
    const winSeg = container.querySelector('.bg-pastel-sage:not(.bg-pastel-sage\\/15)') as HTMLElement | null;
    expect(winSeg).toBeTruthy();
    expect(winSeg!.style.width).toBe('45%');
    // Ambient segment uses flex-grow (no inline width required).
    const ambientSeg = container.querySelector('.bg-pastel-sage\\/15.flex-grow');
    expect(ambientSeg).toBeTruthy();
  });

  it('extremes: 100% win → sage segment full, ambient 0%', () => {
    const { container } = render(
      <WinProbabilityBar fallbackWinProbability={100} />,
    );
    const winSeg = container.querySelector('.bg-pastel-sage.relative') as HTMLElement;
    const lossSeg = container.querySelector('.bg-pastel-sage\\/15.relative') as HTMLElement;
    expect(winSeg.style.width).toBe('100%');
    expect(lossSeg.style.width).toBe('0%');
  });

  it('extremes: 0% win → sage segment 0%, ambient full', () => {
    const { container } = render(
      <WinProbabilityBar fallbackWinProbability={0} />,
    );
    const winSeg = container.querySelector('.bg-pastel-sage.relative') as HTMLElement;
    const lossSeg = container.querySelector('.bg-pastel-sage\\/15.relative') as HTMLElement;
    expect(winSeg.style.width).toBe('0%');
    expect(lossSeg.style.width).toBe('100%');
  });

  it('displayed percentage matches the input probability (rounded)', () => {
    render(<WinProbabilityBar fallbackWinProbability={72.4} />);
    // Compact + full both render the % text. The 72.4 → Math.round → 72.
    const percentSpans = screen.getAllByText('72%');
    expect(percentSpans.length).toBeGreaterThan(0);
  });
});

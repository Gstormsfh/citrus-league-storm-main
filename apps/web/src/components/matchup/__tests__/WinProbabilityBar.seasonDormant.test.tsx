// A BAR AT 50% IS A CLAIM (2026-09-02, offseason audit).
//
// Audited four weeks before the season opens: last NHL game 2026-06-14, next
// 2026-09-29. The matchup header showed a half-filled sage bar under the
// words "Win chance" — "50%" — for a matchup that cannot be played for
// another 27 days.
//
// Nothing was broken. Both sides have 0.0 points and zero games left, so
// `winProbabilityFromTotals` takes its `variance <= 0` branch and returns
// `{ probability: 0.5, settled: true }` — "the scoreboard is level". The bar
// had no way to tell that apart from "either team could win" and drew the
// second. This file locks the third option: draw nothing.
//
// Companion to WinProbabilityBar.test.tsx (the width contract for a number
// that IS justified) and WinProbabilityBar.simulation.test.tsx (the stored
// Monte Carlo row). The rule those two encode still holds everywhere the
// schedule has hockey in it — which is what half of the cases below check.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { MatchupSimulation } from '@/services/MatchupSimulationService';

const getSimulation = vi.fn<(id: string) => Promise<MatchupSimulation | null>>();

vi.mock('@/services/MatchupSimulationService', () => ({
  MatchupSimulationService: {
    getSimulation: (id: string) => getSimulation(id),
    isStale: () => false,
    getConfidenceLevel: () => ({ label: 'High', color: 'text-pastel-sage' }),
  },
}));

import { WinProbabilityBar } from '../WinProbabilityBar';

const freshRow = (): MatchupSimulation => ({
  winProbability: 0.64,
  lossProbability: 0.35,
  tieProbability: 0.01,
  team1Projected: 110.2,
  team2Projected: 98.7,
  team1Std: 20,
  team2Std: 21,
  marginMean: 11.5,
  marginStd: 29,
  pBlowoutWin: 0.3,
  pBlowoutLoss: 0.1,
  nSims: 10000,
  simulatedAt: new Date().toISOString(),
  ci95: [0.6, 0.68],
  percentiles: { p5: 80, p25: 95, p50: 110, p75: 125, p95: 140 },
});

beforeEach(() => {
  getSimulation.mockReset();
  getSimulation.mockResolvedValue(null);
});

describe('WinProbabilityBar — a dormant schedule is no basis for a probability', () => {
  it('renders nothing at all in compact mode: no bar, no caption, no "50%"', () => {
    const { container } = render(
      <WinProbabilityBar fallbackWinProbability={50} seasonDormant compact />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Win chance')).toBeNull();
    expect(screen.queryByText('50%')).toBeNull();
  });

  it('renders nothing at all in full mode either', () => {
    const { container } = render(
      <WinProbabilityBar fallbackWinProbability={50} seasonDormant />,
    );
    expect(container.firstChild).toBeNull();
    expect(container.querySelector('.bg-pastel-sage')).toBeNull();
  });

  it('says nothing rather than something quieter — no placeholder, no empty shell', () => {
    const { container } = render(
      <WinProbabilityBar fallbackWinProbability={50} seasonDormant />,
    );
    // An offseason caption in this slot would be a second thing to keep true.
    // The season copy belongs to the page (dormantHeadline), not to the bar.
    expect(container.textContent).toBe('');
  });

  it('a stored simulation does not revive it: a sim of a week with no games is the same nothing', async () => {
    getSimulation.mockResolvedValue(freshRow());
    const { container } = render(
      <WinProbabilityBar matchupId="m-1" fallbackWinProbability={50} seasonDormant compact />,
    );
    await waitFor(() => expect(getSimulation).toHaveBeenCalledWith('m-1'));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('64%')).toBeNull();
  });

  it('a fallback that is not a number renders nothing rather than "NaN%"', () => {
    const { container } = render(
      <WinProbabilityBar fallbackWinProbability={Number.NaN} compact />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});

describe('WinProbabilityBar — in season and when the schedule is unknown, nothing moves', () => {
  it('an in-season 50% is a real forecast and still draws its bar', () => {
    const { container } = render(
      <WinProbabilityBar fallbackWinProbability={50} seasonDormant={false} compact />,
    );
    const winSeg = container.querySelector('.bg-pastel-sage:not(.bg-pastel-sage\\/15)') as HTMLElement;
    expect(winSeg.style.width).toBe('50%');
    expect(screen.getByText('Win chance')).toBeInTheDocument();
  });

  it('phase "unknown" behaves exactly like today: the prop is absent and the bar renders', () => {
    // `deriveSeasonStatus` returns isDormant:false for an unloaded schedule,
    // so the page passes false and this is what a caller that was never
    // wired up looks like too. A failed fetch must not announce an offseason.
    const { container } = render(<WinProbabilityBar fallbackWinProbability={72} />);
    const winSeg = container.querySelector('.bg-pastel-sage.relative') as HTMLElement;
    expect(winSeg.style.width).toBe('72%');
    expect(screen.getAllByText('72%').length).toBeGreaterThan(0);
  });

  it('the extremes a settled in-season week produces (0% / 100%) still draw', () => {
    for (const p of [0, 100]) {
      const { container } = render(<WinProbabilityBar fallbackWinProbability={p} />);
      expect(container.querySelector('.bg-pastel-sage.relative')).toBeTruthy();
    }
  });
});

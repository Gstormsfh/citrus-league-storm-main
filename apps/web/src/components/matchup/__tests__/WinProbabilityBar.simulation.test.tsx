// Simulation override + perspective (2026-09-01, Sleeper parity audit M1).
// Companion to WinProbabilityBar.test.tsx, which locks the width contract
// for the fallback number. This file covers the other source:
//
//   * a FRESH matchup_simulations row overrides the formula,
//   * a row older than SIMULATION_MAX_AGE_MINUTES is ignored (the producer
//     is a manual script; a stale row must not freeze the bar for a week),
//   * rows are stored for team1, so a team2 viewer sees the mirrored number,
//   * the label reads "Win chance" in both modes.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { MatchupSimulation } from '@/services/MatchupSimulationService';

const getSimulation = vi.fn<(id: string) => Promise<MatchupSimulation | null>>();

vi.mock('@/services/MatchupSimulationService', () => ({
  MatchupSimulationService: {
    getSimulation: (id: string) => getSimulation(id),
    // Real staleness semantics, so the 24h gate is exercised for real.
    isStale: (sim: MatchupSimulation, maxAgeMinutes = 60) =>
      Date.now() - Date.parse(sim.simulatedAt) > maxAgeMinutes * 60 * 1000,
    getConfidenceLevel: () => ({ label: 'High', color: 'text-pastel-sage' }),
  },
}));

import { WinProbabilityBar, SIMULATION_MAX_AGE_MINUTES } from '../WinProbabilityBar';

const row = (overrides: Partial<MatchupSimulation> = {}): MatchupSimulation => ({
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
  ...overrides,
});

const compactWidth = (container: HTMLElement) =>
  (container.querySelector('.bg-pastel-sage:not(.bg-pastel-sage\\/15)') as HTMLElement).style.width;

beforeEach(() => {
  getSimulation.mockReset();
});

describe('WinProbabilityBar — label', () => {
  it('reads "Win chance" in compact and full modes', () => {
    render(<WinProbabilityBar fallbackWinProbability={55} compact />);
    render(<WinProbabilityBar fallbackWinProbability={55} />);
    expect(screen.getAllByText('Win chance')).toHaveLength(2);
    expect(screen.queryByText(/Win Prob/)).toBeNull();
  });
});

describe('WinProbabilityBar — simulation override', () => {
  it('does not fetch without a matchupId', () => {
    render(<WinProbabilityBar fallbackWinProbability={55} compact />);
    expect(getSimulation).not.toHaveBeenCalled();
  });

  it('a fresh row overrides the formula number', async () => {
    getSimulation.mockResolvedValue(row());
    const { container } = render(
      <WinProbabilityBar matchupId="m-1" fallbackWinProbability={55} compact />,
    );
    expect(compactWidth(container)).toBe('55%');
    await waitFor(() => expect(compactWidth(container)).toBe('64%'));
    expect(getSimulation).toHaveBeenCalledWith('m-1');
    expect(screen.getByText('64%')).toBeInTheDocument();
  });

  it('a team2 viewer sees the mirrored row', async () => {
    getSimulation.mockResolvedValue(row());
    const { container } = render(
      <WinProbabilityBar matchupId="m-1" fallbackWinProbability={55} simulationPerspective="team2" />,
    );
    await waitFor(() => expect(screen.getAllByText('35%').length).toBeGreaterThan(0));
    const winSeg = container.querySelector('.bg-pastel-sage.relative') as HTMLElement;
    expect(winSeg.style.width).toBe('35%');
    // Projected points swap sides with the perspective.
    expect(screen.getByText('98.7')).toBeInTheDocument();
    expect(screen.getByText('110.2')).toBeInTheDocument();
    expect(screen.getByText('-11.5')).toBeInTheDocument();
  });

  it('a row older than the freshness gate is ignored in favour of the formula', async () => {
    const stale = new Date(Date.now() - (SIMULATION_MAX_AGE_MINUTES + 30) * 60 * 1000).toISOString();
    getSimulation.mockResolvedValue(row({ simulatedAt: stale }));
    const { container } = render(
      <WinProbabilityBar matchupId="m-1" fallbackWinProbability={55} compact />,
    );
    await waitFor(() => expect(getSimulation).toHaveBeenCalled());
    // Give the resolved promise a tick to land, then assert nothing changed.
    await new Promise((r) => setTimeout(r, 0));
    expect(compactWidth(container)).toBe('55%');
    expect(screen.queryByText(/sims/)).toBeNull();
  });

  it('no row at all keeps the formula', async () => {
    getSimulation.mockResolvedValue(null);
    const { container } = render(
      <WinProbabilityBar matchupId="m-1" fallbackWinProbability={72} compact />,
    );
    await waitFor(() => expect(getSimulation).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(compactWidth(container)).toBe('72%');
  });
});

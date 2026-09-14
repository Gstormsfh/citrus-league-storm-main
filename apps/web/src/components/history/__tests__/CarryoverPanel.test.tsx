/**
 * IMPORT (2026-09-14): the keeper and traded-pick carry-over says what can
 * land, what is waiting on a claim or a player match, and applies with one
 * tap each.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ getCarryover: vi.fn(), applyKeepers: vi.fn(), applyTradedPicks: vi.fn() }));
vi.mock('@/api/imports', () => ({ importApi: api }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

import { CarryoverPanel } from '../CarryoverPanel';

const carry = {
  draftSeason: 2026,
  keepers: {
    season: 2025, seasonYear: 2026, ready: 1, blocked: 2,
    rows: [
      { memberId: 'A', memberName: 'Alice', teamId: 't-a', teamName: 'Alice FC', playerName: 'Cale Makar', nhlPlayerId: 8480069, externalPlayerId: 'name:cale makar|COL', round: 3, yearsKept: 1, blocker: null },
      { memberId: 'B', memberName: 'Bob', teamId: null, teamName: null, playerName: 'Connor McDavid', nhlPlayerId: 8478402, externalPlayerId: 'name:connor mcdavid|EDM', round: 1, yearsKept: 2, blocker: 'unclaimed' },
      { memberId: 'C', memberName: 'Cy', teamId: 't-c', teamName: 'Cy FC', playerName: 'Some Rookie', nhlPlayerId: null, externalPlayerId: 'name:some rookie', round: null, yearsKept: null, blocker: 'unmatched' },
    ],
  },
  picks: [
    { draftSeason: 2026, round: 1, originalMemberId: 'B', originalName: 'Bob', originalTeamId: 't-b', ownerMemberId: 'A', ownerName: 'Alice', ownerTeamId: 't-a', appliedAt: null, source: 'yahoo', blocker: null },
    { draftSeason: 2026, round: 2, originalMemberId: 'C', originalName: 'Cy', originalTeamId: null, ownerMemberId: 'A', ownerName: 'Alice', ownerTeamId: 't-a', appliedAt: null, source: 'yahoo', blocker: 'unclaimed' },
    { draftSeason: 2027, round: 1, originalMemberId: 'A', originalName: 'Alice', originalTeamId: 't-a', ownerMemberId: 'B', ownerName: 'Bob', ownerTeamId: 't-b', appliedAt: null, source: 'yahoo', blocker: null },
  ],
};

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChanged = vi.fn();
  render(<QueryClientProvider client={qc}><CarryoverPanel leagueId="l-1" onChanged={onChanged} /></QueryClientProvider>);
  return { onChanged };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  toast.mockReset();
});

describe('CarryoverPanel', () => {
  it('lists keepers and traded picks with why each waits, and counts what is ready', async () => {
    api.getCarryover.mockResolvedValue({ data: carry });
    mount();
    const keepers = await screen.findByTestId('carryover-keepers');
    expect(keepers.textContent).toContain('Keepers as of 2025-26 · 1 ready, 2 waiting');
    expect(keepers.textContent).toContain('Cale Makar');
    expect(keepers.textContent).toContain('costs round 3');
    expect(keepers.textContent).toContain('Waiting on claim');
    expect(keepers.textContent).toContain('Player unmatched');
    expect(screen.getByRole('button', { name: 'Designate 1 keeper for 2026-27' })).toBeEnabled();
    const picks = screen.getByTestId('carryover-picks');
    expect(picks.textContent).toContain('Traded draft picks · 3');
    expect(picks.textContent).toContain("Bob's pick, owned by Alice");
    expect(picks.textContent).toContain('Later draft');
    expect(screen.getByRole('button', { name: 'Apply 1 traded pick to the 2026-27 draft order' })).toBeEnabled();
  });

  it('applying keepers and picks calls the API, toasts the outcome and refreshes', async () => {
    api.getCarryover.mockResolvedValue({ data: carry });
    api.applyKeepers.mockResolvedValue({ data: { seasonYear: 2026, written: 1, skippedLocked: 0, blocked: 2 } });
    api.applyTradedPicks.mockResolvedValue({ data: { applied: 1, alreadyApplied: 0, skipped: [{ round: 2, reason: 'Cy or Alice has not claimed a team yet.' }] } });
    const { onChanged } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Designate 1 keeper for 2026-27' }));
    await waitFor(() => expect(api.applyKeepers).toHaveBeenCalledWith('l-1'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Keepers designated' })));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 traded pick to the 2026-27 draft order' }));
    await waitFor(() => expect(api.applyTradedPicks).toHaveBeenCalledWith('l-1', 2026));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Draft order updated', description: expect.stringContaining('1 traded pick applied. 1 waiting: Cy or Alice has not claimed a team yet.') })));
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(api.getCarryover.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('a refusal from the server is shown as a toast', async () => {
    api.getCarryover.mockResolvedValue({ data: carry });
    api.applyTradedPicks.mockRejectedValue(new Error('The draft is in_progress. Traded picks can only be applied before it starts.'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Apply 1 traded pick to the 2026-27 draft order' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "That didn't apply", description: expect.stringContaining('The draft is in_progress') })));
  });

  it('renders nothing when there is nothing to carry over', async () => {
    api.getCarryover.mockResolvedValue({ data: { draftSeason: 2026, keepers: { season: null, seasonYear: 2026, rows: [], ready: 0, blocked: 0 }, picks: [] } });
    mount();
    await waitFor(() => expect(api.getCarryover).toHaveBeenCalled());
    expect(screen.queryByTestId('carryover')).toBeNull();
  });
});

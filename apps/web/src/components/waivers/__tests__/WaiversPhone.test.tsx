// THE WAIVER WIRE ON A PHONE (2026-09-04). Pins: the two facts (priority or
// the FAAB budget, the next run), the rows with the figure that matters and
// ADD / CLAIM by state, the claim sheet with the bid stepper and the drop
// picker writing through, and the claims with CANCEL on the pending ones.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { WaiversPhone, type WirePlayer } from '../WaiversPhone';
import type { WaiverClaim } from '@/services/WaiverService';

afterEach(() => {
  cleanup();
});

const wire = (id: number, over: Partial<WirePlayer> = {}): WirePlayer => ({
  player_id: id,
  full_name: `Player ${id}`,
  position_code: 'C',
  team_abbrev: 'EDM',
  is_goalie: false,
  games_played: 24,
  points: 10 + id,
  wins: 0,
  save_percentage: null,
  ...over,
});

const claim = (id: string, status: WaiverClaim['status'], over: Partial<WaiverClaim> = {}): WaiverClaim => ({
  id,
  league_id: 'L',
  team_id: 'T',
  player_id: 1,
  drop_player_id: null,
  priority: 3,
  bid_amount: null,
  is_conditional_drop: false,
  status,
  created_at: '2026-09-04T18:00:00Z',
  processed_at: null,
  failure_reason: null,
  ...over,
});

const mount = (over: Partial<React.ComponentProps<typeof WaiversPhone>> = {}) => {
  const props = {
    loading: false,
    myPriority: 7,
    teamCount: 12,
    isFAAB: false,
    faabBudget: null,
    processTime: '2:00 AM MT',
    periodHours: 48,
    gameLock: true,
    searchQuery: '',
    onSearchQuery: vi.fn(),
    positions: [{ key: 'all', label: 'ALL' }, { key: 'C', label: 'C' }],
    position: 'all',
    onPosition: vi.fn(),
    players: [wire(1), wire(2, { team_abbrev: 'TOR' }), wire(3, { position_code: 'G', is_goalie: true, wins: 4, save_percentage: 0.912 })],
    playersLoading: false,
    lockedTeams: new Set(['TOR']),
    clearsAt: new Map([['3', '2026-09-06T08:00:00Z']]),
    formatMoment: () => 'Sat 2:00 AM',
    selected: null,
    onSelect: vi.fn(),
    roster: [{ player_id: 9, full_name: 'Bench Guy', position_code: 'D', team_abbrev: 'COL' }],
    dropPlayerId: null,
    onDropPlayer: vi.fn(),
    bidAmount: 0,
    onBidAmount: vi.fn(),
    onSubmit: vi.fn(),
    claims: [claim('a', 'pending', { drop_player_id: 9 }), claim('b', 'failed', { failure_reason: 'Another team had higher priority' })],
    claimPlayers: new Map([
      [1, { full_name: 'Player 1', position: 'C', team: 'EDM' }],
      [9, { full_name: 'Bench Guy', position: 'D', team: 'COL' }],
    ]),
    onCancelClaim: vi.fn(),
    nextRunFor: () => 'Fri 2:00 AM',
    ...over,
  };
  render(<WaiversPhone {...props} />);
  return props;
};

describe('WaiversPhone', () => {
  it('leads with the priority and the next run, then the rules', () => {
    mount();
    const facts = screen.getByTestId('waivers-phone-facts');
    expect(facts).toHaveTextContent('#7');
    expect(facts).toHaveTextContent('OF 12');
    expect(facts).toHaveTextContent('2:00 AM MT');
    expect(screen.getByText('48 hours')).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
  });

  it('a FAAB league shows the budget with its bar instead of a priority', () => {
    mount({ isFAAB: true, faabBudget: 63 });
    const facts = screen.getByTestId('waivers-phone-facts');
    expect(facts).toHaveTextContent('$63');
    expect(facts).not.toHaveTextContent('#7');
  });

  it('rows carry the figure that matters and ADD or CLAIM by state', () => {
    mount();
    const rows = screen.getAllByTestId('waivers-phone-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('11')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('button', { name: 'ADD' })).toBeInTheDocument();
    // TOR is game-locked → CLAIM and the note.
    expect(within(rows[1]).getByRole('button', { name: 'CLAIM' })).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('Game-locked');
    // The goalie shows wins and the clear time.
    expect(within(rows[2]).getByText('4')).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('91.2 SV%');
    expect(rows[2]).toHaveTextContent('On waivers · clears Sat 2:00 AM');
  });

  it('tapping a row or its pill hands the player to the caller', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add Player 1' }));
    expect(p.onSelect).toHaveBeenCalledTimes(1);
    expect((p.onSelect as ReturnType<typeof vi.fn>).mock.calls[0][0].player_id).toBe(1);
  });

  it('the claim sheet carries the drop picker and submits through the caller', () => {
    const p = mount({ selected: wire(1) });
    const sheet = screen.getByTestId('waivers-phone-sheet');
    expect(sheet).toHaveTextContent('WAIVER CLAIM');
    fireEvent.click(within(sheet).getByRole('button', { name: /Drop/ }));
    fireEvent.click(screen.getByRole('option', { name: /Bench Guy/ }));
    expect(p.onDropPlayer).toHaveBeenCalledWith(9);
    fireEvent.click(within(sheet).getByRole('button', { name: 'SUBMIT CLAIM' }));
    expect(p.onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.click(within(sheet).getByRole('button', { name: 'CANCEL' }));
    expect(p.onSelect).toHaveBeenCalledWith(null);
  });

  it('a FAAB sheet steps the bid within the budget and names it on the button', () => {
    const p = mount({ isFAAB: true, faabBudget: 5, selected: wire(1), bidAmount: 5 });
    const sheet = screen.getByTestId('waivers-phone-sheet');
    fireEvent.click(within(sheet).getByRole('button', { name: 'More' }));
    expect(p.onBidAmount).toHaveBeenCalledWith(5);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Less' }));
    expect(p.onBidAmount).toHaveBeenCalledWith(4);
    expect(within(sheet).getByRole('button', { name: 'SUBMIT $5 BID' })).toBeInTheDocument();
  });

  it('claims: the pending one first with CANCEL and its run, the settled ones dimmed with their reason', () => {
    const p = mount();
    const claims = screen.getAllByTestId('waivers-phone-claim');
    expect(claims[0]).toHaveAttribute('data-status', 'pending');
    expect(claims[0]).toHaveTextContent('DROP Bench Guy');
    expect(claims[0]).toHaveTextContent('PRIORITY #3 · RUNS FRI 2:00 AM');
    fireEvent.click(within(claims[0]).getByRole('button', { name: 'CANCEL' }));
    expect(p.onCancelClaim).toHaveBeenCalledWith('a');
    expect(claims[1]).toHaveAttribute('data-status', 'failed');
    expect(claims[1]).toHaveTextContent('Another team had higher priority');
    expect(within(claims[1]).queryByRole('button', { name: 'CANCEL' })).toBeNull();
  });

  it('an empty wire and no claims each say so', () => {
    mount({ players: [], claims: [] });
    expect(screen.getByTestId('waivers-phone-empty')).toHaveTextContent('The wire is empty');
    expect(screen.getByTestId('waivers-phone-no-claims')).toBeInTheDocument();
  });
});

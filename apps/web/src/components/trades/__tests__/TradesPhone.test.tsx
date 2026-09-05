// THE TRADE CENTER ON A PHONE (2026-09-04). Pins: the partner picker, the
// two rosters as toggles that write through, PROPOSE enabled only with both
// sides and a partner, and the offers tab with ACCEPT / REJECT on what was
// received, CANCEL on what was sent, and the settled ones dimmed.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { TradesPhone } from '../TradesPhone';
import type { Player } from '@/services/PlayerService';
import type { TradeOfferWithPlayers } from '@/services/TradeService';

afterEach(() => {
  cleanup();
});

const player = (id: string, name: string, points = 10): Player =>
  ({ id, full_name: name, position: 'C', eligible_positions: ['C'], team: 'EDM', jersey_number: null, status: null, headshot_url: null, last_updated: null, games_played: 10, points }) as unknown as Player;

const offer = (id: string, from: string, to: string, status: TradeOfferWithPlayers['status']): TradeOfferWithPlayers =>
  ({
    id, league_id: 'L', from_team_id: from, to_team_id: to, from_team_name: `Team ${from}`, to_team_name: `Team ${to}`,
    offered_player_ids: [1], requested_player_ids: [2],
    offered_players: [{ player_id: 1, full_name: 'Given One', position_code: 'C', team_abbrev: 'EDM' }],
    requested_players: [{ player_id: 2, full_name: 'Wanted One', position_code: 'D', team_abbrev: 'COL' }],
    status, message: null, created_at: '2026-09-04T18:00:00Z', expires_at: null, processed_at: null, counter_offer_id: null,
    review_type: 'none', review_started_at: null, review_ends_at: null, vetoed_at: null,
  }) as TradeOfferWithPlayers;

const mount = (over: Partial<React.ComponentProps<typeof TradesPhone>> = {}) => {
  const props = {
    tab: 'propose' as const,
    onTab: vi.fn(),
    loading: false,
    draftNotCompleted: false,
    partners: [{ id: 't2', name: 'Puck Norris', roster: [player('9', 'Their Guy', 20)] }],
    partnerId: '',
    onPartner: vi.fn(),
    myRoster: [player('1', 'My Guy', 30), player('2', 'My Other Guy', 5)],
    mySelected: [] as string[],
    onToggleMine: vi.fn(),
    theirSelected: [] as string[],
    onToggleTheirs: vi.fn(),
    searchMine: '',
    onSearchMine: vi.fn(),
    searchTheirs: '',
    onSearchTheirs: vi.fn(),
    myValue: 0,
    theirValue: 0,
    opinion: 'Select players to analyze trade.',
    message: '',
    onMessage: vi.fn(),
    onPropose: vi.fn(),
    onClear: vi.fn(),
    onOpenPlayer: vi.fn(),
    offers: [] as TradeOfferWithPlayers[],
    myTeamId: 't1',
    offersError: false,
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  render(<TradesPhone {...props} />);
  return props;
};

describe('TradesPhone · propose', () => {
  it('starts with the partner unchosen, your roster as toggles, and PROPOSE disabled', () => {
    const p = mount();
    expect(screen.getByText('Choose')).toBeInTheDocument();
    expect(screen.getAllByTestId('trade-send-row')).toHaveLength(2);
    expect(screen.getByText('Pick a trading partner to see their roster.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PROPOSE TRADE' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Add My Guy from what you send/ }));
    expect(p.onToggleMine).toHaveBeenCalledWith('1');
  });

  it('the partner picker writes through; their roster then appears with its own toggles', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: /Trading partner/ }));
    fireEvent.click(screen.getByRole('option', { name: /Puck Norris/ }));
    expect(p.onPartner).toHaveBeenCalledWith('t2');
    cleanup();
    const q = mount({ partnerId: 't2', mySelected: ['1'], theirSelected: ['9'], myValue: 30, theirValue: 20 });
    expect(screen.getAllByTestId('trade-get-row')).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: /Remove Their Guy to what you get/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('trades-phone-values')).toHaveTextContent('YOU SEND30YOU GET20DIFF-10');
    const propose = screen.getByRole('button', { name: 'PROPOSE TRADE' });
    expect(propose).not.toBeDisabled();
    fireEvent.click(propose);
    expect(q.onPropose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'CLEAR' }));
    expect(q.onClear).toHaveBeenCalledTimes(1);
  });

  it('a face tap opens the card; the search narrows the list', () => {
    const p = mount({ searchMine: 'other' });
    expect(screen.getAllByTestId('trade-send-row')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Open player card for My Other Guy' }));
    expect(p.onOpenPlayer).toHaveBeenCalledTimes(1);
  });

  it('before the draft it says trades open after it', () => {
    mount({ draftNotCompleted: true });
    expect(screen.getByTestId('trades-phone-predraft')).toBeInTheDocument();
  });
});

describe('TradesPhone · offers', () => {
  it('received offers carry ACCEPT / REJECT, sent ones CANCEL, settled ones a tag', () => {
    const p = mount({
      tab: 'offers',
      offers: [offer('a', 't2', 't1', 'pending'), offer('b', 't1', 't3', 'pending'), offer('c', 't1', 't4', 'accepted')],
    });
    expect(screen.getByRole('tab', { name: 'Offers · 2' })).toBeInTheDocument();
    const cards = screen.getAllByTestId('trades-phone-offer');
    expect(cards.map((c) => c.getAttribute('data-direction'))).toEqual(['received', 'sent', 'settled']);
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'ACCEPT' }));
    expect(p.onAccept).toHaveBeenCalledWith('a');
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'REJECT' }));
    expect(p.onReject).toHaveBeenCalledWith('a');
    fireEvent.click(within(cards[1]).getByRole('button', { name: 'CANCEL OFFER' }));
    expect(p.onCancel).toHaveBeenCalledWith('b');
    expect(cards[2]).toHaveTextContent('accepted');
    expect(cards[2]).toHaveTextContent('Given One for Wanted One');
  });

  it('no offers says so; the review block mounts above', () => {
    mount({ tab: 'offers', review: <div data-testid="review-block" /> });
    expect(screen.getByTestId('review-block')).toBeInTheDocument();
    expect(screen.getByTestId('trades-phone-no-offers')).toBeInTheDocument();
  });
});

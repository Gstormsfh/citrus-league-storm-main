/**
 * IMPORT (2026-09-14): one season's draft, trades, keepers and weeks, with
 * trades shown one line per trade even though they arrive one asset each.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ getSeasonDetail: vi.fn() }));
vi.mock('@/api/imports', () => ({ importApi: api }));

import { SeasonDetail } from '../SeasonDetail';
import { groupTrades } from '../trades';

const nameOf = (id: string | null | undefined) => ({ A: 'Alice', B: 'Bob', C: 'Cy' }[id ?? ''] ?? 'Unknown manager');
const tx = (over: Record<string, unknown>) => ({ id: Math.random().toString(36).slice(2), occurred_at: '2024-01-15T00:00:00.000Z', type: 'trade', member_id: 'A', counterparty_member_id: 'B', nhl_player_id: null, external_player_id: null, external_player_name: null, pick_season: null, pick_round: null, pick_original_member_id: null, faab_bid: null, external_transaction_id: null, source: 'yahoo', ...over });

const detail = {
  season: 2023,
  picks: [
    { overall_pick: 1, round: 1, pick_in_round: 1, member_id: 'B', nhl_player_id: 8478402, external_player_id: 'x', external_player_name: 'Connor McDavid', is_keeper: true, keeper_cost: 'Round 1', auction_cost: null, source: 'yahoo' },
    { overall_pick: 2, round: 1, pick_in_round: 2, member_id: 'A', nhl_player_id: null, external_player_id: 'y', external_player_name: 'Cale Makar', is_keeper: false, keeper_cost: null, auction_cost: null, source: 'yahoo' },
  ],
  transactions: [
    tx({ member_id: 'A', counterparty_member_id: 'B', external_player_name: 'Connor McDavid' }),
    tx({ member_id: 'B', counterparty_member_id: 'A', pick_season: 2024, pick_round: 1, pick_original_member_id: 'A' }),
    tx({ member_id: 'B', counterparty_member_id: 'A', pick_season: 2024, pick_round: 2 }),
    tx({ type: 'add', member_id: 'C', counterparty_member_id: null, external_player_name: 'Some Rookie', occurred_at: null }),
  ],
  matchups: [{ week: 23, home_member_id: 'A', away_member_id: 'B', home_score: 101.5, away_score: 99, home_cat_wins: null, home_cat_losses: null, home_cat_ties: null, is_playoff: true, is_consolation: false, is_championship: true, winner_member_id: 'A', is_tie: false }],
  keepers: [{ member_id: 'B', external_player_id: 'x', external_player_name: 'Connor McDavid', nhl_player_id: 8478402, round: 1, round_next: 1, years_kept: 2, source: 'yahoo' }],
};

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><SeasonDetail leagueId="l-1" season={2023} nameOf={nameOf} /></QueryClientProvider>);
}

beforeEach(() => api.getSeasonDetail.mockReset());

describe('groupTrades', () => {
  it('folds asset rows into one trade with what each side received; adds are not trades', () => {
    const g = groupTrades(detail.transactions);
    expect(g).toHaveLength(1);
    expect(g[0].sides).toEqual([
      { memberId: 'A', assets: ['Connor McDavid'] },
      { memberId: 'B', assets: ['2024-25 round 1 pick', '2024-25 round 2 pick'] },
    ]);
  });
});

describe('SeasonDetail', () => {
  it('shows the draft first, with keepers marked, and switches to trades, keepers and weeks', async () => {
    api.getSeasonDetail.mockResolvedValue({ data: detail });
    mount();
    const draft = await screen.findByRole('list', { name: '2023-24 draft' });
    expect(draft.textContent).toContain('1.01');
    expect(draft.textContent).toContain('Connor McDavid');
    expect(draft.textContent).toContain('KEEPER');
    expect(draft.textContent).toContain('Bob');
    expect(screen.getByRole('tab', { name: 'Trades · 1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Trades · 1' }));
    const trades = screen.getByRole('list', { name: '2023-24 trades' });
    expect(trades.textContent).toContain('Alice gets Connor McDavid');
    expect(trades.textContent).toContain('Bob gets 2024-25 round 1 pick, 2024-25 round 2 pick');
    fireEvent.click(screen.getByRole('tab', { name: 'Keepers · 1' }));
    expect(screen.getByRole('list', { name: '2023-24 keepers' }).textContent).toContain('Connor McDavid');
    fireEvent.click(screen.getByRole('tab', { name: 'Weeks · 1' }));
    const weeks = screen.getByRole('list', { name: '2023-24 weekly results' });
    expect(weeks.textContent).toContain('Wk 23');
    expect(weeks.textContent).toContain('101.5 - 99');
    expect(weeks.textContent).toContain('FINAL');
  });

  it('renders nothing for a season with only standings', async () => {
    api.getSeasonDetail.mockResolvedValue({ data: { season: 2023, picks: [], transactions: [], matchups: [], keepers: [] } });
    mount();
    await waitFor(() => expect(api.getSeasonDetail).toHaveBeenCalledWith('l-1', 2023));
    expect(screen.queryByTestId('season-detail-2023')).toBeNull();
  });
});

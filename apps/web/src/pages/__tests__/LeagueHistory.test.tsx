/**
 * IMPORT (2026-09-13): the trophy room asks "which one is you?" on the
 * server's word, not on whether the person has a member row. The foundation
 * seed gave every current team owner a row with no history, so a page that
 * treated "has a row" as "has claimed" would never ask anyone who mattered.
 * Everything below importApi is mocked; the room's own parts have their
 * own tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ getHistory: vi.fn(), listUnclaimed: vi.fn(), claim: vi.fn() }));
const leagueApiMock = vi.hoisted(() => ({ getLeague: vi.fn(), getTeams: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/api/imports', () => ({ importApi: api }));
vi.mock('@/api/leagues', () => ({ leagueApi: leagueApiMock }));
vi.mock('@/components/Navbar', () => ({ default: () => null }));
vi.mock('@/components/pressbox/LeagueChrome', () => ({ PressBoxLeagueChrome: ({ leagueName }: { leagueName: string | null }) => <div data-testid="chrome">{leagueName}</div> }));
vi.mock('@/components/history/CommissionerHistoryTools', () => ({ CommissionerHistoryTools: () => <div data-testid="commissioner-tools" /> }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-dee' }, loading: false }) }));

import LeagueHistory from '../LeagueHistory';

const history = {
  league: { id: 'l-1', name: 'The Puck Stops Here', founded_season: 2019, imported_from: 'espn', history_locked: false },
  seasons: [{ season: 2019, platform: 'espn', team_count: 4, champion: 'Alice', runner_up: 'Bob', regular_season_winner: 'Alice' }],
  standings: [{ season: 2019, member_id: 'A', team_name: 'Dangle Dynasty', rank: 1, wins: 15, losses: 5, ties: 0, points_for: 1200, points_against: 800, made_playoffs: true, playoff_finish: 1, playoff_seed: 1, category_record: null }],
  members: [
    { member_id: 'A', display_name: 'Alice', owner_id: 'user-alice', first_season: 2019, last_season: 2019, seasons_played: 1, titles: 1, finals_lost: 0, playoff_seasons: 1, best_finish: 1, career_wins: 15, career_losses: 5, career_ties: 0 },
    { member_id: 'B', display_name: 'Bob', owner_id: null, first_season: 2019, last_season: 2019, seasons_played: 1, titles: 0, finals_lost: 1, playoff_seasons: 1, best_finish: 2, career_wins: 5, career_losses: 15, career_ties: 0 },
    // The signed-in member's seeded row: in the league now, no history attached yet.
    { member_id: 'D', display_name: 'Dee', owner_id: 'user-dee', first_season: null, last_season: null, seasons_played: 0, titles: 0, finals_lost: 0, playoff_seasons: 0, best_finish: null, career_wins: 0, career_losses: 0, career_ties: 0 },
  ],
  trophies: [],
  sources: [{ platform: 'espn', externalLeagueId: '777', season: 2019, isPublicSource: true }],
  importedSettings: null,
  unmatchedPlayers: [],
};
const bob = { id: 'B', display_name: 'Bob', first_season: 2019, last_season: 2019, titles: 0, seasons_played: 1, playoff_seasons: 1, best_finish: 2 };

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/league/l-1/history']}>
        <Routes><Route path="/league/:leagueId/history" element={<LeagueHistory />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of [...Object.values(api), ...Object.values(leagueApiMock)]) fn.mockReset();
  toast.mockReset();
  api.getHistory.mockResolvedValue({ data: history });
  leagueApiMock.getLeague.mockResolvedValue({ data: { id: 'l-1', name: 'The Puck Stops Here', commissioner_id: 'user-alice' } });
  leagueApiMock.getTeams.mockResolvedValue({ data: [] });
});

describe('LeagueHistory: which one is you?', () => {
  it('a member with a seeded row and no claim is asked, and one tap claims', async () => {
    api.listUnclaimed.mockResolvedValue({ data: { members: [bob], attached: false } });
    api.claim.mockResolvedValue({ data: { member_id: 'B', league_id: 'l-1', display_name: 'Bob', claim_method: 'list_pick' } });
    mount();
    const card = await screen.findByTestId('claim-card');
    expect(card.textContent).toContain('Which one is you?');
    expect(card.textContent).toContain('Bob');
    fireEvent.click(screen.getByRole('radio', { name: /Bob/ }));
    fireEvent.click(screen.getByRole('button', { name: 'This is me' }));
    await waitFor(() => expect(api.claim).toHaveBeenCalledWith('l-1', 'B'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "It's yours" })));
    // The room refreshes both reads after a claim.
    await waitFor(() => expect(api.getHistory).toHaveBeenCalledTimes(2));
    expect(api.listUnclaimed.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('a member already attached to their history is not asked, even with others unclaimed', async () => {
    api.listUnclaimed.mockResolvedValue({ data: { members: [bob], attached: true } });
    mount();
    await screen.findByTestId('history-managers');
    await waitFor(() => expect(api.listUnclaimed).toHaveBeenCalled());
    expect(screen.queryByTestId('claim-card')).toBeNull();
  });

  it('a league with no history never asks', async () => {
    api.getHistory.mockResolvedValue({ data: { ...history, seasons: [], standings: [], members: [], sources: [] } });
    mount();
    expect(await screen.findByText("This league's history starts here.")).toBeInTheDocument();
    expect(api.listUnclaimed).not.toHaveBeenCalled();
  });
});

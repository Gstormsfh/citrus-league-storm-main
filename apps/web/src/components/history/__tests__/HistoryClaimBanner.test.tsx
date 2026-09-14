/**
 * IMPORT (2026-09-13): the HQ banner asks "which one is you?" exactly while
 * the server says the person still needs asking, and stays quiet otherwise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ listUnclaimed: vi.fn() }));
vi.mock('@/api/imports', () => ({ importApi: api }));

import { HistoryClaimBanner, type HistoryClaimBannerProps } from '../HistoryClaimBanner';

const bob = { id: 'B', display_name: 'Bob', first_season: 2019, last_season: 2024, titles: 1, seasons_played: 6, playoff_seasons: 3, best_finish: 1 };

function mount(props: Partial<HistoryClaimBannerProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><HistoryClaimBanner leagueId="l-1" {...props} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.listUnclaimed.mockReset();
  try { window.localStorage.clear(); } catch { /* fine */ }
});

describe('HistoryClaimBanner', () => {
  it('asks a member who has not claimed, counts the managers, and sends them to the trophy room', async () => {
    api.listUnclaimed.mockResolvedValue({ data: { members: [bob, { ...bob, id: 'C', display_name: 'Cy' }], attached: false } });
    mount();
    const banner = await screen.findByTestId('history-claim-banner');
    expect(banner.textContent).toContain('2 managers from past seasons have no account attached yet. Which one is you?');
    expect(screen.getByRole('link', { name: 'Find yourself' })).toHaveAttribute('href', '/league/l-1/history');
    expect(api.listUnclaimed).toHaveBeenCalledWith('l-1');
  });

  it('one manager reads as one', async () => {
    api.listUnclaimed.mockResolvedValue({ data: { members: [bob], attached: false } });
    mount();
    expect((await screen.findByTestId('history-claim-banner')).textContent).toContain('One manager from past seasons has no account attached yet.');
  });

  it('stays quiet once the person is attached, and when nobody is left to claim', async () => {
    api.listUnclaimed.mockResolvedValueOnce({ data: { members: [bob], attached: true } });
    const first = mount();
    await waitFor(() => expect(api.listUnclaimed).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('history-claim-banner')).toBeNull();
    first.unmount();
    api.listUnclaimed.mockResolvedValueOnce({ data: { members: [], attached: false } });
    mount();
    await waitFor(() => expect(api.listUnclaimed).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('history-claim-banner')).toBeNull();
  });

  it('does not ask before sign-in resolves', () => {
    mount({ enabled: false });
    expect(api.listUnclaimed).not.toHaveBeenCalled();
    expect(screen.queryByTestId('history-claim-banner')).toBeNull();
  });

  it('a manager who is new to the league dismisses it for this league on this device', async () => {
    api.listUnclaimed.mockResolvedValue({ data: { members: [bob], attached: false } });
    const first = mount();
    fireEvent.click(await screen.findByRole('button', { name: "I'm new here" }));
    expect(screen.queryByTestId('history-claim-banner')).toBeNull();
    first.unmount();
    mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('history-claim-banner')).toBeNull();
    expect(api.listUnclaimed).toHaveBeenCalledTimes(1);
    // Another league is still asked.
    mount({ leagueId: 'l-2' });
    expect(await screen.findByTestId('history-claim-banner')).toBeInTheDocument();
  });
});

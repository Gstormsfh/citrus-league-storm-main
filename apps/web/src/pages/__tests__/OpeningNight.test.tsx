/** OPENING NIGHT PICK'EM (2026-09-09): lead gen with the slate from the API, never typed by hand. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const openingNight = vi.fn();
const addToWaitlist = vi.fn();
vi.mock('@/api/public', () => ({ publicApi: { openingNight: () => openingNight() } }));
vi.mock('@/services/WaitlistService', () => ({ WaitlistService: { addToWaitlist: (...a: unknown[]) => addToWaitlist(...a) } }));
vi.mock('@/components/Navbar', () => ({ default: () => null }));
vi.mock('@/components/citrus2', () => ({
  DarkLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  HockeyFooter: () => null,
  MascotAvatar: () => null,
  GlowCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LivePulse: () => null,
}));
vi.mock('@/components/pressbox/TeamMark', () => ({ PressBoxTeamMark: ({ abbrev }: { abbrev: string }) => <span>{abbrev}</span> }));

import OpeningNight, { OPENING_NIGHT_SOURCE } from '../OpeningNight';

const SLATE = {
  date: '2026-10-07',
  games: [
    { game_id: 1, game_time: '2026-10-08T00:00:00Z', home_team: 'EDM', away_team: 'CGY', venue: null },
    { game_id: 2, game_time: '2026-10-08T02:30:00Z', home_team: 'VAN', away_team: 'SEA', venue: null },
  ],
};

beforeEach(() => {
  openingNight.mockReset();
  addToWaitlist.mockReset();
});

const mount = () => render(<MemoryRouter><OpeningNight /></MemoryRouter>);

describe('OpeningNight', () => {
  it('draws the slate from the API and will not lock picks until every game is picked', async () => {
    openingNight.mockResolvedValue({ data: SLATE });
    mount();
    expect(await screen.findByTestId('opening-night-games')).toBeInTheDocument();
    expect(screen.getByTestId('opening-night-progress').textContent).toBe('0 of 2 picked');
    fireEvent.change(screen.getByLabelText(/Where should we send/), { target: { value: 'g@x.com' } });
    expect(screen.getByRole('button', { name: 'Lock my picks' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Pick EDM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick SEA' }));
    expect(screen.getByTestId('opening-night-progress').textContent).toBe('2 of 2 picked');
    expect(screen.getByRole('button', { name: 'Lock my picks' })).toBeEnabled();
  });

  it('sends the picks with the email under the pick\'em source', async () => {
    openingNight.mockResolvedValue({ data: SLATE });
    addToWaitlist.mockResolvedValue({ success: true, message: 'in' });
    mount();
    await screen.findByTestId('opening-night-games');
    fireEvent.click(screen.getByRole('button', { name: 'Pick EDM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick VAN' }));
    fireEvent.change(screen.getByLabelText(/Where should we send/), { target: { value: 'g@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lock my picks' }));
    await waitFor(() => expect(addToWaitlist).toHaveBeenCalled());
    const [email, source, metadata] = addToWaitlist.mock.calls[0] as [string, string, { date: string; picks: Array<{ game_id: number; pick: string }> }];
    expect(email).toBe('g@x.com');
    expect(source).toBe(OPENING_NIGHT_SOURCE);
    expect(metadata.date).toBe('2026-10-07');
    expect(metadata.picks.map((p) => p.pick)).toEqual(['EDM', 'VAN']);
    expect(await screen.findByText("You're in.")).toBeInTheDocument();
  });

  it('with no slate published it is a plain email capture that says so', async () => {
    openingNight.mockResolvedValue({ data: { date: null, games: [] } });
    addToWaitlist.mockResolvedValue({ success: true, message: 'in' });
    mount();
    expect(await screen.findByText(/slate is not published yet/)).toBeInTheDocument();
    expect(screen.queryByTestId('opening-night-games')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Where should we send/), { target: { value: 'g@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Notify me' }));
    await waitFor(() => expect(addToWaitlist).toHaveBeenCalledWith('g@x.com', OPENING_NIGHT_SOURCE, expect.objectContaining({ date: null })));
  });
});

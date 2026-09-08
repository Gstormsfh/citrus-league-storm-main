/**
 * INVITE ACCEPT (2026-09-09, #19): the link shows who is inviting you to what
 * and joins on Accept, never on arrival.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const getInvite = vi.fn();
const joinLeagueByCode = vi.fn();
const refreshLeagues = vi.fn(async () => {});

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-me' } }) }));
vi.mock('@/contexts/LeagueContext', () => ({ useLeague: () => ({ refreshLeagues }) }));
vi.mock('@/components/Navbar', () => ({ default: () => null }));
vi.mock('@/components/citrus2', () => ({
  DarkLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MascotAvatar: () => null,
}));
vi.mock('@/api/leagues', () => ({ leagueApi: { getInvite: (...a: unknown[]) => getInvite(...a) } }));
vi.mock('@/services/LeagueService', () => ({ LeagueService: { joinLeagueByCode: (...a: unknown[]) => joinLeagueByCode(...a) } }));

import InviteAccept from '../InviteAccept';

const INVITE = {
  leagueId: 'L1',
  name: 'Final Build #15',
  leagueType: 'fantasy',
  commissionerName: 'Garrett Storms',
  draftStatus: 'not_started',
  filled: 1,
  maxTeams: 10,
  alreadyMember: false,
};

function Probe({ label }: { label: string }) {
  return <div data-testid="probe">{label}</div>;
}

function mount(code = 'QHNEPZ') {
  return render(
    <MemoryRouter initialEntries={[`/join/${code}`]}>
      <Routes>
        <Route path="/join/:code" element={<InviteAccept />} />
        <Route path="/league/:id" element={<Probe label="league" />} />
        <Route path="/gm-office" element={<Probe label="gm-office" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getInvite.mockReset();
  joinLeagueByCode.mockReset();
  refreshLeagues.mockClear();
});

describe('InviteAccept', () => {
  it('shows who is inviting you, to what, and how full it is, and does NOT join on arrival', async () => {
    getInvite.mockResolvedValue({ data: INVITE });
    mount();
    expect(await screen.findByText('Join Final Build #15?')).toBeInTheDocument();
    expect(screen.getByText('Garrett Storms invited you.')).toBeInTheDocument();
    expect(screen.getByTestId('invite-seats').textContent).toMatch(/1 of 10 teams in · 9 seats open/);
    expect(getInvite).toHaveBeenCalledWith('QHNEPZ');
    expect(joinLeagueByCode).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Accept and join' })).toBeEnabled();
  });

  it('joins with the code and the chosen team name on Accept, then lands on the league', async () => {
    getInvite.mockResolvedValue({ data: INVITE });
    joinLeagueByCode.mockResolvedValue({ league: { id: 'L1', name: 'Final Build #15' }, team: { id: 't' }, error: null });
    mount();
    await screen.findByText('Join Final Build #15?');
    fireEvent.change(screen.getByLabelText(/Team name/), { target: { value: 'Puck Norris' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept and join' }));
    await waitFor(() => expect(joinLeagueByCode).toHaveBeenCalledWith('QHNEPZ', 'u-me', 'Puck Norris'));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('league'));
    expect(refreshLeagues).toHaveBeenCalled();
  });

  it('refuses an offensive team name before the request and says why', async () => {
    getInvite.mockResolvedValue({ data: INVITE });
    mount();
    await screen.findByText('Join Final Build #15?');
    fireEvent.change(screen.getByLabelText(/Team name/), { target: { value: 'sh1t show' } });
    expect(screen.getByRole('alert').textContent).toMatch(/Keep it clean/);
    expect(screen.getByRole('button', { name: 'Accept and join' })).toBeDisabled();
    expect(joinLeagueByCode).not.toHaveBeenCalled();
  });

  it('tells a member they are already in, with a way into the league', async () => {
    getInvite.mockResolvedValue({ data: { ...INVITE, alreadyMember: true, filled: 4 } });
    mount();
    expect(await screen.findByText('You are already in Final Build #15')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the league' })).toHaveAttribute('href', '/league/L1?league=L1');
    expect(screen.queryByRole('button', { name: 'Accept and join' })).toBeNull();
  });

  it('a full league gets no Accept button', async () => {
    getInvite.mockResolvedValue({ data: { ...INVITE, filled: 10 } });
    mount();
    expect(await screen.findByText(/Every seat is taken/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept and join' })).toBeNull();
  });

  it('an unknown code says so and offers the manual code entry', async () => {
    getInvite.mockRejectedValue(Object.assign(new Error('Invite not found'), { status: 404 }));
    mount('NOPE00');
    expect(await screen.findByText('That invite does not match a league')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Enter a code' })).toHaveAttribute('href', '/create-league?tab=join');
  });

  it('surfaces the join error and keeps the button for another try', async () => {
    getInvite.mockResolvedValue({ data: INVITE });
    joinLeagueByCode.mockResolvedValue({ league: null, team: null, error: new Error('This league is full.') });
    mount();
    await screen.findByText('Join Final Build #15?');
    fireEvent.click(screen.getByRole('button', { name: 'Accept and join' }));
    expect(await screen.findByText('This league is full.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept and join' })).toBeEnabled();
  });
});

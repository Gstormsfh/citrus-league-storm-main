/** BRING YOUR LEAGUE (2026-09-09): the concierge form lands on the waitlist with the league attached. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const addToWaitlist = vi.fn();
vi.mock('@/services/WaitlistService', () => ({ WaitlistService: { addToWaitlist: (...a: unknown[]) => addToWaitlist(...a) } }));
vi.mock('@/components/Navbar', () => ({ default: () => null }));
vi.mock('@/components/citrus2', () => ({
  DarkLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  HockeyFooter: () => null,
  MascotAvatar: () => null,
  GlowCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import BringYourLeague, { BRING_YOUR_LEAGUE_SOURCE } from '../BringYourLeague';

beforeEach(() => addToWaitlist.mockReset());

describe('BringYourLeague', () => {
  it('needs a league name and an email, then sends the league under its source', async () => {
    addToWaitlist.mockResolvedValue({ success: true, message: 'got it' });
    render(<MemoryRouter><BringYourLeague /></MemoryRouter>);
    const button = screen.getByRole('button', { name: 'Set up my league' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('League name'), { target: { value: 'The Frozen Pond' } });
    fireEvent.change(screen.getByLabelText('Teams'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText(/Scoring and roster/), { target: { value: 'H2H points, 2 keepers' } });
    fireEvent.change(screen.getByLabelText('Commissioner email'), { target: { value: 'c@x.com' } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() =>
      expect(addToWaitlist).toHaveBeenCalledWith('c@x.com', BRING_YOUR_LEAGUE_SOURCE, {
        leagueName: 'The Frozen Pond',
        platform: 'Yahoo',
        teams: '12',
        scoring: 'H2H points, 2 keepers',
      }),
    );
    expect(await screen.findByText('Got it.')).toBeInTheDocument();
  });

  it('shows the service message and keeps the form when the send fails', async () => {
    addToWaitlist.mockResolvedValue({ success: false, message: 'Please enter a valid email address' });
    render(<MemoryRouter><BringYourLeague /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('League name'), { target: { value: 'x' } });
    // A syntactically valid address, so the browser's own email validation lets the submit through and the SERVICE is what refuses.
    fireEvent.change(screen.getByLabelText('Commissioner email'), { target: { value: 'bad@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set up my league' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('valid email');
    expect(screen.getByRole('button', { name: 'Set up my league' })).toBeEnabled();
  });
});

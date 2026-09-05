/**
 * LEAGUE HQ IS HOME (2026-09-05). "I want to see LEAGUE HQ when I log in;
 * it adds a lot more value, like a main menu." With an active league the
 * phone's `/` goes to that league's HQ; `?all=1` is the list, which is
 * where SWITCH and a second tap on LEAGUES land.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockAuth = vi.fn();
const mockLeague = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mockAuth() }));
vi.mock('@/contexts/LeagueContext', () => ({ useLeague: () => mockLeague() }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('@/hooks/useSeasonStatus', () => ({ useSeasonStatus: () => ({ status: { isDormant: false, phase: 'regular' } }) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@/components/citrus2', () => ({ Homepage: () => <div data-testid="storefront" /> }));
vi.mock('@/components/home/PressBoxHome', () => ({ PressBoxHome: () => <div data-testid="league-list" /> }));
vi.mock('@/components/LoadingScreen', () => ({ default: () => <div data-testid="loading" /> }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn() } }));

import Index from '../Index';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/league/:id" element={<div data-testid="league-hq" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockAuth.mockReturnValue({ user: { id: 'u1' }, loading: false });
  mockLeague.mockReturnValue({ loading: false, activeLeagueId: 'L1', userLeagues: [{ id: 'L1' }, { id: 'L2' }] });
});

describe('the phone home', () => {
  it('opens the active league\'s HQ', () => {
    renderAt('/');
    expect(screen.getByTestId('league-hq')).toBeInTheDocument();
  });
  it('shows the league list on ?all=1', () => {
    renderAt('/?all=1');
    expect(screen.getByTestId('league-list')).toBeInTheDocument();
  });
  it('shows the list when the active league is not one of the manager\'s', () => {
    mockLeague.mockReturnValue({ loading: false, activeLeagueId: 'gone', userLeagues: [{ id: 'L1' }] });
    renderAt('/');
    expect(screen.getByTestId('league-list')).toBeInTheDocument();
  });
  it('keeps the storefront for a signed-out visitor', () => {
    mockAuth.mockReturnValue({ user: null, loading: false });
    renderAt('/');
    expect(screen.getByTestId('storefront')).toBeInTheDocument();
  });
});

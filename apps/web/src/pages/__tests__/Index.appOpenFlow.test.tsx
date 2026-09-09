/**
 * THE DEFAULT APP FLOW (2026-09-09).
 *
 * Open → league selector → pick a league → its MATCHUP. Reopens land back on
 * that matchup for twelve hours (sliding); past the window the selector is
 * the front door again.
 *
 * This file replaces `Index.leagueHqHome.test.tsx`, which pinned the
 * 2026-09-05 rule ("with an active league the phone's `/` goes to that
 * league's HQ") — deliberately reversed: opening the app is a "what's my
 * score" gesture, and the redirect now expires so a manager returning after
 * a few days picks a league instead of being dropped into the last one.
 * The parts of that rule that did NOT change are still pinned below:
 * `?all=1` is the list, a stale active league falls back to the list, a
 * manager with no leagues never sees the storefront, and a signed-out
 * visitor always does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { markLeagueVisit, LEAGUE_STICKY_MS } from '@/lib/leagueStickiness';

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
        <Route path="/matchup/:leagueId" element={<div data-testid="matchup" />} />
        <Route path="/pool/pickem" element={<div data-testid="pool" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const FANTASY = { id: 'L1', settings: { leagueType: 'fantasy' } };
const OTHER = { id: 'L2', settings: { leagueType: 'fantasy' } };

beforeEach(() => {
  localStorage.clear();
  mockAuth.mockReturnValue({ user: { id: 'u1' }, loading: false });
  mockLeague.mockReturnValue({ loading: false, activeLeagueId: 'L1', userLeagues: [FANTASY, OTHER] });
});

describe('the app open flow', () => {
  it('opens the active league\'s MATCHUP inside the sticky window', () => {
    markLeagueVisit('u1');
    renderAt('/');
    expect(screen.getByTestId('matchup')).toBeInTheDocument();
  });

  it('opens the selector, not HQ, when there is no visit stamp yet', () => {
    // The first open after install/upgrade: nobody is pinned to a league.
    renderAt('/');
    expect(screen.getByTestId('league-list')).toBeInTheDocument();
    expect(screen.queryByTestId('matchup')).toBeNull();
  });

  it('falls back to the selector once the window has passed', () => {
    markLeagueVisit('u1', Date.now() - LEAGUE_STICKY_MS - 1000);
    renderAt('/');
    expect(screen.getByTestId('league-list')).toBeInTheDocument();
  });

  it('never opens League HQ on app open', () => {
    markLeagueVisit('u1');
    renderAt('/');
    expect(screen.queryByTestId('league-hq')).toBeNull();
  });

  it('slides the window on each open, so daily use never sees the selector', () => {
    const elevenHours = 11 * 60 * 60 * 1000;
    markLeagueVisit('u1', Date.now() - elevenHours);
    renderAt('/');
    expect(screen.getByTestId('matchup')).toBeInTheDocument();
    // The open above re-stamped; eleven more hours is still inside the window.
    expect(
      Date.now() - Number(localStorage.getItem('citrus:lastLeagueVisit:u1')),
    ).toBeLessThan(1000);
  });

  it('sends a pool league to its pool route, which has no matchup', () => {
    markLeagueVisit('u1');
    mockLeague.mockReturnValue({
      loading: false,
      activeLeagueId: 'P1',
      userLeagues: [{ id: 'P1', settings: { leagueType: 'pickem' } }],
    });
    renderAt('/');
    expect(screen.getByTestId('pool')).toBeInTheDocument();
  });

  it('shows the league list on ?all=1 even inside the window', () => {
    markLeagueVisit('u1');
    renderAt('/?all=1');
    expect(screen.getByTestId('league-list')).toBeInTheDocument();
  });

  it('shows the list when the active league is not one of the manager\'s', () => {
    markLeagueVisit('u1');
    mockLeague.mockReturnValue({ loading: false, activeLeagueId: 'gone', userLeagues: [FANTASY] });
    renderAt('/');
    expect(screen.getByTestId('league-list')).toBeInTheDocument();
  });

  it('a signed-in manager with no leagues yet gets the app home, never the storefront', () => {
    mockLeague.mockReturnValue({ loading: false, activeLeagueId: null, userLeagues: [] });
    renderAt('/');
    expect(screen.getByTestId('league-list')).toBeInTheDocument();
    expect(screen.queryByTestId('storefront')).toBeNull();
  });

  it('keeps the storefront for a signed-out visitor', () => {
    mockAuth.mockReturnValue({ user: null, loading: false });
    renderAt('/');
    expect(screen.getByTestId('storefront')).toBeInTheDocument();
  });

  it('one account\'s stamp does not pin another', () => {
    markLeagueVisit('someone-else');
    renderAt('/');
    expect(screen.getByTestId('league-list')).toBeInTheDocument();
  });
});

// T12P-T (Entry 39 campaign close, 2026-08-10) — offline integration
// test exercising the full auto-join corridor end-to-end without
// live services.
//
// The T12P-3 source-read locks proved the shapes exist in code. This
// test proves the shapes actually WORK: mount CreateLeague at
// /create-league?code=ABC, stub the RPC layer, watch the effect
// fire, watch handleJoinLeague get called with the code, watch the
// success path navigate + toast + refresh, and watch the top-2
// refusals surface without navigating.
//
// The stubbed RPC return shapes match join_league_with_code (from
// supabase/migrations/20260418100000_idempotent_join_league.sql):
//   - success: { league, team, error: null }
//   - refusal: { league: null, team: null, error: <Error> }
// where <Error> carries the RPC's user-facing message ("This league
// is full." / "Invalid join code. Please check and try again.").

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const mockUseAuth = vi.fn();
const mockUseProfile = vi.fn();
const mockRefreshLeagues = vi.fn(async () => undefined);
const mockSetActiveLeagueId = vi.fn();
const mockJoinLeagueByCode = vi.fn();
const mockToast = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => mockUseProfile(),
}));
vi.mock('@/contexts/LeagueContext', () => ({
  useLeague: () => ({
    refreshLeagues: mockRefreshLeagues,
    setActiveLeagueId: mockSetActiveLeagueId,
    activeLeagueId: null,
    isChangingLeague: false,
  }),
}));
vi.mock('@/services/LeagueService', () => ({
  LeagueService: {
    joinLeagueByCode: (code: string, userId: string, teamName?: string) =>
      mockJoinLeagueByCode(code, userId, teamName),
  },
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      getSession: () => Promise.resolve({ data: { session: null } }),
    },
  },
}));
vi.mock('@/components/Navbar', () => ({ default: () => null }));
vi.mock('@/components/WaitlistSignup', () => ({ default: () => null }));

import CreateLeague from '../CreateLeague';

function DestinationProbe() {
  const location = useLocation();
  return (
    <div data-testid="destination">{location.pathname + location.search}</div>
  );
}

function renderApp(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/create-league" element={<CreateLeague />} />
        <Route path="/league/:id" element={<DestinationProbe />} />
        <Route path="/pool/*" element={<DestinationProbe />} />
        <Route path="/" element={<DestinationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('CreateLeague — T12P-T offline integration (auto-join corridor)', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseProfile.mockReset();
    mockRefreshLeagues.mockClear();
    mockSetActiveLeagueId.mockReset();
    mockJoinLeagueByCode.mockReset();
    mockToast.mockReset();
  });

  it('HAPPY PATH: code + user → auto-join fires → navigate to /league/:id + toast + refresh', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1', email: 'test@example.com' },
      loading: false,
    });
    mockUseProfile.mockReturnValue({ data: { username: 'garrett' } });
    mockJoinLeagueByCode.mockResolvedValue({
      league: {
        id: 'league-abc',
        name: 'The Twelve',
        settings: { leagueType: 'fantasy' },
      },
      team: { id: 'team-1', team_name: 'My Team' },
      error: null,
    });

    renderApp('/create-league?code=ABC123');

    // Assert (1): auto-join effect fires with the code from URL, user
    // from useAuth, and undefined teamName (input empty at auto-join).
    await waitFor(
      () => {
        expect(mockJoinLeagueByCode).toHaveBeenCalledWith(
          'ABC123',
          'user-1',
          undefined,
        );
      },
      { timeout: 1000 },
    );

    // Assert (2): routeToLeague fires the correct destination for a
    // fantasy league (/league/:id?league=:id).
    await waitFor(
      () => {
        const probe = screen.queryByTestId('destination');
        expect(probe?.textContent).toBe('/league/league-abc?league=league-abc');
      },
      { timeout: 1000 },
    );

    // Assert (3): the surrounding contract (refresh, activeLeagueId,
    // success toast) all fire on the happy path.
    expect(mockRefreshLeagues).toHaveBeenCalled();
    expect(mockSetActiveLeagueId).toHaveBeenCalledWith('league-abc');
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Joined League!' }),
    );
  });

  it('FULL-LEAGUE REFUSAL: RPC returns "This league is full." → error surfaces + no navigate', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-2', email: 'invitee@example.com' },
      loading: false,
    });
    mockUseProfile.mockReturnValue({ data: { username: 'zach' } });
    mockJoinLeagueByCode.mockResolvedValue({
      league: null,
      team: null,
      // Shape matches server RPC (LeagueService.ts:199 propagates
      // the RPC error.message from join_league_with_code:71).
      error: new Error('This league is full.'),
    });

    renderApp('/create-league?code=FULL01');

    // Assert (1): auto-join fires with the code.
    await waitFor(
      () => {
        expect(mockJoinLeagueByCode).toHaveBeenCalledWith(
          'FULL01',
          'user-2',
          undefined,
        );
      },
      { timeout: 1000 },
    );

    // Assert (2): error toast fires with the state-name title
    // (COPY_VOICE conformance from T12P-3 :685).
    await waitFor(
      () => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Can't Join Right Now",
            variant: 'destructive',
          }),
        );
      },
      { timeout: 1000 },
    );

    // Assert (3): the RPC error message propagates through to the
    // toast description (the server's user-facing string reaches the
    // user, not a generic client fallback).
    const toastCallArgs = mockToast.mock.calls.find(
      (call) => call[0]?.title === "Can't Join Right Now",
    );
    expect(toastCallArgs?.[0]?.description).toContain('This league is full');

    // Assert (4): no navigation happened; activeLeagueId not set.
    expect(screen.queryByTestId('destination')).toBeNull();
    expect(mockSetActiveLeagueId).not.toHaveBeenCalled();
  });

  it('INVALID-CODE REFUSAL: RPC returns "Invalid join code…" → error surfaces + no navigate', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-3', email: 'wrongcode@example.com' },
      loading: false,
    });
    mockUseProfile.mockReturnValue({ data: { username: 'sam' } });
    mockJoinLeagueByCode.mockResolvedValue({
      league: null,
      team: null,
      // Shape matches join_league_with_code:44 (NOT FOUND branch).
      error: new Error('Invalid join code. Please check and try again.'),
    });

    renderApp('/create-league?code=WRONG');

    // Assert (1): auto-join fires with the bad code.
    await waitFor(
      () => {
        expect(mockJoinLeagueByCode).toHaveBeenCalledWith(
          'WRONG',
          'user-3',
          undefined,
        );
      },
      { timeout: 1000 },
    );

    // Assert (2): destructive toast fires.
    await waitFor(
      () => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Can't Join Right Now",
            variant: 'destructive',
          }),
        );
      },
      { timeout: 1000 },
    );

    // Assert (3): the RPC's "Invalid join code" message propagates.
    const toastCallArgs = mockToast.mock.calls.find(
      (call) => call[0]?.title === "Can't Join Right Now",
    );
    expect(toastCallArgs?.[0]?.description).toContain('Invalid join code');

    // Assert (4): no navigation, no active-league set.
    expect(screen.queryByTestId('destination')).toBeNull();
    expect(mockSetActiveLeagueId).not.toHaveBeenCalled();
  });

  it('IDEMPOTENCY: autoJoinFiredRef prevents a second fire even if searchParams re-emits', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-4', email: 're@example.com' },
      loading: false,
    });
    mockUseProfile.mockReturnValue({ data: { username: 'jo' } });
    mockJoinLeagueByCode.mockResolvedValue({
      league: {
        id: 'league-once',
        name: 'Once',
        settings: { leagueType: 'fantasy' },
      },
      team: { id: 'team-once', team_name: 'Once Team' },
      error: null,
    });

    const { rerender } = renderApp('/create-league?code=ONCE01');

    await waitFor(
      () => {
        expect(mockJoinLeagueByCode).toHaveBeenCalledTimes(1);
      },
      { timeout: 1000 },
    );

    // Force a re-render (simulates a searchParams re-emit that could
    // otherwise re-fire the effect); the autoJoinFiredRef guard must
    // hold and mockJoinLeagueByCode must NOT be called again.
    rerender(
      <MemoryRouter initialEntries={['/create-league?code=ONCE01']}>
        <Routes>
          <Route path="/create-league" element={<CreateLeague />} />
          <Route path="/league/:id" element={<DestinationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    // Give any pending effects a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Still exactly ONE call.
    expect(mockJoinLeagueByCode).toHaveBeenCalledTimes(1);
  });
});

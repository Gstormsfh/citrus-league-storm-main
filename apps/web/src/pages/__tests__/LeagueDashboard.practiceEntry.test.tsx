/**
 * THE RITUAL (2026-09-03, Sleeper-gap 4): the mock draft entry on League HQ.
 *
 * A league learns to draft by drafting, so HQ offers a practice run in the
 * same card as the real Draft Room action. Three things the rendered page
 * must get right, because a screenshot of the wrong state looks fine:
 *
 *   before the draft   the entry is there, a ghost under the real button, and
 *                      it goes to the public simulator, which writes nothing;
 *   during the draft   it is gone. A hot "Join Draft Room" with a practice
 *                      link beside it asks a manager which draft is real;
 *   after the draft    the whole card is gone, and the entry with it.
 *
 * And the sentence under the button is rendered, not just authored: a
 * practice pick must never leave a manager wondering whether it counted.
 *
 * The harness is the one LeagueDashboard.offseason.test.tsx uses: only the
 * boundaries are mocked (contexts, services, API clients, the season hook);
 * the gates and the JSX under test are the real page. The league row is
 * mutable so one harness covers every draft status.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SeasonStatus } from '@citrus/shared';

vi.mock('@/components/Navbar', () => ({ default: () => <nav data-testid="navbar" /> }));
vi.mock('@/components/matchup/LeagueNotifications', () => ({ default: () => null }));
vi.mock('@/components/dashboard/LeagueTimelineCard', () => ({ LeagueTimelineCard: () => null }));
vi.mock('@/components/InvitePlayersButton', () => ({ InvitePlayersButton: () => null }));
vi.mock('@/components/league/ScoringRulesEditor', () => ({ ScoringRulesEditor: () => null }));
vi.mock('@/components/league/KeeperPanel', () => ({ KeeperPanel: () => null }));

// Stable `toast`: `loadLeagueData` lists it in its dependency array, and a
// fresh spy per render would respin the load callback into an update loop.
const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));

// Stable identities for the same reason: `loadLeagueData` closes over `user`.
const USER = { id: 'user-1' };
const PROFILE = { data: { username: 'alex' } };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: USER }) }));
vi.mock('@/hooks/useProfile', () => ({ useProfile: () => PROFILE }));

type DraftStatus = 'not_started' | 'in_progress' | 'completed';

const BASE_LEAGUE = {
  id: 'league-1',
  name: 'Chinook Cup',
  // Not the viewer: a plain member sees "Enter Draft Lobby", the ghost state
  // of the real CTA, which is the state the practice entry must sit under
  // without competing.
  commissioner_id: 'user-9',
  draft_rounds: 21,
  settings: { leagueType: 'fantasy', teamsCount: 12 },
};

/** Mutable per test; read lazily by the service mock at call time. */
let league: typeof BASE_LEAGUE & { draft_status: DraftStatus } = { ...BASE_LEAGUE, draft_status: 'not_started' };

const TEAM = { id: 'team-1', team_name: 'Frost Giants', owner_id: 'user-1' };

vi.mock('@/services/LeagueService', () => ({
  LeagueService: {
    getLeague: vi.fn(async () => ({ league, error: null })),
    getLeagueTeams: vi.fn(async () => ({ teams: [TEAM], error: null })),
    getUserTeam: vi.fn(async () => ({ team: TEAM, error: null })),
  },
}));
vi.mock('@/services/WaiverService', () => ({ WaiverService: { getLeagueWaiverSettings: vi.fn(async () => null) } }));
vi.mock('@/services/TradeService', () => ({ TradeService: {} }));
vi.mock('@/api/leagues', () => ({ leagueApi: {} }));
vi.mock('@/api/waivers', () => ({ waiverApi: {} }));
vi.mock('@/api/rosters', () => ({ rosterApi: { getPlayerIds: vi.fn(async () => ({ data: [] as unknown[] })) } }));

/** In flight, or the request failed: the page renders what it always rendered. */
const UNKNOWN: SeasonStatus = {
  phase: 'unknown',
  hasGamesToday: false,
  lastGameDate: null,
  nextGameDate: null,
  daysUntilNextGame: null,
  daysSinceLastGame: null,
  isDormant: false,
};
vi.mock('@/hooks/useSeasonStatus', () => ({
  useSeasonStatus: () => ({ status: UNKNOWN, headline: null, isLoaded: true }),
  default: () => ({ status: UNKNOWN, headline: null, isLoaded: true }),
}));

import LeagueDashboard from '../LeagueDashboard';

const MOCK_TARGET = '/armchair-gm?tab=mockdraft';
const ENTRY = 'Run a mock draft';
const DISCLAIMER = 'Practice your picks against the computer. Nothing there touches this league.';

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/league/league-1']}>
      <Routes>
        <Route path="/league/:leagueId" element={<LeagueDashboard />} />
      </Routes>
    </MemoryRouter>,
  );

const loaded = () => screen.findByText('League quicklinks', undefined, { timeout: 4000 });

beforeEach(() => {
  toastSpy.mockReset();
});

describe('LeagueDashboard practice entry, before the draft', () => {
  beforeEach(() => {
    league = { ...BASE_LEAGUE, draft_status: 'not_started' };
  });

  it('renders the entry under the real Draft Room action, pointed at the simulator', async () => {
    mount();
    await loaded();

    const entry = screen.getByRole('link', { name: ENTRY });
    expect(entry).toHaveAttribute('href', MOCK_TARGET);
    // The real action is still the card's first button, unchanged.
    expect(screen.getByRole('button', { name: /Enter Draft Lobby/ })).toBeInTheDocument();
  });

  it('is a ghost: no orange fill', async () => {
    mount();
    await loaded();

    // Button's own base classes are merged onto the anchor by asChild, so the
    // rendered class list is checked for the fill that matters, not for the
    // authored string (leagueHqCompositionGuard pins that).
    const entry = screen.getByRole('link', { name: ENTRY });
    expect(entry.className).toContain('bg-transparent');
    expect(entry.className).not.toContain('bg-pastel-orange');
  });

  it('says on the page that a practice pick never counts', async () => {
    mount();
    await loaded();

    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });
});

describe('LeagueDashboard practice entry, once the draft is live or done', () => {
  it('disappears the moment the draft is in progress', async () => {
    league = { ...BASE_LEAGUE, draft_status: 'in_progress' };
    mount();
    await loaded();

    expect(screen.getByRole('button', { name: /Join Draft Room/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: ENTRY })).toBeNull();
    expect(screen.queryByText(DISCLAIMER)).toBeNull();
  });

  it('is gone with the card after the draft completes', async () => {
    league = { ...BASE_LEAGUE, draft_status: 'completed' };
    mount();
    await loaded();

    expect(screen.queryByRole('button', { name: /Draft Room|Draft Lobby/ })).toBeNull();
    expect(screen.queryByRole('link', { name: ENTRY })).toBeNull();
  });
});

/**
 * THERE IS NO WEEK (offseason audit, 2026-09-02).
 *
 * Two claims on the league home were false on the audit date, 80 days after
 * the last NHL game (2026-06-14) and 27 before the next (2026-09-29):
 *
 *   quicklink   "This week's matchup" — a link to a fantasy week that will not
 *               exist for another 27 days, landing on a matchup screen the
 *               same audit found printing "Final" over "0.0 - 0.0"
 *   squad card  "Draft complete. Set your opening lineup" — an instruction the
 *               reader cannot carry out. Every row of that lineup reads
 *               "No Game" until the season opens
 *
 * Both now name the date instead, and the quicklink points at the Draft Kit,
 * which is the thing there IS to do in September.
 *
 * THE GATE IS `phase === 'offseason'`, NOT `isDormant`, and two of the four
 * tests below exist to hold that line:
 *
 *   `unknown`          a failed /api/season/status must render the page it has
 *                      always rendered. Hiding the matchup link because a
 *                      side-channel request timed out would be a worse bug
 *   a Christmas break  dormant, but a fantasy week runs Sunday to Saturday
 *                      whether or not the NHL plays on Tuesday. "This week's
 *                      matchup" is TRUE over Christmas and must not move
 *
 * Only the boundaries are mocked — contexts, services, API clients and the
 * season hook. The gates and the JSX under test are the real page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SeasonStatus } from '@citrus/shared';

vi.mock('@/components/Navbar', () => ({ default: () => <nav data-testid="navbar" /> }));
vi.mock('@/components/matchup/LeagueNotifications', () => ({ default: () => null }));
vi.mock('@/components/dashboard/LeagueTimelineCard', () => ({ LeagueTimelineCard: () => null }));
vi.mock('@/components/InvitePlayersButton', () => ({ InvitePlayersButton: () => null }));
vi.mock('@/components/league/ScoringRulesEditor', () => ({ ScoringRulesEditor: () => null }));
vi.mock('@/components/league/KeeperPanel', () => ({ KeeperPanel: () => null }));

// Stable `toast`: the real hook exports a module-level function, and
// `loadLeagueData` lists it in its dependency array. A fresh spy per render
// would respin the load callback and spin the page into an update loop.
const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));

// STABLE IDENTITIES, not fresh literals per render. `loadLeagueData` closes
// over `user` and lists it in its dependency array, and the effect that calls
// it lists the callback — so a new `{ id: 'user-1' }` object each render
// restarts the load, flips `loading` back to true and pins the page on the
// Stormy loading screen forever. The real AuthContext holds one session object.
const USER = { id: 'user-1' };
const PROFILE = { data: { username: 'alex' } };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: USER }) }));
vi.mock('@/hooks/useProfile', () => ({ useProfile: () => PROFILE }));

const LEAGUE = {
  id: 'league-1',
  name: 'Chinook Cup',
  commissioner_id: 'user-9',
  draft_status: 'completed',
  draft_rounds: 21,
  settings: { leagueType: 'fantasy', teamsCount: 12 },
};

vi.mock('@/services/LeagueService', () => ({
  LeagueService: {
    getLeague: vi.fn(async () => ({ league: LEAGUE, error: null })),
    getLeagueTeams: vi.fn(async () => ({
      teams: [{ id: 'team-1', team_name: 'Frost Giants', owner_id: 'user-1' }],
      error: null,
    })),
    getUserTeam: vi.fn(async () => ({ team: { id: 'team-1', team_name: 'Frost Giants', owner_id: 'user-1' }, error: null })),
  },
}));
vi.mock('@/services/WaiverService', () => ({ WaiverService: { getLeagueWaiverSettings: vi.fn(async () => null) } }));
vi.mock('@/services/TradeService', () => ({ TradeService: {} }));
vi.mock('@/api/leagues', () => ({ leagueApi: {} }));
vi.mock('@/api/waivers', () => ({ waiverApi: {} }));

/**
 * The roster read decides which squad-card sentence renders. `[]` (a drafted
 * league whose picks never landed, or a read that came back empty) is the
 * branch that used to say "Set your opening lineup"; a populated list keeps
 * saying "Roster set" in every season, which is the control.
 */
const playerIds = vi.fn(async () => ({ data: [] as unknown[] }));
vi.mock('@/api/rosters', () => ({ rosterApi: { getPlayerIds: (...a: unknown[]) => playerIds(...(a as [])) } }));

const seasonStatus = vi.fn<() => SeasonStatus>();
vi.mock('@/hooks/useSeasonStatus', () => ({
  useSeasonStatus: () => ({ status: seasonStatus(), headline: null, isLoaded: true }),
  default: () => ({ status: seasonStatus(), headline: null, isLoaded: true }),
}));

import LeagueDashboard from '../LeagueDashboard';

/** The measured schedule on the audit date. */
const OFFSEASON: SeasonStatus = {
  phase: 'offseason',
  hasGamesToday: false,
  lastGameDate: '2026-06-14',
  nextGameDate: '2026-09-29',
  daysUntilNextGame: 27,
  daysSinceLastGame: 80,
  isDormant: true,
};

/** In flight, or the request failed. */
const UNKNOWN: SeasonStatus = {
  phase: 'unknown',
  hasGamesToday: false,
  lastGameDate: null,
  nextGameDate: null,
  daysUntilNextGame: null,
  daysSinceLastGame: null,
  isDormant: false,
};

/** 2025-12-23 to 2025-12-27: dormant, mid-season, the week still running. */
const CHRISTMAS: SeasonStatus = {
  phase: 'regular',
  hasGamesToday: false,
  lastGameDate: '2025-12-23',
  nextGameDate: '2025-12-27',
  daysUntilNextGame: 3,
  daysSinceLastGame: 1,
  isDormant: true,
};

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/league/league-1']}>
      <Routes>
        <Route path="/league/:leagueId" element={<LeagueDashboard />} />
      </Routes>
    </MemoryRouter>,
  );

const loaded = () => screen.findByText('League quicklinks', undefined, { timeout: 4000 });

/**
 * The quicklinks tile. The page footer carries its own Standings link, so a
 * page-wide `getByRole('link', { name: /Standings/ })` finds two — every link
 * assertion is scoped to the tile actually under test.
 */
const quicklinks = () =>
  within(screen.getByText('League quicklinks').parentElement!.parentElement!);

beforeEach(() => {
  toastSpy.mockReset();
  playerIds.mockClear();
  playerIds.mockResolvedValue({ data: [] });
});

describe('LeagueDashboard — the offseason', () => {
  beforeEach(() => seasonStatus.mockReturnValue(OFFSEASON));

  it('drops the "this week\'s matchup" quicklink and points at the Draft Kit', async () => {
    mount();
    await loaded();

    const links = quicklinks();
    expect(links.queryByRole('link', { name: /This week's matchup/ })).toBeNull();
    expect(links.getByRole('link', { name: /Draft Kit/ })).toHaveAttribute('href', '/draft-kit');
    // Standings and Team analytics are true in every season and stay put.
    expect(links.getByRole('link', { name: /Standings/ })).toHaveAttribute('href', '/standings');
    expect(links.getByRole('link', { name: /Team analytics/ })).toHaveAttribute('href', '/team-analytics');
  });

  it('names the date the week comes back rather than leaving a hole', async () => {
    mount();
    await loaded();

    expect(screen.getByText('Matchups start Sep 29.')).toBeInTheDocument();
  });

  it('replaces the un-followable "set your opening lineup" with the opener', async () => {
    mount();
    await loaded();

    expect(screen.queryByText('Draft complete. Set your opening lineup')).toBeNull();
    expect(screen.getByText('Draft complete. First puck drops Sep 29.')).toBeInTheDocument();
  });

  it('still reports a counted roster the same way it always did', async () => {
    // The offseason branch only replaces the sentence that told the reader to
    // do something impossible. "Roster set" is a fact and is season-agnostic.
    playerIds.mockResolvedValue({ data: Array.from({ length: 13 }, (_, i) => i) });
    mount();
    await loaded();

    expect(await screen.findByText('Roster set · 13 players')).toBeInTheDocument();
    expect(screen.queryByText(/First puck drops/)).toBeNull();
  });
});

describe('LeagueDashboard — the states that must NOT change', () => {
  it('keeps the matchup quicklink and the lineup prompt when the status is unknown', async () => {
    seasonStatus.mockReturnValue(UNKNOWN);
    mount();
    await loaded();

    const links = quicklinks();
    expect(links.getByRole('link', { name: /This week's matchup/ })).toHaveAttribute('href', '/matchup');
    expect(links.queryByRole('link', { name: /Draft Kit/ })).toBeNull();
    expect(screen.getByText('Draft complete. Set your opening lineup')).toBeInTheDocument();
    expect(screen.queryByText(/Matchups start/)).toBeNull();
  });

  it('keeps both over a mid-season break, dormant though the schedule is', async () => {
    // The fantasy week is still running on 2025-12-24; only the offseason
    // removes the week itself.
    seasonStatus.mockReturnValue(CHRISTMAS);
    mount();
    await loaded();

    expect(quicklinks().getByRole('link', { name: /This week's matchup/ })).toHaveAttribute('href', '/matchup');
    expect(screen.getByText('Draft complete. Set your opening lineup')).toBeInTheDocument();
  });
});

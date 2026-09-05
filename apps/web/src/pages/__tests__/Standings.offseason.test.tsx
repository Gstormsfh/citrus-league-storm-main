/**
 * A SCOREBOARD FOR A SEASON WITH NO GAMES (offseason audit, 2026-09-02).
 *
 * On 2026-09-02 — 80 days after the last NHL game (2026-06-14), 27 before the
 * next (2026-09-29) — a drafted league opened Standings onto a complete
 * Record / Win % / PF / PA / Streak / Last 5 table: twelve rows of `0-0`,
 * `0.0%`, `0.0`, ranked 1 through 12, playoff cut line drawn across it. The
 * preseason cell that says "the season has not started" was already written,
 * already good, and gated on `sortedTeams.length === 0` — false the moment a
 * commissioner fills the league. So the one screen that could have explained
 * the zeros never appeared on the league that had them.
 *
 * The fix asks two questions instead of one, and BOTH have to say yes: the
 * schedule is dormant, and no team in this league has a game on its record.
 * These tests pin all four corners of that, because three of them are ways to
 * get it wrong:
 *
 *   dormant + nothing played        the preseason state, with the opener date
 *   `unknown` + nothing played      the table, exactly as it shipped
 *   dormant + a game on the books   the table (an All-Star break, mid-season)
 *   live season + nothing played    the table (a league that drafted late)
 *
 * The second is the one that matters most. `unknown` is what a failed
 * /api/season/status returns, and a screen that hides the standings because a
 * side-channel request timed out is a worse bug than the one being fixed.
 *
 * ONLY the boundaries are mocked — the contexts, the services and the season
 * hook. Every gate under test, the `noTeamHasPlayed` scan and the JSX that
 * reads it, is the real Standings module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SeasonStatus } from '@citrus/shared';

const navigateSpy = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

// Chrome. Each of these drags the auth/league/supabase shell in behind it, so
// a failure here would be a failure of the shell and not of the standings.
vi.mock('@/components/Navbar', () => ({ default: () => <nav data-testid="navbar" /> }));
vi.mock('@/components/LeagueCreationCTA', () => ({ LeagueCreationCTA: () => null }));
vi.mock('@/components/matchup/LeagueNotifications', () => ({ default: () => null }));
// A STABLE `toast`, not a fresh spy per render. Standings' load effect lists
// `toast` in its dependency array, and the real hook exports a module-level
// function, so its identity never changes. A `vi.fn()` created inside the hook
// would change on every render and spin the effect into an update loop that
// says nothing about the page.
const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));
// The Press Box league chrome (PR10f) reads the profile for the menu's
// avatar; the real hook reaches api/account -> api/client -> the Supabase
// client, which throws at module scope under the hermetic env.
vi.mock('@/hooks/useProfile', () => ({ useProfile: () => ({ data: null }) }));

const LEAGUE = {
  id: 'league-1',
  name: 'Chinook Cup',
  draft_status: 'completed',
  settings: { playoffTeams: 6 },
};

vi.mock('@/contexts/LeagueContext', () => ({
  useLeague: () => ({
    userLeagueState: 'active-user',
    activeLeagueId: 'league-1',
    activeLeague: LEAGUE,
    isChangingLeague: false,
    loading: false,
  }),
}));

/**
 * `calculateTeamStandings` is never reached in these runs: the page only
 * computes stats when the draft has picks, and `getDraftPicks` returns none.
 * Every team therefore lands on the zero fallback at Standings.tsx :312 —
 * which is precisely the production shape being tested, a drafted league whose
 * matchups have not been played.
 */
const getDraftPicks = vi.fn(async () => ({ picks: [] as unknown[] }));

vi.mock('@/services/LeagueService', () => ({
  LeagueService: {
    getUserLeagues: vi.fn(async () => ({ leagues: [LEAGUE], error: null })),
    getLeague: vi.fn(async () => ({ league: LEAGUE, error: null })),
    getLeagueTeamsWithOwners: vi.fn(async () => ({
      teams: [
        { id: 'team-1', team_name: 'Frost Giants', owner_id: 'user-1', owner_name: 'Alex' },
        { id: 'team-2', team_name: 'Slot Machines', owner_id: 'user-2', owner_name: 'Sam' },
      ],
      error: null,
    })),
    calculateTeamStandings: vi.fn(async () => ({})),
    calculateCategoryStandings: vi.fn(async () => ({})),
    calculateRotoStandingsFromDB: vi.fn(async () => ({})),
    calculateSeasonPointsStandings: vi.fn(async () => ({})),
  },
  getLeagueFormat: () => ({ leagueType: 'fantasy', scoringFormat: 'h2h-points' }),
  LEAGUE_TEAMS_DATA: [],
}));

vi.mock('@/services/DraftService', () => ({ DraftService: { getDraftPicks: (...a: unknown[]) => getDraftPicks(...(a as [])) } }));
vi.mock('@/services/PlayerService', () => ({ PlayerService: { getAllPlayers: vi.fn(async () => []) } }));
vi.mock('@/services/DemoLeagueService', () => ({
  DemoLeagueService: { getDemoLeague: vi.fn(), getDemoTeams: vi.fn(), getDemoDraftPicks: vi.fn() },
  DEMO_LEAGUE_ID_FOR_GUESTS: 'demo',
}));
vi.mock('@/services/MatchupService', () => ({
  MatchupService: {
    autoCompleteMatchups: vi.fn(async () => ({ error: null })),
    updateMatchupScores: vi.fn(async () => ({ error: null, updatedCount: 0 })),
  },
}));
vi.mock('@/services/PlayoffService', () => ({
  PlayoffService: {
    getPlayoffPicture: vi.fn(async () => ({ picture: null })),
    getBracket: vi.fn(async () => ({ bracket: null })),
  },
}));

const seasonStatus = vi.fn<() => SeasonStatus>();
vi.mock('@/hooks/useSeasonStatus', () => ({
  useSeasonStatus: () => ({ status: seasonStatus(), headline: null, isLoaded: true }),
  default: () => ({ status: seasonStatus(), headline: null, isLoaded: true }),
}));

/**
 * jsdom has no IntersectionObserver, and Standings.tsx :400 builds one to drive
 * its reveal animation. Nothing under test reads it; a no-op keeps the mount
 * from throwing on a browser API the assertions do not care about.
 */
vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  },
);

import Standings from '../Standings';

/** The measured schedule on the audit date: last game Jun 14, next Sep 29. */
const OFFSEASON: SeasonStatus = {
  phase: 'offseason',
  hasGamesToday: false,
  lastGameDate: '2026-06-14',
  nextGameDate: '2026-09-29',
  daysUntilNextGame: 27,
  daysSinceLastGame: 80,
  isDormant: true,
};

/** What a failed or in-flight /api/season/status produces. */
const UNKNOWN: SeasonStatus = {
  phase: 'unknown',
  hasGamesToday: false,
  lastGameDate: null,
  nextGameDate: null,
  daysUntilNextGame: null,
  daysSinceLastGame: null,
  isDormant: false,
};

/** Mid-season, hockey tonight. */
const LIVE: SeasonStatus = {
  phase: 'regular',
  hasGamesToday: true,
  lastGameDate: '2026-11-14',
  nextGameDate: '2026-11-15',
  daysUntilNextGame: 1,
  daysSinceLastGame: 0,
  isDormant: false,
};

const mount = () =>
  render(
    <MemoryRouter>
      <Standings />
    </MemoryRouter>,
  );

/** The loading state holds for PB_LOADING_MIN_MS (useMinimumLoadingTime). */
const settled = (text: string | RegExp) => screen.findByText(text, undefined, { timeout: 4000 });
/**
 * A team name appears in three places once the page is populated — the table
 * row, the Playoff Picture card and the Points Leaders card — which is exactly
 * why all three are gated together. Assertions about "the table is here" use
 * the plural query and let the count speak.
 */
const settledAll = (text: string | RegExp) => screen.findAllByText(text, undefined, { timeout: 4000 });

beforeEach(() => {
  navigateSpy.mockReset();
  getDraftPicks.mockClear();
});

describe('Standings — the offseason zero table', () => {
  it('replaces the 0-0 table with the preseason state when the schedule is dormant', async () => {
    seasonStatus.mockReturnValue(OFFSEASON);
    mount();

    expect(await settled('No games played yet.')).toBeInTheDocument();

    // The zeros are gone: no team row, so no record, win % or PF to misread.
    expect(screen.queryByText('Frost Giants')).toBeNull();
    expect(screen.queryByText('0.0%')).toBeNull();

    // The kicker is the shipped empty-state idiom, kept as-is.
    expect(screen.getByText('✦ Preseason')).toBeInTheDocument();
    // "The league is still filling up" is the OTHER empty state and would be a
    // small lie here: this league is full and drafted, it just has not played.
    expect(screen.queryByText('The league is still filling up.')).toBeNull();
  });

  it('names the opener and offers one tap to it, the ScoresEmptyDay contract', async () => {
    seasonStatus.mockReturnValue(OFFSEASON);
    mount();

    expect(await settled(/Records, PF and PA fill in once the season opens Sep 29\./)).toBeInTheDocument();

    // A dormant screen that only says "nothing here" is not finished. This is
    // a real deep link: Scores.tsx reads the `date` query param.
    fireEvent.click(screen.getByRole('button', { name: /Opening night Sep 29/ }));
    expect(navigateSpy).toHaveBeenCalledWith('/scores?date=2026-09-29');
  });

  it('empties the Points Leaders and Playoff Picture cards on the same fact', async () => {
    seasonStatus.mockReturnValue(OFFSEASON);
    mount();
    await settled('No games played yet.');

    // Both cards ranked the same zeros: five teams at 0 points, and a full
    // playoff seeding 1..N built from `sortedTeams` when the picture is empty.
    expect(screen.getByText('No points scored yet. Leaders appear after week 1.')).toBeInTheDocument();
    expect(screen.getByText(/The race starts when the season does\./)).toBeInTheDocument();
  });
});

describe('Standings — the states that must NOT change', () => {
  it('renders the table unchanged when the season status is unknown', async () => {
    // The failure direction that matters: /api/season/status times out, and
    // the standings must look exactly like they did before this change.
    seasonStatus.mockReturnValue(UNKNOWN);
    mount();

    // Three appearances each: the table row, the Playoff Picture and the
    // Points Leaders card — every surface this change could have emptied.
    expect(await settledAll('Frost Giants')).toHaveLength(3);
    expect(screen.getAllByText('Slot Machines')).toHaveLength(3);
    expect(screen.getAllByText('0.0%')).toHaveLength(2);
    expect(screen.queryByText('No games played yet.')).toBeNull();
    expect(screen.queryByRole('button', { name: /Opening night/ })).toBeNull();
  });

  it('renders the table during the season, even before this league has played', async () => {
    // A league that drafts in November has honest zeros: hockey is being
    // played, and the row fills in on Sunday. Only a dormant SCHEDULE means
    // the zeros cannot exist yet.
    seasonStatus.mockReturnValue(LIVE);
    mount();

    expect((await settledAll('Frost Giants')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('0.0%')).toHaveLength(2);
    expect(screen.queryByText('No games played yet.')).toBeNull();
  });

  it('renders the table on a dormant day once a team has a game on its record', async () => {
    // The Olympic break: 20 dark days in the middle of a season with records
    // already on the board. Suppressing those records would delete real results.
    getDraftPicks.mockResolvedValueOnce({ picks: [{ id: 'p1' }] });
    const { LeagueService } = await import('@/services/LeagueService');
    vi.mocked(LeagueService.calculateTeamStandings).mockResolvedValueOnce({
      'team-1': { pointsFor: 412.5, pointsAgainst: 388.1, wins: 6, losses: 2, ties: 0, streak: 'W2', last5: { wins: 4, losses: 1, ties: 0 }, gamesPlayed: 8 },
      'team-2': { pointsFor: 388.1, pointsAgainst: 412.5, wins: 2, losses: 6, ties: 0, streak: 'L2', last5: { wins: 1, losses: 4, ties: 0 }, gamesPlayed: 8 },
    } as never);
    seasonStatus.mockReturnValue({
      ...OFFSEASON,
      phase: 'regular',
      lastGameDate: '2027-02-05',
      nextGameDate: '2027-02-25',
      daysUntilNextGame: 10,
      daysSinceLastGame: 10,
    });
    mount();

    expect((await settledAll('Frost Giants')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('6-2').length).toBeGreaterThan(0);
    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.queryByText('No games played yet.')).toBeNull();
  });
});

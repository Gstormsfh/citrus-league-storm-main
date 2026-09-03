/**
 * STORMY IN THE OFFSEASON (offseason audit, 2026-09-02).
 *
 * The assistant had no idea what month it was. On 2026-09-02 — the last NHL
 * game 80 days behind (2026-06-14), the next 27 ahead (2026-09-29) — it:
 *
 *   opened with   "I already have ... the live playoff bracket in front of me.
 *                 Ask me for a roster review, a start/sit ..."
 *   offered       a "Start/sit help" starter chip, for a night nobody plays
 *   claimed       "Your active league, current roster, this week's matchup,
 *                 and the live xG model. All loaded before you hit send."
 *   metered       the quota as "Matchup Week Usage" / "Questions remaining
 *                 this week", across a 107-day gap between matchup weeks
 *
 * Four separate promises about a matchup and a live model that do not exist.
 *
 * WHAT THESE TESTS PIN, and why each one is here:
 *
 *   the offseason      every claim above is replaced, and the replacements
 *                      name the date the season returns
 *   `unknown`          all four ship exactly as they were. This is what a
 *                      failed /api/season/status produces, and an assistant
 *                      that announces a fake offseason in January is a far
 *                      worse bug than the one being fixed
 *   a mid-season break Christmas is dormant too, and a start/sit question is
 *                      perfectly answerable on Friday. `isDormant` alone would
 *                      have rewritten all of this over a three-day gap; the
 *                      gate is `phase === 'offseason'` for exactly this reason
 *   a live transcript  the greeting swap touches the untouched opening message
 *                      and nothing else. Rewriting a reader's history would be
 *                      a new bug shipped to fix an old one
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SeasonStatus } from '@citrus/shared';

vi.mock('@/components/Navbar', () => ({ default: () => <nav data-testid="navbar" /> }));
vi.mock('@/components/MobileMenuButton', () => ({ default: () => <button type="button" /> }));
vi.mock('@/components/matchup/LeagueNotifications', () => ({ default: () => null }));
vi.mock('@/components/LeagueCreationCTA', () => ({ LeagueCreationCTA: () => null }));

// One league object, not a fresh literal per render: the context-warming
// effect at StormyAssistant.tsx :84 lists `activeLeague?.settings`, and a new
// object each render would refire it on every paint. The real LeagueContext
// holds one.
const USER = { id: 'user-1' };
const LEAGUE = { id: 'league-1', name: 'Chinook Cup', settings: { leagueType: 'fantasy' } };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: USER }) }));
vi.mock('@/contexts/LeagueContext', () => ({
  useLeague: () => ({
    userLeagueState: 'active-user',
    activeLeagueId: 'league-1',
    activeLeague: LEAGUE,
  }),
}));

vi.mock('@/services/StormyService', () => ({
  StormyService: { sendMessage: vi.fn() },
  fetchLeagueContext: vi.fn(async () => ({})),
  fetchPlayoffPoolContext: vi.fn(async () => ({})),
}));

const seasonStatus = vi.fn<() => SeasonStatus>();
vi.mock('@/hooks/useSeasonStatus', () => ({
  useSeasonStatus: () => ({ status: seasonStatus(), headline: null, isLoaded: true }),
  default: () => ({ status: seasonStatus(), headline: null, isLoaded: true }),
}));

import StormyAssistant from '../StormyAssistant';

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

/**
 * Christmas 2025: 2025-12-23 to 2025-12-27, the second-longest in-season gap
 * in the real schedule. Dormant, and none of this copy may move — the matchup
 * is mid-flight and Saturday's start/sit is a live question.
 */
const CHRISTMAS: SeasonStatus = {
  phase: 'regular',
  hasGamesToday: false,
  lastGameDate: '2025-12-23',
  nextGameDate: '2025-12-27',
  daysUntilNextGame: 3,
  daysSinceLastGame: 1,
  isDormant: true,
};

const SHIPPED_CLAIM = /this week's matchup, and the live xG model/;
const SHIPPED_GREETING = /the live playoff bracket in front of me/;

const mount = () =>
  render(
    <MemoryRouter>
      <StormyAssistant />
    </MemoryRouter>,
  );

/**
 * Radix's TabsTrigger activates on mousedown, not click, and TabsContent is
 * unmounted until its tab is active — so a plain click leaves the usage card
 * out of the DOM entirely.
 */
const openSettings = () => {
  const tab = screen.getByRole('tab', { name: /Settings/ });
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
};

beforeEach(() => {
  // The transcript is persisted, so a leftover from the previous test would
  // decide the greeting assertions instead of the code under test.
  localStorage.clear();
});

describe('StormyAssistant — the offseason', () => {
  beforeEach(() => seasonStatus.mockReturnValue(OFFSEASON));

  it('swaps the starter chips for questions that have answers today', async () => {
    mount();

    // "Start/sit help" on 2026-09-02 returns "no game" for all thirteen.
    expect(screen.queryByText('Start/sit help')).toBeNull();
    expect(screen.queryByText('Waiver targets')).toBeNull();

    // The four subjects that are live in September — the Draft Kit's ground.
    for (const chip of ['Draft prep', 'Keeper advice', 'Roster targets', 'Player research']) {
      expect(await screen.findByText(chip)).toBeInTheDocument();
    }
  });

  it('stops claiming a matchup and a live model, and names when they return', () => {
    mount();

    expect(screen.queryByText(SHIPPED_CLAIM)).toBeNull();
    expect(screen.getByText(/No games until Sep 29, so there is no live matchup to read/)).toBeInTheDocument();
  });

  it('meters the quota in days rather than in matchup weeks', () => {
    mount();
    openSettings();

    expect(screen.queryByText('Matchup Week Usage')).toBeNull();
    expect(screen.queryByText('Questions remaining this week')).toBeNull();
    expect(screen.getByText('Question Usage')).toBeInTheDocument();
    expect(screen.getByText('Questions remaining before the next reset')).toBeInTheDocument();
    // The reset cadence itself never changed and must still be stated.
    expect(screen.getByText('Every 7 days')).toBeInTheDocument();
  });

  it('rewrites the opening line once the schedule answers', async () => {
    mount();

    expect(await screen.findByText(/The season is dark until Sep 29/)).toBeInTheDocument();
    expect(screen.queryByText(SHIPPED_GREETING)).toBeNull();
  });

  it('leaves a transcript the reader has added to alone', async () => {
    // The guard is "exactly one message, id '1', from Stormy". Anything else is
    // the reader's conversation, and this must not edit it under them.
    localStorage.setItem(
      'stormyMessages',
      JSON.stringify([
        { id: '1', text: 'Well boss, Stormy here. I already have your league, your roster and picks, and the live playoff bracket in front of me.', sender: 'stormy', timestamp: new Date().toISOString() },
        { id: '2', text: 'Who should I keep?', sender: 'user', timestamp: new Date().toISOString() },
      ]),
    );
    mount();

    expect(await screen.findByText('Who should I keep?')).toBeInTheDocument();
    expect(screen.getByText(SHIPPED_GREETING)).toBeInTheDocument();
    expect(screen.queryByText(/The season is dark until/)).toBeNull();
  });
});

describe('StormyAssistant — the states that must NOT change', () => {
  it('ships every original string when the season status is unknown', async () => {
    // A failed /api/season/status must never produce offseason copy.
    seasonStatus.mockReturnValue(UNKNOWN);
    mount();

    expect(await screen.findByText('Start/sit help')).toBeInTheDocument();
    expect(screen.getByText('Review my roster')).toBeInTheDocument();
    expect(screen.getByText(SHIPPED_CLAIM)).toBeInTheDocument();
    expect(screen.getByText(SHIPPED_GREETING)).toBeInTheDocument();
    expect(screen.queryByText('Draft prep')).toBeNull();

    openSettings();
    expect(screen.getByText('Matchup Week Usage')).toBeInTheDocument();
    expect(screen.getByText('Questions remaining this week')).toBeInTheDocument();
  });

  it('ships every original string over a mid-season break, dormant though it is', async () => {
    seasonStatus.mockReturnValue(CHRISTMAS);
    mount();

    expect(await screen.findByText('Start/sit help')).toBeInTheDocument();
    expect(screen.getByText(SHIPPED_CLAIM)).toBeInTheDocument();
    expect(screen.getByText(SHIPPED_GREETING)).toBeInTheDocument();

    openSettings();
    expect(screen.getByText('Matchup Week Usage')).toBeInTheDocument();
  });
});

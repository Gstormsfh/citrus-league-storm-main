import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { HockeyPlayer } from '@/components/roster/HockeyPlayerCard';
import { MemoryRouter } from 'react-router-dom';

/**
 * THE FALLBACK IS THE CONDITION ON WHICH THE SERVER WRITEUP SHIPPED
 * (2026-09-11).
 *
 * The scouting prose is now rendered by the API server and arrives on
 * `GET /api/players/:playerId/xg-history`. The engine nevertheless stays in
 * the bundle, and this file is why: the build it ships in goes to an
 * expedited Apple review and then into the first real drafts, and a render
 * path that can go blank under load is not acceptable. A reviewer who opens
 * a player card must never see an empty summary.
 *
 * So every way the server answer can fail to arrive is exercised here
 * against the REAL engine and the REAL hook, with only the HTTP client
 * mocked:
 *
 *   * the endpoint 500s;
 *   * the endpoint answers, without a `writeup` key (an older API deploy —
 *     the web app and the API deploy separately, so this is not
 *     hypothetical, it is every deploy's first few minutes);
 *   * the endpoint answers with a malformed `writeup`.
 *
 * In all three the card renders exactly what it rendered before any of this
 * existed. The fourth test is the happy path, and it asserts the server's
 * words actually win when they are there, so a fallback that silently
 * swallowed the payload would fail too.
 */

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  league: vi.fn(),
  format: vi.fn(),
  schedule: vi.fn(),
  log: vi.fn(),
  wireItems: [] as Array<Record<string, unknown>>,
  leagueId: '11111111-1111-1111-1111-111111111111' as string | null,
}));

vi.mock('@/contexts/LeagueContext', () => ({ useLeague: () => ({ activeLeagueId: mocks.leagueId }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/services/LeagueService', () => ({
  getLeagueFormat: mocks.format,
  LeagueService: { getLeague: mocks.league, getWatchlist: () => [] },
}));
vi.mock('@/services/ScheduleService', () => ({ ScheduleService: { getGamesForTeam: mocks.schedule } }));
vi.mock('@/services/MatchupService', () => ({ MatchupService: {} }));
vi.mock('@/api/matchups', () => ({ matchupApi: { getPlayerGameLog: mocks.log } }));
vi.mock('@/api/players', () => ({
  playerApi: {
    getDirectory: async () => ({ data: [] }),
    getRosProjectionForPlayer: async () => ({ data: [] }),
  },
}));
vi.mock('@/hooks/usePlayerDashboardIndex', () => ({ usePlayerDashboardIndex: () => ({ players: [] }) }));
vi.mock('@/hooks/useCitrusPlayerNotes', () => ({ useCitrusPlayerNotes: () => ({ notes: [], items: mocks.wireItems }) }));
vi.mock('../PlayerAdvancedCard', () => ({ PlayerAdvancedCard: () => null }));
vi.mock('@/utils/timezoneUtils', () => ({ getTodayMST: () => '2026-09-06' }));
// The one mock that matters: the HTTP client the real `usePlayerXgHistory`
// reaches for. Everything above is scaffolding so the modal can mount.
vi.mock('@/api/client', () => ({ apiClient: { get: mocks.get } }));

import PlayerStatsModal from '@/components/PlayerStatsModal';

/** A season worth writing about, so the local engine has something to say. */
const STATS = {
  gamesPlayed: 76,
  goals: 44,
  assists: 89,
  points: 133,
  shots: 280,
  hits: 40,
  blockedShots: 25,
  powerPlayPoints: 48,
  plusMinus: 28,
  toi: '21:30',
};

/** Stable identity makes attribution and request-path assertions explicit. */
const PLAYER_ID = '8478402';

function openCard() {
  const player = {
    id: PLAYER_ID,
    statsSeason: 2024,
    name: 'Connor McTest',
    position: 'C',
    team: 'Edmonton Oilers',
    teamAbbreviation: 'EDM',
    stats: STATS,
  } as HockeyPlayer;
  return render(
    <MemoryRouter>
      <PlayerStatsModal player={player} isOpen onClose={() => {}} />
    </MemoryRouter>,
  );
}

const SERVER_WRITEUP = {
  headline: 'Server-rendered headline',
  summary: 'This sentence came from the API server and nowhere else.',
  analysis: 'Projects to 999 fantasy points over 80 games for 2026-27 (C1).',
  tags: [{ label: 'Deployed copy', tone: 'positive' }],
  hasEnoughData: true,
  cardNote: 'Star forward',
  cardTone: 'positive',
};

/** The local historical stat line is absent from the server fixture. */
const LOCAL_SUMMARY = /paired 89 assists with .* shots per game in 2024-25/;

function xgHistory(extra: Record<string, unknown> = {}) {
  return { data: { player_id: Number(PLAYER_ID), points: [], as_of: null, ...extra } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.wireItems = [];
  mocks.leagueId = '11111111-1111-1111-1111-111111111111';
  mocks.schedule.mockResolvedValue({ games: [], error: null });
  mocks.log.mockResolvedValue({ data: { games: [], projections: [] } });
  mocks.league.mockResolvedValue({ league: { scoring_settings: { skater: { goals: 3 } } } });
  mocks.format.mockReturnValue({ scoringFormat: 'h2h-points' });
  mocks.get.mockResolvedValue(xgHistory());
});

describe('the player card falls back to the in-bundle writeup', () => {
  it('renders the server writeup when the payload carries one', async () => {
    mocks.get.mockResolvedValue(xgHistory({ writeup: SERVER_WRITEUP }));
    openCard();

    expect(await screen.findByText('Server-rendered headline')).toBeTruthy();
    expect(screen.getByText(SERVER_WRITEUP.summary)).toBeTruthy();
    expect(screen.getByText('Deployed copy')).toBeTruthy();
    expect(screen.queryByText(LOCAL_SUMMARY)).toBeNull();
  });

  it('falls back safely when optional server news links are malformed', async () => {
    mocks.get.mockResolvedValue(xgHistory({ writeup: { ...SERVER_WRITEUP,
      newsSources: [{ source: 'NHL', url: 'javascript:alert(1)', publishedAt: null }],
    } }));
    openCard();
    expect(await screen.findByText(LOCAL_SUMMARY)).toBeTruthy();
    expect(screen.queryByText('Server-rendered headline')).toBeNull();
  });

  it('renders the local writeup when the payload omits the field', async () => {
    mocks.get.mockResolvedValue(xgHistory());
    openCard();

    expect(await screen.findByText(LOCAL_SUMMARY)).toBeTruthy();
    expect(screen.getByTestId('overview-season-label').textContent).toBe('2024-25 actuals');
    expect(screen.queryByText('Server-rendered headline')).toBeNull();
  });

  it('renders the local writeup when the endpoint 500s', async () => {
    mocks.get.mockRejectedValue(new Error('Request failed with status 500'));
    openCard();

    expect(await screen.findByText(LOCAL_SUMMARY)).toBeTruthy();
    expect(screen.queryByText('Server-rendered headline')).toBeNull();
  });

  it('renders the local writeup rather than half a card when the field is malformed', async () => {
    // A `writeup` with no `summary` is not a writeup. Rendering it would
    // paint a headline over an empty paragraph, which is worse than the
    // copy we already have.
    mocks.get.mockResolvedValue(xgHistory({ writeup: { headline: 'Half a card' } }));
    openCard();

    expect(await screen.findByText(LOCAL_SUMMARY)).toBeTruthy();
    expect(screen.queryByText('Half a card')).toBeNull();
  });

  it('uses attached dated reporting in the bundled fallback', async () => {
    mocks.wireItems = [{
      id: 'practice', player_ids: [Number(PLAYER_ID)], title: 'Connor McTest practiced today',
      snippet: '', source_id: 'nhl', url: 'https://www.nhl.com/news/mctest-practice',
      published_at: new Date(Date.now() - 3600_000).toISOString(),
    }];
    mocks.get.mockRejectedValue(new Error('Server unavailable'));
    openCard();
    expect(await screen.findByText(/Connor McTest took part in practice or skating/)).toBeTruthy();
    expect(screen.getByText(/Practice alone settles neither game clearance/)).toBeTruthy();
    const source = screen.getByRole('link', { name: /nhl.com/ });
    expect(source.getAttribute('href')).toBe('https://www.nhl.com/news/mctest-practice');
  });

  it('asks for the writeup in the active league, so the projection is scored for it', async () => {
    openCard();

    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    const paths = mocks.get.mock.calls.map((c) => String(c[0]));
    expect(
      paths.some((p) => p.includes('/xg-history?leagueId=11111111-1111-1111-1111-111111111111')),
    ).toBe(true);
  });

  it('asks without a league when there is no active one', async () => {
    mocks.leagueId = null;
    openCard();

    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    const paths = mocks.get.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.endsWith('/xg-history'))).toBe(true);
    expect(paths.some((p) => p.includes('leagueId'))).toBe(false);
  });
});

it('category fallback keeps its hockey assessment without a weighted points valuation', async () => {
  mocks.format.mockReturnValue({ scoringFormat: 'h2h-categories' });
  openCard();
  expect(await screen.findByText(LOCAL_SUMMARY)).toBeTruthy();
  await waitFor(() => expect(mocks.league).toHaveBeenCalled());
  expect(screen.queryByText(/scoring points|Projects to/)).toBeNull();
  expect(await screen.findByText(/assist total is not directly rewarded/)).toBeTruthy();
});

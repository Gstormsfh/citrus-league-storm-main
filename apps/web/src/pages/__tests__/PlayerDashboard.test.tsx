import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * THE PLAYER DASHBOARD'S STATES — Component 6.5.
 *
 * The composition was reviewed for a year against `MOCK_*` constants on a
 * DEV-only route, which means every state a real payload can produce is new
 * ground. These are the ones that decide whether the page is shippable:
 *
 *   loading            a skeleton, never a spinner on a full-page composition
 *   401                its own screen, because the API is auth-gated and the
 *                      page is the shareable surface
 *   network failure    a retry, not a blank
 *   a goalie           GSAx treatment; an empty rink is not a coherent claim
 *   a player with no shots   an honest sentence, not a blank hero
 *   the shot read failed     a DIFFERENT sentence — it is a different fact
 *   coordinates that fail their own distance check   the map is refused
 *   no `as_of`         no freshness badge, because the badge would be a claim
 *
 * ONLY THE TRANSPORT IS MOCKED. `@/api/client` is replaced and everything
 * below it — both hooks, `RinkHeatmap`, `PercentileBullet`,
 * `PlayerAdvancedCard`, the percentile maths — is the real module, so this
 * exercises the wiring and not a stand-in for it.
 */

const apiGet = vi.fn();

vi.mock('@/api/client', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }
  return {
    API_BASE_URL: '',
    ApiError,
    apiClient: {
      get: (...args: unknown[]) => apiGet(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

// The nav is chrome and pulls the whole auth/league shell in behind it.
// Replaced so a failure here is a failure of the dashboard.
vi.mock('@/components/Navbar', () => ({
  default: () => <nav data-testid="navbar" />,
}));

import PlayerDashboard from '../PlayerDashboard';
import { resetPlayerDashboardIndex, type DashboardIndexEntry } from '@/hooks/usePlayerDashboardIndex';
import type { DashboardShot, PlayerDashboardPayload } from '@/hooks/usePlayerDashboard';

const MCDAVID = 8478402;
const GOALIE = 8479394;

const GOAL_LINE_X = 89;

function shot(over: Partial<DashboardShot> = {}): DashboardShot {
  const x = over.x ?? 74;
  const y = over.y ?? 0;
  return {
    game_id: 2025020001,
    event_id: 1,
    game_date: '2025-10-08',
    x,
    y,
    distance: Math.hypot(GOAL_LINE_X - x, y),
    angle: 0,
    xg: 0.22,
    is_goal: false,
    shot_type: 'wrist',
    event_type: 'shot-on-goal',
    is_rush: false,
    is_rebound: false,
    is_power_play: false,
    is_shorthanded: false,
    is_empty_net: false,
    strength_state: '5v5',
    ...over,
  };
}

function indexEntry(over: Partial<DashboardIndexEntry> = {}): DashboardIndexEntry {
  return {
    id: MCDAVID,
    name: 'Connor McDavid',
    team: 'EDM',
    position: 'C',
    jersey: 97,
    headshot_url: null,
    is_goalie: false,
    roster_status: null,
    gp: 71, goals: 48, assists: 52, points: 100, sog: 244, hits: 20, blocks: 18,
    ppp: 30, plus_minus: 12, x_goals: 40.5,
    wins: 0, saves: 0, save_pct: 0, gaa: 0, shutouts: 0,
    pim: 0, shp: 0, toi_seconds: 0, losses: 0, ot_losses: 0, goals_against: 0,
    xg_per_60: 1.42, xg_rating: 'Elite',
    gar_per_60: 0.5, gar_evo: 0.31, gar_evd: 0.04, gar_ppo: 0.11, gar_ppd: 0.01, gar_pen: 0.03,
    proj_gp: 58, proj_fantasy_points: 320, proj_fantasy_ppg: 5.5,
    proj_goals: 30, proj_assists: 34, proj_sog: 200, proj_ppp: 18, proj_blocks: 55, proj_hits: 40,
    proj_wins: null, proj_saves: null, proj_shutouts: null,
    toi_total_minutes: null, avg_toi_per_game: null, vopa_score: null,
    gsax_raw: null, gsax_regressed: null, gsax_shots_faced: null, gsax_xga: null, gsax_ga: null,
    as_of: null,
    ...over,
  };
}

/**
 * A cohort big enough for the percentile module to work with. `n=` on the
 * page is read off this, so the assertions below name a real number.
 */
const LEAGUE: DashboardIndexEntry[] = [
  indexEntry(),
  indexEntry({ id: GOALIE, name: 'Carter Hart', team: 'VGK', position: 'G', jersey: 79, is_goalie: true, gp: 24, goals: 0, assists: 0, points: 0, sog: 0, xg_per_60: null, gar_per_60: null, gar_evo: null, gar_evd: null, gar_ppo: null, wins: 12, saves: 640, save_pct: 0.906, gaa: 2.8, shutouts: 2 }),
  ...Array.from({ length: 40 }, (_, i) =>
    indexEntry({
      id: 9000000 + i,
      name: `Forward ${String.fromCharCode(65 + (i % 26))}`,
      xg_per_60: 0.4 + i * 0.02,
      gar_per_60: 0.1 + i * 0.008,
      gar_evo: 0.05 + i * 0.005,
      gar_evd: 0.01 + i * 0.001,
      gar_ppo: 0.02 + i * 0.002,
      points: 20 + i,
      sog: 100 + i * 2,
    }),
  ),
  ...Array.from({ length: 34 }, (_, i) =>
    indexEntry({
      id: 9100000 + i,
      name: `Keeper ${String.fromCharCode(65 + (i % 26))}`,
      position: 'G',
      is_goalie: true,
      gp: 20 + (i % 12),
      wins: 5 + i,
      saves: 400 + i * 9,
      save_pct: 0.88 + i * 0.001,
      gaa: 3.4 - i * 0.02,
      shutouts: i % 5,
      xg_per_60: null,
      gar_per_60: null,
    }),
  ),
];

function payload(over: Partial<PlayerDashboardPayload> = {}): PlayerDashboardPayload {
  return {
    player_id: MCDAVID,
    season: 2025,
    game_type: 'regular',
    player: {
      player_id: MCDAVID,
      name: 'Connor McDavid',
      team: 'EDM',
      position: 'C',
      jersey: 97,
      headshot_url: null,
      is_goalie: false,
    },
    shots: Array.from({ length: 40 }, (_, i) => shot({ event_id: i, x: 74 + (i % 5), y: (i % 7) - 3 })),
    shots_available: true,
    shots_truncated: false,
    shots_cap: 1200,
    seasons: [2023, 2024, 2025].map((season) => ({
      season,
      game_type: 'regular',
      shots: 400, sog: 230, goals: 44, xg: 38.2, finishing: 5.8,
      shots_ev: 300, shots_pp: 90, shots_pk: 10,
      goals_ev: 30, goals_pp: 13, goals_sh: 1,
      xg_ev: 27, xg_pp: 10, xg_pk: 1.2,
      goals_en: 0, xg_en: 0.4,
      avg_dist: 26.4, avg_xg_per_shot: 0.0955,
      rebounds_shot: 31, rush_shots: 66,
    })),
    gsax: null,
    talent: {
      xg_per_60: 1.42,
      xg_rating: 'Elite',
      vopa_score: 3.11,
      avg_toi_per_game: 21.6,
      positional_replacement_level: 0.41,
      positional_std_dev: 0.22,
    },
    as_of: '2026-09-02T06:00:00.000Z',
    ...over,
  };
}

class ApiErrorLike extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Route the two GETs the page makes. `dashboard` may be a payload or a throw. */
function serve(dashboard: PlayerDashboardPayload | Error, league: DashboardIndexEntry[] = LEAGUE) {
  apiGet.mockImplementation((path: string) => {
    if (path.includes('/dashboard-index')) return Promise.resolve({ data: league });
    if (/\/dashboard/.test(path)) {
      return dashboard instanceof Error
        ? Promise.reject(dashboard)
        : Promise.resolve({ data: dashboard });
    }
    return Promise.resolve({ data: {} });
  });
}

function renderAt(id: number | string) {
  return render(
    <MemoryRouter initialEntries={[`/players/${id}`]}>
      <Routes>
        <Route path="/players/:playerId" element={<PlayerDashboard />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPlayerDashboardIndex();
});

describe('PlayerDashboard — the shipped page', () => {
  it('shows a skeleton while the payload is in flight, not a spinner', async () => {
    // Never resolves: the page is held in its loading state.
    apiGet.mockImplementation(() => new Promise(() => {}));
    renderAt(MCDAVID);
    expect(await screen.findByLabelText(/loading player dashboard/i)).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders the whole composition for a skater with a season of shots', async () => {
    serve(payload());
    renderAt(MCDAVID);

    // HERO — the rink, composed AT the player identity.
    const rink = await screen.findByLabelText(/shot heatmap for connor mcdavid/i);
    expect(rink).toBeInTheDocument();

    // Three chapters of the zone contract are present. Chapter 4 (one xG
    // number against the cohort median) was dropped on 2026-09-05: it read
    // as a verdict on the player.
    expect(screen.getByText(/chapter 1 · overview/i)).toBeInTheDocument();
    expect(screen.getByText(/chapter 2 · career arc/i)).toBeInTheDocument();
    expect(screen.getByText(/chapter 3 · breakdown/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/position vs league/i)).toBeNull();
    // A way back on the phone header (2026-09-05).
    expect(screen.getByRole('button', { name: /back to players/i })).toBeInTheDocument();

    // The condensed card is inline at the top — PWS-2 Option 1.
    expect(screen.getByTestId('player-advanced-card')).toBeInTheDocument();
  });

  it('every percentile block names its cohort AND its size', async () => {
    serve(payload());
    renderAt(MCDAVID);
    await screen.findByLabelText(/shot heatmap/i);

    // 41 forwards in LEAGUE clear the 10-GP floor.
    expect(screen.getByText(/percentiles · vs forwards/i)).toBeInTheDocument();
    // `n=` appears on the condensed card at the top of the page as well as
    // on the percentiles tile — both read the same cohort, which is the point.
    expect(screen.getAllByText(/n=41/).length).toBeGreaterThan(0);
    expect(screen.getByText(/41 forwards benchmarked/i)).toBeInTheDocument();
  });

  it('labels our model as ours wherever it prints a modelled number', async () => {
    serve(payload());
    renderAt(MCDAVID);
    await screen.findByLabelText(/shot heatmap/i);

    expect(screen.getByText(/expected goals by season · our model/i)).toBeInTheDocument();
    expect(screen.getByText(/seasons on record · regular season/i)).toBeInTheDocument();
    expect(screen.getAllByText(/our model/i).length).toBeGreaterThan(1);
  });

  // ── The states a real payload forces ──────────────────────────────

  it('401 gets its own screen, not a generic failure', async () => {
    serve(new ApiErrorLike('Unauthorized', 401));
    renderAt(MCDAVID);

    expect(await screen.findByText(/player dashboards are for signed-in managers/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/auth');
    expect(screen.queryByText(/did not come back/i)).toBeNull();
  });

  it('a network failure offers a retry, not a blank page', async () => {
    serve(new ApiErrorLike('Server returned 503', 503));
    renderAt(MCDAVID);

    expect(await screen.findByText(/this dashboard did not come back/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('a junk player id in the URL never reaches the API', async () => {
    serve(payload());
    renderAt('not-a-player');
    expect(await screen.findByText(/that is not a player id/i)).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringContaining('/dashboard?'));
  });

  it('the bad-id screen sends the user somewhere that exists', async () => {
    // 2026-09-03 audit. This copy used to read "Open one from the Players
    // table and the link will be right" -- an instruction to do something
    // that was not possible: the Players table rendered no link to any
    // dashboard. The table now carries a per-row anchor and a Full dashboard
    // button on the panel, and the sentence names them. If either affordance
    // is ever removed, this string is a lie again, so it is pinned here.
    serve(payload());
    renderAt('not-a-player');
    const body = await screen.findByText(/player dashboards live at/i);
    expect(body.textContent).toMatch(/full dashboard/i);
    expect(body.textContent).not.toMatch(/the link will be right/i);
    expect(screen.getByRole('link', { name: /browse players/i })).toHaveAttribute(
      'href',
      '/players',
    );
  });

  it('a goalie gets the GSAx treatment and NO empty rink', async () => {
    serve(
      payload({
        player_id: GOALIE,
        player: {
          player_id: GOALIE, name: 'Carter Hart', team: 'VGK', position: 'G',
          jersey: 79, headshot_url: null, is_goalie: true,
        },
        shots: [],
        seasons: [],
        gsax: {
          season: 2025, shots_faced: 1204, xga: 96.4, ga: 89,
          raw_gsax: 7.4, regressed_gsax: 4.9, league_sv_pct: 0.9033,
        },
      }),
    );
    renderAt(GOALIE);

    expect(await screen.findByText(/gsax · primary shots/i)).toBeInTheDocument();
    expect(screen.getByText('+7.4')).toBeInTheDocument();
    expect(screen.getByText(/a goalie has no shot map of his own attempts/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/shot heatmap/i)).toBeNull();
    // The verdict states shots faced, expected against and allowed.
    expect(screen.getAllByText(/1,204 primary shots/).length).toBeGreaterThan(0);
  });

  it('a player with no shots says so, and does not draw an empty rink', async () => {
    serve(payload({ shots: [] }));
    renderAt(MCDAVID);

    expect(await screen.findByText(/no shots on record for connor mcdavid in the 2025-26 regular season/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/shot heatmap/i)).toBeNull();
  });

  // "The read failed" and "he took no shots" are different facts. A page
  // that renders one sentence for both is lying about one of them.
  it('distinguishes a FAILED shot read from a player with no shots', async () => {
    serve(payload({ shots: [], shots_available: false }));
    renderAt(MCDAVID);

    expect(await screen.findByText(/the shot log could not be read for this request/i)).toBeInTheDocument();
    expect(screen.queryByText(/no shots on record/i)).toBeNull();
    // The rest of the page is unaffected — the career arc still renders.
    expect(screen.getByText(/chapter 2 · career arc/i)).toBeInTheDocument();
  });

  it('refuses to draw a map whose coordinates fail their own distance check', async () => {
    serve(
      payload({
        shots: Array.from({ length: 30 }, (_, i) =>
          shot({ event_id: i, x: 74, y: 0, distance: 95 }),
        ),
      }),
    );
    renderAt(MCDAVID);

    expect(
      await screen.findByText(/only 0 of 30 attempts could be placed against their own recorded distance/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/shot heatmap/i)).toBeNull();
  });

  it('says the shot list was capped when the server capped it', async () => {
    serve(payload({ shots_truncated: true }));
    renderAt(MCDAVID);
    expect(await screen.findByText(/shot list capped at 1200/i)).toBeInTheDocument();
  });

  // A "freshness unknown" chip is itself a freshness claim.
  it('hides the freshness badge when the payload carried no timestamp', async () => {
    serve(payload({ as_of: null }));
    renderAt(MCDAVID);
    await screen.findByLabelText(/shot heatmap/i);
    expect(screen.getByText(/no update timestamp on this payload/i)).toBeInTheDocument();
  });

  it('shows the freshness badge when the payload carried a real timestamp', async () => {
    serve(payload());
    renderAt(MCDAVID);
    await screen.findByLabelText(/shot heatmap/i);
    expect(screen.queryByText(/no update timestamp/i)).toBeNull();
    // The badge names itself for assistive tech (`xG model. <date>, <age>.`);
    // the old text match had been passing against the marketing footer's
    // "31-feature xG model" line, which the app footer no longer carries.
    expect(screen.getByRole('note', { name: /xg model/i })).toBeInTheDocument();
  });

  // The league index is a SEPARATE endpoint behind the same gate. Losing it
  // must cost the percentiles and nothing else.
  it('still renders the hero when the league index is unavailable', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path.includes('/dashboard-index')) return Promise.reject(new ApiErrorLike('Unauthorized', 401));
      return Promise.resolve({ data: payload() });
    });
    renderAt(MCDAVID);

    expect(await screen.findByLabelText(/shot heatmap/i)).toBeInTheDocument();
    expect(
      screen.getByText(/the league payload could not be loaded, so nothing here can be ranked/i),
    ).toBeInTheDocument();
  });

  it('passes the season and game type from the URL through to the endpoint', async () => {
    serve(payload({ season: 2019, game_type: 'playoff' }));
    render(
      <MemoryRouter initialEntries={[`/players/${MCDAVID}?season=2019&gameType=playoff`]}>
        <Routes>
          <Route path="/players/:playerId" element={<PlayerDashboard />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/chapter 1 · overview/i);
    expect(apiGet).toHaveBeenCalledWith(
      `/api/players/${MCDAVID}/dashboard?season=2019&gameType=playoff`,
    );
  });
});

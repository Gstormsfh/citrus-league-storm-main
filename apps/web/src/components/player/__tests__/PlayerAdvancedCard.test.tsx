/**
 * PlayerAdvancedCard — what it renders, and (more importantly) what it does
 * NOT render when the data is not there.
 *
 * The degraded path is the load-bearing test in this file. The card ships on
 * eight host surfaces, all of which must look and behave exactly as they did
 * before it existed whenever `/api/players/dashboard-index` 401s.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('@/api/client', () => ({ apiClient: { get: getMock } }));

import type { XgHistoryPoint } from '@citrus/shared';
import { PlayerAdvancedCard } from '../PlayerAdvancedCard';
import { type CardEntry } from '../playerAdvancedMetrics';
import { projectionFraming } from '../projectionFraming';
import { resetPlayerDashboardIndex } from '@/hooks/usePlayerDashboardIndex';

let seq = 900;
function entry(over: Partial<CardEntry> = {}): CardEntry {
  return {
    id: seq++,
    name: 'Connor McDavid',
    team: 'EDM',
    position: 'C',
    jersey: 97,
    headshot_url: null,
    is_goalie: false,
    roster_status: null,
    gp: 40,
    goals: 24,
    assists: 40,
    points: 64,
    sog: 180,
    hits: 20,
    blocks: 12,
    ppp: 22,
    plus_minus: 12,
    x_goals: 19.4,
    wins: 0,
    saves: 0,
    save_pct: 0,
    gaa: 0,
    shutouts: 0,
    pim: 0,
    shp: 0,
    toi_seconds: 0,
    losses: 0,
    ot_losses: 0,
    goals_against: 0,
    xg_per_60: 1.18,
    xg_rating: 'Elite',
    gar_per_60: 0.62,
    gar_evo: 0.38,
    gar_evd: 0.07,
    gar_ppo: 0.14,
    gar_ppd: 0.0,
    gar_pen: 0.03,
    toi_total_minutes: null,
    avg_toi_per_game: null,
    vopa_score: null,
    gsax_raw: null,
    gsax_regressed: null,
    gsax_shots_faced: null,
    gsax_xga: null,
    gsax_ga: null,
    as_of: null,
    proj_gp: 42,
    proj_fantasy_points: 318.4,
    proj_fantasy_ppg: 7.58,
    proj_goals: 20,
    proj_assists: 34,
    proj_sog: 150,
    proj_ppp: 18,
    proj_blocks: 55,
    proj_hits: 40,
    proj_wins: null,
    proj_saves: null,
    proj_shutouts: null,
    ...over,
  };
}

function goalieEntry(over: Partial<CardEntry> = {}): CardEntry {
  return entry({
    name: 'Andrei Vasilevskiy',
    team: 'TBL',
    position: 'G',
    jersey: 88,
    is_goalie: true,
    goals: 0,
    assists: 0,
    points: 0,
    x_goals: 0,
    xg_per_60: null,
    xg_rating: null,
    gar_per_60: null,
    gar_evo: null,
    gar_evd: null,
    gar_ppo: null,
    gar_ppd: null,
    gar_pen: null,
    gp: 44,
    wins: 26,
    saves: 1180,
    save_pct: 0.918,
    gaa: 2.28,
    shutouts: 4,
    proj_wins: 18,
    proj_saves: 760,
    proj_shutouts: 3,
    ...over,
  });
}

/** A believable cohort so percentiles have something to be measured against. */
function league(): CardEntry[] {
  const forwards = [0.6, 0.7, 0.8, 0.9, 1.0, 1.05, 1.1, 1.15, 1.2, 1.3].map((xg, i) =>
    entry({ name: `Forward ${i}`, xg_per_60: xg, gar_per_60: xg / 2, goals: 10 + i, x_goals: 12 + i }),
  );
  const dmen = [0.2, 0.25, 0.3, 0.35, 0.4].map((xg, i) =>
    entry({ name: `Dman ${i}`, position: 'D', xg_per_60: xg, gar_per_60: xg, goals: 3 + i, x_goals: 4 + i }),
  );
  const tendies = [0.895, 0.902, 0.908, 0.912, 0.918].map((sv, i) =>
    goalieEntry({
      name: `Tendy ${i}`,
      save_pct: sv,
      gaa: 3.2 - i * 0.2,
      wins: 10 + i,
      shutouts: i,
      gsax_raw: -6 + i * 3,
      gsax_regressed: -4 + i * 2,
      gsax_shots_faced: 900 + i * 100,
      gsax_xga: 90,
      gsax_ga: 94 - i * 3,
    }),
  );
  return [...forwards, ...dmen, ...tendies];
}

/** A career arc of the given seasons, regular season, ascending xG. */
function arc(seasons: number[]): XgHistoryPoint[] {
  return seasons.map((season, i): XgHistoryPoint => ({
    season,
    game_type: 'regular',
    shots: 200 + i,
    sog: 120 + i,
    goals: 20 + i,
    xg: 18 + i * 2.5,
    finishing: 2 - i * 1.5,
    teams: 1,
  }));
}

const DAY_MS = 24 * 60 * 60 * 1000;

function renderCard(props: Parameters<typeof PlayerAdvancedCard>[0]) {
  return render(
    <MemoryRouter>
      <PlayerAdvancedCard {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  resetPlayerDashboardIndex();
});

// ── The degraded path ───────────────────────────────────────────────

describe('PlayerAdvancedCard — degraded paths render nothing at all', () => {
  it('renders nothing when the endpoint 401s (guest / demo / expired token)', () => {
    // Not a spinner, not an error, not an empty frame. `null`.
    const { container } = renderCard({ playerId: 8478402, indexOverride: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the player is not in the index', () => {
    const { container } = renderCard({ playerId: 111111, indexOverride: league() });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an unusable id', () => {
    for (const id of [null, undefined, 'roster-row-uuid']) {
      const { container, unmount } = renderCard({ playerId: id, indexOverride: league() });
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('renders nothing when disabled, and never asks the network', () => {
    const { container } = renderCard({ playerId: 8478402, enabled: false });
    expect(container).toBeEmptyDOMElement();
    expect(getMock).not.toHaveBeenCalled();
  });

  it('renders nothing for a player the payload has but has measured nothing for', () => {
    // A card with an identity strip and no numbers implies we looked and
    // found nothing worth showing. Standing down is more honest.
    const bare = entry({
      id: 4242,
      gp: 0,
      goals: 0,
      x_goals: 0,
      xg_per_60: null,
      gar_per_60: null,
      gar_evo: null,
      gar_evd: null,
      gar_ppo: null,
      gar_ppd: null,
      gar_pen: null,
    });
    const { container } = renderCard({ playerId: 4242, indexOverride: [...league(), bare] });
    expect(container).toBeEmptyDOMElement();
  });

  it('does not fetch when an index is injected', () => {
    renderCard({ playerId: 8478402, indexOverride: league() });
    expect(getMock).not.toHaveBeenCalled();
  });
});

// ── The skater card ─────────────────────────────────────────────────

describe('PlayerAdvancedCard — skater', () => {
  const subject = entry({ id: 8478402 });
  const index = [...league(), subject];

  it('renders the identity strip with position, team and jersey', () => {
    renderCard({ playerId: 8478402, indexOverride: index });
    const card = screen.getByTestId('player-advanced-card');
    expect(card).toHaveAttribute('data-cohort', 'F');
    expect(screen.getByText('Connor McDavid')).toBeInTheDocument();
    expect(screen.getByText(/C · EDM · #97/)).toBeInTheDocument();
  });

  it('shows finishing signed, with the raw goals-vs-expected line behind it', () => {
    renderCard({ playerId: 8478402, indexOverride: index });
    // 24 goals on 19.4 expected = +4.6
    expect(screen.getByTestId('advanced-card-finishing')).toHaveTextContent('+4.6');
    expect(screen.getByText('24 goals on 19.4 expected')).toBeInTheDocument();
  });

  it('colours finishing by sign, using only design-system tokens', () => {
    renderCard({ playerId: 8478402, indexOverride: index });
    expect(screen.getByTestId('advanced-card-finishing')).toHaveClass('text-pastel-sage');

    const cold = entry({ id: 5150, goals: 8, x_goals: 15.2 });
    renderCard({ playerId: 5150, indexOverride: [...index, cold] });
    const all = screen.getAllByTestId('advanced-card-finishing');
    expect(all[all.length - 1]).toHaveClass('text-pastel-butter');
  });

  it('shows the moat metric and the GAR headline, measured against forwards', () => {
    renderCard({ playerId: 8478402, indexOverride: index });
    expect(screen.getByText('xG/60')).toBeInTheDocument();
    expect(screen.getByText('Total GAR/60')).toBeInTheDocument();
    expect(screen.getByText(/vs forwards/i)).toBeInTheDocument();
  });

  it('shows four metric rows compact and the whole decomposition expanded', () => {
    const { unmount } = renderCard({ playerId: 8478402, indexOverride: index, variant: 'compact' });
    expect(screen.queryByText('PP Offense')).not.toBeInTheDocument();
    expect(screen.queryByText('Penalty')).not.toBeInTheDocument();
    unmount();

    renderCard({ playerId: 8478402, indexOverride: index, variant: 'expanded' });
    for (const label of ['xG/60', 'Total GAR/60', 'EV Offense', 'EV Defense', 'PP Offense', 'PP Defense', 'Penalty']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows the projection only on the expanded variant, framed for the date', () => {
    // Before the opener the eyebrow is `2026-27 projection`; once the season
    // is under way it is `Rest of season` (projectionFraming.ts).
    const eyebrow = projectionFraming().eyebrow;
    const { unmount } = renderCard({ playerId: 8478402, indexOverride: index });
    expect(screen.queryByText(eyebrow)).not.toBeInTheDocument();
    unmount();

    renderCard({ playerId: 8478402, indexOverride: index, variant: 'expanded' });
    expect(screen.getByText(eyebrow)).toBeInTheDocument();
    expect(screen.getByText(/7.58/)).toBeInTheDocument();
    expect(screen.getByText(/318.4 total/)).toBeInTheDocument();
  });

  it('measures a defenceman against defencemen, never against forwards', () => {
    const dman = entry({ id: 8480069, name: 'Cale Makar', position: 'D', team: 'COL', jersey: 8, xg_per_60: 0.45, gar_per_60: 0.5 });
    renderCard({ playerId: 8480069, indexOverride: [...index, dman] });
    expect(screen.getByTestId('player-advanced-card')).toHaveAttribute('data-cohort', 'D');
    expect(screen.getByText(/vs defencemen/i)).toBeInTheDocument();
  });

  it('links through to the full dashboard, and can be told not to', () => {
    const { unmount } = renderCard({ playerId: 8478402, indexOverride: index });
    expect(screen.getByTestId('advanced-card-link')).toHaveAttribute(
      'href',
      '/players/8478402',
    );
    unmount();
    renderCard({ playerId: 8478402, indexOverride: index, showLink: false });
    expect(screen.queryByTestId('advanced-card-link')).not.toBeInTheDocument();
  });

  it('flags a thin sample instead of quietly presenting it as a season', () => {
    const callup = entry({ id: 7777, name: 'Cutter Gauthier', gp: 4, goals: 3, x_goals: 1.1, xg_per_60: 1.9 });
    renderCard({ playerId: 7777, indexOverride: [...index, callup] });
    expect(screen.getByTestId('advanced-card-low-sample')).toHaveTextContent('4 GP');
    // …and says nothing about him in prose.
    expect(screen.queryByTestId('advanced-card-verdict')).not.toBeInTheDocument();
  });

  it('renders a derived verdict for a full-sample player', () => {
    renderCard({ playerId: 8478402, indexOverride: index });
    const verdict = screen.getByTestId('advanced-card-verdict');
    expect(verdict.textContent).toBeTruthy();
    expect(verdict.textContent).not.toMatch(/undefined|NaN/);
    expect(verdict).toHaveClass('italic');
  });

  it('omits the finishing band entirely when the player has no xG', () => {
    const unmodelled = entry({ id: 6060, x_goals: 0, goals: 11 });
    renderCard({ playerId: 6060, indexOverride: [...index, unmodelled] });
    expect(screen.queryByTestId('advanced-card-finishing')).not.toBeInTheDocument();
  });
});

// ── The goalie card ─────────────────────────────────────────────────

describe('PlayerAdvancedCard — goalie', () => {
  const subject = goalieEntry({ id: 8476883 });
  const index = [...league(), subject];

  it('gives a goalie goalie metrics, not an empty skater card', () => {
    renderCard({ playerId: 8476883, indexOverride: index, variant: 'expanded' });
    expect(screen.getByTestId('player-advanced-card')).toHaveAttribute('data-cohort', 'G');
    for (const label of ['Save rate', 'Goals against', 'Wins', 'Shutouts']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('xG/60')).not.toBeInTheDocument();
    expect(screen.queryByText('EV Offense')).not.toBeInTheDocument();
  });

  it('prints the save rate in the hockey convention and measures it vs goalies', () => {
    renderCard({ playerId: 8476883, indexOverride: index });
    expect(screen.getByText('.918')).toBeInTheDocument();
    expect(screen.getByText(/vs goalies/i)).toBeInTheDocument();
  });

  it('shows no finishing band — G − xG is meaningless for a goalie', () => {
    renderCard({ playerId: 8476883, indexOverride: index });
    expect(screen.queryByTestId('advanced-card-finishing')).not.toBeInTheDocument();
  });

  it('projects wins, saves and shutouts rather than goals and assists', () => {
    renderCard({ playerId: 8476883, indexOverride: index, variant: 'expanded' });
    expect(screen.getByText(/18.0 W · 760.0 SV · 3.0 SO/)).toBeInTheDocument();
  });

  // ── GSAx (2026-09-03) ─────────────────────────────────────────────

  it('leads the goalie card with GSAx, on the compact variant too', () => {
    const vasy = goalieEntry({ id: 8476883, gsax_raw: 11.2, gsax_regressed: 8.2, gsax_shots_faced: 1204, gsax_xga: 96.2, gsax_ga: 85 });
    renderCard({ playerId: 8476883, indexOverride: [...league(), vasy] });
    expect(screen.getByText('GSAx')).toBeInTheDocument();
    // The REGRESSED value, which is the number the modal's own GSAx cell
    // under this card prints. Raw would put +11.2 above a +8.2.
    expect(screen.getByText('+8.2')).toBeInTheDocument();
    expect(screen.queryByText('+11.2')).not.toBeInTheDocument();
    // Measured inside G: the best regressed GSAx among the six goalies.
    // Read off the bullet's own accessible name, because wins and shutouts
    // also sit at 100th for this fixture and a bare text query would be
    // ambiguous.
    expect(screen.getByRole('img', { name: /^GSAx/ })).toHaveAccessibleName(
      /100th percentile, value \+8\.2/,
    );
  });

  it('says the GSAx read in prose, naming the source and the shot sample', () => {
    const vasy = goalieEntry({ id: 8476883, gsax_regressed: 8.2, gsax_shots_faced: 1204 });
    renderCard({ playerId: 8476883, indexOverride: [...league(), vasy] });
    const verdict = screen.getByTestId('advanced-card-verdict');
    expect(verdict).toHaveTextContent('goals more than expected');
    expect(verdict).toHaveTextContent('1,204 primary shots');
    expect(verdict).toHaveTextContent('among goalies');
  });

  it('shows no GSAx row and falls back to the save-rate verdict when the join is empty', () => {
    // `subject` carries no GSAx. The row is dropped, not printed as 0.0,
    // and the compact card still fills its four rows from what IS there
    // rather than leaving the slot empty.
    renderCard({ playerId: 8476883, indexOverride: index });
    expect(screen.queryByText('GSAx')).not.toBeInTheDocument();
    for (const label of ['Save rate', 'Goals against', 'Wins', 'Shutouts']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByTestId('advanced-card-verdict')).toHaveTextContent('save rate');
  });

  it('never shows a skater a GSAx row', () => {
    renderCard({ playerId: 8478402, indexOverride: [...league(), entry({ id: 8478402 })], variant: 'expanded' });
    expect(screen.queryByText('GSAx')).not.toBeInTheDocument();
  });
});

// ── The career trend (2026-09-03) ───────────────────────────────────

describe('PlayerAdvancedCard: career trend', () => {
  const subject = entry({ id: 8478402 });
  const index = [...league(), subject];

  it('draws the sparkline on the expanded card when two or more seasons are on record', () => {
    renderCard({ playerId: 8478402, indexOverride: index, variant: 'expanded', historyOverride: arc([2023, 2024, 2025]) });
    const band = screen.getByTestId('advanced-card-trend');
    expect(band).toHaveTextContent('Citrus xG by season');
    expect(band).toHaveTextContent('2023-24 to 2025-26 · 3 seasons');
    // The newest season's value, to the two decimals the dashboard prints.
    expect(band).toHaveTextContent('23.00');
  });

  it('renders NOTHING for a one-season player: not a tile, not a one-point line', () => {
    // 413 of the 1,900 players in player_xg_season have exactly one regular
    // season (production, 2026-09-03). They get the card they always got.
    renderCard({ playerId: 8478402, indexOverride: index, variant: 'expanded', historyOverride: arc([2025]) });
    expect(screen.queryByTestId('advanced-card-trend')).not.toBeInTheDocument();
    expect(screen.queryByText(/Not enough data/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/xG by season/i)).not.toBeInTheDocument();
  });

  it('renders nothing when the history is absent or empty', () => {
    for (const history of [null, []]) {
      const { unmount } = renderCard({ playerId: 8478402, indexOverride: index, variant: 'expanded', historyOverride: history });
      expect(screen.queryByTestId('advanced-card-trend')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('never draws on the compact card, whatever the history says', () => {
    // The compact card has a height budget and mounts on list surfaces.
    renderCard({ playerId: 8478402, indexOverride: index, variant: 'compact', historyOverride: arc([2021, 2022, 2023, 2024, 2025]) });
    expect(screen.queryByTestId('advanced-card-trend')).not.toBeInTheDocument();
  });

  it('does not fetch the history when one is injected, or when the index is', () => {
    renderCard({ playerId: 8478402, indexOverride: index, variant: 'expanded', historyOverride: arc([2024, 2025]) });
    renderCard({ playerId: 8478402, indexOverride: index, variant: 'expanded' });
    expect(getMock).not.toHaveBeenCalled();
  });
});

// ── Freshness and the sample (2026-09-03) ──────────────────────────

describe('PlayerAdvancedCard: freshness badge', () => {
  it('wears the badge only when the row carries a real, stale timestamp', () => {
    const stale = entry({ id: 4141, as_of: new Date(Date.now() - 30 * DAY_MS).toISOString() });
    renderCard({ playerId: 4141, indexOverride: [...league(), stale] });
    const badge = screen.getByTestId('advanced-card-freshness');
    expect(badge).toHaveTextContent(/Outdated/);
    expect(badge).toHaveTextContent(/30 days ago/);
  });

  it('shows nothing for a fresh row: the badge is a warning, not furniture', () => {
    const fresh = entry({ id: 4242, as_of: new Date().toISOString() });
    renderCard({ playerId: 4242, indexOverride: [...league(), fresh] });
    expect(screen.queryByTestId('advanced-card-freshness')).not.toBeInTheDocument();
  });

  it('shows nothing when there is no timestamp, and never claims one is unavailable', () => {
    // Passing null to StaleDataBadge renders "Very outdated / Update
    // timestamp unavailable", which is the false claim the first cut of
    // this card refused to ship. The badge is not mounted at all.
    const unstamped = entry({ id: 4343, as_of: null });
    renderCard({ playerId: 4343, indexOverride: [...league(), unstamped] });
    expect(screen.queryByTestId('advanced-card-freshness')).not.toBeInTheDocument();
    expect(screen.queryByText(/timestamp unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Very outdated/i)).not.toBeInTheDocument();
  });
});

describe('PlayerAdvancedCard: the sample behind the rates', () => {
  it('prints games and the minutes the per-60 rows are divided by', () => {
    const mcdavid = entry({ id: 8478402, gp: 82, toi_total_minutes: 1884.8 });
    renderCard({ playerId: 8478402, indexOverride: [...league(), mcdavid] });
    expect(screen.getByTestId('advanced-card-deployment')).toHaveTextContent('82 GP · 1,885 min');
  });

  it('prints minutes a night and VOPA only when the table carries them', () => {
    const filled = entry({ id: 5151, gp: 82, toi_total_minutes: 1884.8, avg_toi_per_game: 22.98, vopa_score: 3.114 });
    const { unmount } = renderCard({ playerId: 5151, indexOverride: [...league(), filled] });
    expect(screen.getByTestId('advanced-card-deployment')).toHaveTextContent('82 GP · 1,885 min · 23.0 min/GP · VOPA +3.11');
    unmount();

    // A goalie has no GAR row, so no minutes: the line is games alone.
    const tendy = goalieEntry({ id: 5252, gp: 58 });
    renderCard({ playerId: 5252, indexOverride: [...league(), tendy] });
    expect(screen.getByTestId('advanced-card-deployment')).toHaveTextContent('58 GP');
    expect(screen.getByTestId('advanced-card-deployment')).not.toHaveTextContent('min');
  });
});

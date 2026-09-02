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

import { PlayerAdvancedCard } from '../PlayerAdvancedCard';
import { resetPlayerDashboardIndex, type DashboardIndexEntry } from '@/hooks/usePlayerDashboardIndex';

let seq = 900;
function entry(over: Partial<DashboardIndexEntry> = {}): DashboardIndexEntry {
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
    xg_per_60: 1.18,
    xg_rating: 'Elite',
    gar_per_60: 0.62,
    gar_evo: 0.38,
    gar_evd: 0.07,
    gar_ppo: 0.14,
    gar_ppd: 0.0,
    gar_pen: 0.03,
    proj_gp: 42,
    proj_fantasy_points: 318.4,
    proj_fantasy_ppg: 7.58,
    proj_goals: 20,
    proj_assists: 34,
    proj_sog: 150,
    proj_ppp: 18,
    proj_wins: null,
    proj_saves: null,
    proj_shutouts: null,
    ...over,
  };
}

function goalieEntry(over: Partial<DashboardIndexEntry> = {}): DashboardIndexEntry {
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
function league(): DashboardIndexEntry[] {
  const forwards = [0.6, 0.7, 0.8, 0.9, 1.0, 1.05, 1.1, 1.15, 1.2, 1.3].map((xg, i) =>
    entry({ name: `Forward ${i}`, xg_per_60: xg, gar_per_60: xg / 2, goals: 10 + i, x_goals: 12 + i }),
  );
  const dmen = [0.2, 0.25, 0.3, 0.35, 0.4].map((xg, i) =>
    entry({ name: `Dman ${i}`, position: 'D', xg_per_60: xg, gar_per_60: xg, goals: 3 + i, x_goals: 4 + i }),
  );
  const tendies = [0.895, 0.902, 0.908, 0.912, 0.918].map((sv, i) =>
    goalieEntry({ name: `Tendy ${i}`, save_pct: sv, gaa: 3.2 - i * 0.2, wins: 10 + i, shutouts: i }),
  );
  return [...forwards, ...dmen, ...tendies];
}

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

  it('shows the rest-of-season projection only on the expanded variant', () => {
    const { unmount } = renderCard({ playerId: 8478402, indexOverride: index });
    expect(screen.queryByText(/Rest of season/i)).not.toBeInTheDocument();
    unmount();

    renderCard({ playerId: 8478402, indexOverride: index, variant: 'expanded' });
    expect(screen.getByText(/Rest of season/i)).toBeInTheDocument();
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
});

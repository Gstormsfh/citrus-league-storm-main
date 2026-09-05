// THE PLAYERS TAB ON A PHONE (2026-09-04). Pins: one figure per row and the
// sort chooses it; the team and sort chips open pickers that write through;
// a row tap hands the entry to the caller; fifty rows then + N MORE; the
// card adapter carries only what the index holds.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { PlayersBrowsePhone, PAGE_SIZE } from '../PlayersBrowsePhone';
import { dashboardEntryToHockeyPlayer, svp } from '../playersBrowse';
import type { DashboardIndexEntry } from '@/hooks/usePlayerDashboardIndex';

afterEach(() => {
  cleanup();
});

const entry = (id: number, over: Partial<DashboardIndexEntry> = {}): DashboardIndexEntry =>
  ({
    id,
    name: `Player ${id}`,
    team: 'EDM',
    position: 'C',
    jersey: id,
    headshot_url: null,
    is_goalie: false,
    roster_status: null,
    gp: 10,
    goals: id,
    assists: 2,
    points: id + 2,
    sog: 30,
    hits: 1,
    blocks: 2,
    ppp: 3,
    plus_minus: 4,
    x_goals: 5.5,
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
    xg_per_60: id === 1 ? null : 1.234,
    xg_rating: null,
    gar_per_60: 0.5,
    gar_evo: null,
    gar_evd: null,
    gar_ppo: null,
    gar_ppd: null,
    gar_pen: null,
    toi_total_minutes: null,
    avg_toi_per_game: null,
    vopa_score: null,
    gsax_raw: null,
    proj_gp: null,
    proj_goals: null,
    proj_assists: null,
    proj_sog: null,
    proj_ppp: null,
    proj_blocks: null,
    proj_hits: null,
    proj_fantasy_points: 100 + id,
    proj_fantasy_ppg: null,
    proj_wins: null,
    proj_saves: null,
    proj_shutouts: null,
    ...over,
  }) as DashboardIndexEntry;

const mount = (over: Partial<React.ComponentProps<typeof PlayersBrowsePhone>> = {}) => {
  const props = {
    rows: [entry(3), entry(2), entry(1)],
    total: 3,
    loading: false,
    group: 'skaters' as const,
    onGroup: vi.fn(),
    position: 'ALL',
    onPosition: vi.fn(),
    teams: ['COL', 'EDM'],
    team: 'ALL',
    onTeam: vi.fn(),
    skaterSort: 'points' as const,
    onSkaterSort: vi.fn(),
    goalieSort: 'wins' as const,
    onGoalieSort: vi.fn(),
    searchOpen: false,
    searchQuery: '',
    onSearchQuery: vi.fn(),
    onOpen: vi.fn(),
    ...over,
  };
  render(<PlayersBrowsePhone {...props} />);
  return props;
};

describe('PlayersBrowsePhone', () => {
  it('shows one figure per row — the sorted stat — under its column head', () => {
    mount();
    const rows = screen.getAllByTestId('players-browse-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Player 3');
    expect(within(rows[0]).getByText('5')).toBeInTheDocument(); // points = id + 2
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Skaters · 3');
    expect(screen.getByText('by PTS')).toBeInTheDocument();
  });

  it('a rate with no sample is a dash, never a zero', () => {
    mount({ skaterSort: 'xg_per_60' });
    const rows = screen.getAllByTestId('players-browse-row');
    expect(rows[2]).toHaveTextContent('Player 1');
    expect(within(rows[2]).getByText('–')).toBeInTheDocument();
    expect(within(rows[0]).getByText('1.23')).toBeInTheDocument();
  });

  it('the sort chip opens a picker that writes the key through', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: /SORT · PTS/ }));
    fireEvent.click(screen.getByRole('option', { name: /GAR\/60/ }));
    expect(p.onSkaterSort).toHaveBeenCalledWith('gar_per_60');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('the team chip opens a picker of every club; a position chip writes straight through', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: 'TEAM ▾' }));
    expect(screen.getAllByRole('option')).toHaveLength(3);
    fireEvent.click(screen.getByRole('option', { name: 'COL' }));
    expect(p.onTeam).toHaveBeenCalledWith('COL');
    fireEvent.click(screen.getByRole('button', { name: 'D' }));
    expect(p.onPosition).toHaveBeenCalledWith('D');
  });

  it('goalies get their own sorts and no position chips', () => {
    mount({ group: 'goalies', rows: [entry(9, { is_goalie: true, position: 'G', wins: 30, save_pct: 0.912 })], total: 1, goalieSort: 'save_pct' });
    expect(screen.queryByRole('button', { name: 'LW' })).toBeNull();
    expect(screen.getByText('.912')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /SORT · SV%/ }));
    expect(screen.getAllByRole('option').some((o) => /PROJ W/.test(o.textContent ?? ''))).toBe(true);
  });

  it('a row tap hands the entry to the caller', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open player card for Player 2' }));
    expect(p.onOpen).toHaveBeenCalledTimes(1);
    expect((p.onOpen as ReturnType<typeof vi.fn>).mock.calls[0][0].id).toBe(2);
  });

  it('pages fifty at a time', () => {
    const rows = Array.from({ length: PAGE_SIZE + 7 }, (_, i) => entry(i + 1));
    mount({ rows, total: rows.length });
    expect(screen.getAllByTestId('players-browse-row')).toHaveLength(PAGE_SIZE);
    fireEvent.click(screen.getByRole('button', { name: /\+ 7 MORE/ }));
    expect(screen.getAllByTestId('players-browse-row')).toHaveLength(PAGE_SIZE + 7);
  });

  it('loading, error and empty each say what they are', () => {
    mount({ loading: true, rows: [] });
    expect(screen.getByTestId('players-browse-loading')).toBeInTheDocument();
    cleanup();
    const onRetry = vi.fn();
    mount({ error: 'Nope', rows: [], onRetry });
    fireEvent.click(screen.getByRole('button', { name: 'TRY AGAIN' }));
    expect(onRetry).toHaveBeenCalled();
    cleanup();
    mount({ rows: [], total: 0 });
    expect(screen.getByTestId('players-browse-empty')).toBeInTheDocument();
  });
});

describe('dashboardEntryToHockeyPlayer', () => {
  it('carries the season line the index holds, PIM, SHP and TOI per game included', () => {
    // 2026-09-05: the card printed PIM 0, SHP 0 and TOI/G "-" for every
    // skater. The index SELECTed pim and toi and dropped them; shp was never
    // read; this mapper carried none of the three.
    const p = dashboardEntryToHockeyPlayer(entry(7, { roster_status: 'IR', pim: 14, shp: 2, toi_seconds: 11_220 }));
    expect(p).toMatchObject({ id: 7, name: 'Player 7', position: 'C', number: 7, teamAbbreviation: 'EDM', status: 'IR' });
    expect(p.stats).toEqual({
      gamesPlayed: 10, goals: 7, assists: 2, points: 9, shots: 30, hits: 1, blockedShots: 2, powerPlayPoints: 3, shortHandedPoints: 2, pim: 14, plusMinus: 4, xGoals: 5.5,
      toi: '18:42',
    });
    // No ice time on record: no invented "0:00".
    expect(dashboardEntryToHockeyPlayer(entry(9, { toi_seconds: 0 })).stats.toi).toBeUndefined();
    const g = dashboardEntryToHockeyPlayer(entry(8, { is_goalie: true, position: 'G', wins: 30, losses: 12, ot_losses: 4, saves: 900, save_pct: 0.912, gaa: 2.4, shutouts: 3, goals_against: 118 }));
    expect(g.stats).toEqual({ gamesPlayed: 10, wins: 30, losses: 12, otl: 4, saves: 900, savePct: 0.912, gaa: 2.4, shutouts: 3, goalsAgainst: 118 });
    expect(g.status).toBeNull();
  });

  it('svp spells a save percentage the artboard way', () => {
    expect(svp(0.912)).toBe('.912');
    expect(svp(912)).toBe('.912');
    expect(svp(0)).toBe('–');
    expect(svp(null)).toBe('–');
  });
});

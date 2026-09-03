// THE PLAYERS TABLE NOW REACHES THE PLAYER DASHBOARD (2026-09-03 audit).
//
// Two defects, one page.
//
// 1. REACH. `/players/:playerId` is a real, ungated route and the page behind
//    it is substantial (shot map, career arc, cohort percentiles). Its ONLY
//    route in from the UI was: open the player modal on some other surface,
//    switch to its "Detailed" tab, scroll to the bottom, and tap a link that
//    renders `null` whenever the advanced payload is incomplete. Four steps
//    and a conditional, for a page the founder specifically said "deserves
//    its love". The table that lists every player linked to none of them.
//
//    The fix deliberately ADDS an affordance instead of retargeting the row.
//    A row click still selects, because that is the gesture this table was
//    built around: the panel beside it (or the sheet below `lg`) redraws in
//    place, and scanning twenty players without a page load is the whole
//    point of the layout. Below `lg` especially, making the name navigate
//    would have swallowed almost the entire visible tap target of the sticky
//    cell and taken the overlay sheet with it. So the row keeps its click,
//    and gains a real <a> beside it, plus a labelled button in the panel.
//
// 2. FACE. The page carried its own headshot component: a bare <img> that
//    fell back to a grey square of initials, with no team crest in between.
//    That was the third private fallback chain in a codebase that already
//    has `roster/Mug` for exactly this.
//
// Only the transport is mocked. The table, the panel, the URL sync and Mug
// itself are the real modules.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiGet = vi.fn();

vi.mock('@/api/client', () => ({
  API_BASE_URL: '',
  ApiError: class extends Error {},
  apiClient: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// Chrome, and it pulls the whole auth/league shell in behind it.
vi.mock('@/components/Navbar', () => ({ default: () => <nav data-testid="navbar" /> }));

import Players, { type DashboardPlayer } from '../Players';
import { resetPlayerDashboardIndex } from '@/hooks/usePlayerDashboardIndex';
import { teamCrestUrl } from '@/components/roster/headshot';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const PAGE = readFileSync(resolve(HERE, '..', 'Players.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const MCDAVID = 8478402;
const MAKAR = 8480069;
const MUG = 'https://assets.nhle.com/mugs/nhl/20252026/EDM/8478402.png';

function entry(over: Partial<DashboardPlayer> = {}): DashboardPlayer {
  return {
    id: MCDAVID,
    name: 'Connor McDavid',
    team: 'EDM',
    position: 'C',
    jersey: 97,
    headshot_url: MUG,
    is_goalie: false,
    roster_status: null,
    gp: 71, goals: 48, assists: 52, points: 100, sog: 244, hits: 20, blocks: 18,
    ppp: 30, plus_minus: 12, x_goals: 40.5,
    wins: 0, saves: 0, save_pct: 0, gaa: 0, shutouts: 0,
    xg_per_60: 1.42, xg_rating: 'Elite',
    gar_per_60: 0.5, gar_evo: 0.31, gar_evd: 0.04, gar_ppo: 0.11, gar_ppd: 0.01, gar_pen: 0.03,
    proj_gp: 58, proj_fantasy_points: 320, proj_fantasy_ppg: 5.5,
    proj_goals: 30, proj_assists: 34, proj_sog: 200, proj_ppp: 18, proj_blocks: 55, proj_hits: 40,
    proj_wins: null, proj_saves: null, proj_shutouts: null,
    ...over,
  };
}

const LEAGUE: DashboardPlayer[] = [
  entry(),
  entry({ id: MAKAR, name: 'Cale Makar', team: 'COL', position: 'D', jersey: 8, headshot_url: null, points: 90 }),
];

function renderPage(initialEntry = '/players') {
  apiGet.mockImplementation((path: string) =>
    path.includes('/dashboard-index')
      ? Promise.resolve({ data: LEAGUE })
      : Promise.resolve({ data: { notes: [] } }),
  );
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/players" element={<Players />} />
        <Route path="/players/:playerId" element={<div data-testid="full-dashboard" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * The <tr> a player's name sits in. Scoped to the table on purpose: the
 * panel beside it prints the selected player's name too, and the default
 * selection is the top of the current sort.
 */
const rowFor = async (name: string) => {
  const table = await screen.findByTestId('players-table');
  const cell = await within(table).findByText(name);
  return cell.closest('tr') as HTMLElement;
};

beforeEach(() => {
  vi.clearAllMocks();
  resetPlayerDashboardIndex();
});

describe('every row links to that player\'s full dashboard', () => {
  it('carries an anchor to /players/<id>, labelled for a screen reader', async () => {
    renderPage();
    const row = await rowFor('Connor McDavid');
    const link = within(row).getByTestId('players-row-dashboard-link');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe(`/players/${MCDAVID}`);
    expect(link.getAttribute('aria-label')).toBe('Open the full dashboard for Connor McDavid');
  });

  it('following the row link lands on the dashboard route', async () => {
    renderPage();
    const row = await rowFor('Cale Makar');
    fireEvent.click(within(row).getByTestId('players-row-dashboard-link'));
    expect(screen.getByTestId('full-dashboard')).toBeInTheDocument();
  });

  it('the link does not double as a row selection', async () => {
    // stopPropagation: a navigation that ALSO rewrote ?player= and opened the
    // mobile sheet would leave the page it navigated away from in a state the
    // back button restores wrong.
    renderPage();
    const row = await rowFor('Cale Makar');
    fireEvent.click(within(row).getByTestId('players-row-dashboard-link'));
    expect(screen.queryByTestId('player-dashboard-panel')).toBeNull();
  });
});

describe('the inline panel behaviour people rely on is unchanged', () => {
  it('a row click still selects that player into the panel', async () => {
    renderPage();
    fireEvent.click(await rowFor('Cale Makar'));
    const panel = screen.getAllByTestId('player-dashboard-panel')[0];
    expect(within(panel).getByRole('heading', { name: 'Cale Makar' })).toBeInTheDocument();
    // Still on /players, not navigated away.
    expect(screen.queryByTestId('full-dashboard')).toBeNull();
  });

  it('?player=<id> still selects on load', async () => {
    renderPage(`/players?player=${MAKAR}`);
    const panel = (await screen.findAllByTestId('player-dashboard-panel'))[0];
    expect(within(panel).getByRole('heading', { name: 'Cale Makar' })).toBeInTheDocument();
  });

  it('the panel repeats the link as a labelled button', async () => {
    renderPage();
    const panel = (await screen.findAllByTestId('player-dashboard-panel'))[0];
    const link = within(panel).getByTestId('players-panel-dashboard-link');
    expect(link.getAttribute('href')).toBe(`/players/${MCDAVID}`);
    expect(link.textContent).toContain('Full dashboard');
  });
});

describe('the face on this page is the shared Mug', () => {
  it('a row with a headshot on file draws it', async () => {
    renderPage();
    const row = await rowFor('Connor McDavid');
    const img = within(row).getByAltText('Connor McDavid') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(MUG);
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('a row without one falls to the team crest, not a grey square of initials', async () => {
    renderPage();
    const row = await rowFor('Cale Makar');
    const face = row.querySelector('[data-mug-state]') as HTMLElement;
    expect(face.getAttribute('data-mug-state')).toBe('crest');
    expect((within(row).getByAltText('COL') as HTMLImageElement).getAttribute('src')).toBe(
      teamCrestUrl('COL'),
    );
  });

  it('a headshot that fails is replaced, never hidden', async () => {
    renderPage();
    const row = await rowFor('Connor McDavid');
    fireEvent.error(within(row).getByAltText('Connor McDavid'));
    expect(within(row).queryByAltText('Connor McDavid')).toBeNull();
    expect(within(row).getByAltText('EDM')).toBeInTheDocument();
  });

  it('the page owns no private headshot component any more', () => {
    expect(PAGE).toMatch(/from ['"]@\/components\/roster\/Mug['"]/);
    expect(PAGE).not.toMatch(/function Headshot/);
    expect(PAGE).not.toMatch(/function initials/);
    expect(PAGE).not.toMatch(/src=\{[^}]*headshot_url/);
    expect(PAGE).not.toMatch(/<img/);
  });
});

// ROSTER-DROP DIALOG (2026-08-26) — reported from an iPhone as "when the list
// of players is too long to drop for free agents you can't scroll to drop
// them, they bounce back off the screen."
//
// Two defects were behind that screen, and only one of them was the scrolling.
//
// 1. COLUMN MISALIGNMENT — what these tests pin.
//    The roster rendered as ONE table whose header was chosen by the position
//    filter. Under the default "All" filter that header was the SKATER header
//    (11 columns) while goalie rows still rendered goalie cells (9). HTML does
//    not complain about a row with too few cells; it just shifts everything
//    left. So a goalie's WINS printed under Goals and his SAVE PERCENTAGE
//    under Assists, on every roster with a goalie on it, silently. Skaters and
//    goalies are now separate tables inside one scroller, each with its own
//    header, and these tests assert that every row's cell count matches the
//    header it sits under — the invariant whose violation is invisible.
//
// 2. THE SCROLL TRAP — asserted at the bottom as a source contract, because
//    jsdom has no layout engine and cannot see it. Measured in Chromium at
//    393x852: the list's clipping box was 274px tall and the Radix ScrollArea
//    viewport inside it was 358px (a fixed `min(420px,42vh)`), so 84px of
//    viewport lived outside the box that clipped it. The scroller believed
//    those rows were already visible and refused to scroll them into view —
//    the last two players on a 22-man roster could never be reached. The fix
//    is structural: the scroller and the box that clips it are now the same
//    element, so they cannot disagree.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Player } from '@/services/PlayerService';

const getTeamRoster = vi.fn();
const getPlayersByIds = vi.fn();

vi.mock('@/api/rosters', () => ({ rosterApi: { getTeamRoster: (...a: unknown[]) => getTeamRoster(...a) } }));
vi.mock('@/services/PlayerService', () => ({
  PlayerService: { getPlayersByIds: (...a: unknown[]) => getPlayersByIds(...a) },
}));
vi.mock('@/services/WaiverService', () => ({ WaiverService: { addPlayer: vi.fn() } }));
// Stable identity on purpose. The dialog's roster-loading effect lists `toast`
// in its dependency array, so a hook that returns a fresh function each render
// re-runs that effect forever — refetching the roster and resetting the
// position filter on every pass. shadcn's real useToast returns a module-level
// function, so this mirrors production rather than papering over it.
vi.mock('@/hooks/use-toast', () => {
  const stable = { toast: vi.fn() };
  return { useToast: () => stable };
});
vi.mock('@/utils/rosterRefresh', () => ({ notifyRosterChanged: vi.fn() }));

import { DropPlayerForAddDialog } from '../DropPlayerForAddDialog';

const skater = (id: string, name: string, position = 'C'): Player =>
  ({
    id, full_name: name, position, eligible_positions: [position], team: 'COL',
    games_played: 70, goals: 25, assists: 35, points: 60, plus_minus: 8,
    shots: 180, hits: 40, blocks: 30, pim: 18, ppp: 12, shp: 0,
    icetime_seconds: 70 * 19 * 60, xGoals: 20,
    wins: null, losses: null, ot_losses: null, saves: null, shutouts: null,
    goals_against_average: null, save_percentage: null,
  } as unknown as Player);

const goalie = (id: string, name: string): Player =>
  ({
    id, full_name: name, position: 'G', eligible_positions: ['G'], team: 'TBL',
    games_played: 75,          // games DRESSED — deliberately different from...
    goalie_gp: 58,             // ...games PLAYED, which is what a card must show
    goals: 0, assists: 0, points: 0, plus_minus: 0, shots: 0, hits: 0, blocks: 0,
    pim: 0, ppp: 0, shp: 0, icetime_seconds: 205845, xGoals: 0,
    wins: 39, losses: 15, ot_losses: 4, saves: 1600, shutouts: 2,
    goals_against_average: 2.31, save_percentage: 0.912,
  } as unknown as Player);

const ROSTER: Player[] = [
  skater('1', 'Nathan MacKinnon'),
  skater('2', 'Cale Makar', 'D'),
  skater('3', 'Mikko Rantanen', 'RW'),
  goalie('4', 'Andrei Vasilevskiy'),
  goalie('5', 'Logan Thompson'),
];

const props = {
  open: true,
  onOpenChange: vi.fn(),
  addPlayer: skater('99', 'Connor McDavid'),
  leagueId: 'league-1',
  teamId: 'team-1',
  userId: 'user-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  getTeamRoster.mockResolvedValue({ data: ROSTER.map((p) => ({ player_id: p.id })) });
  getPlayersByIds.mockResolvedValue(ROSTER);
});

/** Every table inside the scrolling roster list (not the "Adding" strip). */
function rosterTables(): HTMLTableElement[] {
  const list = document.querySelector('[data-testid="roster-list"]');
  if (!list) throw new Error('roster list container not found');
  return [...list.querySelectorAll('table')] as HTMLTableElement[];
}

function headerLabels(table: HTMLTableElement): string[] {
  return [...table.querySelectorAll('thead th')].map((th) => (th.textContent || '').trim());
}

describe('DropPlayerForAddDialog — column alignment', () => {
  it('gives every row exactly as many cells as the header it sits under', async () => {
    render(<DropPlayerForAddDialog {...props} />);
    await waitFor(() => expect(screen.getByText('Andrei Vasilevskiy')).toBeInTheDocument());

    const tables = rosterTables();
    expect(tables.length).toBeGreaterThan(0);

    for (const table of tables) {
      const headerCells = table.querySelectorAll('thead th').length;
      const rows = [...table.querySelectorAll('tbody tr')];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const label = row.textContent?.slice(0, 40);
        expect(row.querySelectorAll('td').length, `row "${label}" does not match its header`).toBe(headerCells);
      }
    }
  });

  it('puts skaters and goalies under separate headers, not one shared one', async () => {
    render(<DropPlayerForAddDialog {...props} />);
    await waitFor(() => expect(screen.getByText('Andrei Vasilevskiy')).toBeInTheDocument());

    const tables = rosterTables();
    expect(tables).toHaveLength(2);

    const headers = tables.map(headerLabels);
    const skaterTable = headers.findIndex((h) => h.includes('PTS'));
    const goalieTable = headers.findIndex((h) => h.includes('GAA'));
    expect(skaterTable).toBeGreaterThanOrEqual(0);
    expect(goalieTable).toBeGreaterThanOrEqual(0);
    expect(skaterTable).not.toBe(goalieTable);

    // A goalie must never appear under the skater header — that is the bug.
    expect(tables[skaterTable].textContent).not.toContain('Vasilevskiy');
    expect(tables[goalieTable].textContent).toContain('Vasilevskiy');
  });

  it('prints each goalie number under its own column heading', async () => {
    render(<DropPlayerForAddDialog {...props} />);
    await waitFor(() => expect(screen.getByText('Andrei Vasilevskiy')).toBeInTheDocument());

    const table = rosterTables().find((t) => headerLabels(t).includes('GAA'))!;
    const labels = headerLabels(table);
    const row = [...table.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('Vasilevskiy'))!;
    const cells = [...row.querySelectorAll('td')].map((td) => (td.textContent || '').trim());

    const at = (label: string) => cells[labels.indexOf(label)];
    expect(at('GAA')).toBe('2.31');
    expect(at('SV%')).toBe('91.2');
    expect(at('W')).toBe('39');
    expect(at('L')).toBe('15');
    expect(at('SO')).toBe('2');
  });

  it('shows a goalie his APPEARANCES, not the nights he dressed', async () => {
    // goalie_gp 58 against games_played 75 — the roster card must not print 75.
    render(<DropPlayerForAddDialog {...props} />);
    await waitFor(() => expect(screen.getByText('Andrei Vasilevskiy')).toBeInTheDocument());

    const table = rosterTables().find((t) => headerLabels(t).includes('GAA'))!;
    const labels = headerLabels(table);
    const row = [...table.querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('Vasilevskiy'))!;
    const cells = [...row.querySelectorAll('td')].map((td) => (td.textContent || '').trim());
    expect(cells[labels.indexOf('GP')]).toBe('58');
  });

  it('keeps the alignment invariant when the list is filtered to goalies', async () => {
    render(<DropPlayerForAddDialog {...props} />);
    await waitFor(() => expect(screen.getByText('Andrei Vasilevskiy')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Goalies' }));

    await waitFor(() => {
      const tables = rosterTables();
      expect(tables).toHaveLength(1);
      expect(headerLabels(tables[0])).toContain('GAA');
    });

    for (const table of rosterTables()) {
      const headerCells = table.querySelectorAll('thead th').length;
      for (const row of table.querySelectorAll('tbody tr')) {
        expect(row.querySelectorAll('td').length).toBe(headerCells);
      }
    }
  });
});

// ── the scroll trap ─────────────────────────────────────────────────────────
// jsdom reports every height as 0, so no rendered assertion here can tell a
// reachable row from an unreachable one. These pin the STRUCTURE that made the
// bug possible instead: one element that both scrolls and clips, and nothing
// nested inside it that carries its own height.
const SOURCE = readFileSync(
  resolve(fileURLToPath(import.meta.url), '..', '..', 'DropPlayerForAddDialog.tsx'),
  'utf8',
);

describe('DropPlayerForAddDialog — the scrolling contract', () => {
  it('scrolls and clips with the same element', () => {
    expect(SOURCE).toMatch(/flex-1 min-h-0 overflow-auto overscroll-contain/);
  });

  it('does not wrap the list in a ScrollArea again', () => {
    // A Radix ScrollArea needs a definite height on its Root. Given one inside
    // a flex child that is free to shrink, the two disagree and the overflow
    // is silently unreachable. That is the whole bug.
    // Matches real usage, not the explanation above it.
    expect(SOURCE).not.toMatch(/<ScrollArea/);
    expect(SOURCE).not.toMatch(/from '@\/components\/ui\/scroll-area'/);
  });

  it('never gives the list a fixed height that its parent can shrink past', () => {
    expect(SOURCE).not.toMatch(/h-\[min\(420px,\s*42vh\)\]/);
  });

  it('contains a flick rather than letting it chain into the locked page', () => {
    expect(SOURCE).toMatch(/overscroll-contain/);
  });
});

describe('DropPlayerForAddDialog — the name column contract', () => {
  // Reported from the Capacitor build (2026-08-28): "adding/dropping a player
  // their name gets cut off in the player menu." The name span carried a fixed
  // cap — max-w-[7.5rem] on the phone, 120 CSS pixels — chosen so `truncate`
  // had a bound to resolve against inside an auto-layout table. It cut
  // "Alexander Ovechkin" to a stub while the row had empty width to spare,
  // because a hardcoded cap cannot know how much room the visible stat
  // columns actually left.
  //
  // The idiom that does know is on the CELL, not the span: w-full makes the
  // name column the greedy one (it receives every pixel the content-sized
  // stat columns do not claim) and max-w-0 gives the overflow machinery a
  // resolvable bound so truncate still works. jsdom has no layout engine, so
  // these are source contracts — the classes ARE the behavior.

  it('never caps the name span at a fixed width again', () => {
    const nameSpans = SOURCE.match(/<span[^>]*>\{p\.full_name\}<\/span>/g) ?? [];
    expect(nameSpans.length).toBeGreaterThanOrEqual(2);
    for (const span of nameSpans) {
      expect(span).not.toMatch(/max-w-\[[\d.]+rem\]/);
    }
  });

  it('makes the name cell the greedy column with a resolvable overflow bound', () => {
    const nameCells = SOURCE.match(/<td[^>]*>\s*<span[^>]*>\{p\.full_name\}/g) ?? [];
    expect(nameCells.length).toBeGreaterThanOrEqual(2);
    for (const cell of nameCells) {
      expect(cell).toMatch(/w-full/);
      expect(cell).toMatch(/max-w-0/);
    }
  });

  it('still ellipsizes rather than letting a long name widen the row', () => {
    const nameSpans = SOURCE.match(/<span[^>]*>\{p\.full_name\}<\/span>/g) ?? [];
    for (const span of nameSpans) {
      expect(span).toMatch(/truncate/);
    }
  });
});

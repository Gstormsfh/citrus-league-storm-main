// ROSTER MOBILE CHROME (2026-09-01, Sleeper parity audit R4 + R8 + R9)
//
// Measured on the stack before this slice, at 393x852: the first player row
// began ~780px down — a sticky header AND a header card both saying the team
// name and record, the card stacked three deep, then a week bar, a day card
// with its own "Viewing:" line, the game-day strip, a "Lineup" heading with
// a Season / Rest-of-Season toggle the phone rows never read, and only then
// "Forwards". Sleeper shows the first player within a thumb-length of the
// top. Now the card is one line, week and day share one row, the toggle is
// desktop-only, and the first row lands around 375px.
//
// jsdom cannot mount Roster.tsx cheaply (it is 4,400 lines of effects), so
// these are source contracts in the shape of mobileSweepGuard and
// darkThemeContrastGuard: what is checkable is whether the source
// reintroduces the construct that regressed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
/** Strip comments so documentation of the old code is not read as code. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROSTER = code(read('pages/Roster.tsx'));

/** The JSX of one element's opening tag, from `<Tag` to its `>`. */
const openingTag = (src: string, marker: string) => {
  const at = src.indexOf(marker);
  expect(at, `${marker} not found`).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('>', at) + 1);
};

// ── R4: the header card is one line on phones ─────────────────────────────

describe('the header card collapses to one line below lg', () => {
  const cardStart = ROSTER.indexOf('data-testid="roster-header-card"');
  const card = ROSTER.slice(cardStart, ROSTER.indexOf('<Tabs ', cardStart));

  it('the row never stacks — no flex-col on the header row', () => {
    expect(cardStart).toBeGreaterThan(-1);
    expect(openingTag(ROSTER, '<div data-testid="roster-header-card"')).not.toContain('flex-col');
  });

  it('the manager eyebrow, Rank and Total Pts are desktop-only', () => {
    // The eyebrow's wrapper (a stripped JSX comment leaves `{}` before the text).
    expect(card).toMatch(/hidden lg:block[^"]*"[^>]*>[\s{}]*Manager ·/);
    for (const label of ['Rank', 'Total Pts']) {
      const at = card.indexOf(`>${label}<`);
      expect(at, `${label} cell missing`).toBeGreaterThan(-1);
      // The label sits in its own div; the cell is the div before that.
      const labelDiv = card.lastIndexOf('<div className="', at);
      const cell = card.lastIndexOf('<div className="', labelDiv - 1);
      const cls = card.slice(cell, card.indexOf('"', cell + 16));
      expect(cls, `${label} cell must be hidden below lg`).toContain('hidden lg:block');
    }
  });

  it('the record stays, as a mono number, on phones', () => {
    const span = openingTag(card, '<span\n                  data-testid="roster-header-record"');
    expect(span).toContain('lg:hidden');
    expect(span).toContain('font-jbmono');
    expect(span).toContain('tabular-nums');
    expect(card).toContain('{teamStats.record}');
  });

  it('Auto Lineup shrinks to a 32px pill and lg restores the default button', () => {
    expect(card).toContain('Auto Lineup');
    const btn = card.slice(card.indexOf('<Button'), card.indexOf('</Button>'));
    expect(btn).toContain('h-8');
    expect(btn).toContain('min-h-0');
    expect(btn).toContain('lg:h-12');
    expect(btn).toContain('lg:min-h-[48px]');
  });

  it('the card and the tab body lose their desktop padding on phones', () => {
    const cardOuter = ROSTER.lastIndexOf('<div className="bg-[#1A2A20]', cardStart);
    const cls = ROSTER.slice(cardOuter, ROSTER.indexOf('>', cardOuter));
    expect(cls).toContain('p-3 lg:p-5');
    expect(cls).toContain('mb-3 lg:mb-4');
    expect(openingTag(ROSTER, '<TabsContent value="roster"')).toContain('px-3 py-4 lg:p-6');
  });
});

// ── R4: week + day are one row on phones; the Viewing line is desktop's ──

describe('week and day selectors share one row on phones', () => {
  const rowAt = ROSTER.indexOf('data-testid="roster-week-day-row"');
  const branchStart = ROSTER.lastIndexOf('isMobile ? (', rowAt);
  const stripAt = ROSTER.indexOf('<TodayStrip', rowAt);
  // The desktop branch opens with the block the page always had.
  const split = ROSTER.indexOf('<div className="mb-6 space-y-4">', rowAt);
  const mobile = ROSTER.slice(branchStart, split);
  const desktop = ROSTER.slice(split, stripAt);

  it('the phone branch mounts the compact week trigger beside the compact day chips', () => {
    expect(rowAt).toBeGreaterThan(-1);
    expect(branchStart).toBeGreaterThan(-1);
    expect(mobile).toMatch(/<MatchupScheduleSelector\s+compact/);
    expect(mobile).toMatch(/<WeeklySchedule\s+compact/);
  });

  it('the phone branch carries no "Viewing:" line, no Read Only badge, no Lineup heading', () => {
    expect(mobile).not.toContain('Viewing:');
    expect(mobile).not.toContain('Read Only');
    expect(mobile).not.toContain('>Lineup<');
  });

  it('the desktop branch is the one that was there: varsity week bar, day card, Viewing line', () => {
    expect(desktop).not.toMatch(/<MatchupScheduleSelector\s+compact/);
    expect(desktop).not.toMatch(/<WeeklySchedule\s+compact/);
    expect(desktop).toContain('Viewing:');
    expect(desktop).toContain('Read Only');
  });

  it('a past day\'s read-only mark moves into the strip on phones', () => {
    const strip = ROSTER.slice(stripAt, ROSTER.indexOf('/>', stripAt));
    expect(strip).toContain('readOnly={isMobile && isPastDate}');
  });
});

// ── R4: the Season / Rest-of-Season toggle is desktop-only ───────────────

describe('the Lineup heading and the stat-view toggle are desktop-only', () => {
  it('the row wrapping the heading and the ToggleGroup is hidden below lg', () => {
    const h2 = ROSTER.indexOf('>Lineup</h2>');
    expect(h2).toBeGreaterThan(-1);
    const row = ROSTER.lastIndexOf('<div className="', h2);
    const cls = ROSTER.slice(row, ROSTER.indexOf('"', row + 16));
    expect(cls).toContain('hidden lg:flex');
    const rowEnd = ROSTER.indexOf('</div>', h2);
    expect(ROSTER.slice(h2, rowEnd)).toContain('<ToggleGroup');
  });

  it('the toggle still drives the desktop cards — statView is not dead code', () => {
    expect(ROSTER).toContain("value={statView}");
    expect(ROSTER).toMatch(/starters: prev\.starters\.map\(p => \(\{ \.\.\.p, statView \}\)\)/);
  });
});

// ── R8: the IR slot count reaches the phone list ─────────────────────────

describe('the phone list is told the league\'s real IR slot count', () => {
  it('resolves it with the server rule and passes it down', () => {
    expect(ROSTER).toContain('resolveIrSlotCount(leagueRosterSlots)');
    const list = ROSTER.slice(ROSTER.indexOf('<MobileRosterList'), ROSTER.indexOf('<FillSlotSheet'));
    expect(list).toContain('irSlotCount={irSlotCount}');
  });
});

// ── R9: the 'Game' placeholder is gone ───────────────────────────────────

describe('rows never print the "Game" placeholder', () => {
  it('Roster.tsx builds no nextGame with a literal opponent', () => {
    expect(ROSTER).not.toMatch(/opponent:\s*[^,\n]*'Game'/);
    expect(ROSTER).not.toContain("|| 'Game'");
    expect(ROSTER).not.toContain('"Game"');
  });

  it('the row line is derived from the selected date\'s schedule row', () => {
    expect(ROSTER).toContain('rowGameFor(');
    expect(ROSTER).toContain('gameOnDate(scheduleByTeam.get(');
    expect(ROSTER).toContain('ScheduleService.getGamesForTeams(');
  });

  it('the phone row prints the opponent only when there is one', () => {
    const list = code(read('components/roster/MobileRosterList.tsx'));
    expect(list).toContain('{player.nextGame?.opponent && (');
    expect(list).not.toContain("'Game'");
  });
});

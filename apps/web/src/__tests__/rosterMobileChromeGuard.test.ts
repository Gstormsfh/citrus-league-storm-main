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

  it('the legacy card is DESKTOP ONLY — the phone gets the Press Box card', () => {
    // The shape changed with the Press Box conversion (2026-09-04). This card
    // still exists and still carries Rank, Total Pts and a 48px Auto Lineup
    // button, none of which fit a 393px row; below lg it is not rendered at
    // all and `PressBoxTeamCard` takes its place. The contract this case has
    // always protected — a phone never sees the desktop card's padding — is
    // now satisfied by not drawing the card, which is stronger than shrinking
    // it, so the assertion moved rather than being dropped.
    const cardOuter = ROSTER.lastIndexOf('<div className="hidden lg:block bg-[#1A2A20]', cardStart);
    expect(cardOuter, 'the legacy header card must be hidden below lg').toBeGreaterThan(-1);
    const cls = ROSTER.slice(cardOuter, ROSTER.indexOf('>', cardOuter));
    expect(cls).toContain('p-3 lg:p-5');
    expect(cls).toContain('mb-3 lg:mb-4');
    expect(openingTag(ROSTER, '<TabsContent value="roster"')).toContain('px-3 py-4 lg:p-6');
  });

  it('the phone card is the Press Box one, with exactly one orange action', () => {
    const at = ROSTER.indexOf('<PressBoxTeamCard');
    expect(at, 'the phone team card must be mounted').toBeGreaterThan(-1);
    const wrapper = openingTag(ROSTER, ROSTER.slice(ROSTER.lastIndexOf('<div', at), ROSTER.lastIndexOf('<div', at) + 20));
    expect(wrapper, 'and only below lg').toContain('lg:hidden');
    const card = ROSTER.slice(at, ROSTER.indexOf('/>', ROSTER.indexOf('actions=', at)));
    for (const label of ['Optimize', 'Trade', 'Add', 'Log']) {
      expect(card, `${label} action missing`).toContain(`label: '${label}'`);
    }
    expect(card.match(/primary: true/g) ?? [], 'exactly one primary action').toHaveLength(1);
  });

  it('the list escapes the tab body\'s gutter so its rules reach both edges', () => {
    // The tab body keeps px-3 for the summary card above the list; the list
    // cancels it with -mx-3 and supplies the only gutter the rows see. Two
    // nested gutters put the rows 24px in from each edge, which is what made
    // a dense list read as a panel floating in a box.
    const at = ROSTER.indexOf('<PressBoxRosterList');
    const wrapper = ROSTER.lastIndexOf('<div className="-mx-3 lg:mx-0">', at);
    expect(wrapper, 'the list must cancel the page gutter below lg').toBeGreaterThan(-1);
  });
});

// ── PRESS BOX (2026-09-05): the day lives on the STARTERS header ─────────
//
// Artboard 1a's Team screen has no week/day row under the team card: the
// day is THU · FRI · SAT · WEEK on the STARTERS header, and the WK column
// and the ownership segment ride on the rows. The R4 phone row (compact
// week trigger + day chips) and the game-day strip are the desktop's now.

describe('the phone has no week/day row; the day toggles ride on the list', () => {
  const branchAt = ROSTER.indexOf("the day lives on the STARTERS header's");
  const listAt = ROSTER.indexOf('<PressBoxRosterList');
  const stripAt = ROSTER.indexOf('<TodayStrip');

  it('the phone branch of the week/day selector renders nothing', () => {
    expect(branchAt).toBeGreaterThan(-1);
    const branch = ROSTER.slice(ROSTER.lastIndexOf('isMobile ? (', branchAt), ROSTER.indexOf(') : (', branchAt));
    expect(branch).toContain('null');
    expect(branch).not.toMatch(/<MatchupScheduleSelector/);
    expect(branch).not.toMatch(/<WeeklySchedule/);
    expect(ROSTER).not.toContain('data-testid="roster-week-day-row"');
  });

  it('the desktop branch is the one that was there: varsity week bar, day card, Viewing line', () => {
    const desktop = ROSTER.slice(ROSTER.indexOf('<div className="mb-6 space-y-4">', branchAt), stripAt);
    expect(desktop).not.toMatch(/<MatchupScheduleSelector\s+compact/);
    expect(desktop).toContain('Viewing:');
    expect(desktop).toContain('Read Only');
  });

  it('the game-day strip is hidden below lg', () => {
    const strip = ROSTER.slice(stripAt, ROSTER.indexOf('/>', stripAt));
    expect(strip).toContain("'max-lg:hidden");
  });

  it('the list gets the day toggles, the WK column and the ownership segment', () => {
    const list = ROSTER.slice(listAt, ROSTER.indexOf('starters={rows.starters}', listAt));
    expect(list).toContain('days={[...pressBoxDays.map((d) => d.label)');
    expect(list).toContain("['WEEK']");
    expect(list).toContain('showWeek={rosterWeek.ready}');
    expect(list).toContain('showOwnership={ownership.size > 0}');
    expect(ROSTER).toContain('extras: rowExtras,');
  });

  it('the team card gets the win bar and the score pair', () => {
    const card = ROSTER.slice(ROSTER.indexOf('<PressBoxTeamCard'), ROSTER.indexOf('actions=[', ROSTER.indexOf('<PressBoxTeamCard')));
    expect(card).toContain('winPct={teamCardNumbers.winPct}');
    expect(card).toContain('yourScore={teamCardNumbers.yourScore}');
    expect(card).toContain('theirScore={teamCardNumbers.theirScore}');
  });

  it('the view switcher under the team card is desktop-only', () => {
    const tabs = ROSTER.slice(ROSTER.indexOf('<TabsList'), ROSTER.indexOf('>', ROSTER.indexOf('<TabsList')));
    expect(tabs).toContain('max-lg:hidden');
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
    // The SHAPE changed with the Press Box conversion (2026-09-04): the page
    // no longer hands a component `irSlotCount` as a prop, it hands it to
    // `buildRosterRows`, which turns the count into one row per IR SLOT --
    // held or empty -- for the list to draw. The intent this guard exists to
    // protect is unchanged and is what is asserted: the count is resolved by
    // the SERVER's rule, never defaulted locally, and it reaches the rows.
    expect(ROSTER).toContain('resolveIrSlotCount(leagueRosterSlots)');
    const call = ROSTER.slice(ROSTER.indexOf('buildRosterRows({'), ROSTER.indexOf('<PressBoxRosterList'));
    expect(call, 'the IR count reaches the row builder').toContain('irSlotCount,');
    const list = ROSTER.slice(ROSTER.indexOf('<PressBoxRosterList'), ROSTER.indexOf('<FillSlotSheet'));
    expect(list, 'and the built IR rows reach the list').toContain('ir={rows.ir}');
    expect(list).toContain('irRequired={rows.irRequired}');
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

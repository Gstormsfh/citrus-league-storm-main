// FREE AGENTS — THE PHONE PAGE (2026-09-02).
//
// Measured in Chromium at 393x852 against the real page (harness/README.md
// explains why that measurement cannot be a jsdom assertion — jsdom has no
// layout engine):
//
//   * the hero — "✦ Scouting Room", "Scout the pool.", a subtitle and the
//     search box — was ~250px, and the first player row began at y≈900;
//   * the seven position chips wrapped onto three lines, another ~96px;
//   * search and "See All" landed on a `min-w-[600px]` table inside
//     `overflow-x-auto`, so the projection column was off the right edge.
//
// FreeAgents.tsx cannot be mounted cheaply in jsdom (auth, league context,
// six services), so the page is held to a SOURCE contract — the same
// approach FreeAgents.mug.test.tsx and the MobileRosterList locks take.
// What the rows themselves do is covered by FreeAgentRow.test.tsx.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const RAW = readFileSync(resolve(HERE, '..', 'FreeAgents.tsx'), 'utf8');
/** Comments stripped, so this file's own explanations cannot satisfy a guard. */
const PAGE = RAW.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '');

const count = (needle: string, hay = PAGE) => hay.split(needle).length - 1;
/** The component body, so an import line cannot satisfy a usage count. */
const BODY = PAGE.slice(PAGE.indexOf('const FreeAgents ='));
/** The markup from `marker` forward — enough to cover one JSX block. */
const blockFrom = (marker: string, len = 1600) => {
  const i = PAGE.indexOf(marker);
  expect(i, `marker not found in FreeAgents.tsx: ${marker}`).toBeGreaterThan(-1);
  return PAGE.slice(i, i + len);
};

describe('the hero is desktop-only', () => {
  it('the eyebrow, the headline and the subtitle all live inside one hidden lg:flex block', () => {
    const hero = blockFrom('hidden lg:flex flex-col md:flex-row justify-between');
    expect(hero).toContain('✦ Scouting Room');
    expect(hero).toContain('Scout the pool.');
    expect(hero).toContain('Available players to improve your roster');
  });

  it('none of the three is rendered anywhere else, so none can leak back onto a phone', () => {
    expect(count('✦ Scouting Room')).toBe(1);
    expect(count('Scout the pool.')).toBe(1);
    expect(count('Available players to improve your roster')).toBe(1);
  });

  it('the branch is CSS, not a window read — no hydration flash, no innerWidth', () => {
    // Removing `window.innerWidth` reads from the render path is an active
    // repo goal (see useIsMobile.ts). A responsive class costs nothing and
    // paints correctly on the first frame.
    expect(PAGE).not.toMatch(/window\.innerWidth/);
    expect(PAGE).not.toMatch(/useIsMobile/);
  });
});

describe('the Press Box chrome carries the search (PR6b, 2026-09-04)', () => {
  // The compact title bar of 2026-09-02 is gone with the hero it replaced:
  // below lg the page is the shared LeagueHeader over PlayersPhone, whose
  // SEARCH cell opens a field bound to the same state the desktop input uses.
  it('the phone layer is the LeagueHeader over PlayersPhone, bound to the page search', () => {
    const chrome = blockFrom('className="lg:hidden pt-[env(safe-area-inset-top)]"', 600);
    expect(chrome).toContain('<LeagueHeader');
    const phone = blockFrom('<PlayersPhone', 2400);
    expect(phone).toContain('searchQuery={searchQuery}');
    expect(phone).toContain('onSearchQuery={setSearchQuery}');
    expect(phone).toContain('positionFilter={positionFilter}');
    expect(phone).toContain('renderRow={renderPhoneRow}');
  });

  it('the desktop layout is not rendered below lg', () => {
    expect(PAGE).toContain('<main className="hidden lg:block');
  });
});

describe('the position filters are one row, never three', () => {
  it('the Available tab applies the shared scroller class, not flex-wrap', () => {
    expect(PAGE).toContain('className={FA_CHIP_ROW}');
    expect(PAGE).toMatch(/import \{[^}]*FA_CHIP_ROW[^}]*\} from '@\/components\/freeagents\/freeAgentRowKit'/);
    // The exact class string this replaced. Its return is the regression.
    expect(PAGE).not.toContain('<div className="flex flex-wrap gap-2">');
    expect(PAGE).not.toContain('<div className="flex flex-wrap gap-2 mb-4">');
  });

  it('every chip carries the atomic class, so none can wrap or shrink mid-label', () => {
    // Two filter rows on this page (Available, Schedule) — both are chips.
    expect(count('FA_CHIP,', BODY)).toBe(2);
  });
});

describe('every phone list is the shared row', () => {
  it('Trending, Top Projected, the pool and the three phone views all render FreeAgentRowPressBox', () => {
    // Three in <main> (tablet widths, md–lg) and three in renderPhoneRow —
    // TREND, GAMES and the projection row PlayersPhone draws below lg.
    expect(count('<FreeAgentRowPressBox')).toBe(6);
    expect(PAGE).toContain("import { FreeAgentRowPressBox } from '@/components/freeagents/FreeAgentRowPressBox'");
    // The legacy row is no longer imported by the page; it stays in the
    // tree with its tests until the screen is signed off (PR6).
    expect(PAGE).not.toContain("from '@/components/freeagents/FreeAgentRow'");
  });

  it('each <main> row shows the projection and derives its own action state', () => {
    for (const block of BODY.split('<FreeAgentRowPressBox').slice(1)) {
      const tag = block.slice(0, block.indexOf('/>'));
      expect(tag).toMatch(/projection=\{|\{\.\.\.common\}/);
      expect(tag).toMatch(/action=\{freeAgentAction\(|\{\.\.\.common\}/);
    }
    // The phone rows share one prop bag, and it derives the same state.
    const common = blockFrom('const common = {', 500);
    expect(common).toContain('projection: player.weeklyProjection');
    expect(common).toContain('action: freeAgentAction(player, rosterFull)');
    expect(common).toContain('todayStr,');
    expect(common).toContain('onAction: () => handleRowAction(player)');
  });

  it('the sideways table is not the phone experience, and the row list stands in its place', () => {
    const list = blockFrom('data-testid="free-agents-phone-list"', 900);
    expect(list).toContain('<FreeAgentRowPressBox');
    // The wrapper that used to be the phone experience.
    expect(PAGE).not.toContain('<div className="overflow-x-auto">\n                        <Table className="min-w-[600px]');
  });
});

/**
 * WHERE THE ROW LIST STOPS (2026-09-02, tablet pass).
 *
 * Measured in Chromium on the real stylesheet with the pool table's own
 * markup: the table's minimum content width is 722px, and the container
 * below `lg` is `viewport - 18px` (the content column's `px-2` plus the
 * card's 1px border on each side). So the table fits from 768px (750px of
 * container, 28px of slack) and does not at 744 (726px, 4px — too thin to
 * build on). Everything from 768 to 1023 was being handed a 64px row with
 * ~700px of empty space beside it and no sortable columns.
 *
 * The switch is a CSS branch and a MEASUREMENT, not a fifth answer to "is
 * this a phone" — that question still has exactly one (`useIsMobile.ts`,
 * `MOBILE_BREAKPOINT = 1024`) and this page still asks it nowhere.
 */
describe('the row list gives way to the table where the table fits', () => {
  const ROW_MODULE = readFileSync(
    resolve(HERE, '..', '..', 'components', 'freeagents', 'freeAgentRowKit.ts'),
    'utf8',
  );

  it('the pair is declared once, in freeAgentRowKit.ts, at md', () => {
    expect(ROW_MODULE).toMatch(/export const FA_ROWS_ONLY = 'md:hidden'/);
    expect(ROW_MODULE).toMatch(/export const FA_TABLE_ONLY = 'hidden md:block'/);
    // The measurement that chose `md` has to travel with the constants, or
    // the next sweep moves them back on instinct.
    expect(ROW_MODULE).toContain('722px');
  });

  it('every list/table switch on the page uses that pair, and none is hand-typed', () => {
    // Three surfaces: Trending, Top Projected, the pool.
    expect(count('FA_ROWS_ONLY', BODY)).toBe(3);
    expect(count('FA_TABLE_ONLY', BODY)).toBe(3);
    expect(PAGE).toMatch(
      /import \{[^}]*FA_ROWS_ONLY[^}]*FA_TABLE_ONLY[^}]*\} from '@\/components\/freeagents\/freeAgentRowKit'/,
    );
    // The literals the constants replaced. `hidden lg:block` still has two
    // legitimate uses on this page (the desktop Navbar and the mascot
    // portrait), so what is banned is an `lg` gate wrapping a <Table>.
    expect(count('<div className="lg:hidden">')).toBe(0);
    expect(count('<div className="hidden lg:block overflow-x-auto">')).toBe(0);
    expect(PAGE).not.toMatch(/lg:(?:block|hidden)[^"]*"\s*>\s*<Table/);
  });

  it('the tablet keeps the mobile chrome — the breakpoints answer different questions', () => {
    // The page header, the hero and the nav still split at `lg`, because
    // "does this screen want app chrome" is not "does this table fit".
    expect(PAGE).toContain('className="lg:hidden pt-[env(safe-area-inset-top)]"');
    expect(PAGE).toContain('hidden lg:flex flex-col md:flex-row justify-between');
    expect(PAGE).toContain('<div className="hidden lg:block"><Navbar /></div>');
  });

  it('the tap/click hint already split at md, and now agrees with the list', () => {
    // "Tap a player row" vs "Click any column header to sort" — the second
    // is only true where the sortable header is on screen.
    expect(PAGE).toContain('<span className="md:hidden">Tap a player row');
    expect(PAGE).toContain('<span className="hidden md:inline">Click any column header to sort.');
  });
});

describe('the phone list leads with the projection', () => {
  it('its default order is sortByProjection, not the fetch order', () => {
    expect(PAGE).toContain('sortByProjection(filteredPlayers.map(withProjection))');
    expect(PAGE).toMatch(/import \{[^}]*sortByProjection[^}]*\} from '@\/components\/freeagents\/freeAgentRowKit'/);
  });

  it('it pages with the same visibleCount the desktop table does', () => {
    // One sentinel, one counter, one "Showing N of M" — the phone list and
    // the table must not disagree about how far down the pool you are.
    expect(PAGE).toContain('.slice(0, visibleCount)');
  });
});

describe('one scoring path', () => {
  it('the page builds exactly one ScoringCalculator, and every list reads through it', () => {
    // Two copies of the rest-of-week projection existed — one in the Top
    // Projected card, one inline in the Schedule tab's table body, each
    // constructing its own calculator. Two copies is two answers to "what
    // is he worth"; the phone row would have made three.
    expect(count('new ScoringCalculator(')).toBe(1);
    expect(PAGE).toContain('const withProjection = useCallback(');
    // Trending, Top Projected, the phone list and the Schedule tab.
    expect(count('withProjection')).toBeGreaterThanOrEqual(6);
  });
});

describe('the player card opened from a row carries the verb', () => {
  it('PlayerStatsModal is given an action, and it names the transaction', () => {
    const modal = blockFrom('<PlayerStatsModal', 2400);
    expect(modal).toContain('action={selectedSourcePlayer');
    expect(modal).toContain('Claim on waivers');
    expect(modal).toContain("'Add with a drop'");
    expect(modal).toContain("'Add to roster'");
  });

  it('it routes to the page\'s own handlers rather than a second add path', () => {
    const modal = blockFrom('<PlayerStatsModal', 2400);
    expect(modal).toContain('handleRowAction(source)');
    // The card's footer must not grow its own transaction: one add path.
    expect(modal).not.toContain('WaiverService');
  });

  it('handleRowAction only picks a handler — it files nothing itself', () => {
    const fn = blockFrom('const handleRowAction = (player: Player) => {', 400);
    expect(fn).toContain('handleAddWithDrop(player)');
    expect(fn).toContain('handleAddPlayer(player)');
    expect(fn).not.toContain('WaiverService');
    expect(fn).not.toContain('supabase');
  });
});

describe('roster capacity is a label, not a gate', () => {
  it('it is read AFTER the list renders, like the waiver badge beside it', () => {
    // The 2026-08-2x fix that put this page's list on screen before its
    // optional enrichments must not be undone by a capacity check.
    const i = PAGE.indexOf('setPlayers(freeAgentResult.players)');
    const j = PAGE.indexOf('void enrichRosterCapacity(currentLeagueId)');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(PAGE).toContain('void enrichWithWaiverStatus(currentLeagueId)');
  });
});

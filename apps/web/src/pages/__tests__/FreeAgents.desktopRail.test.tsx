// FREE AGENTS, THE DESKTOP RAILS (2026-09-03).
//
// The 2026-09-02 tablet pass measured the pool table at 722px of minimum
// content width and moved the row-list/table switch to `md`, where the table
// fits. It also wrote down, and did not ship, the desktop half of the
// finding: at `lg` the page grew two rails (200px + 260px, then 220 + 280 at
// `xl`) and the card holding the table shrank to 450px at 1024 and 634px at
// 1280. The first desktop width that held the table was 1368. Every laptop
// narrower than that was scrolling the projection column, the one the
// decision turns on, off the right edge, while a 1023px tablet had 555px
// more room for the same table.
//
// The fix keeps the table everywhere it is shown and gives the notifications
// rail a breakpoint of its own (1400px) instead of `lg`. The geometry is a
// set of class strings in freeAgentRowKit.ts, and this file does what jsdom
// cannot (it has no layout engine, see harness/README.md): it computes the
// card width from those strings, band by band, with Tailwind's default
// screens and spacing scale, and fails if any breakpoint where the table
// renders hands it fewer than 722px. The old grid is fed through the same
// model to prove the model bites.
//
// The page itself cannot be mounted cheaply in jsdom (auth, league context,
// six services), so its use of the constants is a SOURCE contract, the same
// approach FreeAgents.phoneList.test.tsx takes.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// freeAgentRowKit.ts imports ScheduleService for its game line, which pulls the
// API client, whose Supabase client throws at module scope under the suite's
// hermetic (empty) env. Same stub FreeAgentRow.test.tsx uses.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn() } },
}));

import {
  FA_CONTENT_COLUMN,
  FA_NOTIFICATIONS_RAIL,
  FA_PAGE_GRID,
  FA_PAGE_GRID_WITH_RAIL,
  FA_POOL_CARD,
  FA_RAIL_MIN_VIEWPORT,
  FA_ROWS_ONLY,
  FA_TABLE_MIN_WIDTH,
  FA_TABLE_ONLY,
} from '@/components/freeagents/freeAgentRowKit';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const RAW = readFileSync(resolve(HERE, '..', 'FreeAgents.tsx'), 'utf8');
/** Comments stripped, so this file's own explanations cannot satisfy a guard. */
const PAGE = RAW.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '');
const ROW_MODULE = readFileSync(
  resolve(HERE, '..', '..', 'components', 'freeagents', 'freeAgentRowKit.ts'),
  'utf8',
);

const count = (needle: string, hay = PAGE) => hay.split(needle).length - 1;

// ── A model of the cascade, just wide enough for these strings ────────────
//
// Tailwind emits one media query per screen, in ascending min-width order,
// and sorts `min-[Npx]:` variants in with the named screens by value
// (tailwindcss/lib/corePlugins.js, "screens and min-* are sorted together").
// So at a viewport W the utility that wins a property is the one with the
// largest breakpoint <= W. Two utilities of one family at one breakpoint are
// an ambiguity the model refuses rather than guesses at.

/** Tailwind's defaults. tailwind.config.ts overrides none of them: its only
 * `screens` key sits under `container`, which caps `.container` and nothing
 * else. */
const SCREENS: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 };

/** The spacing scale: 1 = 0.25rem = 4px at the 16px root index.css keeps. */
const spacing = (token: string): number => {
  const arbitrary = token.match(/^\[(\d+(?:\.\d+)?)px\]$/);
  if (arbitrary) return Number(arbitrary[1]);
  expect(token, `not a spacing token: "${token}"`).toMatch(/^\d+(?:\.\d+)?$/);
  return Number(token) * 4;
};

interface Rule {
  from: number;
  utility: string;
}

/** `lg:px-4` -> { from: 1024, utility: 'px-4' }; `min-[1400px]:block` -> { from: 1400, ... }. */
function parse(classes: string): Rule[] {
  return classes
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((cls) => {
      const arbitrary = cls.match(/^min-\[(\d+)px\]:(.+)$/);
      if (arbitrary) return { from: Number(arbitrary[1]), utility: arbitrary[2] };
      const named = cls.match(/^([a-z0-9]+):(.+)$/);
      if (named) {
        const from = SCREENS[named[1]];
        if (from === undefined) throw new Error(`the model knows no variant "${named[1]}:" (in "${cls}")`);
        return { from, utility: named[2] };
      }
      return { from: 0, utility: cls };
    });
}

/** The property families the arithmetic depends on. Everything else is ignored. */
type Family = 'display' | 'columns' | 'gap' | 'px' | 'border';

function family(utility: string): Family | null {
  if (/^(?:hidden|block|flex|grid|inline|inline-block|inline-flex)$/.test(utility)) return 'display';
  if (/^grid-cols-/.test(utility)) return 'columns';
  if (/^gap-/.test(utility)) return 'gap';
  if (/^px-/.test(utility)) return 'px';
  if (utility === 'border') return 'border';
  return null;
}

interface Resolved {
  display: string | undefined;
  /** The `grid-template-columns` tracks, e.g. ['220px', '1fr', '280px']. */
  columns: string[];
  gap: number;
  px: number;
  border: number;
}

/** What the element's computed style is at viewport `width`. */
function resolveAt(classes: string, width: number): Resolved {
  const winner: Partial<Record<Family, Rule>> = {};
  for (const rule of parse(classes)) {
    const fam = family(rule.utility);
    if (!fam || rule.from > width) continue;
    const current = winner[fam];
    if (current && current.from === rule.from) {
      throw new Error(`"${classes}" sets ${fam} twice at ${rule.from}px: ${current.utility} and ${rule.utility}`);
    }
    if (!current || rule.from > current.from) winner[fam] = rule;
  }
  const cols = winner.columns?.utility.match(/^grid-cols-\[(.+)\]$/);
  return {
    display: winner.display?.utility,
    columns: cols ? cols[1].split('_') : [],
    gap: winner.gap ? spacing(winner.gap.utility.slice('gap-'.length)) : 0,
    px: winner.px ? spacing(winner.px.utility.slice('px-'.length)) : 0,
    border: winner.border ? 1 : 0,
  };
}

interface Geometry {
  grid: string;
  column: string;
  card: string;
}

/**
 * The width the pool card gets at viewport `width`: the grid's own padding,
 * its fixed columns and the gaps between all of them come off first, then
 * the content column's padding, then the card's border. Below `lg` the
 * wrapper is a flex column and only the paddings and border apply.
 */
function cardWidthAt({ grid, column, card }: Geometry, width: number): number {
  const g = resolveAt(grid, width);
  let columnWidth = width - 2 * g.px;
  if (g.display === 'grid') {
    const fr = g.columns.filter((c) => c.endsWith('fr'));
    expect(fr, `the content column must be the one 1fr track in "${g.columns.join(' ')}"`).toEqual(['1fr']);
    const fixed = g.columns.filter((c) => c.endsWith('px')).reduce((sum, c) => sum + Number.parseFloat(c), 0);
    columnWidth -= fixed + (g.columns.length - 1) * g.gap;
  }
  return columnWidth - 2 * resolveAt(column, width).px - 2 * resolveAt(card, width).border;
}

/** True where a `hidden md:block`-style pair shows its element. */
const shownAt = (classes: string, width: number) => resolveAt(classes, width).display !== 'hidden';

const NOW: Geometry = { grid: FA_PAGE_GRID, column: FA_CONTENT_COLUMN, card: FA_POOL_CARD };
const NOW_WITH_RAIL: Geometry = { ...NOW, grid: `${FA_PAGE_GRID} ${FA_PAGE_GRID_WITH_RAIL}` };

/** Every breakpoint any of the strings mentions, its lower edge and the width just under it. */
function bandEdges(...classLists: string[]): number[] {
  const froms = new Set<number>(Object.values(SCREENS));
  for (const list of classLists) for (const r of parse(list)) froms.add(r.from);
  const edges = new Set<number>();
  for (const f of froms) {
    edges.add(f);
    if (f > 0) edges.add(f - 1);
  }
  return [...edges].filter((w) => w > 0).sort((a, b) => a - b);
}

/** Extra widths to probe on top of the band edges: the header's phone and
 * tablet widths, then a spread of laptop and desktop widths. */
const DEVICES = [393, 744, 820, 1366, 1440, 1512, 1920];

// ── The contract ──────────────────────────────────────────────────────────

describe('the pool table fits wherever it is shown', () => {
  const widths = [...new Set([...bandEdges(FA_PAGE_GRID, FA_PAGE_GRID_WITH_RAIL, FA_CONTENT_COLUMN, FA_TABLE_ONLY), ...DEVICES])].sort(
    (a, b) => a - b,
  );

  it('the model saw every band it needs to (a screens table with a hole hides a band)', () => {
    for (const w of [767, 768, 1023, 1024, 1279, 1280, FA_RAIL_MIN_VIEWPORT - 1, FA_RAIL_MIN_VIEWPORT, 1535, 1536]) {
      expect(widths).toContain(w);
    }
  });

  it('at every band edge and every device width where the table renders, the card is at least 722px', () => {
    const short: string[] = [];
    for (const w of widths) {
      if (!shownAt(FA_TABLE_ONLY, w)) continue;
      for (const [label, geometry] of [['with the rail', NOW_WITH_RAIL], ['without it', NOW]] as const) {
        const card = cardWidthAt(geometry, w);
        if (card < FA_TABLE_MIN_WIDTH) short.push(`${w}px ${label}: ${card}px, ${FA_TABLE_MIN_WIDTH - card} short`);
      }
    }
    expect(short, `the table scrolls sideways at:\n${short.join('\n')}`).toEqual([]);
  });

  it('the row list and the table are never both on screen, and never both off', () => {
    for (const w of widths) {
      expect(shownAt(FA_ROWS_ONLY, w), `rows at ${w}`).toBe(!shownAt(FA_TABLE_ONLY, w));
    }
  });

  it('is the table freeAgentRowKit.ts writes down, to the pixel', () => {
    // [viewport, card with the rail rendered, card without it]. The two agree
    // below FA_RAIL_MIN_VIEWPORT because the rail is hidden there and its
    // column does not exist. A change to any gutter, rail or breakpoint has
    // to rewrite this table AND the header it mirrors.
    const EXPECTED: Array<[number, number, number]> = [
      [768, 750, 750],
      [1023, 1005, 1005],
      [1024, 742, 742],
      [1279, 997, 997],
      [1280, 938, 938],
      [1366, 1024, 1024],
      [1399, 1057, 1057],
      [1400, 754, 1058],
      [1440, 794, 1098],
      [1536, 890, 1194],
    ];
    for (const [w, withRail, withoutRail] of EXPECTED) {
      expect(cardWidthAt(NOW_WITH_RAIL, w), `${w}px with the rail`).toBe(withRail);
      expect(cardWidthAt(NOW, w), `${w}px without the rail`).toBe(withoutRail);
    }
    // The thinnest the table ever gets on a desktop, and the slack it keeps.
    expect(cardWidthAt(NOW_WITH_RAIL, 1024) - FA_TABLE_MIN_WIDTH).toBe(20);
    expect(cardWidthAt(NOW_WITH_RAIL, FA_RAIL_MIN_VIEWPORT) - FA_TABLE_MIN_WIDTH).toBe(32);
    // The numbers travel with the constants, as the `md` measurement does.
    expect(ROW_MODULE).toContain('viewport - 282');
    expect(ROW_MODULE).toContain('viewport - 646');
    expect(ROW_MODULE).toContain('722px');
  });
});

describe('the rail and its column are one decision', () => {
  it('both carry the same spelled-out breakpoint, and it is FA_RAIL_MIN_VIEWPORT', () => {
    // Tailwind only generates a class it can read verbatim from the source,
    // so the number is typed twice on purpose. This is what keeps the two
    // literals honest with each other and with the number the tests use.
    const bp = `min-[${FA_RAIL_MIN_VIEWPORT}px]:`;
    expect(FA_PAGE_GRID_WITH_RAIL).toContain(bp);
    expect(FA_NOTIFICATIONS_RAIL).toContain(bp);
    expect(FA_PAGE_GRID_WITH_RAIL.match(/min-\[/g)).toHaveLength(1);
    expect(FA_NOTIFICATIONS_RAIL.match(/min-\[/g)).toHaveLength(1);
    // The base grid has no third column at any width; only the rail's
    // addition does, so a guest never gets an empty column.
    expect(FA_PAGE_GRID).not.toMatch(/min-\[/);
    for (const w of bandEdges(FA_PAGE_GRID)) expect(resolveAt(FA_PAGE_GRID, w).columns.length).toBeLessThanOrEqual(2);
  });

  it('the third column exists exactly where the rail is shown', () => {
    for (const w of [...bandEdges(FA_PAGE_GRID_WITH_RAIL, FA_NOTIFICATIONS_RAIL), ...DEVICES]) {
      const columns = resolveAt(NOW_WITH_RAIL.grid, w).columns.length;
      const railShown = resolveAt(FA_NOTIFICATIONS_RAIL, w).display === 'block';
      expect(columns === 3, `${w}px: ${columns} columns, rail ${railShown ? 'shown' : 'hidden'}`).toBe(railShown);
    }
  });

  it('the rail waits for a width that fits with slack, and comes back before 2xl', () => {
    // The three-column grid as it stands at `xl`, with the 1400px gate
    // removed, so the model can find the width where it holds the table by
    // exactly 0px. That width is 1368, and it is why the gate is not `xl`.
    const railColumns = parse(FA_PAGE_GRID_WITH_RAIL)
      .filter((r) => family(r.utility) === 'columns')
      .map((r) => r.utility);
    expect(railColumns).toHaveLength(1);
    const ungated = FA_PAGE_GRID.replace(/xl:grid-cols-\[[^\]]+\]/, `xl:${railColumns[0]}`);
    expect(ungated).not.toBe(FA_PAGE_GRID);
    const threeColumns: Geometry = { ...NOW, grid: ungated };
    expect(cardWidthAt(threeColumns, 1368)).toBe(FA_TABLE_MIN_WIDTH);
    expect(cardWidthAt(threeColumns, 1367)).toBeLessThan(FA_TABLE_MIN_WIDTH);
    // The gate gives the rail's return the same order of slack `md` has
    // (28px at 768), and it sits between `xl` and `2xl`: 1536 would take the
    // rail off every laptop between 1440 and 1535 wide for nothing.
    expect(cardWidthAt(NOW_WITH_RAIL, FA_RAIL_MIN_VIEWPORT) - FA_TABLE_MIN_WIDTH).toBeGreaterThanOrEqual(28);
    expect(FA_RAIL_MIN_VIEWPORT).toBeGreaterThan(SCREENS.xl);
    expect(FA_RAIL_MIN_VIEWPORT).toBeLessThan(SCREENS['2xl']);
  });
});

// ── The model bites ───────────────────────────────────────────────────────

describe('the old grid fails the same check (so the check is doing work)', () => {
  // The 2026-09-02 page, verbatim from the classes it carried.
  const OLD: Geometry = {
    grid: 'flex flex-col lg:grid lg:grid-cols-[200px_1fr_260px] xl:grid-cols-[220px_1fr_280px] lg:gap-4 xl:gap-6 lg:px-4 xl:px-6',
    column: 'min-w-0 px-2 lg:px-6 order-1 lg:order-2',
    card: 'border rounded-lg overflow-hidden',
  };

  it('grid-cols-[200px_1fr_260px] at lg alone leaves 450px for a 722px table', () => {
    const lgOnly: Geometry = { ...OLD, grid: 'flex flex-col lg:grid lg:grid-cols-[200px_1fr_260px] lg:gap-4 lg:px-4' };
    expect(cardWidthAt(lgOnly, 1024)).toBe(450);
    expect(cardWidthAt(lgOnly, 1024)).toBeLessThan(FA_TABLE_MIN_WIDTH);
  });

  it('reproduces the history table in the freeAgentRowKit.ts header', () => {
    expect(cardWidthAt(OLD, 1023)).toBe(1005);
    expect(cardWidthAt(OLD, 1024)).toBe(450);
    expect(cardWidthAt(OLD, 1279)).toBe(705);
    expect(cardWidthAt(OLD, 1280)).toBe(634);
    expect(cardWidthAt(OLD, 1366)).toBe(720);
    expect(cardWidthAt(OLD, 1368)).toBe(722);
    expect(cardWidthAt(OLD, 1440)).toBe(794);
  });

  it('would fail the fit check at every desktop band edge below 1368', () => {
    const failing = bandEdges(OLD.grid, OLD.column, FA_TABLE_ONLY)
      .filter((w) => shownAt(FA_TABLE_ONLY, w))
      .filter((w) => cardWidthAt(OLD, w) < FA_TABLE_MIN_WIDTH);
    expect(failing).toEqual([1024, 1279, 1280]);
  });

  it('refuses an ambiguous string rather than guessing which utility wins', () => {
    expect(() => resolveAt('px-2 lg:px-4 lg:px-6', 1024)).toThrow(/sets px twice at 1024px/);
    expect(() => resolveAt('hover:px-4', 1024)).toThrow(/knows no variant/);
  });
});

// ── The page uses the constants ───────────────────────────────────────────

describe('FreeAgents.tsx builds its desktop layout from the constants', () => {
  it('imports the whole set from freeAgentRowKit.ts', () => {
    expect(PAGE).toMatch(
      /import \{[^}]*FA_CONTENT_COLUMN[^}]*FA_NOTIFICATIONS_RAIL[^}]*FA_PAGE_GRID[^}]*FA_PAGE_GRID_WITH_RAIL[^}]*FA_POOL_CARD[^}]*\} from '@\/components\/freeagents\/freeAgentRowKit'/,
    );
  });

  it('the grid adds the rail column only when the rail renders, on one shared flag', () => {
    expect(PAGE).toContain("const showNotificationsRail = userLeagueState === 'active-user' && Boolean(activeLeagueId);");
    expect(PAGE).toContain('<div className={cn(FA_PAGE_GRID, showNotificationsRail && FA_PAGE_GRID_WITH_RAIL)}>');
    expect(PAGE).toContain('{showNotificationsRail && activeLeagueId && (');
    expect(PAGE).toContain('<aside className={FA_NOTIFICATIONS_RAIL}>');
    // The rail block is the notifications feed, and it is the only rail.
    const rail = PAGE.slice(PAGE.indexOf('<aside className={FA_NOTIFICATIONS_RAIL}>'));
    expect(rail.slice(0, rail.indexOf('</aside>'))).toContain('<LeagueNotifications');
    expect(count('<aside')).toBe(2);
  });

  it('the content column and the pool card are the strings the arithmetic measures', () => {
    expect(count('<div className={FA_CONTENT_COLUMN}>')).toBe(1);
    expect(count('<div className={FA_POOL_CARD}>')).toBe(1);
    // The card wraps the phone list and the table, so its border is the
    // border the table sits inside.
    const card = PAGE.slice(PAGE.indexOf('<div className={FA_POOL_CARD}>'), PAGE.indexOf('<div className={FA_POOL_CARD}>') + 1200);
    expect(card).toContain('data-testid="free-agents-phone-list"');
    expect(card).toContain('FA_TABLE_ONLY');
  });

  it('no rail grid is hand-typed anywhere on the page', () => {
    // The literals the constants replaced. Their return is the regression.
    expect(PAGE).not.toContain('grid-cols-[200px_1fr_260px]');
    expect(PAGE).not.toContain('grid-cols-[220px_1fr_280px]');
    expect(PAGE).not.toMatch(/grid-cols-\[\d+px_1fr(?:_\d+px)?\]/);
    expect(PAGE).not.toContain('<aside className="hidden lg:block order-3">');
    expect(PAGE).not.toContain('px-2 lg:px-6 order-1');
  });
});

describe('the empty pool speaks COPY_VOICE', () => {
  it('names the actor instead of "No X found"', () => {
    // The thrown message is app-authored copy, and lib/userMessage.ts passes
    // app-authored Error messages to the screen. "No players found" is the
    // exact idiom docs/COPY_VOICE.md bans.
    expect(PAGE).toContain("throw new Error('The player pool came back empty.');");
    expect(PAGE).not.toContain('No players found');
  });
});

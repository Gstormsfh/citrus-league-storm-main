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

describe('the compact phone chrome carries the search', () => {
  it('the sticky bar holds the title and a search input bound to the same state', () => {
    const bar = blockFrom('lg:hidden sticky top-0');
    expect(bar).toContain('Free Agents');
    expect(bar).toContain('<Input');
    expect(bar).toContain('placeholder="Search players…"');
    expect(bar).toContain('value={searchQuery}');
    expect(bar).toContain('setSearchQuery(e.target.value)');
    // Reachable without a pointer, and labelled — it has no visible <label>.
    expect(bar).toContain('aria-label="Search free agents"');
  });
});

describe('the position filters are one row, never three', () => {
  it('the Available tab applies the shared scroller class, not flex-wrap', () => {
    expect(PAGE).toContain('className={FA_CHIP_ROW}');
    expect(PAGE).toMatch(/import \{[^}]*FA_CHIP_ROW[^}]*\} from '@\/components\/freeagents\/freeAgentRow'/);
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
  it('Trending, Top Projected and the filtered/search list all render FreeAgentRow', () => {
    expect(count('<FreeAgentRow')).toBe(3);
    expect(PAGE).toContain("import { FreeAgentRow } from '@/components/freeagents/FreeAgentRow'");
  });

  it('each of them shows the projection and derives its own action state', () => {
    for (const block of PAGE.split('<FreeAgentRow').slice(1)) {
      const tag = block.slice(0, block.indexOf('/>'));
      expect(tag).toContain('projection={');
      expect(tag).toContain('action={freeAgentAction(');
      expect(tag).toContain('todayStr={todayStr}');
      expect(tag).toContain('onAction={() => handleRowAction(');
    }
  });

  it('the sideways table is desktop-only, and the phone list stands in its place', () => {
    const list = blockFrom('data-testid="free-agents-phone-list"', 900);
    expect(list).toContain('<FreeAgentRow');
    // The wrapper that used to be the phone experience.
    expect(PAGE).toContain('<div className="hidden lg:block overflow-x-auto">');
    expect(PAGE).not.toContain('<div className="overflow-x-auto">\n                        <Table className="min-w-[600px]');
  });

  it('the summary cards hand the phone the list and the desktop the table', () => {
    // Both cards previously split at `md`, which left a 768–1023px tablet on
    // the desktop table. The redesign is everything under `lg`.
    expect(count('<div className="lg:hidden">')).toBeGreaterThanOrEqual(2);
    expect(count('<div className="hidden md:block">')).toBe(0);
    expect(count('<div className="md:hidden">')).toBe(0);
  });
});

describe('the phone list leads with the projection', () => {
  it('its default order is sortByProjection, not the fetch order', () => {
    expect(PAGE).toContain('sortByProjection(filteredPlayers.map(withProjection))');
    expect(PAGE).toMatch(/import \{[^}]*sortByProjection[^}]*\} from '@\/components\/freeagents\/freeAgentRow'/);
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

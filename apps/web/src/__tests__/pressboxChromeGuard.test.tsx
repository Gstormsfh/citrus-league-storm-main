/**
 * PRESS BOX CHROME GUARD (2026-09-04).
 *
 * The four pieces of chrome that wrap every league page. They are shared, so
 * a regression in one of them is a regression on every screen at once — which
 * is exactly the class of defect that is cheapest to pin and most expensive
 * to find by eye.
 *
 * What this file protects, and why each one earned a case:
 *
 *  1. THE SPLIT. The bottom nav is app-level; the sub-tab strip is
 *     league-level. Collapsing them is what produced the playoff-pool trap
 *     fixed the same day, where four tabs all led back into the pool. If a
 *     league route appears in the bottom nav, that maze is being rebuilt.
 *  2. NO DEAD TILES. Every menu tile must carry a route. `linkGraphIntegrity`
 *     checks the targets resolve; this checks none is missing.
 *  3. NO INVENTED NUMBERS. A tile's stat line is optional and must not be
 *     hardcoded in the component — the spec names ten tiles with live stats
 *     and this repo has data for almost none of them.
 *  4. THE FIXED HEIGHTS. Chat bar 40 + nav 76. A screen that does not reserve
 *     them hides its own last row, which no screenshot of the top of the page
 *     will ever show.
 *  5. NO HEX. Styling rule 3: Tailwind on the pressbox.* tokens, and the one
 *     allowed inline style is the computed scanline gradient.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultLeagueTiles } from '@/components/pressbox/leagueMenuTiles';
import { CHATBAR_H, BOTTOMNAV_H, BOTTOM_CHROME_H, HEADER_H } from '@/components/pressbox/chromeMetrics';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, '..', 'components/pressbox', rel), 'utf-8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const HEADER = strip(read('LeagueHeader.tsx'));
const NAV = strip(read('PressBoxBottomNav.tsx'));
const CHAT = strip(read('ChatBar.tsx'));
const MENU = strip(read('LeagueMenu.tsx'));
const TILES = strip(read('leagueMenuTiles.ts'));
const TILE = strip(read('Tile.tsx'));

describe('app-level nav and league-level nav stay separate', () => {
  it('the bottom nav is exactly the five app destinations', () => {
    const tos = [...NAV.matchAll(/to: '([^']+)'/g)].map((m) => m[1]);
    expect(tos).toEqual(['/', '/scores', '/players', '/news', '/profile']);
  });

  it('the bottom nav carries no league-scoped route', () => {
    // A league route here is the maze being rebuilt: the bar would once again
    // be answering "which league" and "where in this league" at the same time.
    for (const t of [...NAV.matchAll(/to: '([^']+)'/g)].map((m) => m[1])) {
      expect(t, `${t} is league-scoped and belongs in the sub-tab strip`).not.toMatch(
        /^\/(matchup|roster|free-agents|league|standings)/,
      );
    }
  });

  it('the sub-tab strip is exactly the four league sections, in order', () => {
    const keys = [...HEADER.matchAll(/\{ key: '([a-z]+)', label: '([A-Za-z]+)'/g)].map((m) => m[2]);
    expect(keys).toEqual(['Match', 'Team', 'Players', 'League']);
  });

  it('the sub-tab strip names the league in every destination', () => {
    // The header is the one place a manager switches section without
    // switching league. A destination that drops the id is how LeagueContext
    // falls back to localStorage and quietly serves a different league.
    const tos = [...HEADER.matchAll(/to: \(id\) => `([^`]+)`/g)].map((m) => m[1]);
    expect(tos).toHaveLength(4);
    for (const t of tos) expect(t, t).toContain('${id}');
  });
});

describe('menu tiles', () => {
  it('every default tile has a route', () => {
    const tiles = defaultLeagueTiles('lg-1');
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.to, `${t.key} must route`).toBeTruthy();
      expect(t.to).toMatch(/^\//);
      expect(t.to, `${t.key} must name the league`).toContain('lg-1');
    }
  });

  it('ships no hardcoded stat line', () => {
    // "Standings · 2nd · 4-1 · 71% playoff odds" against no aggregate is
    // exactly the fabricated number rule 9 forbids. The field is a prop and
    // renders only when supplied.
    for (const t of defaultLeagueTiles('lg-1')) {
      expect(t.stat ?? null, `${t.key} must not ship a canned stat`).toBeNull();
    }
    expect(TILES).not.toMatch(/stat:\s*'/);
  });

  it('renders the stat line only when there is one', () => {
    // The rule did not change; the file did. The menu's hand-rolled tile
    // became `PressBoxTile` on 2026-09-04 so League HQ could use the same
    // one, and this assertion moved with it — a guard belongs to the
    // behaviour, not to the file the behaviour happened to start in. The
    // menu is still checked for MOUNTING it, so deleting the tile from the
    // menu still fails here.
    expect(TILE).toContain('{stat && (');
    expect(MENU).toContain('<PressBoxTile');
  });

  it('the tile stat is Barlow, not mono', () => {
    // Everywhere else in Press Box a number is mono because it is being
    // compared, column against column. Six unrelated tile stats read as
    // sentences, and the mono face made them look like a table. Artboard 1a
    // sets them in `400 11px Barlow`.
    expect(TILE).toContain('font-barlow text-[11px]');
    expect(TILE).not.toMatch(/font-plex[^']*text-\[11px\]/);
  });
});

describe('fixed chrome heights', () => {
  it('are the numbers the spec fixes', () => {
    expect(CHATBAR_H).toBe(40);
    expect(BOTTOMNAV_H).toBe(76);
    expect(BOTTOM_CHROME_H).toBe(116);
    expect(HEADER_H).toBe(86);
  });

  it('the chat bar sits above the nav, including the safe area', () => {
    expect(CHAT).toContain('env(safe-area-inset-bottom)');
    expect(CHAT).toContain('BOTTOMNAV_H');
  });

  it('the nav clears the home indicator', () => {
    expect(NAV).toContain('env(safe-area-inset-bottom)');
  });
});

describe('the chrome obeys the styling and colour rules', () => {
  it.each([
    ['LeagueHeader', HEADER],
    ['PressBoxBottomNav', NAV],
    ['ChatBar', CHAT],
    ['LeagueMenu', MENU],
  ])('%s uses tokens, not hex literals', (_name, src) => {
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('the chat bar message can never wrap', () => {
    // Fixed-height chrome with a variable-length string in it. The only
    // question is whether it truncates or pushes the action off screen.
    expect(CHAT).toContain('whitespace-nowrap');
    expect(CHAT).toContain('overflow-hidden');
    expect(CHAT).toContain('text-ellipsis');
  });

  it('the active bottom-nav tab is colour only, with no filled square', () => {
    expect(NAV).toContain('text-pressbox-orange-soft');
    expect(NAV).not.toMatch(/isActive[^)]*bg-pressbox-orange\b/);
  });

  it('every icon-only control carries a label and a 44px target', () => {
    for (const [name, src] of [['LeagueHeader', HEADER], ['LeagueMenu', MENU]] as const) {
      const iconButtons = [...src.matchAll(/<button[\s\S]{0,400}?<\/button>/g)]
        .filter((m) => /lucide|<[A-Z][A-Za-z]+ className="w-\[?\d/.test(m[0]) && !/>\s*\{?[A-Za-z]/.test(m[0]));
      for (const b of iconButtons) {
        expect(b, `${name}: icon button needs aria-label`).toMatch(/aria-label=/);
      }

      // TWO WAYS TO REACH 44px, and the second one exists because the first
      // has a cost. `min-h-[44px]` grows the BOX, which is right in a header
      // row that is 44px tall anyway and wrong where the artboard draws an
      // 18px glyph: on the league menu it made the row 44 against the
      // artboard's 36 and pushed the centred league pill off the screen's
      // centre line. A `relative` control with an `after:absolute` negative
      // inset grows the HIT AREA and takes no layout space, which is both
      // requirements instead of one traded for the other.
      //
      // The pattern is only real WITH `relative` — an absolutely positioned
      // ::after on a static parent resolves against some ancestor and the
      // target lands somewhere else entirely — so both halves are required
      // here, and the inset must be at least 13px, which is what takes an
      // 18px glyph to 44.
      const grown = /relative[\s\S]{0,400}?after:absolute[\s\S]{0,80}?after:-inset(?:-[xy])?-(?:\[(\d+)px\]|(\d+))/.exec(src);
      const insetPx = grown ? Number(grown[1] ?? Number(grown[2]) * 4) : 0;
      expect(
        src.includes('min-h-[44px]') || insetPx >= 13,
        `${name}: needs 44px targets — either min-h-[44px], or a relative control with an after:-inset of 13px or more`,
      ).toBe(true);
    }
  });

  it('the grown-hit-area pattern is detected honestly', () => {
    // The escape hatch above must not be a hole. A bare `after:absolute`
    // without `relative` positions against the wrong ancestor, and a 2px
    // inset is not a tap target — neither may pass.
    const probe = (src: string) => {
      const m = /relative[\s\S]{0,400}?after:absolute[\s\S]{0,80}?after:-inset(?:-[xy])?-(?:\[(\d+)px\]|(\d+))/.exec(src);
      return m ? Number(m[1] ?? Number(m[2]) * 4) : 0;
    };
    expect(probe("className=\"relative after:absolute after:-inset-[13px]\""), 'the real pattern').toBe(13);
    expect(probe("className=\"relative after:absolute after:-inset-y-[13px] after:-inset-x-5\""), 'axis form').toBe(13);
    expect(probe("className=\"after:absolute after:-inset-[13px]\""), 'no relative, no credit').toBe(0);
    expect(probe("className=\"relative after:absolute after:-inset-[2px]\""), 'too small to be a target').toBe(2);
  });
});

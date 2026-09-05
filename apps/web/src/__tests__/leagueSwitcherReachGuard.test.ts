/**
 * LEAGUE SWITCHER REACH (2026-09-01) — iPhone sim: "the drop down is too
 * long so I can't even reach the create league option." The switcher
 * rendered every league as a menu item with Create / Join League LAST,
 * and the menu had no height cap — enough leagues pushed the only
 * creation affordance off the bottom of the screen with no way to
 * scroll to it.
 *
 * Two dropdown variants exist in Navbar.tsx — the desktop rail and the
 * mobile-menu overlay — and both must hold the contract:
 *   1. Create / Join League sits ABOVE the league list — reachable at
 *      any league count.
 *   2. The league list itself is height-capped and scrolls on its own.
 *
 * PRESS BOX (2026-09-04): the phone's switcher is no longer a dropdown.
 * The old hamburger menu (MobileMenuButton, the variant the first fix
 * missed) is gone; below lg the LEAGUES tab is the home screen, whose
 * league list IS the switcher and whose header carries `+ LEAGUE`. The
 * creation affordance is in the header above the list, so it is reachable
 * at any league count by construction; the list scrolls with the page.
 * Pinned below as its own case.
 *
 * jsdom has no layout engine; these are source contracts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const SOURCES = [
  {
    file: 'Navbar.tsx',
    text: readFileSync(resolve(here, '../components/Navbar.tsx'), 'utf-8'),
    // Radix dropdown variants close with DropdownMenuContent.
    endMarker: '</DropdownMenuContent>',
    minBlocks: 2, // desktop rail + mobile-menu overlay
  },
] as const;

const HOME = readFileSync(resolve(here, '../components/home/PressBoxHome.tsx'), 'utf-8');

// Each switcher block runs from its "My Leagues" label to the variant's
// end marker (or EOF — the reach assertions still bind on the slice).
function switcherBlocks(text: string, endMarker: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf('My Leagues ({userLeagues.length})', from);
    if (start === -1) break;
    const end = text.indexOf(endMarker, start);
    blocks.push(text.slice(start, end === -1 ? undefined : end));
    from = start + 1;
  }
  return blocks;
}

describe('the league switcher never buries Create / Join League', () => {
  const labeled = SOURCES.flatMap(({ file, text, endMarker, minBlocks }) => {
    const blocks = switcherBlocks(text, endMarker);
    return { file, blocks, minBlocks };
  });

  it.each(labeled.map(({ file, blocks, minBlocks }) => [file, blocks.length, minBlocks] as const))(
    '%s renders its switcher variant(s)',
    (_file, count, minBlocks) => {
      expect(count, 'expected every switcher variant to exist').toBeGreaterThanOrEqual(minBlocks);
    },
  );

  const flat = labeled.flatMap(({ file, blocks }) =>
    blocks.map((block, i) => [`${file} variant ${i}`, block] as const),
  );

  it.each(flat)('%s pins the action above the league list', (_label, block) => {
    const action = block.indexOf('Create / Join League');
    const list = block.indexOf('{userLeagues.map(');
    expect(action, 'Create / Join League missing from switcher').toBeGreaterThan(-1);
    expect(list, 'league list missing from switcher').toBeGreaterThan(-1);
    expect(action, 'the creation affordance must precede the league list').toBeLessThan(list);
  });

  it.each(flat)('%s caps and scrolls the league list', (_label, block) => {
    expect(block).toMatch(/max-h-\[min\(50vh,320px\)\] overflow-y-auto/);
  });
});

describe('the phone switcher is the home league list', () => {
  it('puts the creation affordance in the header, above the list', () => {
    const header = HOME.indexOf("onAddLeague={() => navigate('/create-league')}");
    const list = HOME.indexOf('<PressBoxLeagueCard');
    expect(header, '+ LEAGUE missing from the home header').toBeGreaterThan(-1);
    expect(list, 'league cards missing from home').toBeGreaterThan(-1);
    expect(header).toBeLessThan(list);
  });

  it('every card switches through the shared helper', () => {
    expect(HOME).toContain("leagueSwitchDestination(l.id, fmt.leagueType, '/')");
  });
});

/**
 * LEAGUE SWITCHER REACH (2026-09-01) — iPhone sim: "the drop down is too
 * long so I can't even reach the create league option." The switcher
 * rendered every league as a menu item with Create / Join League LAST,
 * and the menu had no height cap — enough leagues pushed the only
 * creation affordance off the bottom of the screen with no way to
 * scroll to it.
 *
 * The contract, for BOTH the desktop and mobile-menu variants:
 *   1. Create / Join League sits ABOVE the league list — reachable at
 *      any league count.
 *   2. The league list itself is height-capped and scrolls on its own.
 *
 * jsdom has no layout engine; these are source contracts on Navbar.tsx.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const NAVBAR = readFileSync(resolve(here, '../components/Navbar.tsx'), 'utf-8');

// Each switcher block runs from its "My Leagues" label to its closing
// DropdownMenuContent. Two variants exist (desktop rail + mobile menu).
function switcherBlocks(): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const start = NAVBAR.indexOf('My Leagues ({userLeagues.length})', from);
    if (start === -1) break;
    const end = NAVBAR.indexOf('</DropdownMenuContent>', start);
    blocks.push(NAVBAR.slice(start, end === -1 ? undefined : end));
    from = start + 1;
  }
  return blocks;
}

describe('the league switcher never buries Create / Join League', () => {
  const blocks = switcherBlocks();

  it('both switcher variants exist', () => {
    expect(blocks.length, 'expected the desktop and mobile switchers').toBeGreaterThanOrEqual(2);
  });

  it.each(blocks.map((b, i) => [i, b] as const))(
    'variant %i pins the action above the league list',
    (_i, block) => {
      const action = block.indexOf('Create / Join League');
      const list = block.indexOf('{userLeagues.map(');
      expect(action, 'Create / Join League missing from switcher').toBeGreaterThan(-1);
      expect(list, 'league list missing from switcher').toBeGreaterThan(-1);
      expect(action, 'the creation affordance must precede the league list').toBeLessThan(list);
    },
  );

  it.each(blocks.map((b, i) => [i, b] as const))(
    'variant %i caps and scrolls the league list',
    (_i, block) => {
      expect(block).toMatch(/max-h-\[min\(50vh,320px\)\] overflow-y-auto/);
    },
  );
});

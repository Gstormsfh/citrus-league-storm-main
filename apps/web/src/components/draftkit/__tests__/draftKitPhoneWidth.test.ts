// DRAFT KIT PHONE-WIDTH GUARD
//
// The section ships to TestFlight, so the binding constraint is
// `document.body.scrollWidth === window.innerWidth` at 393x852. jsdom has no
// layout engine and cannot measure that, so this follows the pattern the repo
// already uses for exactly this problem (see stickyScrollContainerGuard and
// mobileSweepGuard): pin the SOURCE CONSTRUCTS whose reintroduction is what
// makes the page wider than the phone.
//
// Three constructs can do it here, and each is checked:
//   1. A horizontal strip of chips wider than the viewport. Both strips on the
//      page are `w-max` rows, which are only safe inside an `overflow-x-auto`
//      parent. A `w-max` row without one pushes the page.
//   2. A multi-column grid that is not breakpoint-gated. The board and the
//      moves tab are two-column at lg and must be one column below it.
//   3. A fixed pixel width wider than the phone with no breakpoint prefix.
//      380px sidebars are fine behind `lg:`; the same value unprefixed is not.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const DRAFTKIT_DIR = resolve(HERE, '..');
const PAGE = resolve(DRAFTKIT_DIR, '..', '..', 'pages', 'DraftKit.tsx');

/** Strip comments so the notes explaining a construct are not read as one. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const FILES: Array<{ name: string; src: string }> = [
  ...readdirSync(DRAFTKIT_DIR)
    .filter((f) => /\.tsx$/.test(f))
    .map((f) => ({ name: f, src: code(readFileSync(join(DRAFTKIT_DIR, f), 'utf8')) })),
  { name: 'pages/DraftKit.tsx', src: code(readFileSync(PAGE, 'utf8')) },
];

/** The phone this section is designed against. */
const PHONE_WIDTH = 393;

describe('Draft Kit stays inside a 393px viewport', () => {
  it('every w-max strip sits inside an overflow-x-auto container', () => {
    const offenders: string[] = [];
    for (const { name, src } of FILES) {
      const strips = (src.match(/\bw-max\b/g) ?? []).length;
      if (strips === 0) continue;
      const scrollers = (src.match(/\boverflow-x-auto\b/g) ?? []).length;
      if (scrollers < strips) {
        offenders.push(`${name}: ${strips} w-max strips, ${scrollers} overflow-x-auto parents`);
      }
    }
    expect(offenders, `unscrollable wide strips:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no multi-column grid is applied below the lg breakpoint', () => {
    const offenders: string[] = [];
    for (const { name, src } of FILES) {
      // grid-cols-N (N > 1) or an explicit track list, with no breakpoint
      // prefix in front of it, applies at 393px.
      for (const m of src.matchAll(/(^|[\s"'`])(grid-cols-(\d+)|grid-cols-\[)/g)) {
        const cols = m[3] ? Number(m[3]) : Infinity;
        if (cols > 1) offenders.push(`${name}: ${m[2]} with no breakpoint prefix`);
      }
    }
    expect(offenders, `multi-column at phone width:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no unprefixed fixed width exceeds the phone viewport', () => {
    const offenders: string[] = [];
    for (const { name, src } of FILES) {
      for (const m of src.matchAll(/(^|[\s"'`])(w|min-w)-\[(\d+)px\]/g)) {
        if (Number(m[3]) > PHONE_WIDTH) offenders.push(`${name}: ${m[2]}-[${m[3]}px]`);
      }
    }
    expect(offenders, `fixed widths wider than the phone:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('long text in a row is truncated rather than allowed to push the row', () => {
    // Both list rows render a player name of unbounded length next to a
    // fixed-width value column. `min-w-0` on the flexible cell is what lets
    // `truncate` actually take effect inside a flex row; without it the cell
    // refuses to shrink below its content and the row grows instead.
    for (const name of ['DraftKitRankings.tsx', 'RosterChangeList.tsx']) {
      const src = FILES.find((f) => f.name === name)!.src;
      expect(src, `${name} needs min-w-0 on its flexible cell`).toMatch(/min-w-0/);
      expect(src, `${name} needs truncate on its name cell`).toMatch(/\btruncate\b/);
    }
  });
});

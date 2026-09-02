/**
 * MOBILE MATCHUP ROWS GUARD (2026-09-01, Sleeper-parity audit M3 / M5 / M6).
 *
 * What a phone showed before this, all from index.css's `@media (max-width:
 * 1023px)` block:
 *
 *   * rows were `50% 50%` with `.matchup-center-column { display: none }` —
 *     no slot label anywhere; position was a 4px border colour;
 *   * the sticky team header stayed at the desktop `47% 6% 47%`, so header,
 *     rows and total row had three different centre lines on one page;
 *   * `.player-mobile-score { color: #F9A436 !important }` painted every
 *     number orange — a final score and a projection looked identical —
 *     and both cards pinned it `right: 8px`, so the left card's number sat
 *     at the gutter and the right card's at the screen edge.
 *
 * jsdom has no cascade, so the component tests pin the DOM and this file
 * pins the stylesheet: one grid, a visible centre column, no colour forced
 * over the component, and the opponent card reversed so its score also
 * meets the gutter.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SRC = resolve(HERE, '..');
const CSS = readFileSync(resolve(SRC, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Strip `//` and block comments so prose about the old rules is not read as code. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => {
      const i = l.indexOf('//');
      return i === -1 ? l : l.slice(0, i);
    })
    .join('\n');
}

/**
 * Every innermost `selector { body }` inside EVERY `@media (max-width:
 * 1023px)` block (there is more than one; the matchup rules live in the
 * "MOBILE AGGRESSIVE" one near the end of the file).
 */
function mobileRules(): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const marker = '@media (max-width: 1023px)';
  let start = CSS.indexOf(marker);
  if (start === -1) throw new Error('index.css: no @media (max-width: 1023px) block');
  while (start !== -1) {
    // Walk to the matching close brace of the at-rule.
    let depth = 0;
    let i = CSS.indexOf('{', start);
    const open = i;
    for (; i < CSS.length; i++) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}' && --depth === 0) break;
    }
    const block = CSS.slice(open + 1, i);
    const re = /([^{}]+?)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block))) {
      out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
    }
    start = CSS.indexOf(marker, i);
  }
  return out;
}

const rules = mobileRules();
const rulesFor = (selector: string) =>
  rules.filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector));
const declares = (selector: string, prop: string, value: RegExp) =>
  rulesFor(selector).some((r) => new RegExp(`(^|[;\\s])${prop}\\s*:\\s*${value.source}`, 'i').test(r.body));

describe('index.css mobile block — one grid for header, rows and total', () => {
  it.each(['.matchup-comparison-row', '.matchup-total-row', '.matchup-team-header'])(
    '%s is 1fr | 36px | 1fr below 1024px',
    (sel) => {
      expect(rulesFor(sel).length, `${sel} has no mobile rule`).toBeGreaterThan(0);
      expect(
        declares(sel, 'grid-template-columns', /minmax\(0,\s*1fr\)\s+36px\s+minmax\(0,\s*1fr\)/),
        `${sel} must share the 1fr/36px/1fr grid`,
      ).toBe(true);
      expect(declares(sel, 'grid-template-columns', /50%\s+50%/), `${sel} regressed to 50/50`).toBe(false);
    },
  );

  it('the centre column is shown, not hidden, and its desktop label yields to the chip', () => {
    expect(declares('.matchup-center-column', 'display', /none/)).toBe(false);
    expect(declares('.matchup-center-column', 'display', /flex/)).toBe(true);
    expect(declares('.matchup-total-center', 'display', /none/)).toBe(false);
    expect(declares('.matchup-center-column .position-label', 'display', /none/)).toBe(true);
  });
});

describe('index.css mobile block — the score stack belongs to the component', () => {
  const stackRules = rulesFor('.player-card .player-mobile-score');

  it('has a layout rule but forces no colour, background, border or font over the JSX', () => {
    expect(stackRules.length).toBeGreaterThan(0);
    for (const r of stackRules) {
      expect(r.body, 'colour forced by the stylesheet').not.toMatch(/(^|[;\s])color\s*:/i);
      expect(r.body).not.toMatch(/(^|[;\s])background\s*:/i);
      expect(r.body).not.toMatch(/(^|[;\s])border\s*:/i);
      expect(r.body).not.toMatch(/(^|[;\s])font-size\s*:/i);
      expect(r.body).not.toMatch(/(^|[;\s])font-weight\s*:/i);
    }
  });

  it('is an in-flow flex item, not absolutely pinned to one edge', () => {
    expect(declares('.player-card .player-mobile-score', 'position', /static/)).toBe(true);
    expect(declares('.player-card .player-mobile-score', 'position', /absolute/)).toBe(false);
    expect(stackRules.some((r) => /right\s*:\s*8px/.test(r.body))).toBe(false);
  });
});

describe('index.css mobile block — the opponent card is mirrored', () => {
  it('the row runs [content][score] on the user side and reverses on the opponent side', () => {
    expect(declares('.player-card', 'flex-direction', /row\b/)).toBe(true);
    expect(declares('.player-card.opponent-team', 'flex-direction', /row-reverse/)).toBe(true);
  });

  it('opponent text hugs the screen edge; both score stacks hug the gutter', () => {
    expect(declares('.player-card.opponent-team .player-card-content', 'align-items', /flex-end/)).toBe(true);
    expect(declares('.player-card.opponent-team .player-meta-row', 'justify-content', /flex-end/)).toBe(true);
    expect(declares('.player-card.user-team .player-mobile-score', 'align-items', /flex-end/)).toBe(true);
    expect(declares('.player-card.opponent-team .player-mobile-score', 'align-items', /flex-start/)).toBe(true);
    expect(declares('.matchup-team-header-opponent', 'justify-content', /flex-end/)).toBe(true);
  });

  it('the content column no longer reserves a fixed 50px for a pinned chip', () => {
    expect(declares('.player-card .player-card-content', 'padding-right', /50px/)).toBe(false);
    expect(declares('.player-card .player-card-content', 'min-width', /0/)).toBe(true);
  });
});

describe('index.css mobile block — the mug column (audit M4)', () => {
  // The 28px mug sits between the name block and the score on both cards.
  // For a straight column of faces down the page the score stack beside it
  // must be the same width on every row, and nothing may let the mug
  // shrink; the width both need comes out of the gutter padding and gaps,
  // not the name block.
  //
  // 2026-09-02, phone type scale: the score column went 38 -> 42px because
  // the number moved up to the 17px HEADLINE rung and a four-figure week
  // total in JetBrains Mono is 4 x 0.6em = 40.8px. The 4px came out of the
  // SCREEN-EDGE padding (the shorthand's horizontal value, 8 -> 6px), which
  // is the same rule this block already enforced — the name block keeps its
  // ~85px either way. The pins move with the geometry; they do not relax.
  it('the score stack is a fixed 42px column, not a percentage', () => {
    expect(declares('.player-card .player-mobile-score', 'width', /42px/)).toBe(true);
    expect(declares('.player-card .player-mobile-score', 'flex', /0 0 42px/)).toBe(true);
    expect(declares('.player-card .player-mobile-score', 'max-width', /45%/)).toBe(false);
  });

  it('the mug cannot shrink or stretch', () => {
    expect(rulesFor('.player-card .player-mug').length).toBeGreaterThan(0);
    expect(declares('.player-card .player-mug', 'flex', /0 0 auto/)).toBe(true);
    expect(declares('.player-card .player-mug', 'align-self', /center/)).toBe(true);
  });

  it('the row gives the face and the number their width from the edges, not the name', () => {
    expect(declares('.player-card', 'gap', /6px/)).toBe(true);
    expect(declares('.player-card.user-team', 'padding-right', /6px/)).toBe(true);
    expect(declares('.player-card.opponent-team', 'padding-left', /6px/)).toBe(true);
    // Both horizontal paddings are now 6px: the gutter side always was, the
    // screen-edge side paid the score column's extra 4px.
    expect(declares('.player-card', 'padding', /6px 6px/)).toBe(true);
    expect(declares('.player-card', 'padding', /6px 8px/)).toBe(false);
  });

  // THE NAME MUST BE ABLE TO SHRINK (2026-09-02). `.player-name` is
  // `white-space: nowrap` with an ellipsis, but the opponent card mirrors
  // itself with `align-items: flex-end`, and a column flex container whose
  // align-items is not `stretch` sizes its children to their own content.
  // Measured at 393x852 before the fix: an 82.5px content column held a
  // 161px header and "A. Wennberg-Nylander" printed straight over the
  // opponent's score. Without these two declarations the ellipsis never
  // fires and every long name collides with the number beside it.
  it('the name column is pinned to the card, so the name ellipsis can fire', () => {
    for (const sel of ['.player-card .player-card-header', '.player-card .player-header-left']) {
      expect(declares(sel, 'width', /100%/), `${sel} must not size to its own content`).toBe(true);
      expect(declares(sel, 'min-width', /0/), `${sel} must be allowed to shrink`).toBe(true);
    }
  });
});

describe('the row components carry no second palette', () => {
  const playerCard = code(readFileSync(resolve(SRC, 'components/matchup/PlayerCard.tsx'), 'utf8'));

  it('PlayerCard has no 8px or 9px label in the mobile score stack', () => {
    const start = playerCard.indexOf('player-mobile-score');
    expect(start).toBeGreaterThan(-1);
    const stack = playerCard.slice(start);
    expect(stack).not.toMatch(/text-\[[89]px\]/);
  });

  it('PlayerCard no longer ships the full-card BENCHED overlay or grayscale bench rows', () => {
    expect(playerCard).not.toMatch(/BENCHED/);
    expect(playerCard).not.toMatch(/\bgrayscale\b/);
    expect(playerCard).not.toMatch(/opacity-40/);
  });

  // ONE face. Both mobile rows import the roster's Mug (headshot → crest →
  // initials, fixed box, lazy) rather than growing a private <img> with its
  // own fallback — a private copy is how the roster row ended up with a
  // crest where the matchup row had nothing at all (audit M4 / R3).
  it.each([
    ['components/matchup/PlayerCard.tsx', /from ['"]@\/components\/roster\/Mug['"]/],
    ['components/roster/MobileRosterList.tsx', /from ['"]\.\/Mug['"]/],
  ])('%s draws the face with the shared Mug', (rel, importRe) => {
    const src = code(readFileSync(resolve(SRC, rel), 'utf8'));
    expect(src).toMatch(importRe);
    expect(src).toMatch(/<Mug\b[^>]*size="xs"[^>]*crest/);
    // No hand-rolled headshot <img> beside it.
    expect(src).not.toMatch(/mugs\/nhl/);
  });

  it('PlayerCard renders the mug once, before the score stack, mobile only, badge to the gutter', () => {
    const mug = playerCard.search(/<Mug\b/);
    const stack = playerCard.indexOf('player-mobile-score');
    expect(mug).toBeGreaterThan(-1);
    expect(mug).toBeLessThan(stack);
    const tag = playerCard.slice(mug, playerCard.indexOf('/>', mug));
    expect(tag).toMatch(/lg:hidden/);
    expect(tag).toMatch(/crestSide=\{isUserTeam \? 'right' : 'left'\}/);
    expect((playerCard.match(/<Mug\b/g) || []).length).toBe(1);
  });
});

/**
 * THE NAME COLUMN (2026-09-02).
 *
 * The 82.5px name block is not declared anywhere — it is what the card has
 * left after the two fixed columns and the paddings above, and every rule
 * that feeds it is already pinned in this file. What is NOT derivable from
 * the stylesheet is the string the card decides to put in it, so that rule
 * lives in `components/matchup/compactPlayerName.ts` with its measurement,
 * and this block pins that the card still asks that module and has not
 * re-grown a private formatter.
 *
 * Why it matters that the rule stays in one place: the same 82.5px column
 * is the reason `.player-name` is 15px rather than 17px, the reason its
 * letter-spacing is 0, and the reason the header had to be pinned to the
 * card's width before the ellipsis could fire. Four decisions, one number —
 * a second copy of the abbreviation rule is a second answer to it.
 */
describe('the phone row shows the family name, from the shared module', () => {
  const PLAYER_CARD_RAW = readFileSync(resolve(SRC, 'components/matchup/PlayerCard.tsx'), 'utf8');
  const PLAYER_CARD = code(PLAYER_CARD_RAW);
  const MODULE = code(readFileSync(resolve(SRC, 'components/matchup/compactPlayerName.ts'), 'utf8'));

  it('PlayerCard imports the rule rather than carrying one', () => {
    expect(PLAYER_CARD).toMatch(/import \{ compactPlayerName \} from ['"]\.\/compactPlayerName['"]/);
    expect(PLAYER_CARD).toContain('compactPlayerName(player.name, isMobile)');
    // The private formatter this replaced, and the shape it produced.
    expect(PLAYER_CARD).not.toContain('formatPlayerName');
    expect(PLAYER_CARD).not.toMatch(/firstInitial/);
  });

  it('the module builds no initial-prefixed form', () => {
    // `${initial}. ${last}` in any spelling is the rule that lost 23 of 57
    // surnames to the ellipsis. It must not come back inside the module
    // either, which is the one place a "clever" hybrid would be added.
    expect(MODULE).not.toMatch(/charAt\(0\)/);
    expect(MODULE).not.toMatch(/\$\{[^}]*\}\.\s/);
  });

  it('the name is still the row\'s own element, truncating in a column pinned to the card', () => {
    // The module can only help if the block it writes into is still the one
    // the measurement was taken in: an ellipsis that never fires (the
    // opponent-card bug above) hides the difference entirely.
    expect(declares('.player-card .player-name', 'font-size', /0\.9375rem/)).toBe(true);
    expect(declares('.player-card .player-name', 'text-overflow', /ellipsis/)).toBe(true);
    expect(declares('.player-card .player-name', 'white-space', /nowrap/)).toBe(true);
    expect(declares('.player-card .player-name', 'letter-spacing', /0/)).toBe(true);
  });

  it('the status badges are siblings of the name, not inside the string it truncates', () => {
    // `.player-name` is nowrap + ellipsis. A badge inside it is part of the
    // string the ellipsis eats: measured at 393x852, an IR row's name
    // element was scrollWidth 91 in an 83px box and the 8px it lost were
    // the badge, so the row said "Celebrini…" and never said IR.
    expect(PLAYER_CARD).toContain('<div className="player-name-row">');
    const nameEl = PLAYER_CARD.slice(PLAYER_CARD.indexOf('className="player-name" title='));
    const closed = nameEl.slice(0, nameEl.indexOf('</div>'));
    expect(closed).not.toContain('<Badge');

    // Only the name may shrink, and it needs min-width:0 to be able to.
    expect(declares('.player-card .player-name-row > .player-name', 'flex', /0 1 auto/)).toBe(true);
    expect(declares('.player-card .player-name-row > .player-name', 'min-width', /0/)).toBe(true);
    expect(declares('.player-card .player-name-row', 'width', /100%/)).toBe(true);
    // Mirrored, like every other line on the opponent card.
    expect(declares('.player-card.opponent-team .player-name-row', 'justify-content', /flex-end/)).toBe(true);
    // And declared OUTSIDE the mobile block too, or the desktop card drops
    // each inline-flex badge onto its own line.
    expect(CSS).toMatch(/\.player-name-row\s*\{[^}]*display:\s*flex/);
  });

  it('the full name is still reachable from the row', () => {
    // Dropping the given name is only safe because the row keeps it: the
    // native title, and the card the row opens on tap.
    expect(PLAYER_CARD).toMatch(/className="player-name" title=\{player\.name\}/);
  });

  // ONE SHRINKABLE CHILD IN THE META LINE (2026-09-02, adversarial review F2).
  //
  // The phone meta line is `min-w-0 overflow-hidden` and every child after
  // the opponent block is `shrink-0` -- the live pill, the period, the score.
  // The opponent block was `shrink-0` too, so NOTHING in the row could
  // shrink: the line overran its 83px box and `overflow: hidden` cut it.
  // Measured at 393x852 before the fix: on the opponent card, whose content
  // is right-aligned, a final score rendered at x=392.1 against a card edge
  // of 393 -- zero pixels on a 393px screen. On the user card the same
  // overrun slid the score under the 28px mug.
  //
  // jsdom has no layout engine, so this cannot be asserted geometrically
  // here. What CAN be pinned is the source contract the geometry depends on:
  // the opponent block shrinks, its label truncates, and the score does not.
  // Break any one and the score leaves the screen again.
  it('the opponent label is the shrinkable child of the meta line, and the score is not', () => {
    const src = readFileSync(resolve(SRC, 'components/matchup/PlayerCard.tsx'), 'utf8');
    const meta = src.slice(src.indexOf('player-meta-row'));
    // The wrapper's own className, not its children's: the logo inside it is
    // legitimately shrink-0 (a squashed crest is worse than a shorter label).
    const wrapper = /<div className="flex items-center gap-0\.5([^"]*)"/.exec(meta)?.[1] ?? '';
    expect(wrapper, 'the opponent block must be allowed to shrink').toContain('min-w-0');
    expect(wrapper, 'a shrink-0 opponent block leaves nothing to absorb the overflow').not.toContain('shrink-0');
    // ...and the logo inside it must still hold its 14px.
    expect(meta.slice(0, meta.indexOf('player-opponent'))).toMatch(/w-3\.5 h-3\.5 object-contain shrink-0/);
    expect(meta).toMatch(/player-opponent truncate/);
    // The row still needs its hard-stop container, or the overflow moves out
    // of the card instead of into an ellipsis.
    expect(meta).toMatch(/lg:hidden flex items-center gap-1 min-w-0 overflow-hidden/);
  });
});

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
});

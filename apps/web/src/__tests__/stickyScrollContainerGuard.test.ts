// STICKY SCROLL-CONTAINER GUARD (2026-08-26).
//
// `position: sticky` positions an element relative to its NEAREST SCROLLING
// ANCESTOR. If `body` (or `html`) is turned into a scroll container, every
// sticky element in the app starts sticking to a box whose scroll height
// equals its content height — a box that never scrolls — so nothing sticks.
//
// index.css carried two unlayered `!important` rules that did exactly that:
//
//   html, body { overflow-y: auto !important; overflow-x: hidden !important }
//   @media (max-width: 1023px) { body, html, #root { overflow-x: hidden
//                                !important; overflow-y: auto !important } }
//
// Both overrode the @layer base SCROLL FIX (unlayered beats layered), and
// `overflow-x: hidden` additionally forces overflow-y out of `visible` per
// spec — so both axes on both elements became scroll containers. Measured in
// Chromium at 393x852 and 1440x900: the draft room's `sticky top-0` clock
// moved -1484px for a 1500px scroll. Sixty-plus sticky elements — the nav,
// the draft clock, the player-pool and draft-board headers, the matchup team
// header — were all inert in production.
//
// The fix keeps horizontal clipping via `overflow-x: clip`, which clips
// WITHOUT establishing a scroll container, and declares no overflow-y at all:
// the viewport is the one true scroller.
//
// This guard is a source contract. jsdom has no layout or cascade resolution,
// so the pixel finding above cannot be re-measured here; what is checkable —
// and what actually regressed — is whether any rule reintroduces a
// scroll-container declaration on the document elements.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CSS = readFileSync(resolve(HERE, '..', 'index.css'), 'utf8');

/** Strip comments so documentation of the old rules is not read as CSS. */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every rule whose selector list targets `html`, `body` or `#root` as a whole
 * element (not a descendant), paired with its declaration block.
 */
function documentRules(): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  // Innermost blocks only: `[^{}]*` cannot span a nested block, so an
  // at-rule wrapper (@media/@layer) is skipped and its children matched
  // individually. The selector is whatever follows the last brace before it.
  const re = /([^{}]+?)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CODE))) {
    // Trim any trailing fragment of an enclosing at-rule prelude.
    const selector = m[1].split(/[{}]/).pop()!.trim();
    if (!selector || selector.startsWith('@')) continue;
    const targets = selector.split(',').map((s) => s.trim());
    if (targets.some((t) => t === 'html' || t === 'body' || t === '#root')) {
      out.push({ selector, body: m[2] });
    }
  }
  return out;
}

describe('index.css — the document must not become a scroll container', () => {
  const rules = documentRules();

  it('finds the html/body/#root rules to check', () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it.each(['overflow-y', 'overflow'])(
    'no rule on html/body/#root declares %s (it would kill every position:sticky)',
    (prop) => {
      const offenders = rules
        .filter((r) => new RegExp(`(^|[;\\s])${prop}\\s*:`, 'i').test(r.body))
        // `overflow: visible` is the one safe value — it is the default and
        // establishes no scroll container. #root declares it defensively.
        .filter((r) => !new RegExp(`${prop}\\s*:\\s*visible`, 'i').test(r.body))
        .map((r) => `${r.selector} { ${r.body.trim().replace(/\s+/g, ' ')} }`);
      expect(offenders, `scroll-container declaration on the document:\n${offenders.join('\n')}`).toEqual([]);
    },
  );

  it('overflow-x on html/body is clip, never hidden — hidden forces overflow-y out of visible', () => {
    const offenders = rules
      .filter((r) => /overflow-x\s*:\s*hidden/i.test(r.body))
      .map((r) => r.selector);
    expect(offenders, `overflow-x:hidden on ${offenders.join(', ')} — use clip`).toEqual([]);
  });

  it('horizontal clipping is still declared on body', () => {
    const clips = rules.filter(
      (r) => r.selector.split(',').some((s) => s.trim() === 'body') && /overflow-x\s*:\s*clip/i.test(r.body),
    );
    expect(clips.length, 'body must still clip horizontal overflow').toBeGreaterThan(0);
  });
});

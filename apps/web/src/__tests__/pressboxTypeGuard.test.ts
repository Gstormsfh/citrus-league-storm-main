import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * PRESS BOX TYPE GUARD (2026-09-04).
 *
 * Two defects, one root, and both were invisible in review because every
 * value in the source was correct.
 *
 * 1. THE FACE. `index.css` carries `body, p, span, .font-body { font-family:
 *    Montserrat; font-weight: 500 }` as an ELEMENT rule, which beats
 *    inheritance. A <span> inside a row marked `font-plex font-semibold`
 *    renders in Montserrat 500 anyway — `span` matches the span and the
 *    utility only matches its parent. So the standings table's figures, which
 *    the artboard sets in IBM Plex Mono, were shipping in Montserrat, and
 *    every heading inside a Press Box panel was pulling the Graduate varsity
 *    face at weight 900. Nothing in the component said so.
 *
 * 2. THE LEADING. Every rule on the artboard is written with the `font:`
 *    shorthand, which resets `line-height` to `normal`. This app's base is
 *    1.5. That is seven pixels added to every two-line row — nine rows of
 *    standings, half a screen — and it is the whole of what "it still looks
 *    way too spread out" was pointing at.
 *
 * `.pb-type` in index.css fixes both for a Press Box subtree, and `PB_TYPE`
 * in components/pressbox/rowScale.ts is how a component asks for it. This
 * guard holds three things that are each one careless edit from breaking:
 *
 *   * every Press Box component puts PB_TYPE on something,
 *   * the CSS rule keeps its `:where()`, without which the reset outranks the
 *     very utilities it exists to let through (Tailwind v3 INLINES `@layer`,
 *     so there are no real cascade layers here — only source order and
 *     specificity, and `.pb-type span` is 0,1,1 against `font-barlow`'s
 *     0,1,0), and
 *   * PB_TYPE stays free of a `leading-*` class, because `cn()` is
 *     tailwind-merge and tailwind-merge DROPS `leading-*` when a
 *     `text-{size}` class follows it. That is how the segmented control
 *     silently lost its leading the first time.
 */

// `dirname(fileURLToPath(import.meta.url))`, like every other guard: Vite's
// asset plugin rewrites the `new URL('.', import.meta.url)` form into a
// served `/src/...` URL, which is not a file: URL, and under vitest 4 the
// suite could not load ("The URL must be of scheme file", 2026-09-04).
const here = dirname(fileURLToPath(import.meta.url));
const PRESSBOX = resolve(here, '..', 'components', 'pressbox');
const INDEX_CSS = resolve(here, '..', 'index.css');

/** Files in components/pressbox that render markup, so must carry PB_TYPE. */
const COMPONENTS = readdirSync(PRESSBOX)
  .filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
  .sort();

describe('Press Box type guard', () => {
  it('has components to check', () => {
    expect(COMPONENTS.length).toBeGreaterThan(8);
  });

  it.each(COMPONENTS)('%s puts PB_TYPE on its root', (file) => {
    const src = readFileSync(join(PRESSBOX, file), 'utf8');
    expect(src.includes('PB_TYPE')).toBe(true);
  });

  it('PB_TYPE is a bare class name, never paired with a leading-* utility', () => {
    const src = readFileSync(join(PRESSBOX, 'rowScale.ts'), 'utf8');
    const decl = src.match(/export const PB_TYPE = '([^']*)'/);
    expect(decl).toBeTruthy();
    expect(decl![1]).toBe('pb-type');
  });

  it('the .pb-type reset keeps its :where(), or it eats the utilities', () => {
    const css = readFileSync(INDEX_CSS, 'utf8');
    expect(css).toContain('.pb-type :where(');
    // A bare descendant form is the bug this guard exists to catch.
    expect(/\.pb-type\s+(p|span|h[1-6])\s*[,{]/.test(css)).toBe(false);
  });

  it('the .pb-type rule restores the four properties the element rules steal', () => {
    const css = readFileSync(INDEX_CSS, 'utf8');
    const block = css.slice(css.indexOf('.pb-type :where('));
    const body = block.slice(block.indexOf('{'), block.indexOf('}'));
    for (const prop of ['font-family', 'font-weight', 'letter-spacing', 'text-transform']) {
      expect(body).toContain(prop);
    }
    expect(css).toMatch(/\.pb-type\s*\{[\s\S]*?line-height:\s*normal/);
  });

  it('the element rule this exists to survive is still there', () => {
    // If someone deletes `body, p, span, .font-body { … }`, .pb-type stops
    // being load-bearing and this whole mechanism should be reconsidered
    // rather than left in place as cargo.
    const css = readFileSync(INDEX_CSS, 'utf8');
    expect(css).toContain('body, p, span, .font-body');
  });
});

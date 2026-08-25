import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Dark-theme contrast guard (2026-08-19 visual audit).
 *
 * The app renders on #0F1F15 (see `body` in index.css and the
 * pastel.surface family in tailwind.config.ts), but it grew out of an
 * earlier CREAM theme and kept that theme's TEXT tokens. The result,
 * measured on the live draft room: 262 of 1,315 text nodes failed WCAG
 * AA, the worst at 2.17:1 — player names, the "ROSTERS ARE SET" hero,
 * the manager list, every outline and ghost button.
 *
 * Four distinct root causes were fixed, and this test pins each one so a
 * future edit cannot quietly reintroduce it.
 *
 * Contrast maths for the record, composited on #0F1F15:
 *   text-white/40 → 3.78:1   fail
 *   text-white/45 → 4.43:1   fail (so close it looks deliberate)
 *   text-white/50 → 5.16:1   pass
 *   text-white/55 → 5.96:1   pass  ← the codebase's own convention
 */

const HERE = resolve(fileURLToPath(import.meta.url), '..');
// Posix separators from here down. SRC is the prefix REL() strips off every
// FILES entry, so the two have to speak the same dialect or the strip is only
// accidentally right. Windows path APIs accept forward slashes, and resolve()
// re-normalises whatever it is handed, so nothing downstream cares.
const SRC = resolve(HERE, '..').replace(/\\/g, '/');
const INDEX_CSS = resolve(SRC, 'index.css');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** Strip comments so our own explanatory notes don't trip the guards. */
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

// Normalised ONCE here, to match SRC above, so every guard below — including
// the Preview* `inScope` exemption — matches identically on Windows (walk()
// joins with backslashes there) and on the ubuntu CI runners. Because SRC is
// normalised too, REL is a plain prefix strip and `f.startsWith(SRC)` holds
// for anyone who reaches for it later.
//
// Pre-fix defect (2026-08-24): the exemption regex required '/', never
// matched a Windows path, and the glass-surface guard failed on every
// local Windows run while passing on CI — a permanently-red local test
// is a guard nobody reads, which is the exact failure mode this file
// exists to prevent.
const FILES = walk(SRC)
  .map((f) => f.replace(/\\/g, '/'))
  .filter((f) => !f.includes('__tests__'));
const REL = (f: string) => f.slice(SRC.length + 1);

// Dev-only preview pages are stripped from the production bundle by the
// import.meta.env.DEV gate in App.tsx, so they are out of scope.
const inScope = (f: string) => !/\/Preview[A-Za-z]*\.tsx$/.test(f);

describe('dark-theme contrast guard', () => {
  it('index.css does not set a blanket colour on p/span/div', () => {
    const css = code(readFileSync(INDEX_CSS, 'utf8'));
    // An element selector like `p, span, div { color: ... }` beats every
    // parent's `text-*` class via specificity, silently overriding
    // hundreds of deliberate component colours. This is the rule that
    // made component-by-component colour fixes never stick.
    const blanket = /(^|\})\s*[^{}]*\b(p|span|div)\b\s*,[^{}]*\{[^}]*\bcolor\b[^}]*\}/m;
    expect(blanket.test(css), 'a blanket p/span/div colour rule is back in index.css').toBe(false);
    expect(css).not.toMatch(/\bp\s*,\s*span\s*,\s*div\s*\{[^}]*text-citrus-forest/);
  });

  it('the global body/heading defaults are light, not the cream-theme darks', () => {
    const css = code(readFileSync(INDEX_CSS, 'utf8'));
    const body = css.slice(css.indexOf('body {'), css.indexOf('body {') + 600);
    expect(body).toMatch(/text-pastel-cream/);
    expect(body).not.toMatch(/text-citrus-forest/);
  });

  it('no component uses the cream-theme text tokens', () => {
    // citrus-forest (#4A5F4D) and citrus-charcoal (#5C5C5C) are text
    // colours for LIGHT surfaces. tailwind.config.ts says so in its own
    // comment: "forest* are TEXT colors (deep-forest-on-light
    // backgrounds). Don't conflate them." On the dark tiles they measure
    // 2.17:1 and 1.47:1. Use text-pastel-cream, or text-pastel-forest
    // when the element genuinely has a light sage/peach fill.
    const offenders: string[] = [];
    for (const f of FILES.filter(inScope)) {
      const src = code(readFileSync(f, 'utf8'));
      if (/\btext-citrus-forest\b/.test(src)) offenders.push(`${REL(f)} (text-citrus-forest)`);
      if (/\btext-citrus-charcoal\b/.test(src)) offenders.push(`${REL(f)} (text-citrus-charcoal)`);
    }
    expect(offenders, `cream-theme text tokens on the dark app:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('muted text never drops below the readable white alpha', () => {
    // /45 and below fail AA once composited on #0F1F15. /55 is the
    // established convention across the codebase.
    const offenders: string[] = [];
    for (const f of FILES.filter(inScope)) {
      const src = code(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/\btext-white\/(\d{1,3})\b/g)) {
        const a = Number(m[1]);
        // <=25 is reserved for genuinely decorative marks (separator
        // dots, empty-slot placeholders) and is allowed.
        if (a > 25 && a < 50) offenders.push(`${REL(f)}: text-white/${a}`);
      }
    }
    expect(offenders, `muted text below 4.5:1 on #0F1F15:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no malformed double-alpha utility classes', () => {
    // `text-white/55/40` is not valid Tailwind — the class is dropped
    // entirely and the element silently falls back to inherited colour.
    // 39 of these existed, left behind by an earlier global class sweep
    // that appended an alpha to classes that already had one.
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(
        /\b(?:bg|text|border|ring|fill|stroke|from|to|via)-(?:white|black|citrus-[a-z-]+|pastel-[a-z-]+)\/\d{1,3}\/\d{1,3}\b/g,
      )) {
        offenders.push(`${REL(f)}: ${m[0]}`);
      }
    }
    expect(offenders, `Tailwind silently drops these:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no high-opacity white "glass" surfaces on the dark page', () => {
    // bg-white/40..80 composites to roughly rgb(159,165,161) on #0F1F15
    // — a mid-grey where NEITHER light nor dark text reaches 4.5:1
    // (cream 2.37, dark labels 1.58). The surface is the bug, not the
    // text colour. Use the pastel-surface tile family, or bg-white/5.
    const offenders: string[] = [];
    for (const f of FILES.filter(inScope)) {
      const src = code(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/\bbg-white\/(\d{1,3})\b/g)) {
        const a = Number(m[1]);
        // /85+ is a deliberate near-opaque LIGHT surface (the cookie
        // banner, the hover state of a solid white button) and carries
        // its own dark text — it is out of the mid-grey dead zone.
        if (a >= 40 && a < 85) offenders.push(`${REL(f)}: bg-white/${a}`);
      }
    }
    expect(offenders, `mid-grey dead-zone surfaces:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the on-clock action bar keeps dark text on its lemon background', () => {
    // bg-fantasy-primary is #F9E076. It shipped with text-white (~1.3:1),
    // making the single most important surface in a live draft — the
    // player name, round, pick and Draft button — unreadable in the
    // non-urgent state.
    const src = code(readFileSync(resolve(SRC, 'components/draft/v2/OnClockActionBar.tsx'), 'utf8'));
    expect(src).not.toMatch(/bg-fantasy-primary\s+text-white/);
    expect(src).not.toMatch(/text-fantasy-primary/);
  });

  it('global varsity color rules must exclude buttons', () => {
    // BUTTON-VISIBILITY ROOT FIX (2026-08-24). The shadcn Button base
    // includes `font-varsity`. A global `.dark .font-varsity { color }`
    // rule (specificity 0-2-0) silently overrode EVERY text-* utility on
    // EVERY button in dark mode — cream-on-lemon Draft buttons measured
    // ~1.4:1. Any selector that colors .font-varsity must carry
    // :not(button) so buttons keep the color their variant/call site set.
    const css = readFileSync(INDEX_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const offenders: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim();
      const body = m[2];
      if (!/\.font-varsity/.test(sel)) continue;
      const setsColor = /(^|[^-])color\s*:/.test(body) || /@apply[^;]*text-(pastel|citrus|white|\[)/.test(body);
      if (!setsColor) continue;
      for (const part of sel.split(',')) {
        if (part.includes('.font-varsity') && !part.includes(':not(button)')) {
          offenders.push(part.trim());
        }
      }
    }
    expect(
      offenders,
      `font-varsity color rules missing :not(button) — these force text color onto buttons:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

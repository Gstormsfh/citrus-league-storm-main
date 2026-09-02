/**
 * THE Z-INDEX SCALE GUARD (2026-09-02).
 *
 * `src/styles/zLayers.ts` is the ordered list of layers and the only place a
 * stacking number is written down. This file is what makes that true.
 *
 * WHAT WAS FOUND, measured rather than assumed (Chromium, the real built
 * CSS):
 *
 *   * 75 `fixed` / `sticky` layers across `src/`, carrying eleven distinct
 *     z values between 0 and 999999, with no ordering written anywhere.
 *   * `index.css` shipped
 *     `[data-radix-popper-content-wrapper]{z-index:60!important}`. Radix's
 *     popper copies the content's computed z-index onto that wrapper as an
 *     INLINE style, and a stylesheet `!important` beats a non-important
 *     inline declaration — so the dropdown (60), the select (60), the
 *     popover (9999), the app's matchup tooltips and shadcn's tooltip
 *     (999999) ALL rendered at 60. Four rungs, one number.
 *   * Three more `index.css` rules (`[data-radix-portal]`,
 *     `[data-radix-tooltip-content]`, `[data-radix-popover-content]`) read
 *     as the stacking policy and matched nothing at all: the installed
 *     Radix emits none of those attributes.
 *   * `CitrusToaster`'s `z-[10000]` was correct and hand-derived, with a
 *     comment listing the numbers it had to beat. Nothing stopped the next
 *     sheet from typing 10001.
 *
 * So the guard has four jobs, and each is a section below:
 *
 *   1. the scale is a scale: unique, ordered, complete;
 *   2. every layer in `src/` is on it, by name, with no raw numbers;
 *   3. the RESERVED rungs still match what `components/ui/**` actually
 *      declares, so a shadcn regeneration that moves one fails here instead
 *      of silently reordering the app;
 *   4. the CSS that used to override all of this is gone and stays gone.
 *
 * A source contract, in this repo's idiom (`stickyScrollContainerGuard`,
 * `matchupMobileRowsGuard`): jsdom has no cascade and no layout, so what is
 * checkable is whether the construct that regressed can come back.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VENDOR_LAYERS, Z_LAYERS, tailwindZIndex } from '../styles/zLayers';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SRC = resolve(HERE, '..').replace(/\\/g, '/');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
const CSS = read('index.css');

/** Strip comments so prose about the old rules is not read as code. */
const code = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => {
      const i = l.indexOf('//');
      return i === -1 ? l : l.slice(0, i);
    })
    .join('\n');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry).replace(/\\/g, '/');
    if (statSync(full).isDirectory()) {
      // `components/ui` is shadcn-managed (CLAUDE.md forbids editing it) and
      // is checked separately, as the RESERVED rungs.
      if (entry === '__tests__' || full === `${SRC}/components/ui`) continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC);
const REL = (f: string) => f.slice(SRC.length + 1);

// ── 1. The scale is a scale ──────────────────────────────────────────────

describe('the scale is ordered, unique and complete', () => {
  const entries = Object.entries(Z_LAYERS);

  it('is strictly increasing in declaration order, so reading it top to bottom is paint order', () => {
    const values = entries.map(([, v]) => v);
    for (let i = 1; i < values.length; i++) {
      expect(values[i], `${entries[i][0]} is not above ${entries[i - 1][0]}`).toBeGreaterThan(
        values[i - 1],
      );
    }
  });

  it('has no two rungs on the same number', () => {
    const values = entries.map(([, v]) => v);
    expect(new Set(values).size).toBe(values.length);
  });

  it('names every rung in kebab-case, which is what the Tailwind utility becomes', () => {
    for (const [name] of entries) expect(name, name).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it('puts the toast one rung above the highest RESERVED vendor layer', () => {
    // Not a bump. `tooltip` is 999999 in ui/tooltip.tsx and that file is not
    // editable here, so "a notification is never hidden" forces the value.
    const vendorMax = Math.max(...Object.keys(VENDOR_LAYERS).map((k) => Z_LAYERS[k as never] as number));
    expect(vendorMax).toBe(Z_LAYERS.tooltip);
    expect(Z_LAYERS.toast).toBeGreaterThan(vendorMax);
  });

  it('keeps the sheets BELOW the popover rung', () => {
    // They were tied at 9999 and the tie was broken by DOM order. A select
    // or popover opened from inside a sheet has to be above the sheet.
    expect(Z_LAYERS.sheet).toBeLessThan(Z_LAYERS.popover);
    expect(Z_LAYERS.sheet).toBeGreaterThan(Z_LAYERS.overlay);
  });

  it('keeps app chrome below the dialog rung', () => {
    // The nav used to be 50, exactly the dialog's own value, and lost only
    // because Radix portals to <body> — later in the document than #root.
    expect(Z_LAYERS['app-nav']).toBeLessThan(Z_LAYERS.dialog);
    expect(Z_LAYERS['page-header']).toBeLessThan(Z_LAYERS['app-nav']);
  });

  it('reaches Tailwind as named utilities', () => {
    const cfg = readFileSync(resolve(SRC, '..', 'tailwind.config.ts'), 'utf8');
    expect(cfg).toContain('zIndex: tailwindZIndex()');
    expect(cfg).toMatch(/from "\.\/src\/styles\/zLayers"/);
    expect(tailwindZIndex()).toEqual(
      Object.fromEntries(entries.map(([k, v]) => [k, String(v)])),
    );
  });
});

// ── 2. Every layer in src/ is on the scale ───────────────────────────────

/**
 * Every `z-*` token that appears in a class string alongside `fixed` or
 * `sticky` — i.e. every element that stacks against the rest of the app
 * rather than against its own siblings inside one card.
 *
 * Deliberately NOT every `z-*`: `relative z-10` over a gradient inside a
 * card is local layering with no app-wide meaning, and dragging 130 of
 * those onto the scale would make the scale mean nothing.
 */
function layerTokens(src: string): { token: string; snippet: string }[] {
  const out: { token: string; snippet: string }[] = [];
  // LINE BY LINE, and quotes may not cross a newline.
  //
  // A whole-file scanner desynchronises on the first apostrophe in JSX prose
  // ("Stormy's behavior"), which then swallows hundreds of lines as one
  // "string" — and that span contains both a `sticky` somewhere and an
  // unrelated `relative z-10` somewhere else, so the guard reports a layer
  // that does not exist. Every class string in this codebase is on one line;
  // a template literal that is not carries no `fixed`/`sticky` layer.
  for (const line of code(src).split('\n')) {
    const str = /(["'`])((?:(?!\1)[^\\\n]|\\.)*?)\1/g;
    let m: RegExpExecArray | null;
    while ((m = str.exec(line))) {
      const cls = m[2];
      if (!/\b(fixed|sticky)\b/.test(cls)) continue;
      for (const t of cls.matchAll(/(?:^|[\s:])(!?-?z-\[[^\]]+\]|!?-?z-[a-z0-9-]+)/g)) {
        out.push({ token: t[1], snippet: cls.slice(0, 70) });
      }
    }
  }
  return out;
}

const NAMED = new Set(Object.keys(Z_LAYERS));
const isOnScale = (token: string) => {
  const bare = token.replace(/^!?-?z-/, '');
  return NAMED.has(bare);
};

describe('every fixed or sticky layer stacks by name, not by number', () => {
  it('the walk found the app, not an empty directory', () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES.some((f) => REL(f) === 'components/notifications/CitrusToaster.tsx')).toBe(true);
    // components/ui is excluded on purpose — it is the RESERVED set.
    expect(FILES.some((f) => REL(f).startsWith('components/ui/'))).toBe(false);
  });

  it('no layer carries a raw number or an arbitrary value', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const { token, snippet } of layerTokens(readFileSync(f, 'utf8'))) {
        if (!isOnScale(token)) offenders.push(`${REL(f)}: ${token}   (${snippet})`);
      }
    }
    expect(
      offenders,
      `layers off the scale — add a rung to src/styles/zLayers.ts, do not type a number:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the layers that were the whole problem are each on their rung', () => {
    const on = (rel: string, rung: string) =>
      expect(layerTokens(read(rel)).map((t) => t.token), `${rel} → ${rung}`).toContain(rung);

    on('components/notifications/CitrusToaster.tsx', 'z-toast');
    on('components/roster/SlotPickerMenu.tsx', 'z-sheet');
    on('components/roster/FillSlotSheet.tsx', 'z-sheet');
    on('components/roster/AutoLineupSheet.tsx', 'z-sheet');
    on('pages/DraftRoomV2.tsx', 'z-page-header'); // the on-clock action bar
    on('components/Navbar.tsx', 'z-app-nav');
    on('components/mobile/MobileBottomNav.tsx', 'z-app-nav');
  });

  it('the bespoke tooltips built on Popover are on the popover rung', () => {
    // Six components override shadcn's tooltip z down to this rung. They
    // used to type `!z-[9999]` each, and none of them stacked there anyway
    // (see the popper-wrapper note above).
    const OVERRIDES = [
      'components/matchup/PointsTooltip.tsx',
      'components/matchup/ProjectionTooltip.tsx',
      'components/matchup/GoalieProjectionTooltip.tsx',
      'components/matchup/GameLogosBar.tsx',
      'components/armchair-gm/CapPlayerCard.tsx',
      'components/armchair-gm/CapSummaryBar.tsx',
    ];
    for (const rel of OVERRIDES) {
      const src = code(read(rel));
      expect(src, rel).toContain('!z-popover');
      expect(src, rel).not.toContain('z-[9999]');
    }
  });

  it('the detector bites, and does not bite on local layering or comments', () => {
    expect(layerTokens('<div className="fixed inset-0 z-[9999]" />').map((t) => t.token)).toEqual([
      'z-[9999]',
    ]);
    expect(layerTokens('<div className="sticky top-0 z-50" />').map((t) => t.token)).toEqual(['z-50']);
    expect(isOnScale('z-[9999]')).toBe(false);
    expect(isOnScale('z-50')).toBe(false);
    expect(isOnScale('z-toast')).toBe(true);
    expect(isOnScale('lg:z-sticky-raised'.replace(/^lg:/, ''))).toBe(true);
    // In-flow layering inside one card is not an app layer.
    expect(layerTokens('<div className="relative z-10" />')).toEqual([]);
    // A comment describing the old value must not fail the build.
    expect(layerTokens('// it used to be "fixed inset-0 z-[9999]"')).toEqual([]);
    // And an apostrophe in JSX prose must not swallow the rest of the file:
    // a whole-file scanner reported a phantom layer for exactly this input.
    expect(
      layerTokens(
        [
          '<div className="fixed inset-0 z-sheet">',
          '  <p>Tune Stormy\'s behavior</p>',
          '  <div className="relative z-10" />',
        ].join('\n'),
      ).map((t) => t.token),
    ).toEqual(['z-sheet']);
  });
});

// ── 3. The RESERVED rungs still match what shadcn declares ───────────────

describe('the shadcn rungs are reserved, and still where the scale says', () => {
  /** The z tokens in one `components/ui/*` file's class strings. */
  const vendorZ = (rel: string): number[] => {
    const src = code(readFileSync(resolve(SRC, 'components', rel), 'utf8'));
    return [...src.matchAll(/(?:^|[\s"'`])z-\[?(\d+)\]?(?![\w-])/g)].map((m) => Number(m[1]));
  };

  it.each(Object.entries(VENDOR_LAYERS))('%s is %s in every file that owns it', (rung, files) => {
    const expected = Z_LAYERS[rung as keyof typeof Z_LAYERS];
    for (const rel of files) {
      const found = vendorZ(rel);
      expect(found.length, `${rel} declares no z-index`).toBeGreaterThan(0);
      expect(
        new Set(found),
        `${rel} moved off the reserved ${rung} rung (${expected}) — update src/styles/zLayers.ts and re-check every rung around it`,
      ).toEqual(new Set([expected]));
    }
  });
});

// ── 4. The CSS that overrode all of it is gone ───────────────────────────

describe('index.css no longer decides stacking behind the scale', () => {
  const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

  it('the popper wrapper is not forced to one z-index', () => {
    // This is the rule that made every dropdown, select, popover and
    // tooltip render at 60. Letting Radix's inline copy through IS the fix.
    expect(CSS_CODE).not.toMatch(/data-radix-popper-content-wrapper[\s\S]{0,120}z-index/);
    expect(CSS_CODE).not.toMatch(/data-radix-popper-content-wrapper[\s\S]{0,120}@apply[^;]*z-/);
  });

  it('the three dead radix selectors are not reintroduced', () => {
    // The installed Radix emits none of these; they read as policy and did
    // nothing. Bringing one back would look like a fix and not be one.
    expect(CSS_CODE).not.toContain('[data-radix-tooltip-content]');
    expect(CSS_CODE).not.toContain('[data-radix-popover-content]');
    expect(CSS_CODE).not.toMatch(/\[data-radix-portal\][^{]*\{[^}]*z-index/);
  });

  it('no stylesheet rule sets a z-index above the scale', () => {
    // `.skip-to-content` is the one intentional high value left in CSS and
    // it is a focus-only a11y affordance; everything else must come from a
    // utility class so the scale can see it.
    const declared = [...CSS_CODE.matchAll(/([^{}]+)\{([^}]*z-index\s*:\s*(-?\d+)[^}]*)\}/g)].map(
      (m) => ({ selector: m[1].trim().split('\n').pop()!.trim(), value: Number(m[3]) }),
    );
    const scaleMax = Math.max(...Object.values(Z_LAYERS));
    const tooHigh = declared.filter(
      (d) => d.value > 100 && d.value < scaleMax && !d.selector.includes('.skip-to-content'),
    );
    expect(
      tooHigh.map((d) => `${d.selector} { z-index: ${d.value} }`),
      'a stylesheet rule is competing with the scale',
    ).toEqual([]);
  });
});

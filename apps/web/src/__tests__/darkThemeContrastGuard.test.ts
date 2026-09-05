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
      // `bg-white/NN` AND gradient stops. A stop lands the same mid-grey on
      // the page as a flat fill does — `via-white/50` inside a
      // `bg-gradient-to-br` paints the dead zone straight down the middle of
      // the element. The original regex only knew about `bg-`, which is how
      // HockeyPlayerCard's projection bar shipped the exact surface this
      // guard's own comment describes (found 2026-08-24, roster audit).
      for (const m of src.matchAll(/\b(bg|from|via|to)-white\/(\d{1,3})\b/g)) {
        const a = Number(m[2]);
        // /85+ is a deliberate near-opaque LIGHT surface (the cookie
        // banner, the hover state of a solid white button) and carries
        // its own dark text — it is out of the mid-grey dead zone.
        if (a >= 40 && a < 85) offenders.push(`${REL(f)}: ${m[1]}-white/${a}`);
      }
    }
    expect(offenders, `mid-grey dead-zone surfaces:\n${offenders.join('\n')}`).toEqual([]);
  });

  /**
   * LIGHT-THEME PALETTE FAMILIES (2026-09-02 Free Agents phone audit).
   *
   * Tailwind's blue/gray/slate/zinc/neutral ramps are the default palette of
   * a LIGHT app. Nothing in the Citrus design system uses them: the surface
   * family is pastel-surface (#0F1F15 / #1A2A20 / #243429), "info" is
   * pastel-sage, the accent is pastel-orange, and borders are white alphas.
   * Every occurrence found was one of two defects:
   *
   *   * dark ink on a dark page — `text-blue-700` on `bg-blue-500/20`,
   *     `text-slate-700` on `bg-slate-500/10`, `text-blue-900` over a
   *     blue-200 wash that composites to a mid-grey on #0F1F15. Measured
   *     1.6–2.9:1; the position chips on the mock draft board and the
   *     confidence badges on the matchup cards were simply unreadable;
   *   * off-brand tinting — a blue "info" affordance on a forest-green page.
   *
   * 34 occurrences across 18 files were swept the day this guard was
   * written. The families are banned outright rather than audited one by
   * one, because "a blue that happens to pass contrast" is still the wrong
   * palette, and a per-instance rule is one nobody can apply from memory.
   *
   * `bg-(blue|gray|slate)-50` is banned in the same breath: a near-white
   * fill is a light-surface decision, and it lands in the same mid-grey
   * dead zone the glass-surface guard above describes.
   *
   * FIXING ONE: pick the token that preserves the intent. An info/secondary
   * blue becomes pastel-sage (or pastel-sage-soft where it must read light);
   * a grey border becomes border-white/10; grey body text becomes
   * text-white/70 (or text-pastel-forest on a genuinely light surface, like
   * the cookie banner). Never reach back into the ramp.
   */
  const LIGHT_FAMILY = /\btext-(?:blue|gray|slate|zinc|neutral)-\d{2,3}\b|\bbg-(?:blue|gray|slate)-50\b/g;

  /**
   * The offenders one file's source contains. Extracted so the rule below
   * and the "does this guard actually bite" test can run the same code —
   * a guard whose detector is only exercised by the codebase passing it is
   * a guard that could be matching nothing at all.
   */
  function lightThemeOffenders(rel: string, src: string): string[] {
    return [...code(src).matchAll(LIGHT_FAMILY)].map((m) => `${rel}: ${m[0]}`);
  }

  it('no light-theme palette families on the dark app', () => {
    // Scoped to the two directories that hold rendered UI. Everything under
    // them is in: this is a whole-defect-class ban, not a per-page one.
    const SCOPED = FILES.filter(inScope).filter(
      (f) => f.startsWith(`${SRC}/pages/`) || f.startsWith(`${SRC}/components/`),
    );
    expect(SCOPED.length, 'the scoped walk found no files — the path prefixes are wrong').toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const f of SCOPED) offenders.push(...lightThemeOffenders(REL(f), readFileSync(f, 'utf8')));

    // ALLOWLIST: empty, and it should stay that way. An entry here is a
    // known light-theme class that could not be swept; add one only with a
    // comment naming the surface and why the token cannot follow, and take
    // it out again as soon as it can.
    const ALLOWED: string[] = [];
    const real = offenders.filter((o) => !ALLOWED.includes(o));

    expect(real, `light-theme palette on the dark app:\n${real.join('\n')}`).toEqual([]);
  });

  it('the light-theme rule bites: a planted offender is caught, clean source is not', () => {
    // Proof that the regex above is doing work. Without this, deleting a
    // family from the alternation, or breaking the `\b` anchors, would leave
    // a permanently-green test guarding nothing.
    expect(lightThemeOffenders('Planted.tsx', '<div className="text-blue-600" />')).toEqual([
      'Planted.tsx: text-blue-600',
    ]);
    expect(lightThemeOffenders('Planted.tsx', '<p className="p-2 text-slate-700 mt-1" />')).toEqual([
      'Planted.tsx: text-slate-700',
    ]);
    expect(lightThemeOffenders('Planted.tsx', '<div className="bg-gray-50" />')).toEqual([
      'Planted.tsx: bg-gray-50',
    ]);
    // Every banned family, so none can be quietly dropped from the union.
    for (const cls of ['text-blue-400', 'text-gray-700', 'text-slate-500', 'text-zinc-300', 'text-neutral-600']) {
      expect(lightThemeOffenders('Planted.tsx', `class="${cls}"`)).toEqual([`Planted.tsx: ${cls}`]);
    }
    // ...and it does not fire on the tokens that replaced them, on an
    // opacity-suffixed shade of a legal family, or on `bg-blue-500`, whose
    // "50" is not a shade (the \b anchor is what keeps that true).
    expect(lightThemeOffenders('Clean.tsx', '<div className="text-pastel-sage-soft bg-pastel-sage/20" />')).toEqual([]);
    expect(lightThemeOffenders('Clean.tsx', '<div className="text-white/55 border-white/10" />')).toEqual([]);
    expect(lightThemeOffenders('Clean.tsx', '<div className="bg-blue-500/10" />')).toEqual([]);
    // A comment mentioning the old class is documentation, not a defect.
    expect(lightThemeOffenders('Clean.tsx', '// was text-blue-600 before the sweep')).toEqual([]);
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

  // ── PRESS BOX COLOUR CONTRACT (2026-09-04) ───────────────────────────────
  //
  // Direction 1a's central finding was that the app was noisy, not dark: five
  // saturated position fills and per-team colour bars competed with the one
  // element that actually had to be unmissable. The contract that fixed it:
  //
  //   orange #FF6B1A is the ONLY saturated colour and means "you / your pick
  //   / the primary action", one per screen region. Position tags are
  //   neutral. Team colour is a 1.5px ring on the mug, never a fill.
  //
  // Contrast is why this lives here rather than in a new file: a coloured
  // position chip is not merely off-brand, it is the mechanism by which the
  // old maps put white on #C8DCC4 at 1.45:1 (see positionChip.ts's header).
  // The guard that measured that regression should be the one that prevents
  // its return.

  it('Press Box position chips stay neutral — the letter carries the position', () => {
    // components/pressbox/positionChip.ts, NOT components/roster/positionChip.ts.
    // The legacy chip keeps its sage/orange maps for the screens still wearing
    // the old styling; this contract binds the Press Box skin, and each screen
    // PR moves its own chip over as it converts. Pointing this rule at the
    // legacy file before any screen consumed the new one is what broke
    // thirteen test files on the first attempt — the rule was right and the
    // target was a module five shipping surfaces still owned.
    const src = readFileSync(resolve(SRC, 'components/pressbox/positionChip.ts'), 'utf8');
    const maps = [...src.matchAll(/const (posColor|posRingColor): Record<string, string> = \{([^}]+)\}/gs)];
    expect(maps.length, 'both chip maps must still exist').toBe(2);

    const offenders: string[] = [];
    for (const [, mapName, body] of maps) {
      for (const line of body.split('\n')) {
        const m = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*'([^']*)'/);
        if (!m) continue;
        const [, key, classes] = m;
        // Anything that is not white-alpha or the neutral text token is a hue.
        const hue = classes
          .split(/\s+/)
          .filter((c) => /^(bg|text|ring)-/.test(c))
          .filter((c) => !/^(bg|ring)-white\//.test(c))
          .filter((c) => c !== 'text-pressbox-text' && !/^text-white\//.test(c));
        if (hue.length) offenders.push(`${mapName}.${key}: ${hue.join(' ')}`);
      }
    }
    expect(
      offenders,
      `coloured position chips — orange is the only saturated colour and it means "you":\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('team colour is a ring, never a fill or a bar', () => {
    // teamColors.ts is allowed to EXPORT hexes; components are not allowed to
    // pour them into a background or a bar. The reference calls this out
    // twice because it is the regression that made the draft board look like
    // a sticker album: `background: teamColor` on a row, and a 3px team-colour
    // rule down its left edge.
    const offenders: string[] = [];
    for (const f of FILES.filter(inScope)) {
      const src = code(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/\b(backgroundColor|background|borderLeft|borderLeftColor|borderBottomColor)\s*:\s*([^,;\n}]+)/g)) {
        const value = m[2];
        if (!/\bteam(Colou?r|Primary|Secondary)\b/i.test(value)) continue;
        // NARROWED 2026-09-04, for the player card's 24px team badge.
        //
        // What this rule is actually protecting is READABILITY and surface
        // hierarchy: `background: teamColor` on a ROW destroys the tile
        // ladder, and a team-colour rule down an edge turns a board into a
        // sticker album. A small identity badge is neither — it is the one
        // place on artboard 1a where a team's own colour is the point.
        //
        // What made the original rule right is that arbitrary NHL hexes span
        // from #00205B to #FFB81C, so cream ink is unreadable on half of them
        // and forest ink on the other half. `onTeamColor` (utils/
        // teamColorContrast.ts) answers that per colour by MEASURING both
        // candidates rather than guessing from a luminance cutoff. So the fill
        // is allowed exactly when the ink is derived from it, and stays
        // banned everywhere else — including the case the reference names,
        // where there is no ink at all because the offender is a bar.
        const near = src.slice(Math.max(0, m.index - 240), m.index + 240);
        if (/\bonTeamColor\s*\(/.test(near)) continue;
        offenders.push(`${REL(f)}: ${m[1]}: ${value.trim().slice(0, 60)}`);
      }
    }
    expect(
      offenders,
      `team colour used as a fill or bar — Press Box allows a 1.5px ring on the mug only:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('both Press Box rules bite: planted offenders are caught', () => {
    // A detector nobody has watched fail is a detector that might be reading
    // the wrong thing. Same self-test pattern the light-theme rule above uses.
    //
    // The FIRST version of this self-test hand-rolled its own parse —
    // `line.split(/\s+/)` straight off a source line — and reported the
    // shipped, clean chip as an offender: the tokens it produced were
    // `'bg-white/10` (leading quote, so the white-alpha filter missed it) and
    // `text-pressbox-text',` (trailing quote and comma, so the exact-match
    // filter missed it). The rule above was right and its self-test was
    // wrong, which is the one failure mode a self-test exists to prevent. So
    // it now runs the SAME extraction the rule runs.
    const hues = (line: string): string[] => {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*'([^']*)'/);
      if (!m) return [];
      return m[2]
        .split(/\s+/)
        .filter((c) => /^(bg|text|ring)-/.test(c))
        .filter((c) => !/^(bg|ring)-white\//.test(c))
        .filter((c) => c !== 'text-pressbox-text' && !/^text-white\//.test(c));
    };

    // `text-white` with no alpha is flagged alongside the fill, and should be:
    // bare white on a saturated chip is the exact pairing that measured 1.45:1
    // on sage-soft and 2.85:1 on orange. Only `text-white/NN` (an alpha over a
    // dark ground) and the neutral token are exempt.
    expect(hues("  RW: 'bg-pastel-orange text-white',"), 'a coloured chip must be detected').toEqual([
      'bg-pastel-orange',
      'text-white',
    ]);
    expect(hues("  LW: 'bg-pastel-sage-soft text-pastel-forest',"), 'the old sage pair too').toEqual([
      'bg-pastel-sage-soft',
      'text-pastel-forest',
    ]);

    const fill = 'style={{ backgroundColor: teamColor }}';
    const hit = [...fill.matchAll(/\b(backgroundColor|background)\s*:\s*([^,;\n}]+)/g)].filter((m) =>
      /\bteam(Colou?r)\b/i.test(m[2]),
    );
    expect(hit.length, 'a team-colour fill must be detected').toBeGreaterThan(0);

    // The narrowing must not become a hole. A fill whose ink is measured is
    // allowed; the SAME fill without it is not, and neither is a bar that
    // happens to sit in a file which uses onTeamColor somewhere far away.
    const near = (text: string, at: number) =>
      /\bonTeamColor\s*\(/.test(text.slice(Math.max(0, at - 240), at + 240));
    const safe = 'style={{ background: teamColor, color: onTeamColor(teamColor) }}';
    expect(near(safe, safe.indexOf('background:')), 'a measured fill is allowed').toBe(true);
    expect(near(fill, fill.indexOf('backgroundColor:')), 'an unmeasured fill is not').toBe(false);
    const far = `const ink = onTeamColor(c);${' '.repeat(400)}style={{ borderLeft: teamColor }}`;
    expect(near(far, far.indexOf('borderLeft:')), 'a distant helper does not excuse a bar').toBe(false);

    // And the shipped neutral pair must NOT trip the chip rule.
    expect(hues("  RW: 'bg-white/10 text-pressbox-text',"), 'the shipped chip must be clean').toEqual([]);
    expect(hues("  BN: 'bg-white/10 text-white/55 ring-white/16',"), 'the bench chip too').toEqual([]);
  });
});

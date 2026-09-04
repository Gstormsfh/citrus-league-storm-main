// MOBILE SWEEP GUARD (2026-08-27)
//
// The 2026-08-27 phone-viewport sweep changed visible behaviour across
// twenty-two files and shipped with no test — the review that caught that was
// right to. These are the three findings whose regression would be invisible:
// each looks like working software in a screenshot of the wrong state, and
// none of them is reachable by mounting a page cheaply in jsdom.
//
// Source contracts, in the shape this repo already uses for
// stickyScrollContainerGuard and darkThemeContrastGuard: jsdom has no layout
// and no cascade, so what is checkable is whether the source reintroduces the
// construct that regressed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(fileURLToPath(import.meta.url), '..', '..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
/** Strip comments so documentation of the old code is not read as code. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── 1. In-app pages must not carry the marketing pitch ────────────────────

// Pages a signed-in manager works inside. A "Create a league" CTA and an
// elevator pitch at the bottom of these reads as template leakage.
const IN_APP_PAGES = [
  'Roster', 'Matchup', 'FreeAgents', 'WaiverWire', 'TradeAnalyzer',
  'TeamAnalytics', 'Profile', 'Standings', 'LeagueDashboard', 'GMOffice',
  'StormyAssistant', 'ScheduleManager', 'DraftRoom', 'OtherTeam', 'ArmchairGM',
  'PoolConfidence', 'PoolPickem', 'PoolSurvivor', 'PlayoffBracket', 'Admin',
];

// Public pages that SHOULD pitch — the split is the point, so pinning only
// one side would let "app everywhere" pass.
const MARKETING_PAGES = ['About', 'Features', 'Pricing', 'Blog', 'Guides', 'Podcasts', 'News'];

describe('the marketing footer stays out of the app', () => {
  it.each(IN_APP_PAGES)('%s uses the app footer variant', (page) => {
    const src = code(read(`pages/${page}.tsx`));
    expect(src).toContain('<HockeyFooter variant="app"');
    // A bare <HockeyFooter /> anywhere in the file would defeat the variant.
    expect(src).not.toMatch(/<HockeyFooter\s*\/>/);
  });

  it.each(MARKETING_PAGES)('%s keeps the marketing footer', (page) => {
    const src = code(read(`pages/${page}.tsx`));
    expect(src).not.toContain('variant="app"');
  });
});

// ── 2. Profile must never render a bare empty value ───────────────────────

describe('Profile display mode names its empty fields', () => {
  // A blank under an orange uppercase label is indistinguishable from a
  // rendering fault, and a fresh account showed SEVEN of them — the page read
  // as a skeleton of labels. Every display-mode value carries a fallback.
  const PROFILE = code(read('pages/Profile.tsx'));

  it('every rendered formData value has a fallback', () => {
    // Display-mode reads look like {formData.x} inside a text node. Any that
    // is not followed by `||` is a bare value.
    const bare = [...PROFILE.matchAll(/>\{formData\.(\w+)\}</g)].map((m) => m[1]);
    expect(bare).toEqual([]);
  });

  it('uses the same wording everywhere, so the page does not invent synonyms', () => {
    const fallbacks = [...PROFILE.matchAll(/\{formData\.\w+ \|\| (<span[^>]*>)([^<]*)</g)].map((m) => m[2]);
    expect(fallbacks.length).toBeGreaterThanOrEqual(7);
    expect(new Set(fallbacks)).toEqual(new Set(['Not set']));
  });
});

// ── 3. A disabled CTA must not read as half-tappable ──────────────────────

describe('disabled primary actions are honestly off', () => {
  it('no brand-fill control dims to 50% instead of turning off', () => {
    // `disabled:opacity-50` on a saturated orange leaves a button that still
    // reads as orange — a manager taps it and nothing happens, twice. Off is
    // a neutral fill with no glow.
    //
    // Scoped to BRAND-FILL controls on purpose. The first draft of this guard
    // banned the string outright and flagged the partner search Input, where
    // dimming a disabled field is exactly right. The contract is about
    // controls that look like the primary action, not every disabled element.
    const src = code(read('pages/TradeAnalyzer.tsx'));
    const classAttrs = [...src.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
    const dimmedBrandFill = classAttrs.filter(
      (c) => c.includes('bg-pastel-orange') && c.includes('disabled:opacity-50'),
    );
    expect(dimmedBrandFill).toEqual([]);
  });

  it('the trade submit turns neutral and drops its glow', () => {
    const src = code(read('pages/TradeAnalyzer.tsx'));
    const submits = [...src.matchAll(/className="([^"]*bg-pastel-orange[^"]*)"/g)]
      .map((m) => m[1])
      .filter((c) => c.includes('disabled:'));
    expect(submits.length).toBe(2);   // the lg header action and the mobile CTA
    for (const c of submits) {
      expect(c).toContain('disabled:bg-white/10');
      expect(c).toContain('disabled:shadow-none');
    }
  });
});

// ── 4. The roster tab bar must fit a phone ────────────────────────────────

describe('roster tabs fit a phone without a hidden scroller', () => {
  const ROSTER = code(read('pages/Roster.tsx'));

  it('carries a short mobile label and the full label at sm', () => {
    // Measured in Chromium: at 393px the four full labels overflowed and the
    // third was cut mid-word to "TRENDS & ANAL", with nothing signalling that
    // the row scrolled — so Transactions was undiscoverable.
    //
    // The short label for the third tab is ANALYTICS, not TRENDS (2026-09-04).
    // That tab is the insight surface other fantasy apps do not have, and
    // "Trends" reads as a generic mover list; if only one word survives the
    // phone, it has to be the one that says what the tab is for.
    for (const [short, full] of [['Stats', 'Team Stats'], ['Analytics', 'Trends &amp; Analytics']]) {
      expect(ROSTER).toContain(`<span className="sm:hidden">${short}</span>`);
      expect(ROSTER).toContain(`<span className="hidden sm:inline">${full}</span>`);
    }
  });

  it('tracking loosens only at sm, where the bar has room', () => {
    // Tracking was the lever that made all four fit at 375px; shipping the
    // wide value on mobile again re-cuts the row. The pair moved to the Press
    // Box strip's values (2026-09-04) — Barlow Condensed 13px is narrower than
    // the JetBrains Mono it replaced, but "TRANSACTIONS" in a 98px column
    // still needs the tight setting.
    expect(ROSTER).toContain('tracking-[0.04em] sm:tracking-[0.14em]');
  });

  it('the strip is four equal columns, not a scroller', () => {
    // The old bar was `overflow-x-auto` with `flex-none` triggers — a row you
    // have to scroll is a row that failed to fit. Four equal columns cannot
    // hide a tab.
    const list = ROSTER.slice(ROSTER.indexOf('<TabsList'), ROSTER.indexOf('</TabsList>'));
    expect(list).toContain('grid grid-cols-4');
    expect(list).not.toContain('overflow-x-auto');
  });
});

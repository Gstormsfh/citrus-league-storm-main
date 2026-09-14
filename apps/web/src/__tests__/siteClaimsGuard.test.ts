/**
 * SITE CLAIMS GUARD (2026-09-09).
 *
 * The marketing pages carried three numbers nobody had verified against the
 * model artifacts ("31-feature", "19,000 sims", "every shift since 2007") and
 * one seasonal claim that was false for five months of the year ("Stanley
 * Cup Playoffs · Live now", shown in September). The numbers rule is that a
 * figure about the model appears on the site only after it has been checked
 * against the artifact that produces it, and nothing on the site asserts a
 * live state it is not reading. This guard keeps both out of the public
 * pages. Preview routes are design canon and are not scanned.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
const PUBLIC_PAGES = [
  'components/citrus2/Homepage.tsx',
  'components/citrus2/HockeyFooter.tsx',
  'pages/About.tsx',
  'pages/Features.tsx',
  'pages/Pricing.tsx',
  'pages/Guides.tsx',
  'pages/Waitlist.tsx',
];

/** Prose only: drop line and block comments before scanning. */
const prose = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const UNVERIFIED_MODEL_FIGURES = [/\b\d+[- ]feature/i, /\b19,?000\b/, /since 2007/i, /\b1,?247 sims/i];
const STALE_LIVE_CLAIMS = [/Live now/i, /Games Tonight/i];

describe('site claims guard', () => {
  for (const rel of PUBLIC_PAGES) {
    const text = prose(readFileSync(join(SRC, rel), 'utf8'));

    it(`${rel} states no unverified model figure`, () => {
      for (const re of UNVERIFIED_MODEL_FIGURES) {
        expect(text, `${rel} matches ${re}`).not.toMatch(re);
      }
    });

    it(`${rel} asserts no live state it is not reading`, () => {
      for (const re of STALE_LIVE_CLAIMS) {
        expect(text, `${rel} matches ${re}`).not.toMatch(re);
      }
    });
  }
});

describe('homepage visual hierarchy', () => {
  it('keeps mascot scenes out of the storefront hero and card grids', () => {
    const homepage = readFileSync(join(SRC, 'components/citrus2/Homepage.tsx'), 'utf8');

    // Mascots have a role in the product (notably Stormy's assistant surface),
    // but marketing should lead with the league experience rather than repeat
    // character art in the hero and every card.
    expect(homepage).not.toMatch(/scene-[a-z-]+\.webp/);
    expect(homepage).not.toContain('MascotCard');
    expect(homepage).not.toContain('MASCOT_LIST');
  });

  it('uses labelled, sized mobile product captures rather than an invented dashboard', () => {
    const homepage = readFileSync(join(SRC, 'components/citrus2/Homepage.tsx'), 'utf8');

    expect(homepage).toContain('Actual product screens');
    expect(homepage).toContain('/product-demo/player-dashboard-demo-390.png');
    expect(homepage).toContain('/product-demo/player-analysis-demo-390.png');
    expect(homepage).toMatch(/width="390"\s+height="844"/);
    expect(homepage).toContain('Demo data · mobile layout');
  });

  it('uses a product-led footer without time-sensitive launch copy', () => {
    const homepage = prose(readFileSync(join(SRC, 'components/citrus2/Homepage.tsx'), 'utf8'));

    // The squad still belongs on the about surface, but not as a final extra
    // mascot row on the product-led storefront.
    expect(homepage).toContain('<HockeyFooter showSquad={false} />');
    expect(homepage).not.toMatch(/Drafts are open|Puck drops|Sep 29/i);
  });

  it('gives each game-mode CTA a descriptive link rather than nesting a button in one', () => {
    const card = readFileSync(join(SRC, 'components/citrus2/GameModeCard.tsx'), 'utf8');

    expect(card).not.toContain('className="contents"');
    expect(card).not.toMatch(/<button\b/);
    expect(card).toContain('aria-label={`${ctaLabel}: ${label}`}');
  });
});

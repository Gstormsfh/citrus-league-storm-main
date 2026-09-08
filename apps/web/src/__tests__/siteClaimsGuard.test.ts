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

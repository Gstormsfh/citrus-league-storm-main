/**
 * BRAND NAME IN THE DOCUMENT SHELL (2026-08-31)
 *
 * The app was renamed CitrusSports -> Citrus everywhere a person sees it, but
 * index.html was missed: the browser tab, the iOS home-screen title, the SEO
 * description, the author tag, both Open Graph tags and the no-JS fallback
 * heading all still said "CitrusSports" in production.
 *
 * These are not cosmetic strings buried in a component:
 *   - <title> is the browser tab and the App Store screenshot's tab text
 *   - apple-mobile-web-app-title is the name under the icon on an iPhone
 *     home screen, and ships INSIDE the native bundle
 *   - og:* is what renders when anyone shares a link to the site
 *   - the <h1> is what a user sees if JavaScript fails to boot
 *
 * The native build copies index.html into the iOS app, so a stale name here
 * reaches TestFlight and the App Store, not just the website.
 *
 * DELIBERATELY NOT CHECKED: `twitter:site`. That is an external account
 * handle, not display copy — it must match whatever X/Twitter account is
 * actually registered. Renaming it to match the product would point the tag
 * at an account that may belong to someone else. It changes when the account
 * changes, by a human who knows which handle is real.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(resolve(here, '../../index.html'), 'utf-8');

const PRODUCT_NAME = 'Citrus';
const RETIRED_NAME = 'CitrusSports';

/** Every user-visible field in the shell, as [label, extractor]. */
const VISIBLE_FIELDS: Array<[string, RegExp]> = [
  ['<title>', /<title>([^<]*)<\/title>/],
  ['apple-mobile-web-app-title', /<meta\s+name="apple-mobile-web-app-title"\s+content="([^"]*)"/],
  ['meta description', /<meta\s+name="description"\s+content="([^"]*)"/],
  ['meta author', /<meta\s+name="author"\s+content="([^"]*)"/],
  ['og:title', /<meta\s+property="og:title"\s+content="([^"]*)"/],
  ['og:description', /<meta\s+property="og:description"\s+content="([^"]*)"/],
  ['no-JS fallback heading', /<h1[^>]*>([^<]*)<\/h1>/],
];

describe('the document shell carries the current product name', () => {
  for (const [label, pattern] of VISIBLE_FIELDS) {
    it(`${label} exists and does not say ${RETIRED_NAME}`, () => {
      const match = INDEX_HTML.match(pattern);
      expect(match, `${label} is missing from index.html entirely`).toBeTruthy();
      const value = match![1];
      expect(value, `${label} still carries the retired product name`).not.toContain(RETIRED_NAME);
      expect(value).toContain(PRODUCT_NAME);
    });
  }

  it('leaves no other occurrence of the retired name outside the twitter handle', () => {
    const offenders = INDEX_HTML.split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => line.includes(RETIRED_NAME))
      .filter(([, line]) => !line.includes('twitter:site'));
    expect(offenders, `unexpected "${RETIRED_NAME}" at ${offenders.map(([n]) => n).join(', ')}`).toEqual([]);
  });

  it('keeps the PWA manifest name in step with the shell', () => {
    const manifest = JSON.parse(readFileSync(resolve(here, '../../public/manifest.json'), 'utf-8'));
    expect(manifest.name).toBe(PRODUCT_NAME);
    expect(manifest.short_name).toBe(PRODUCT_NAME);
  });
});

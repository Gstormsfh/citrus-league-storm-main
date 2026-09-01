/**
 * NATIVE BOOT DESTINATION (2026-08-31) — reported from the iOS simulator
 * as "there are no menus."
 *
 * The native app booted onto the marketing homepage: the one core route
 * with no app navigation at all. A signed-in manager opening the app
 * landed on the sales pitch and had to hunt for their league. The native
 * shell now boots signed-in users with an active league straight to
 * League HQ; the web homepage stays the storefront.
 *
 * jsdom cannot run the Capacitor native branch, so these are source
 * contracts on the exact behaviors that matter:
 *   - the decision is native-only (web keeps the homepage)
 *   - it waits for auth AND league context to settle before deciding
 *     (deciding early flashes the marketing page, or strands a signed-in
 *     user whose `user` was still null at look time)
 *   - the redirect carries the ?league= param the LeagueContext URL
 *     watcher expects, matching the bottom nav's own link shape
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(here, '../pages/Index.tsx'), 'utf-8');

describe('native boot lands on League HQ', () => {
  it('gates the redirect on the native platform, never the web', () => {
    expect(SOURCE).toMatch(/Capacitor\.isNativePlatform\(\)/);
  });

  it('waits for auth and league context to settle before deciding', () => {
    expect(SOURCE).toMatch(/auth\?\.loading/);
    expect(SOURCE).toMatch(/league\?\.loading/);
  });

  it('redirects to League HQ with the league param the context watcher expects', () => {
    expect(SOURCE).toMatch(/\/league\/\$\{activeLeagueId\}\?league=\$\{activeLeagueId\}/);
    expect(SOURCE).toMatch(/replace/);
  });

  it('holds the splash ground color while settling — no marketing flash', () => {
    expect(SOURCE).toMatch(/#0F1F15/);
  });

  it('still renders the homepage for the web and for users without leagues', () => {
    expect(SOURCE).toMatch(/<Homepage \/>/);
  });
});

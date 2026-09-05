/**
 * NATIVE BOOT DESTINATION (2026-08-31) — reported from the iOS simulator
 * as "there are no menus."
 *
 * The native app booted onto the marketing homepage: the one core route
 * with no app navigation at all. A signed-in manager opening the app
 * landed on the sales pitch and had to hunt for their league. The fix of
 * 2026-08-31 redirected the native shell to League HQ.
 *
 * THE APP HOME (PRESS BOX, 2026-09-04) supersedes the redirect. `/` is now
 * artboard 1a's LEAGUES tab for a signed-in manager with a league — on the
 * native shell and on a phone-width web view — with the app nav, the Stormy
 * bar, tonight's slate and every league's card. The original complaint was
 * "no menus", not "not my league": the app home has both. A tab that
 * redirected away from itself would not be a tab, so the redirect is gone
 * and League HQ is the card's tap. The web at desktop width, anyone signed
 * out, and anyone without a league still get the storefront.
 *
 * jsdom cannot run the Capacitor native branch, so these are source
 * contracts on the exact behaviors that matter:
 *   - the native shell still waits for auth AND league context to settle
 *     before deciding (deciding early flashes the marketing page, or strands
 *     a signed-in user whose `user` was still null at look time)
 *   - the app home is gated on a signed-in user WITH leagues, on native or
 *     below lg — never the desktop web, never the signed-out
 *   - nothing on this route redirects to League HQ any more
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(here, '../pages/Index.tsx'), 'utf-8');

describe('the homepage is the app home on a phone, the storefront everywhere else', () => {
  it('still knows the native platform, and holds the splash ground while it settles', () => {
    expect(SOURCE).toMatch(/Capacitor\.isNativePlatform\(\)/);
    expect(SOURCE).toMatch(/auth\?\.loading/);
    expect(SOURCE).toMatch(/league\?\.loading/);
    // The Press Box surface -- the same ground as the launch image and the
    // boot splash (PR18), so the hold is invisible.
    expect(SOURCE).toMatch(/#0C1811/);
  });

  it('renders the Press Box home for a signed-in manager with leagues, native or below lg', () => {
    expect(SOURCE).toMatch(/<PressBoxHome/);
    expect(SOURCE).toMatch(/auth\?\.user && hasLeagues && \(native \|\| isMobile\)/);
    expect(SOURCE).toMatch(/userLeagues\?\.length/);
  });

  it('no longer redirects the native shell to League HQ — the LEAGUES tab has to come back here', () => {
    expect(SOURCE).not.toMatch(/<Navigate/);
    expect(SOURCE).not.toMatch(/\/league\/\$\{activeLeagueId\}/);
  });

  it('still renders the storefront for the web at desktop width and for users without leagues', () => {
    expect(SOURCE).toMatch(/<Homepage \/>/);
  });
});

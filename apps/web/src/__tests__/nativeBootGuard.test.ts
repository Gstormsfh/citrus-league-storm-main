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

  it('renders the app home for EVERY signed-in phone, leagues or none (2026-09-05: a manager whose leagues had not loaded got the storefront)', () => {
    expect(SOURCE).toMatch(/<PressBoxHome/);
    expect(SOURCE).toMatch(/auth\?\.user && \(native \|\| isMobile\)/);
    expect(SOURCE).not.toMatch(/auth\?\.user && hasLeagues/);
  });

  it('the matchup is home (2026-09-09), and only inside the sticky window', () => {
    // Supersedes LEAGUE HQ IS HOME (2026-09-05). Two things changed and both
    // are pinned here: the destination is the league's MATCHUP rather than its
    // HQ, and the redirect EXPIRES, so a manager returning days later picks a
    // league instead of being dropped into whichever one they opened last.
    expect(SOURCE).toMatch(/get\('all'\) === '1'/);
    expect(SOURCE).toMatch(/leagueOpenDestination\(/);
    expect(SOURCE).toMatch(/isLeagueVisitFresh\(/);
    // The window slides on each open, or daily use would eventually see the
    // selector for no reason.
    expect(SOURCE).toMatch(/markLeagueVisit\(/);
    // HQ is no longer an app-open destination.
    expect(SOURCE).not.toMatch(/<Navigate to=\{`\/league\/\$\{activeId\}`\} replace \/>/);
    // Only a league the manager is actually in; a stale active id shows the list.
    expect(SOURCE).toMatch(/userLeagues\?\.find\(\(l\) => l\.id === activeId\)/);
  });

  it('the native shell signed out opens on the door, not the storefront', () => {
    expect(SOURCE).toMatch(/native && !auth\?\.loading && !auth\?\.user/);
    expect(SOURCE).toMatch(/<Navigate to="\/auth" replace \/>/);
  });

  it('still renders the storefront for the web at desktop width and for a signed-out visitor', () => {
    expect(SOURCE).toMatch(/<Homepage \/>/);
  });
});

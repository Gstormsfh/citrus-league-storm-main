/**
 * TWO DEAD ENDS, REPORTED THE NIGHT BEFORE SUBMISSION (2026-09-04).
 *
 *   "I'm in an old league that had playoff brackets. I switched to it, now
 *    I'm completely stuck in this section and can't switch back."
 *
 *   "If I'm already in a league I can't do mock drafts."
 *
 * Neither was a missing feature. Both were navigation that pointed nowhere,
 * and both are the sort of thing App Review finds by tapping around for four
 * minutes -- an app you can get permanently stuck in is a rejection, not a
 * papercut.
 *
 * ── 1. THE PLAYOFF RATCHET ──────────────────────────────────────────────
 *
 * The league switcher is duplicated in three JSX callbacks (Navbar twice,
 * MobileMenuButton once) and every copy had the same two faults:
 *
 *   THE SELF-PIN. From a `/league/:id/playoffs` URL the chain read
 *
 *       else if (pathname.match(/^\/league\/[^/]+\/playoffs$/))
 *         navigate(`/league/${l.id}/playoffs`)
 *
 *   so every league you could pick landed on THAT league's playoffs page.
 *   No selection existed that left the section. "Can't switch back" was
 *   literally true.
 *
 *   THE MISSING `?league=`. Elsewhere it navigated to `/league/${l.id}`
 *   with no query. LeagueContext resolves the active league from
 *   `searchParams.get('league')` and never from the path segment, so it saw
 *   no league, fell back to localStorage -- still the pool -- and rewrote
 *   the URL to say so. LeagueDashboard then read a pool league and
 *   redirected into the pool. Picking the fantasy league put you back in
 *   the playoff pool.
 *
 * Both now live in one pure function, `leagueSwitchDestination`, so the rule
 * is testable instead of being three callbacks nobody diffs.
 *
 * ── 2. THE MOCK DRAFT ───────────────────────────────────────────────────
 *
 * The simulator was never gated: `/armchair-gm` is public in App.tsx, and
 * ArmchairGM.tsx has no auth check, no league check and no redirect. It had
 * no LINK. The fantasy tab set replaced the signed-out set, and only the
 * signed-out set carried Armchair GM. On the native shell that left no path
 * at all, because Index.tsx redirects the homepage -- where the other
 * mock-draft entry points live -- straight into your league.
 *
 * mockDraftNavGuard.test.ts already pins that the marketing surfaces point at
 * the simulator. This pins that a manager inside a league can reach it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leagueSwitchDestination } from '@/utils/leagueTypeHelpers';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf-8');

const NAVBAR = read('../components/Navbar.tsx');
const MENU = read('../components/MobileMenuButton.tsx');
const SWITCHERS: Array<[string, string]> = [['Navbar', NAVBAR], ['MobileMenuButton', MENU]];

const FANTASY = 'lg-fantasy';
const POOL = 'lg-pool';
const MOCK_DRAFT = '/armchair-gm?tab=mockdraft';

describe('switching leagues out of the playoff section', () => {
  it('does not pin a fantasy league to the playoffs page it was picked from', () => {
    const to = leagueSwitchDestination(FANTASY, 'fantasy', `/league/${POOL}/playoffs`);
    expect(to).not.toContain('/playoffs');
    expect(to).toContain(FANTASY);
  });

  it('names the league in the query, because LeagueContext reads only the query', () => {
    // Without this the context falls back to localStorage -- still the pool --
    // and LeagueDashboard redirects straight back into it.
    for (const from of ['/', '/gm-office', `/league/${POOL}`, `/league/${POOL}/playoffs`, '/pool/playoff-hub']) {
      const to = leagueSwitchDestination(FANTASY, 'fantasy', from);
      expect(to, `from ${from}`).toBe(`/league/${FANTASY}?league=${FANTASY}`);
    }
  });

  it('still sends a pool league to its pool route', () => {
    expect(leagueSwitchDestination(POOL, 'playoff-roster-pool', '/gm-office'))
      .toBe(`/pool/playoff-roster?league=${POOL}`);
    expect(leagueSwitchDestination(POOL, 'pickem', `/league/${FANTASY}`))
      .toBe(`/pool/pickem?league=${POOL}`);
  });

  it('keeps the surfaces that exist for every league', () => {
    expect(leagueSwitchDestination(FANTASY, 'fantasy', `/matchup/${POOL}`)).toBe(`/matchup/${FANTASY}`);
    expect(leagueSwitchDestination(FANTASY, 'fantasy', '/matchup')).toBe(`/matchup/${FANTASY}`);
  });

  it('leaves the draft room rather than swapping the league under a live draft', () => {
    expect(leagueSwitchDestination(FANTASY, 'fantasy', '/draft-room/abc')).toBe('/gm-office');
    expect(leagueSwitchDestination(FANTASY, 'fantasy', '/draft')).toBe('/gm-office');
  });

  it.each(SWITCHERS)('%s routes through the shared helper, not its own copy', (_name, src) => {
    expect(src).toContain('leagueSwitchDestination(l.id, lType, location.pathname)');
  });

  it.each(SWITCHERS)('%s no longer carries the self-pin branch', (_name, src) => {
    // The exact shape that made the section inescapable.
    expect(src).not.toMatch(/navigate\(`\/league\/\$\{l\.id\}\/playoffs`\)/);
    expect(src).not.toMatch(/pathname\.match\(\/\^\\\/league[^)]*playoffs/);
  });
});

describe('the playoff pool navigation has a way out of the pool', () => {
  /** Every `path:` in the tab set for one league type. */
  const tabPaths = (src: string, leagueType: string): string[] => {
    const at = src.indexOf(`case '${leagueType}':`);
    expect(at, `${leagueType} tab set is missing`).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf('];', at));
    return [...block.matchAll(/path:\s*(?:'([^']+)'|`([^`]+)`)/g)].map((m) => m[1] ?? m[2]);
  };

  const POOL_TYPES = ['playoff-bracket-pickem', 'playoff-confidence-pool', 'playoff-roster-pool'];

  it.each(
    SWITCHERS.flatMap(([name, src]) => POOL_TYPES.map((t) => [name, t, src] as const)),
  )('%s / %s offers a destination outside the pool', (_name, type, src) => {
    const paths = tabPaths(src, type);
    expect(paths.length).toBeGreaterThan(0);
    // /pool/* is the pool; /nhl/playoffs is the same section by another name.
    const escapes = paths.filter((p) => !p.startsWith('/pool/') && !p.startsWith('/nhl/'));
    expect(escapes, `${type} tabs: ${paths.join(', ')}`).not.toHaveLength(0);
  });
});

describe('a manager inside a league can still reach a mock draft', () => {
  /** The tab set shown when the user has an active fantasy league. */
  const fantasyTabs = (src: string): string => {
    const at = src.indexOf('activeLeagueId && !isPool');
    expect(at, 'fantasy tab set is missing').toBeGreaterThan(-1);
    return src.slice(at, src.indexOf(']', at));
  };

  it.each(SWITCHERS)('%s links the simulator from inside a fantasy league', (_name, src) => {
    expect(fantasyTabs(src)).toContain(MOCK_DRAFT);
  });

  it('the simulator route is still public and still ungated', () => {
    // If this ever grows an auth or league gate, the links above become the
    // dead end they were written to remove.
    const app = read('../App.tsx');
    const line = app.split('\n').find((l) => l.includes('"/armchair-gm"')) ?? '';
    expect(line).not.toContain('ProtectedRoute');

    const gm = read('../pages/ArmchairGM.tsx');
    expect(gm).not.toMatch(/<Navigate\b/);
    expect(gm).toContain("'mockdraft'");
  });
});

describe('the pool pages never drop their navigation', () => {
  const PAGES = ['PoolPlayoffBracket', 'PoolPlayoffConfidence', 'PoolPlayoffHub', 'PoolPlayoffRoster'];

  it.each(PAGES)('%s renders the Navbar in its loading branch', (page) => {
    const src = read(`../pages/${page}.tsx`);
    const at = src.indexOf('if (loading)');
    expect(at, `${page} has no loading branch`).toBeGreaterThan(-1);
    // The switcher lives in the Navbar, and on a pool page it is the way out.
    const branch = src.slice(at, at + 800);
    expect(branch).toContain('<Navbar');
  });

  it.each(['PoolPlayoffBracket', 'PoolPlayoffConfidence'])(
    '%s stops loading when it arrives with no league',
    (page) => {
      const src = read(`../pages/${page}.tsx`);
      expect(src).toContain('if (!leagueId || !user) { setLoading(false); return; }');
    },
  );
});

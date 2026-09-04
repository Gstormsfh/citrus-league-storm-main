/**
 * League type helpers — used across Navbar, MobileBottomNav, page guards, etc.
 * to differentiate pool leagues from fantasy leagues.
 */

import type { LeagueType } from '@/types/leagueTypes';
import { LEAGUE_TYPE_LABELS } from '@citrus/shared';

/** Returns true for pickem, survivor, confidence-pool, and all playoff pool leagues */
export const isPoolLeague = (leagueType: string | undefined | null): boolean =>
  leagueType === 'pickem' || leagueType === 'survivor' || leagueType === 'confidence-pool'
  || leagueType === 'playoff-bracket-pickem' || leagueType === 'playoff-confidence-pool' || leagueType === 'playoff-roster-pool';

/** Returns true for any of the playoff-specific pool types */
export const isPlayoffPoolLeague = (leagueType: string | undefined | null): boolean =>
  leagueType === 'playoff-bracket-pickem' || leagueType === 'playoff-confidence-pool' || leagueType === 'playoff-roster-pool';

/**
 * SEASON-AGNOSTIC (2026-08-13) — which league types the create-league
 * picker offers, given the `?type` query param.
 *
 * This rule used to live inside CreateLeague's JSX as
 * "only show playoff types (we're in playoff season)", with `?type=all`
 * as a documented backdoor. That put the CALENDAR IN THE SOURCE: every
 * turn of the season required a code change and a deploy, and until
 * someone made it, nobody could create a season-long fantasy league at
 * all. It is what blocked draft testing for THE TWELVE in August.
 *
 * Inverted here: the URL NARROWS, the default shows everything.
 *
 *   ?type=playoff  -> the three playoff formats only. Every playoff CTA
 *                     (Navbar, MobileMenuButton, MobileBottomNav,
 *                     NHLPlayoffBracket) already passes this, so the
 *                     playoff funnel is untouched.
 *   anything else  -> the full catalogue, Fantasy Hockey first.
 *                     `?type=all` therefore keeps working unchanged.
 *
 * Extracted as a pure function specifically so this is pinned by a test.
 * The cost of it silently regressing is "no one can create a league",
 * which is not a thing that should be discoverable only by a founder
 * trying to run a draft.
 */
export const visibleLeagueTypes = (typeParam: string | null | undefined): LeagueType[] => {
  const all = Object.keys(LEAGUE_TYPE_LABELS) as LeagueType[];
  if (typeParam === 'playoff') return all.filter((t) => isPlayoffPoolLeague(t));
  return all;
};

/** Returns the correct frontend route for a pool league */
export const getPoolRoute = (leagueType: string, leagueId: string, tab?: string): string => {
  const routes: Record<string, string> = {
    'pickem': '/pool/pickem',
    'survivor': '/pool/survivor',
    'confidence-pool': '/pool/confidence',
    'playoff-bracket-pickem': '/pool/playoff-bracket',
    'playoff-confidence-pool': '/pool/playoff-confidence',
    'playoff-roster-pool': '/pool/playoff-roster',
  };
  const base = routes[leagueType];
  if (!base) return `/league/${leagueId}`;
  const params = new URLSearchParams({ league: leagueId });
  if (tab) params.set('tab', tab);
  return `${base}?${params.toString()}`;
};

/**
 * WHERE A LEAGUE LIVES — the single answer to "the user picked league X from
 * the switcher; where do they go?"
 *
 * Reported 2026-09-04: "I'm in an old league that had playoff brackets. I
 * switched to it, now I'm completely stuck in this section and can't switch
 * back." Both halves of that were true, and this function is where both were
 * decided -- three times, in three copies, in Navbar (twice) and
 * MobileMenuButton.
 *
 * WHAT WAS WRONG
 *
 * 1. THE SELF-PIN. The old chain had a branch
 *
 *      else if (pathname.match(/^\/league\/[^/]+\/playoffs$/))
 *        navigate(`/league/${l.id}/playoffs`)
 *
 *    so from a playoffs page EVERY league you could pick landed you on that
 *    league's playoffs page. There was no selection that left the section.
 *    That is not a switcher, it is a tab bar with extra steps. Gone: a league
 *    you deliberately switch to opens at its front door.
 *
 * 2. THE MISSING `?league=`. The old chain navigated to `/league/${l.id}`
 *    with no query. LeagueContext resolves the active league from
 *    `searchParams.get('league')` and NEVER from the path segment, so on that
 *    URL it saw no league, fell through to the localStorage value -- still
 *    the pool -- and rewrote the URL to advertise it. LeagueDashboard then
 *    read a pool league and redirected to the pool route. The user picked the
 *    fantasy league and arrived back in the playoff pool, which is exactly
 *    what "can't switch back" felt like from the outside.
 *
 *    Naming the league in the query is the small, local fix: the URL now
 *    says which league it means, so nothing has to guess. (The deeper fix --
 *    LeagueContext treating the PATH as a source of truth, the way
 *    matchupUrlSync.ts already argues it must -- is a bigger change than the
 *    night before a submission deserves. This closes the trap without it.)
 *
 * Pure, and exported on its own, so the rules above are pinned by a test
 * instead of living in three JSX callbacks nobody diffs against each other.
 */
export const leagueSwitchDestination = (
  leagueId: string,
  leagueType: string | undefined | null,
  currentPathname: string,
): string => {
  // A pool league only exists at its pool route -- unchanged.
  if (isPoolLeague(leagueType)) return getPoolRoute(leagueType as string, leagueId);

  // Stay on the surface the user is already looking at, where that surface
  // exists for every league. Matchup does; a playoffs bracket does not.
  if (currentPathname.startsWith('/matchup')) return `/matchup/${leagueId}`;

  // Switching leagues out of a draft room means leaving the draft room.
  if (currentPathname.startsWith('/draft-room') || currentPathname === '/draft') return '/gm-office';

  return `/league/${leagueId}?league=${leagueId}`;
};

/** Returns a display label for the pool type */
export const getPoolLabel = (leagueType: string): string => {
  const labels: Record<string, string> = {
    'pickem': "Pick'em",
    'survivor': 'Survivor',
    'confidence-pool': 'Confidence',
    'playoff-bracket-pickem': 'Playoff Bracket',
    'playoff-confidence-pool': 'Playoff Confidence',
    'playoff-roster-pool': 'Playoff Roster',
  };
  return labels[leagueType] || 'Pool';
};

/** Get the league type from a league's settings JSONB */
export const getLeagueTypeFromSettings = (settings: Record<string, unknown> | null | undefined): LeagueType => {
  return (settings?.leagueType as LeagueType) || 'fantasy';
};

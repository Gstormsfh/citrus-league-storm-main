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

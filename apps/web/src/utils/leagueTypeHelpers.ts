/**
 * League type helpers — used across Navbar, MobileBottomNav, page guards, etc.
 * to differentiate pool leagues from fantasy leagues.
 */

import type { LeagueType } from '@/types/leagueTypes';

/** Returns true for pickem, survivor, confidence-pool, and all playoff pool leagues */
export const isPoolLeague = (leagueType: string | undefined | null): boolean =>
  leagueType === 'pickem' || leagueType === 'survivor' || leagueType === 'confidence-pool'
  || leagueType === 'playoff-bracket-pickem' || leagueType === 'playoff-confidence-pool' || leagueType === 'playoff-roster-pool';

/** Returns true for any of the playoff-specific pool types */
export const isPlayoffPoolLeague = (leagueType: string | undefined | null): boolean =>
  leagueType === 'playoff-bracket-pickem' || leagueType === 'playoff-confidence-pool' || leagueType === 'playoff-roster-pool';

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

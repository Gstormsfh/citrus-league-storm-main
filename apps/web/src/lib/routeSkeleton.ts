/**
 * Which skeleton a route settles into while its chunk loads (PR3).
 *
 * Read by `LoadingScreen`, the Suspense fallback, which renders OUTSIDE
 * `<Routes>` and so knows only the pathname. The `chrome` says what
 * silhouette holds the header's space: the league header's for a league
 * screen, the app header's for a tab, nothing for auth and the draft.
 */
import type { PressBoxSkeletonKind } from '@/components/pressbox/Skeleton';

export type RouteSkeletonShape = { kind: PressBoxSkeletonKind; chrome: 'league' | 'app' | 'none' };

export function routeSkeleton(pathname: string): RouteSkeletonShape {
  const p = pathname.toLowerCase();
  const starts = (...prefixes: string[]) => prefixes.some((x) => p === x || p.startsWith(`${x}/`));
  // The routes as App.tsx declares them (2026-09-05). Order matters where
  // one path is under another: the bracket lives at /league/:id/playoffs.
  if (starts('/roster', '/team')) return { kind: 'roster', chrome: 'league' };
  if (starts('/standings')) return { kind: 'standings', chrome: 'league' };
  if (starts('/matchup')) return { kind: 'matchup', chrome: 'league' };
  if (/^\/league\/[^/]+\/playoffs/.test(p)) return { kind: 'bracket', chrome: 'league' };
  if (starts('/league')) return { kind: 'hq', chrome: 'league' };
  if (starts('/free-agents', '/waiver-wire', '/trade-analyzer')) return { kind: 'players', chrome: 'league' };
  if (starts('/schedule-manager', '/team-analytics', '/gm-office')) return { kind: 'list', chrome: 'league' };
  if (starts('/players')) return { kind: 'browse', chrome: 'app' };
  if (starts('/scores')) return { kind: 'scores', chrome: 'app' };
  if (starts('/news')) return { kind: 'news', chrome: 'app' };
  if (starts('/profile', '/settings')) return { kind: 'account', chrome: 'app' };
  if (starts('/create-league')) return { kind: 'list', chrome: 'app' };
  if (p === '/') return { kind: 'home', chrome: 'app' };
  return { kind: 'list', chrome: 'none' };
}

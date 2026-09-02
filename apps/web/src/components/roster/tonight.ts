import type { HockeyPlayer } from './HockeyPlayerCard';

/**
 * Tonight's number for a player, computed the way the roster column does:
 * actual points once the game is live/final, otherwise the projection.
 *
 * Shared by the Line Change sheet and the Fill sheet (2026-09-01) so a
 * player shows the same figure whichever way the manager reaches him.
 * Plain function in its own module — a file exporting both a component and
 * a helper breaks react-refresh.
 */
export function tonight(p: HockeyPlayer): { pts: number | null; live: boolean } {
  const isG = p.position === 'Goalie' || p.position === 'G';
  const status = p.nextGame?.gameStatus;
  const live = status === 'live' || status === 'intermission' || status === 'final';
  if (live && p.daily_actual_points != null) return { pts: p.daily_actual_points, live: true };
  const proj = isG
    ? p.goalieProjection?.total_projected_points
    : p.daily_projection?.total_projected_points;
  return { pts: proj ?? null, live: false };
}

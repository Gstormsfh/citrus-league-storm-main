import type { MatchupPlayer } from './types';
import { ScoringCalculator } from '@/utils/scoringUtils';
import { projectionSettings } from '@/components/player/projectionScoring';

/** Earned fantasy points, never raw NHL points or default-scored fallback. */
export function sidebarFantasyPoints(player: MatchupPlayer, scoring: unknown, ready: boolean): number | null {
  if (!ready) return null;
  if (typeof player.total_points === 'number' && Number.isFinite(player.total_points)) return player.total_points;
  if (!player.matchupStats) return null;
  return new ScoringCalculator(projectionSettings(scoring)).calculatePoints(
    player.matchupStats, player.position === 'G' || player.position === 'Goalie',
  );
}

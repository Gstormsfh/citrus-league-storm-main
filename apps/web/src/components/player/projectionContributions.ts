import { ScoringCalculator } from '@/utils/scoringUtils';
import { projectionSettings, projectionStats } from './projectionScoring';

const STAT_NAMES: Record<string, [string, string]> = {
  goals: ['goals', 'Goals'], assists: ['assists', 'Assists'],
  shots_on_goal: ['sog', 'Shots on goal'], blocks: ['blocks', 'Blocks'],
  hits: ['hits', 'Hits'], penalty_minutes: ['pim', 'Penalty minutes'],
  power_play_points: ['ppp', 'Power-play points'], short_handed_points: ['shp', 'Short-handed points'],
  plus_minus: ['plus_minus', 'Plus/minus'], wins: ['wins', 'Wins'],
  saves: ['saves', 'Saves'], goals_against: ['goals_against', 'Goals against'],
  shutouts: ['shutouts', 'Shutouts'],
};

/** Presentation only. Contributions use the same calculator as the league total.
 * Keep zeros, negative contributions and unavailable categories visible. */
export function projectionContributions(row: Record<string, unknown> | null, scoring: unknown, goalie: boolean) {
  const settings = projectionSettings(scoring);
  const scorer = new ScoringCalculator(settings);
  const stats = row ? projectionStats(row) : {};
  return Object.entries(settings[goalie ? 'goalie' : 'skater']).map(([key, weight]) => {
    const [stat, label] = STAT_NAMES[key] ?? [key, key.replace(/_/g, ' ')];
    const count = stats[stat] ?? null;
    return { key, label, count, weight: weight ?? 0,
      points: count === null ? null : scorer.calculatePoints({ [stat]: count }, goalie) };
  });
}

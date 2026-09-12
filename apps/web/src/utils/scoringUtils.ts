/** Shared scoring implementation; retain the historical web import path. */
export {
  DEFAULT_SCORING,
  ADDITIONAL_SCORING_STATS,
  ScoringCalculator,
  extractScoringSettings,
  createScorerFromLeague,
  EMPTY_CATEGORY_STATS,
  compareCategoryMatchup,
  resolveCategoryPlayoffTiebreaker,
  calculateRotoStandings,
  calculateSeasonPointsStandings,
} from '@citrus/shared';
export type { ScoringSettings, CategoryStats } from '@citrus/shared';

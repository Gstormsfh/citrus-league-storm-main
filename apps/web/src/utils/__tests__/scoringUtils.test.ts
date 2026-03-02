import { describe, it, expect } from 'vitest';
import {
  ScoringCalculator,
  DEFAULT_SCORING,
  extractScoringSettings,
  createScorerFromLeague,
  compareCategoryMatchup,
  resolveCategoryPlayoffTiebreaker,
  calculateRotoStandings,
  calculateSeasonPointsStandings,
  EMPTY_CATEGORY_STATS,
} from '../scoringUtils';

// =============================================================================
// ScoringCalculator — Core Fantasy Points
// =============================================================================

describe('ScoringCalculator', () => {
  const scorer = new ScoringCalculator(DEFAULT_SCORING);

  // --- Skater scoring ---

  it('calculates 0 points for null stats', () => {
    expect(scorer.calculatePoints(null, false)).toBe(0);
    expect(scorer.calculatePoints(undefined, false)).toBe(0);
    expect(scorer.calculatePoints(null, true)).toBe(0);
  });

  it('calculates 0 points for empty stats object', () => {
    expect(scorer.calculatePoints({}, false)).toBe(0);
    expect(scorer.calculatePoints({}, true)).toBe(0);
  });

  it('calculates correct skater points for a single goal', () => {
    const stats = { goals: 1 };
    // 1 goal × 3 = 3
    expect(scorer.calculatePoints(stats, false)).toBe(3);
  });

  it('calculates correct skater points for a multi-stat line', () => {
    // Classic stat line: 2G, 1A, 1PPP, 4SOG, 2H, 1BLK, 2PIM
    const stats = { goals: 2, assists: 1, ppp: 1, sog: 4, hits: 2, blocks: 1, pim: 2 };
    // 2×3 + 1×2 + 1×1 + 4×0.4 + 2×0.2 + 1×0.5 + 2×0.5 = 6+2+1+1.6+0.4+0.5+1 = 12.5
    expect(scorer.calculatePoints(stats, false)).toBeCloseTo(12.5);
  });

  it('calculates correct skater points with shorthanded points', () => {
    const stats = { goals: 1, shp: 1 };
    // 1×3 + 1×2 = 5
    expect(scorer.calculatePoints(stats, false)).toBe(5);
  });

  it('handles alternative field names (shots_on_goal, power_play_points)', () => {
    const stats = { goals: 1, power_play_points: 1, shots_on_goal: 3 };
    // 1×3 + 1×1 + 3×0.4 = 3+1+1.2 = 5.2
    expect(scorer.calculatePoints(stats, false)).toBeCloseTo(5.2);
  });

  // --- Goalie scoring ---

  it('calculates correct goalie points for a win with saves', () => {
    const stats = { wins: 1, saves: 30, goals_against: 2 };
    // 1×4 + 30×0.2 + 2×(-1) = 4+6-2 = 8
    expect(scorer.calculatePoints(stats, true)).toBeCloseTo(8);
  });

  it('calculates correct goalie points for a shutout', () => {
    const stats = { wins: 1, saves: 35, shutouts: 1, goals_against: 0 };
    // 1×4 + 35×0.2 + 1×3 + 0×(-1) = 4+7+3 = 14
    expect(scorer.calculatePoints(stats, true)).toBeCloseTo(14);
  });

  it('calculates negative goalie points for a blowout loss', () => {
    const stats = { wins: 0, saves: 20, shutouts: 0, goals_against: 6 };
    // 0×4 + 20×0.2 + 0×3 + 6×(-1) = 0+4+0-6 = -2
    expect(scorer.calculatePoints(stats, true)).toBeCloseTo(-2);
  });

  // --- Custom scoring weights ---

  it('works with custom scoring settings', () => {
    const custom = new ScoringCalculator({
      skater: { goals: 5, assists: 3, power_play_points: 2, short_handed_points: 3, shots_on_goal: 0.5, blocks: 1, hits: 0.5, penalty_minutes: 0 },
      goalie: { wins: 5, shutouts: 5, saves: 0.3, goals_against: -2 },
    });
    // Skater: 2 goals × 5 = 10
    expect(custom.calculatePoints({ goals: 2 }, false)).toBe(10);
    // Goalie: 1 win×5 + 25 saves×0.3 + 3 GA×(-2) = 5+7.5-6 = 6.5
    expect(custom.calculatePoints({ wins: 1, saves: 25, goals_against: 3 }, true)).toBeCloseTo(6.5);
  });

  it('defaults to DEFAULT_SCORING when no settings provided', () => {
    const defaultScorer = new ScoringCalculator();
    expect(defaultScorer.getSettings()).toEqual(DEFAULT_SCORING);
  });

  // --- getStatBreakdown ---

  it('returns empty breakdown for null stats', () => {
    expect(scorer.getStatBreakdown(null, false)).toEqual({});
  });

  it('only includes non-zero stats in breakdown', () => {
    const stats = { goals: 2, assists: 0, sog: 3 };
    const breakdown = scorer.getStatBreakdown(stats, false);
    expect(breakdown['Goals']).toBeDefined();
    expect(breakdown['Shots on Goal']).toBeDefined();
    expect(breakdown['Assists']).toBeUndefined(); // 0 assists excluded
  });

  it('breakdown points match calculatePoints total', () => {
    const stats = { goals: 1, assists: 2, sog: 5, blocks: 1, hits: 3, pim: 4, ppp: 1, shp: 0 };
    const total = scorer.calculatePoints(stats, false);
    const breakdown = scorer.getStatBreakdown(stats, false);
    const breakdownTotal = Object.values(breakdown).reduce((sum, b) => sum + b.points, 0);
    expect(breakdownTotal).toBeCloseTo(total);
  });

  it('goalie breakdown includes correct categories', () => {
    const stats = { wins: 1, saves: 28, shutouts: 0, goals_against: 3 };
    const breakdown = scorer.getStatBreakdown(stats, true);
    expect(breakdown['Wins']).toBeDefined();
    expect(breakdown['Saves']).toBeDefined();
    expect(breakdown['Goals Against']).toBeDefined();
    expect(breakdown['Shutouts']).toBeUndefined(); // 0 shutouts excluded
  });

  // --- getWeight ---

  it('returns correct weight for known stats', () => {
    expect(scorer.getWeight('goals', false)).toBe(3);
    expect(scorer.getWeight('assists', false)).toBe(2);
    expect(scorer.getWeight('wins', true)).toBe(4);
    expect(scorer.getWeight('goals_against', true)).toBe(-1);
  });

  it('returns 0 for unknown stat names', () => {
    expect(scorer.getWeight('unknown_stat', false)).toBe(0);
    expect(scorer.getWeight('unknown_stat', true)).toBe(0);
  });
});

// =============================================================================
// extractScoringSettings / createScorerFromLeague
// =============================================================================

describe('extractScoringSettings', () => {
  it('returns league scoring_settings when present', () => {
    const customSettings = { skater: { ...DEFAULT_SCORING.skater, goals: 5 }, goalie: DEFAULT_SCORING.goalie };
    const league = { scoring_settings: customSettings };
    expect(extractScoringSettings(league).skater.goals).toBe(5);
  });

  it('returns DEFAULT_SCORING when league has no scoring_settings', () => {
    expect(extractScoringSettings({})).toEqual(DEFAULT_SCORING);
    expect(extractScoringSettings(null)).toEqual(DEFAULT_SCORING);
    expect(extractScoringSettings(undefined)).toEqual(DEFAULT_SCORING);
  });
});

describe('createScorerFromLeague', () => {
  it('creates a ScoringCalculator with league settings', () => {
    const customSettings = { skater: { ...DEFAULT_SCORING.skater, goals: 10 }, goalie: DEFAULT_SCORING.goalie };
    const scorer = createScorerFromLeague({ scoring_settings: customSettings });
    expect(scorer.calculatePoints({ goals: 1 }, false)).toBe(10);
  });
});

// =============================================================================
// compareCategoryMatchup — H2H Categories
// =============================================================================

describe('compareCategoryMatchup', () => {
  const categories = ['goals', 'assists', 'sog', 'hits', 'blocks'];
  const categoryMeta: Record<string, { higherIsBetter: boolean }> = {
    goals: { higherIsBetter: true },
    assists: { higherIsBetter: true },
    sog: { higherIsBetter: true },
    hits: { higherIsBetter: true },
    blocks: { higherIsBetter: true },
  };

  it('correctly counts wins, losses, and ties', () => {
    const team1 = { goals: 10, assists: 8, sog: 30, hits: 20, blocks: 10 };
    const team2 = { goals: 8, assists: 10, sog: 30, hits: 15, blocks: 12 };
    // team1 wins: goals, hits (2)
    // team2 wins: assists, blocks (2)
    // ties: sog (1)
    const result = compareCategoryMatchup(team1, team2, categories, categoryMeta);
    expect(result.team1Wins).toBe(2);
    expect(result.team2Wins).toBe(2);
    expect(result.ties).toBe(1);
    expect(result.mostCategoriesWinner).toBe('tie');
  });

  it('handles complete sweep', () => {
    const team1 = { goals: 15, assists: 12, sog: 40, hits: 30, blocks: 20 };
    const team2 = { goals: 5, assists: 3, sog: 20, hits: 10, blocks: 8 };
    const result = compareCategoryMatchup(team1, team2, categories, categoryMeta);
    expect(result.team1Wins).toBe(5);
    expect(result.team2Wins).toBe(0);
    expect(result.ties).toBe(0);
    expect(result.mostCategoriesWinner).toBe('team1');
  });

  it('handles lowerIsBetter categories (like GAA)', () => {
    const gaaCategories = ['gaa'];
    const gaaMeta = { gaa: { higherIsBetter: false } };
    const team1 = { gaa: 2.5 };
    const team2 = { gaa: 3.0 };
    // Lower is better: team1 wins
    const result = compareCategoryMatchup(team1, team2, gaaCategories, gaaMeta);
    expect(result.team1Wins).toBe(1);
    expect(result.team2Wins).toBe(0);
  });

  it('treats missing stats as 0', () => {
    const team1 = { goals: 5 };
    const team2 = {}; // all zeros
    const result = compareCategoryMatchup(team1, team2, categories, categoryMeta);
    expect(result.team1Wins).toBe(1); // goals
    expect(result.ties).toBe(4); // rest are 0-0 ties
  });
});

// =============================================================================
// resolveCategoryPlayoffTiebreaker
// =============================================================================

describe('resolveCategoryPlayoffTiebreaker', () => {
  it('breaks tie via head-to-head record', () => {
    const team1 = { wins: 10, losses: 8, ties: 0, pointsFor: 500 };
    const team2 = { wins: 10, losses: 8, ties: 0, pointsFor: 520 };
    const h2h = { team1Wins: 3, team2Wins: 1 };
    // team1 wins H2H 3-1 → positive result
    expect(resolveCategoryPlayoffTiebreaker(team1, team2, h2h)).toBeGreaterThan(0);
  });

  it('falls through to category wins when H2H is tied', () => {
    const team1 = { wins: 10, losses: 8, ties: 0, pointsFor: 500, categoryWins: 45 };
    const team2 = { wins: 10, losses: 8, ties: 0, pointsFor: 520, categoryWins: 40 };
    const h2h = { team1Wins: 2, team2Wins: 2 };
    // H2H tied → team1 has more category wins → positive
    expect(resolveCategoryPlayoffTiebreaker(team1, team2, h2h)).toBeGreaterThan(0);
  });

  it('falls through to points for when categories are tied', () => {
    const team1 = { wins: 10, losses: 8, ties: 0, pointsFor: 520, categoryWins: 40 };
    const team2 = { wins: 10, losses: 8, ties: 0, pointsFor: 500, categoryWins: 40 };
    const h2h = { team1Wins: 2, team2Wins: 2 };
    // H2H tied, categories tied → team1 has more points → positive
    expect(resolveCategoryPlayoffTiebreaker(team1, team2, h2h)).toBeGreaterThan(0);
  });

  it('returns 0 when truly tied', () => {
    const team1 = { wins: 10, losses: 8, ties: 0, pointsFor: 500, categoryWins: 40 };
    const team2 = { wins: 10, losses: 8, ties: 0, pointsFor: 500, categoryWins: 40 };
    const h2h = { team1Wins: 2, team2Wins: 2 };
    expect(resolveCategoryPlayoffTiebreaker(team1, team2, h2h)).toBe(0);
  });
});

// =============================================================================
// calculateRotoStandings
// =============================================================================

describe('calculateRotoStandings', () => {
  const categories = ['goals', 'assists'];
  const categoryMeta = {
    goals: { higherIsBetter: true },
    assists: { higherIsBetter: true },
  };

  it('correctly ranks 3 teams across 2 categories', () => {
    const teamStats = {
      teamA: { goals: 30, assists: 20 },
      teamB: { goals: 20, assists: 30 },
      teamC: { goals: 10, assists: 10 },
    };
    const result = calculateRotoStandings(teamStats, categories, categoryMeta);
    // Goals: A=1st(3pts), B=2nd(2pts), C=3rd(1pt)
    // Assists: B=1st(3pts), A=2nd(2pts), C=3rd(1pt)
    // Total: A=5, B=5, C=2
    expect(result['teamA'].rotoPoints).toBe(5);
    expect(result['teamB'].rotoPoints).toBe(5);
    expect(result['teamC'].rotoPoints).toBe(2);
  });

  it('handles tied values with averaged ranking points', () => {
    const teamStats = {
      teamA: { goals: 20, assists: 20 },
      teamB: { goals: 20, assists: 10 },
    };
    const result = calculateRotoStandings(teamStats, categories, categoryMeta);
    // Goals: tied → average of (2+1)/2 = 1.5 each
    // Assists: A=1st(2pts), B=2nd(1pt)
    // Total: A=3.5, B=2.5
    expect(result['teamA'].rotoPoints).toBe(3.5);
    expect(result['teamB'].rotoPoints).toBe(2.5);
  });
});

// =============================================================================
// calculateSeasonPointsStandings
// =============================================================================

describe('calculateSeasonPointsStandings', () => {
  it('sorts teams by total points descending', () => {
    const standings = calculateSeasonPointsStandings({
      teamA: 500,
      teamB: 700,
      teamC: 600,
    });
    expect(standings[0].teamId).toBe('teamB');
    expect(standings[1].teamId).toBe('teamC');
    expect(standings[2].teamId).toBe('teamA');
  });

  it('calculates PPG correctly', () => {
    const standings = calculateSeasonPointsStandings(
      { teamA: 100 },
      { teamA: 10 }
    );
    expect(standings[0].ppg).toBe(10);
  });

  it('handles zero games played (PPG = 0)', () => {
    const standings = calculateSeasonPointsStandings({ teamA: 100 });
    expect(standings[0].ppg).toBe(0);
  });
});

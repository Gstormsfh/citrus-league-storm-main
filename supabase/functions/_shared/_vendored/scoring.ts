// ── VENDORED COPY — SYNC ON CHANGE ──────────────────────────────────────
// Canonical source: packages/shared/src/utils/scoring.ts
//
// This file is a verbatim copy of the canonical source, vendored into
// supabase/functions/_shared/_vendored/ so the Supabase CLI bundler can
// resolve it on Windows. See KI-007.
//
// MAINTENANCE: when packages/shared/src/utils/scoring.ts changes, this
// file MUST be updated to match. Drift between canonical and vendored
// ScoringCalculator would produce different FPTS values across
// runtimes, leading to autopick decisions diverging from the v1 web
// client's heuristic (which uses the canonical). Phase 7 CI check
// enforces parity.
// ────────────────────────────────────────────────────────────────────────

/**
 * Centralized Fantasy Scoring Utility
 * Single source of truth for all scoring calculations across the application
 *
 * This utility ensures consistency between:
 * - Database RPC calculations
 * - Frontend display calculations
 * - Stat breakdown generation
 * - Daily/weekly point totals
 *
 * @example
 * ```typescript
 * const scorer = new ScoringCalculator(league.scoring_settings);
 * const points = scorer.calculatePoints(playerStats, isGoalie);
 * const breakdown = scorer.getStatBreakdown(playerStats, isGoalie);
 * ```
 */

export interface ScoringSettings {
  skater: {
    goals: number;
    assists: number;
    power_play_points: number;
    short_handed_points: number;
    shots_on_goal: number;
    blocks: number;
    hits: number;
    penalty_minutes: number;
  };
  goalie: {
    wins: number;
    shutouts: number;
    saves: number;
    goals_against: number;
  };
}

/**
 * Default scoring settings matching database defaults
 * INDUSTRY-STANDARD DEFAULTS (2026-09-01): Yahoo-aligned; SHP/hits/PIM
 * opt-in at 0. Kept in sync with packages/shared even though this
 * vendored copy is slated for removal (KI-007 / chunk 11g.9).
 */
export const DEFAULT_SCORING: ScoringSettings = {
  skater: {
    goals: 6,
    assists: 4,
    power_play_points: 2,
    short_handed_points: 0,
    shots_on_goal: 0.9,
    blocks: 1,
    hits: 0,
    penalty_minutes: 0
  },
  goalie: {
    wins: 5,
    shutouts: 5,
    saves: 0.6,
    goals_against: -3
  }
};

/**
 * Centralized scoring calculator
 * Provides consistent point calculations and display formatting across the app
 */
export class ScoringCalculator {
  private settings: ScoringSettings;

  constructor(settings?: ScoringSettings | Partial<ScoringSettings> | null) {
    // Accept null/undefined → use defaults silently (expected path).
    // Accept a full ScoringSettings object (has .skater AND .goalie)
    //   → use as-is.
    // Reject malformed input (e.g. {} from an unprovisioned league
    // row, or a Partial<ScoringSettings> missing one of the sub-
    // objects) → console.warn AND fall back to defaults rather than
    // crash downstream when calculatePoints reads
    // `this.settings.skater.goals`.
    //
    // The previous `|| DEFAULT_SCORING` shortcut only caught
    // null/undefined/falsy values — `{}` is truthy in JS, so an
    // empty object passed the gate and broke downstream. Caught by
    // the Phase 4 SC-406b cross-transaction diagnostic on staging.
    //
    // Loud-fail-then-fallback over silent-fallback: the warn fires
    // only when the caller PROVIDED an object that we couldn't use,
    // not when they passed null/undefined (the expected "use
    // defaults" path).
    if (
      settings != null &&
      typeof settings === 'object' &&
      (settings as Partial<ScoringSettings>).skater != null &&
      (settings as Partial<ScoringSettings>).goalie != null
    ) {
      this.settings = settings as ScoringSettings;
    } else {
      if (settings != null) {
        console.warn(
          '[ScoringCalculator] Malformed scoring_settings — using defaults',
          {
            received:
              typeof settings === 'object'
                ? Object.keys(settings as object)
                : typeof settings,
          },
        );
      }
      this.settings = DEFAULT_SCORING;
    }
  }

  /**
   * Calculate fantasy points for a player's stats
   * Handles both skater and goalie stats with proper type detection
   *
   * @param stats - Player stats object (supports multiple field name variations)
   * @param isGoalie - True for goalie stats, false for skater stats
   * @returns Total fantasy points calculated
   */
  calculatePoints(stats: Record<string, number> | null | undefined, isGoalie: boolean): number {
    if (!stats) return 0;

    if (isGoalie) {
      return (
        (stats.wins || 0) * this.settings.goalie.wins +
        (stats.saves || 0) * this.settings.goalie.saves +
        (stats.shutouts || 0) * this.settings.goalie.shutouts +
        (stats.goals_against || 0) * this.settings.goalie.goals_against
      );
    } else {
      return (
        (stats.goals || 0) * this.settings.skater.goals +
        (stats.assists || 0) * this.settings.skater.assists +
        (stats.ppp || stats.power_play_points || stats.powerPlayPoints || 0) * this.settings.skater.power_play_points +
        (stats.shp || stats.short_handed_points || stats.shortHandedPoints || 0) * this.settings.skater.short_handed_points +
        (stats.sog || stats.shots_on_goal || stats.shots || 0) * this.settings.skater.shots_on_goal +
        (stats.blocks || stats.blk || stats.blockedShots || 0) * this.settings.skater.blocks +
        (stats.hits || 0) * this.settings.skater.hits +
        (stats.pim || stats.penalty_minutes || 0) * this.settings.skater.penalty_minutes
      );
    }
  }

  /**
   * Get detailed stat breakdown for display in tooltips/cards
   * Only includes stats with non-zero values
   *
   * @param stats - Player stats object
   * @param isGoalie - True for goalie, false for skater
   * @returns Object mapping stat names to count/points/logic
   */
  getStatBreakdown(stats: Record<string, number> | null | undefined, isGoalie: boolean): Record<string, { count: number; points: number; logic: string }> {
    if (!stats) return {};

    if (isGoalie) {
      const breakdown: Record<string, { count: number; points: number; logic: string }> = {};

      if ((stats.wins || 0) > 0) {
        const weight = this.settings.goalie.wins;
        breakdown['Wins'] = {
          count: stats.wins,
          points: stats.wins * weight,
          logic: `${stats.wins} wins × ${weight.toFixed(1)} points`
        };
      }

      if ((stats.saves || 0) > 0) {
        const weight = this.settings.goalie.saves;
        breakdown['Saves'] = {
          count: stats.saves,
          points: stats.saves * weight,
          logic: `${stats.saves} saves × ${weight.toFixed(1)} points`
        };
      }

      if ((stats.shutouts || 0) > 0) {
        const weight = this.settings.goalie.shutouts;
        breakdown['Shutouts'] = {
          count: stats.shutouts,
          points: stats.shutouts * weight,
          logic: `${stats.shutouts} shutouts × ${weight.toFixed(1)} points`
        };
      }

      if ((stats.goals_against || 0) > 0) {
        const weight = this.settings.goalie.goals_against;
        breakdown['Goals Against'] = {
          count: stats.goals_against,
          points: stats.goals_against * weight,
          logic: `${stats.goals_against} GA × ${weight.toFixed(1)} points`
        };
      }

      return breakdown;
    } else {
      const breakdown: Record<string, { count: number; points: number; logic: string }> = {};
      const statMappings = [
        { key: 'Goals', stat: 'goals', weight: this.settings.skater.goals },
        { key: 'Assists', stat: 'assists', weight: this.settings.skater.assists },
        { key: 'Power Play Points', stat: 'ppp', weight: this.settings.skater.power_play_points },
        { key: 'Shorthanded Points', stat: 'shp', weight: this.settings.skater.short_handed_points },
        { key: 'Shots on Goal', stat: 'sog', weight: this.settings.skater.shots_on_goal },
        { key: 'Blocks', stat: 'blocks', weight: this.settings.skater.blocks },
        { key: 'Hits', stat: 'hits', weight: this.settings.skater.hits },
        { key: 'Penalty Minutes', stat: 'pim', weight: this.settings.skater.penalty_minutes }
      ];

      statMappings.forEach(({ key, stat, weight }) => {
        const count = stats[stat] || 0;
        if (count > 0) {
          breakdown[key] = {
            count,
            points: count * weight,
            logic: `${count} ${key.toLowerCase()} × ${weight.toFixed(1)} points`
          };
        }
      });

      return breakdown;
    }
  }

  /**
   * Get the point weight for a specific stat
   *
   * @param stat - Stat name (e.g., 'goals', 'assists', 'wins')
   * @param isGoalie - True for goalie stats, false for skater stats
   * @returns Point value for that stat
   */
  getWeight(stat: string, isGoalie: boolean): number {
    if (isGoalie) {
      return this.settings.goalie[stat as keyof typeof this.settings.goalie] || 0;
    } else {
      return this.settings.skater[stat as keyof typeof this.settings.skater] || 0;
    }
  }

  /**
   * Format a single stat for display
   *
   * @param statName - Name of the stat
   * @param count - Number of times the stat occurred
   * @param isGoalie - True for goalie, false for skater
   * @returns Formatted string like "2 goals × 3.0 points"
   */
  formatStat(statName: string, count: number, isGoalie: boolean): string {
    const weight = this.getWeight(statName, isGoalie);
    return `${count} ${statName} × ${weight.toFixed(1)} points`;
  }

  /**
   * Calculate fantasy points per game for a player
   * Returns 0 if gamesPlayed is 0 to avoid division by zero
   */
  calculatePointsPerGame(stats: Record<string, number> | null | undefined, isGoalie: boolean, gamesPlayed: number): number {
    if (!gamesPlayed || gamesPlayed <= 0) return 0;
    return this.calculatePoints(stats, isGoalie) / gamesPlayed;
  }

  /**
   * Get the scoring settings being used
   * Useful for debugging or displaying scoring rules
   */
  getSettings(): ScoringSettings {
    return { ...this.settings };
  }
}

/**
 * Helper to extract scoring settings from league object
 * Provides safe access with fallback to defaults
 *
 * @param league - League object with optional scoring_settings
 * @returns ScoringSettings object (defaults if not found)
 */
export function extractScoringSettings(league: { scoring_settings?: ScoringSettings } | null | undefined): ScoringSettings {
  return league?.scoring_settings || DEFAULT_SCORING;
}

/**
 * Create a ScoringCalculator instance from a league object
 * Convenience method for common use case
 *
 * @param league - League object with optional scoring_settings
 * @returns New ScoringCalculator instance
 */
export function createScorerFromLeague(league: { scoring_settings?: ScoringSettings } | null | undefined): ScoringCalculator {
  return new ScoringCalculator(extractScoringSettings(league));
}

// ============================================================================
// CATEGORY-BASED & ROTISSERIE SCORING
// ============================================================================

/**
 * Raw stat values for a team across a time period (week or season).
 * Used by H2H Categories and Rotisserie formats.
 */
export interface CategoryStats {
  goals: number;
  assists: number;
  points: number;
  plus_minus: number;
  ppp: number;
  shp: number;
  sog: number;
  hits: number;
  blocks: number;
  pim: number;
  wins: number;
  saves: number;
  shutouts: number;
  gaa: number;
  save_pct: number;
}

/** Default empty category stats */
export const EMPTY_CATEGORY_STATS: CategoryStats = {
  goals: 0, assists: 0, points: 0, plus_minus: 0, ppp: 0, shp: 0,
  sog: 0, hits: 0, blocks: 0, pim: 0, wins: 0, saves: 0, shutouts: 0,
  gaa: 0, save_pct: 0,
};

/**
 * Compare two teams across selected categories for H2H Categories format.
 * Returns { team1Wins, team2Wins, ties } for a single weekly matchup.
 *
 * @param team1Stats - Raw category stats for team 1
 * @param team2Stats - Raw category stats for team 2
 * @param categories - Array of category IDs to compare
 * @param categoryMeta - Metadata for each category (higherIsBetter)
 */
export function compareCategoryMatchup(
  team1Stats: Partial<CategoryStats>,
  team2Stats: Partial<CategoryStats>,
  categories: string[],
  categoryMeta: Record<string, { higherIsBetter: boolean }>
): { team1Wins: number; team2Wins: number; ties: number; details: Record<string, 'team1' | 'team2' | 'tie'>; mostCategoriesWinner?: 'team1' | 'team2' | 'tie' } {
  let team1Wins = 0;
  let team2Wins = 0;
  let ties = 0;
  const details: Record<string, 'team1' | 'team2' | 'tie'> = {};

  for (const cat of categories) {
    const v1 = (team1Stats as Record<string, number>)[cat] ?? 0;
    const v2 = (team2Stats as Record<string, number>)[cat] ?? 0;
    const higher = categoryMeta[cat]?.higherIsBetter ?? true;

    if (v1 === v2) {
      ties++;
      details[cat] = 'tie';
    } else if ((higher && v1 > v2) || (!higher && v1 < v2)) {
      team1Wins++;
      details[cat] = 'team1';
    } else {
      team2Wins++;
      details[cat] = 'team2';
    }
  }

  // "Most Categories" outcome: overall matchup winner is team with more category wins
  // ESPN/Yahoo standard — used for H2H-Categories standings and playoff tiebreakers
  const mostCategoriesWinner: 'team1' | 'team2' | 'tie' =
    team1Wins > team2Wins ? 'team1' : team2Wins > team1Wins ? 'team2' : 'tie';

  return { team1Wins, team2Wins, ties, details, mostCategoriesWinner };
}

/**
 * Resolve H2H Category playoff tiebreakers.
 * ESPN/Yahoo standard order:
 *   1. Head-to-head record between tied teams
 *   2. Total category wins during regular season
 *   3. Total points scored (higher wins)
 *
 * @returns Positive if team1 wins tiebreak, negative if team2 wins, 0 if still tied
 */
export function resolveCategoryPlayoffTiebreaker(
  team1: { wins: number; losses: number; ties: number; pointsFor: number; categoryWins?: number },
  team2: { wins: number; losses: number; ties: number; pointsFor: number; categoryWins?: number },
  h2hRecord?: { team1Wins: number; team2Wins: number }
): number {
  // Tiebreaker 1: Head-to-head record (if available)
  if (h2hRecord) {
    if (h2hRecord.team1Wins !== h2hRecord.team2Wins) {
      return h2hRecord.team1Wins - h2hRecord.team2Wins;
    }
  }

  // Tiebreaker 2: Total category wins across all matchups
  if (team1.categoryWins !== undefined && team2.categoryWins !== undefined) {
    if (team1.categoryWins !== team2.categoryWins) {
      return team1.categoryWins - team2.categoryWins;
    }
  }

  // Tiebreaker 3: Total points scored (higher wins)
  return team1.pointsFor - team2.pointsFor;
}

/**
 * Calculate rotisserie standings from season-long category totals.
 * Each team earns ranking points (N = first, 1 = last) per category.
 *
 * @param teamStats - Map of teamId -> CategoryStats for the season
 * @param categories - Array of category IDs to rank
 * @param categoryMeta - Metadata for each category (higherIsBetter)
 * @returns Map of teamId -> { rotoPoints, categoryRanks }
 */
export function calculateRotoStandings(
  teamStats: Record<string, Partial<CategoryStats>>,
  categories: string[],
  categoryMeta: Record<string, { higherIsBetter: boolean }>
): Record<string, { rotoPoints: number; categoryRanks: Record<string, number> }> {
  const teamIds = Object.keys(teamStats);
  const numTeams = teamIds.length;
  const result: Record<string, { rotoPoints: number; categoryRanks: Record<string, number> }> = {};

  // Initialize
  teamIds.forEach(id => {
    result[id] = { rotoPoints: 0, categoryRanks: {} };
  });

  // For each category, rank all teams and assign points
  for (const cat of categories) {
    const higher = categoryMeta[cat]?.higherIsBetter ?? true;

    // Sort teams by their stat value
    const sorted = [...teamIds].sort((a, b) => {
      const va = (teamStats[a] as Record<string, number>)?.[cat] ?? 0;
      const vb = (teamStats[b] as Record<string, number>)?.[cat] ?? 0;
      return higher ? vb - va : va - vb; // Descending for "higher is better", ascending otherwise
    });

    // Assign ranking points (handle ties by averaging)
    let rank = 1;
    let i = 0;
    while (i < sorted.length) {
      // Find tied group
      let j = i;
      const val = (teamStats[sorted[i]] as Record<string, number>)?.[cat] ?? 0;
      while (j < sorted.length && ((teamStats[sorted[j]] as Record<string, number>)?.[cat] ?? 0) === val) {
        j++;
      }

      // Average the ranking points for the tied group
      // Points go from numTeams (1st) down to 1 (last)
      let totalPoints = 0;
      for (let k = i; k < j; k++) {
        totalPoints += numTeams - k; // numTeams for 1st, numTeams-1 for 2nd, etc.
      }
      const avgPoints = totalPoints / (j - i);

      for (let k = i; k < j; k++) {
        const teamId = sorted[k];
        result[teamId].rotoPoints += avgPoints;
        result[teamId].categoryRanks[cat] = avgPoints;
      }

      rank += (j - i);
      i = j;
    }
  }

  return result;
}

/**
 * Calculate total season points standings (for Total Points / Points Per Game formats).
 * Simple accumulation - no matchups needed.
 *
 * @param teamTotalPoints - Map of teamId -> total fantasy points
 * @param teamGamesPlayed - Map of teamId -> games played (for PPG format)
 * @returns Sorted array of { teamId, totalPoints, gamesPlayed, ppg }
 */
export function calculateSeasonPointsStandings(
  teamTotalPoints: Record<string, number>,
  teamGamesPlayed?: Record<string, number>
): Array<{ teamId: string; totalPoints: number; gamesPlayed: number; ppg: number }> {
  return Object.entries(teamTotalPoints)
    .map(([teamId, totalPoints]) => {
      const gp = teamGamesPlayed?.[teamId] ?? 0;
      return {
        teamId,
        totalPoints,
        gamesPlayed: gp,
        ppg: gp > 0 ? totalPoints / gp : 0,
      };
    })
    .sort((a, b) => b.totalPoints - a.totalPoints);
}

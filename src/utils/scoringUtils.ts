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
 * These are the standard fantasy hockey point values
 */
export const DEFAULT_SCORING: ScoringSettings = {
  skater: {
    goals: 3,
    assists: 2,
    power_play_points: 1,
    short_handed_points: 2,
    shots_on_goal: 0.4,
    blocks: 0.5,
    hits: 0.2,
    penalty_minutes: 0.5
  },
  goalie: {
    wins: 4,
    shutouts: 3,
    saves: 0.2,
    goals_against: -1
  }
};

/**
 * Centralized scoring calculator
 * Provides consistent point calculations and display formatting across the app
 */
export class ScoringCalculator {
  private settings: ScoringSettings;

  constructor(settings?: ScoringSettings | any) {
    // Handle both ScoringSettings interface and raw league.scoring_settings objects
    this.settings = settings || DEFAULT_SCORING;
  }

  /**
   * Calculate fantasy points for a player's stats
   * Handles both skater and goalie stats with proper type detection
   * 
   * @param stats - Player stats object (supports multiple field name variations)
   * @param isGoalie - True for goalie stats, false for skater stats
   * @returns Total fantasy points calculated
   */
  calculatePoints(stats: any, isGoalie: boolean): number {
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
  getStatBreakdown(stats: any, isGoalie: boolean): Record<string, { count: number; points: number; logic: string }> {
    if (!stats) return {};

    if (isGoalie) {
      const breakdown: Record<string, any> = {};
      
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
      const breakdown: Record<string, any> = {};
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
export function extractScoringSettings(league: any): ScoringSettings {
  return league?.scoring_settings || DEFAULT_SCORING;
}

/**
 * Create a ScoringCalculator instance from a league object
 * Convenience method for common use case
 * 
 * @param league - League object with optional scoring_settings
 * @returns New ScoringCalculator instance
 */
export function createScorerFromLeague(league: any): ScoringCalculator {
  return new ScoringCalculator(extractScoringSettings(league));
}

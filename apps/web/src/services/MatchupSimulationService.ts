/**
 * MatchupSimulationService
 *
 * Frontend service for accessing Monte Carlo matchup simulation results.
 * Reads from the matchup_simulations table populated by the Python simulation engine.
 *
 * Provides:
 * - Win probability with confidence intervals
 * - Point projection distributions (mean ± std)
 * - Tail risk probabilities (blowout win/loss)
 * - Brier score calibration tracking
 *
 * Architecture:
 * - Python pipeline (simulate_matchups.py) runs simulations and writes to Supabase
 * - This service reads results and exposes them to React components
 * - Uses RPC functions for optimized queries with RLS
 */

import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';

// ============================================================================
// TYPES
// ============================================================================

export interface MatchupSimulation {
  /** P(team1 wins), 0-1 */
  winProbability: number;
  /** P(team1 loses), 0-1 */
  lossProbability: number;
  /** P(tie), 0-1 */
  tieProbability: number;
  /** Mean projected points for team1 */
  team1Projected: number;
  /** Mean projected points for team2 */
  team2Projected: number;
  /** Standard deviation of team1 projections */
  team1Std: number;
  /** Standard deviation of team2 projections */
  team2Std: number;
  /** Expected margin (positive = team1 favored) */
  marginMean: number;
  /** Margin standard deviation */
  marginStd: number;
  /** P(team1 wins by 20+) */
  pBlowoutWin: number;
  /** P(team1 loses by 20+) */
  pBlowoutLoss: number;
  /** Number of simulations run */
  nSims: number;
  /** When the simulation was last run */
  simulatedAt: string;
  /** 95% confidence interval on win probability */
  ci95: [number, number];
  /** Point distribution percentiles for team1 */
  percentiles: {
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
}

export interface BrierScore {
  /** Overall Brier score (0 = perfect, 0.25 = no skill) */
  overallBrier: number | null;
  /** Total number of predictions evaluated */
  totalPredictions: number;
  /** Rating: excellent / good / adequate / poor / no_skill / pending */
  rating: string;
  /** Weekly breakdown */
  weeklyScores: Array<{
    week: number;
    brierScore: number;
    nMatchups: number;
    rating: string;
  }>;
}

// ============================================================================
// SERVICE
// ============================================================================

export class MatchupSimulationService {
  /**
   * Get simulation results for a specific matchup.
   *
   * @param matchupId - The matchup UUID
   * @returns MatchupSimulation or null if not yet simulated
   */
  static async getSimulation(matchupId: string): Promise<MatchupSimulation | null> {
    try {
      const { data, error } = await supabase
        .rpc('get_matchup_simulation', { p_matchup_id: matchupId });

      if (error) {
        logger.error('[MatchupSimulationService] RPC error:', error.message);
        return null;
      }

      if (!data || data.length === 0) {
        return null;
      }

      const row = data[0];
      const details = row.simulation_details || {};

      return {
        winProbability: Number(row.win_probability),
        lossProbability: Number(row.loss_probability),
        tieProbability: Number(row.tie_probability),
        team1Projected: Number(row.team1_projected),
        team2Projected: Number(row.team2_projected),
        team1Std: Number(row.team1_std),
        team2Std: Number(row.team2_std),
        marginMean: Number(row.margin_mean),
        marginStd: Number(row.margin_std),
        pBlowoutWin: Number(row.p_blowout_win),
        pBlowoutLoss: Number(row.p_blowout_loss),
        nSims: Number(row.n_sims),
        simulatedAt: row.simulated_at,
        ci95: details.ci_95 || [0, 1],
        percentiles: details.percentiles || { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
      };
    } catch (err) {
      logger.error('[MatchupSimulationService] Error fetching simulation:', err);
      return null;
    }
  }

  /**
   * Get simulation results for all matchups in a league's current week.
   * Falls back to direct table query if RPC is not available.
   *
   * @param leagueId - The league UUID
   * @param weekNumber - The fantasy week number
   */
  static async getLeagueSimulations(
    leagueId: string,
    weekNumber: number
  ): Promise<MatchupSimulation[]> {
    try {
      const { data, error } = await supabase
        .from('matchup_simulations')
        .select('*')
        .eq('league_id', leagueId)
        .eq('week_number', weekNumber)
        .order('simulated_at', { ascending: false });

      if (error) {
        logger.error('[MatchupSimulationService] Query error:', error.message);
        return [];
      }

      return (data || []).map((row: Record<string, unknown>) => {
        const details = (row.simulation_details || {}) as Record<string, unknown>;
        return {
          winProbability: Number(row.win_probability),
          lossProbability: Number(row.loss_probability),
          tieProbability: Number(row.tie_probability),
          team1Projected: Number(row.team1_projected),
          team2Projected: Number(row.team2_projected),
          team1Std: Number(row.team1_std),
          team2Std: Number(row.team2_std),
          marginMean: Number(row.margin_mean),
          marginStd: Number(row.margin_std),
          pBlowoutWin: Number(row.p_blowout_win),
          pBlowoutLoss: Number(row.p_blowout_loss),
          nSims: Number(row.n_sims),
          simulatedAt: row.simulated_at as string,
          ci95: (details.ci_95 || [0, 1]) as [number, number],
          percentiles: (details.percentiles || { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 }) as MatchupSimulation['percentiles'],
        };
      });
    } catch (err) {
      logger.error('[MatchupSimulationService] Error fetching league simulations:', err);
      return [];
    }
  }

  /**
   * Get the Brier score calibration data for a league.
   *
   * @param leagueId - The league UUID
   * @param season - NHL season (default: current)
   */
  static async getBrierScore(
    leagueId: string,
    season: number = 2025
  ): Promise<BrierScore | null> {
    try {
      const { data, error } = await supabase
        .rpc('get_league_brier_score', {
          p_league_id: leagueId,
          p_season: season,
        });

      if (error) {
        logger.error('[MatchupSimulationService] Brier RPC error:', error.message);
        return null;
      }

      if (!data || data.length === 0) {
        return null;
      }

      const row = data[0];
      return {
        overallBrier: row.overall_brier ? Number(row.overall_brier) : null,
        totalPredictions: Number(row.total_predictions),
        rating: row.rating || 'pending',
        weeklyScores: (row.weekly_scores || []).map((w: Record<string, unknown>) => ({
          week: Number(w.week),
          brierScore: Number(w.brier_score),
          nMatchups: Number(w.n_matchups),
          rating: w.rating as string,
        })),
      };
    } catch (err) {
      logger.error('[MatchupSimulationService] Error fetching Brier score:', err);
      return null;
    }
  }

  /**
   * Check if simulation data is stale (older than threshold).
   * Used to decide whether to show "updating..." indicator.
   */
  static isStale(simulation: MatchupSimulation, maxAgeMinutes: number = 60): boolean {
    const simulatedAt = new Date(simulation.simulatedAt);
    const now = new Date();
    const ageMs = now.getTime() - simulatedAt.getTime();
    return ageMs > maxAgeMinutes * 60 * 1000;
  }

  /**
   * Format win probability for display.
   * Returns string like "64.2%" or "50/50"
   */
  static formatWinProbability(prob: number): string {
    if (Math.abs(prob - 0.5) < 0.005) {
      return '50/50';
    }
    return `${(prob * 100).toFixed(1)}%`;
  }

  /**
   * Get confidence level descriptor.
   * Maps win probability to human-readable confidence.
   */
  static getConfidenceLevel(prob: number): {
    label: string;
    color: string;
  } {
    const p = Math.max(prob, 1 - prob); // Always use the higher side
    if (p >= 0.85) return { label: 'Very High', color: 'text-green-500' };
    if (p >= 0.70) return { label: 'High', color: 'text-emerald-500' };
    if (p >= 0.60) return { label: 'Moderate', color: 'text-amber-500' };
    if (p >= 0.55) return { label: 'Slight', color: 'text-orange-500' };
    return { label: 'Toss-Up', color: 'text-red-500' };
  }

  /**
   * Get Brier score quality descriptor.
   */
  static getBrierRating(score: number | null): {
    label: string;
    description: string;
    color: string;
  } {
    if (score === null) {
      return { label: 'Pending', description: 'Not enough data yet', color: 'text-gray-400' };
    }
    if (score < 0.10) {
      return { label: 'Excellent', description: 'Better than most election forecasters', color: 'text-green-500' };
    }
    if (score < 0.15) {
      return { label: 'Good', description: 'Strong predictive calibration', color: 'text-emerald-500' };
    }
    if (score < 0.20) {
      return { label: 'Adequate', description: 'Useful predictions', color: 'text-amber-500' };
    }
    if (score < 0.25) {
      return { label: 'Poor', description: 'Minimal predictive value', color: 'text-orange-500' };
    }
    return { label: 'No Skill', description: 'Worse than coin flip', color: 'text-red-500' };
  }
}

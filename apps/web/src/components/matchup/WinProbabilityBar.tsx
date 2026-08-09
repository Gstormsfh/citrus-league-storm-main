/**
 * WinProbabilityBar
 *
 * Monte Carlo-powered win probability display for fantasy matchups.
 * Shows simulated win probability with confidence intervals, tail risk,
 * and Brier score calibration quality.
 *
 * When simulation data is available (from matchup_simulations table),
 * displays the full distribution. Falls back to projection-based estimate
 * when simulations haven't been run yet.
 *
 * Inspired by institutional quant desk methodology:
 * - Probability displayed with 95% confidence interval
 * - Tail risk indicators (blowout win/loss probability)
 * - Brier score calibration badge
 * - Visual confidence level indicator
 */

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Activity, BarChart3 } from "lucide-react";
import {
  MatchupSimulationService,
  MatchupSimulation,
} from "@/services/MatchupSimulationService";

interface WinProbabilityBarProps {
  /** Matchup UUID for fetching simulation data */
  matchupId?: string;
  /** Fallback: current score-based win probability (0-100) */
  fallbackWinProbability: number;
  /** Team 1 (user) projected points */
  team1Projected?: number;
  /** Team 2 (opponent) projected points */
  team2Projected?: number;
  /** Compact mode for mobile */
  compact?: boolean;
}

export const WinProbabilityBar = ({
  matchupId,
  fallbackWinProbability,
  team1Projected = 0,
  team2Projected = 0,
  compact = false,
}: WinProbabilityBarProps) => {
  const [simulation, setSimulation] = useState<MatchupSimulation | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!matchupId) return;

    let cancelled = false;
    setLoading(true);

    MatchupSimulationService.getSimulation(matchupId)
      .then((result) => {
        if (!cancelled) {
          setSimulation(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [matchupId]);

  // Use simulation data if available, otherwise fallback
  const hasSimulation = simulation !== null;
  const winProb = hasSimulation
    ? simulation.winProbability * 100
    : fallbackWinProbability;

  const displayProb = Math.round(winProb);
  const isStale = hasSimulation
    ? MatchupSimulationService.isStale(simulation)
    : false;

  const confidence = MatchupSimulationService.getConfidenceLevel(
    winProb / 100
  );

  // ============================================================================
  // COMPACT MODE (Mobile)
  // ============================================================================
  if (compact) {
    return (
      <div className="mt-2">
        <div className="flex justify-between items-center mb-1">
          <div className="flex items-center gap-1">
            <span className="font-varsity text-[9px] text-citrus-forest uppercase">
              Win Prob
            </span>
            {hasSimulation && (
              <Activity className="w-2.5 h-2.5 text-citrus-sage opacity-60" />
            )}
          </div>
          <span className="font-display font-bold text-xs text-citrus-forest">
            {displayProb}%
          </span>
        </div>
        <div className="h-3 rounded-full overflow-hidden border border-citrus-forest bg-[#E8EED9]/50">
          <div className="flex h-full transition-all duration-700 ease-out">
            <div
              className="bg-citrus-sage"
              style={{ width: `${displayProb}%` }}
            />
            <div className="bg-citrus-peach flex-grow" />
          </div>
        </div>
        {/* Compact simulation details */}
        {hasSimulation && (
          <div className="flex justify-between mt-1">
            <span className="text-[8px] font-mono text-citrus-charcoal/50">
              {simulation.team1Projected.toFixed(1)} vs{" "}
              {simulation.team2Projected.toFixed(1)} proj
            </span>
            <span className="text-[8px] font-mono text-citrus-charcoal/50">
              {simulation.nSims.toLocaleString()} sims
            </span>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // FULL MODE (Desktop)
  // ============================================================================
  return (
    <div className="px-6 pb-6">
      {/* Header row */}
      <div className="mb-2 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="font-varsity text-xs text-citrus-forest uppercase">
            Win Probability
          </span>
          {hasSimulation && (
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-mono border ${confidence.color} border-current/20 bg-current/5`}
            >
              <BarChart3 className="w-2.5 h-2.5" />
              {confidence.label}
            </span>
          )}
          {isStale && (
            <span className="text-[9px] font-mono text-citrus-charcoal/40">
              updating...
            </span>
          )}
        </div>
        <span className="font-display font-bold text-citrus-forest">
          {displayProb}%
        </span>
      </div>

      {/* Win probability bar */}
      <div className="h-8 rounded-full overflow-hidden border-3 border-citrus-forest bg-[#E8EED9]/50 backdrop-blur-sm shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]">
        <div className="flex h-full transition-all duration-700 ease-out">
          <div
            className="bg-citrus-sage relative"
            style={{ width: `${displayProb}%` }}
          >
            {/* Win percentage label inside the bar */}
            {displayProb > 15 && (
              <span className="absolute inset-0 flex items-center justify-center font-varsity text-xs text-[#E8EED9]">
                {displayProb}%
              </span>
            )}
          </div>
          <div
            className="bg-citrus-peach relative flex-grow"
            style={{ width: `${100 - displayProb}%` }}
          >
            {/* Loss percentage label */}
            {100 - displayProb > 15 && (
              <span className="absolute inset-0 flex items-center justify-center font-varsity text-xs text-[#E8EED9]">
                {100 - displayProb}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Simulation details (only shown when Monte Carlo data available) */}
      {hasSimulation && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {/* Projected Points */}
          <div className="bg-[#E8EED9]/40 rounded-lg px-2.5 py-1.5 border border-citrus-sage/20">
            <div className="text-[9px] font-varsity text-citrus-charcoal/60 uppercase">
              Projected
            </div>
            <div className="font-mono text-xs text-citrus-forest">
              <span className="font-bold">
                {simulation.team1Projected.toFixed(1)}
              </span>
              <span className="text-citrus-charcoal/40 mx-1">vs</span>
              <span className="font-bold">
                {simulation.team2Projected.toFixed(1)}
              </span>
            </div>
            <div className="text-[8px] font-mono text-citrus-charcoal/40">
              ±{simulation.team1Std.toFixed(1)} / ±{simulation.team2Std.toFixed(1)}
            </div>
          </div>

          {/* Margin */}
          <div className="bg-[#E8EED9]/40 rounded-lg px-2.5 py-1.5 border border-citrus-sage/20">
            <div className="text-[9px] font-varsity text-citrus-charcoal/60 uppercase">
              Margin
            </div>
            <div className="flex items-center gap-1">
              {simulation.marginMean > 0 ? (
                <TrendingUp className="w-3 h-3 text-citrus-sage" aria-hidden="true" />
              ) : (
                <TrendingDown className="w-3 h-3 text-citrus-peach" />
              )}
              <span className="font-mono text-xs font-bold text-citrus-forest">
                {simulation.marginMean > 0 ? "+" : ""}
                {simulation.marginMean.toFixed(1)}
              </span>
            </div>
            <div className="text-[8px] font-mono text-citrus-charcoal/40">
              ±{simulation.marginStd.toFixed(1)} std
            </div>
          </div>

          {/* Tail Risk */}
          <div className="bg-[#E8EED9]/40 rounded-lg px-2.5 py-1.5 border border-citrus-sage/20">
            <div className="text-[9px] font-varsity text-citrus-charcoal/60 uppercase">
              Tail Risk
            </div>
            <div className="font-mono text-[10px] text-citrus-forest space-y-0.5">
              <div className="flex justify-between">
                <span className="text-citrus-charcoal/50">Win 20+</span>
                <span className="font-bold">
                  {(simulation.pBlowoutWin * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-citrus-charcoal/50">Lose 20+</span>
                <span className="font-bold">
                  {(simulation.pBlowoutLoss * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Simulation metadata */}
      {hasSimulation && (
        <div className="mt-2 flex justify-between items-center">
          <span className="text-[8px] font-mono text-citrus-charcoal/30">
            95% CI: ({(simulation.ci95[0] * 100).toFixed(1)}%,{" "}
            {(simulation.ci95[1] * 100).toFixed(1)}%)
          </span>
          <span className="text-[8px] font-mono text-citrus-charcoal/30">
            {simulation.nSims.toLocaleString()} Monte Carlo simulations
          </span>
        </div>
      )}
    </div>
  );
};

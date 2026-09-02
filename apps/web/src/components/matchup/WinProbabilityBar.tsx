/**
 * WinProbabilityBar — the "Win chance" bar under the matchup scores.
 *
 * Two sources, one contract:
 *
 * 1. `fallbackWinProbability` (0–100) — computed by the caller from
 *    `utils/winProbability` (expected finals + Φ(margin/σ)). This is what
 *    renders on every load: the simulation table has no scheduled producer
 *    (data-pipeline/scoring/simulate_matchups.py is a manual run).
 * 2. A `matchup_simulations` row for `matchupId`, when one exists AND is
 *    recent. The Monte Carlo result overrides the formula and unlocks the
 *    distribution details (CI, tail risk, sims count).
 *
 * The bar itself never clamps or reinterprets the number it is given: the
 * sage segment's width IS the probability (locked by WinProbabilityBar.test).
 *
 * PERSPECTIVE. The simulation row is stored from team1's point of view
 * (`win_probability` = P(team1 wins), see the matchup_simulations
 * migration). The bar always speaks for the LEFT team, which is team2
 * whenever the viewer's team happens to be team2, so the caller passes
 * `simulationPerspective` and the row is mirrored here. Before this the
 * bar would have shown a team2 viewer their OPPONENT's win chance.
 */

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Activity, BarChart3 } from "lucide-react";
import {
  MatchupSimulationService,
  MatchupSimulation,
} from "@/services/MatchupSimulationService";

/**
 * A simulation older than this is ignored in favour of the live formula.
 * The nightly pipeline cadence is 24h; a row from last Tuesday's manual run
 * would otherwise silently freeze the bar for the rest of the week.
 */
export const SIMULATION_MAX_AGE_MINUTES = 24 * 60;

interface WinProbabilityBarProps {
  /** Matchup UUID for fetching simulation data */
  matchupId?: string;
  /** Fallback: formula-based win probability for the LEFT team (0-100) */
  fallbackWinProbability: number;
  /** Team 1 (user) projected points */
  team1Projected?: number;
  /** Team 2 (opponent) projected points */
  team2Projected?: number;
  /**
   * Which side of the stored simulation row the LEFT team is. Rows are
   * written for team1; pass 'team2' when the left team is the matchup's
   * team2 and the row is mirrored. Defaults to 'team1'.
   */
  simulationPerspective?: 'team1' | 'team2';
  /** Compact mode for mobile */
  compact?: boolean;
}

/** Mirror a team1-perspective simulation row so it speaks for team2. */
const mirrorSimulation = (sim: MatchupSimulation): MatchupSimulation => ({
  ...sim,
  winProbability: sim.lossProbability,
  lossProbability: sim.winProbability,
  team1Projected: sim.team2Projected,
  team2Projected: sim.team1Projected,
  team1Std: sim.team2Std,
  team2Std: sim.team1Std,
  marginMean: -sim.marginMean,
  pBlowoutWin: sim.pBlowoutLoss,
  pBlowoutLoss: sim.pBlowoutWin,
  ci95: [1 - sim.ci95[1], 1 - sim.ci95[0]],
});

export const WinProbabilityBar = ({
  matchupId,
  fallbackWinProbability,
  team1Projected = 0,
  team2Projected = 0,
  simulationPerspective = 'team1',
  compact = false,
}: WinProbabilityBarProps) => {
  const [fetchedSimulation, setFetchedSimulation] = useState<MatchupSimulation | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!matchupId) return;

    let cancelled = false;
    setLoading(true);

    MatchupSimulationService.getSimulation(matchupId)
      .then((result) => {
        if (!cancelled) {
          setFetchedSimulation(result);
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

  // A simulation row overrides the formula only while it is fresh enough
  // to trust; otherwise the live formula is the better answer.
  const currentSimulation =
    fetchedSimulation && !MatchupSimulationService.isStale(fetchedSimulation, SIMULATION_MAX_AGE_MINUTES)
      ? fetchedSimulation
      : null;
  const simulation = currentSimulation
    ? (simulationPerspective === 'team2' ? mirrorSimulation(currentSimulation) : currentSimulation)
    : null;

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
            <span className="font-varsity text-[9px] text-pastel-cream uppercase">
              Win chance
            </span>
            {hasSimulation && (
              <Activity className="w-2.5 h-2.5 text-pastel-sage opacity-60" />
            )}
          </div>
          <span className="font-display font-bold text-xs text-pastel-cream">
            {displayProb}%
          </span>
        </div>
        <div className="h-3 rounded-full overflow-hidden border border-white/10 bg-[#1A2A20]">
          <div className="flex h-full transition-all duration-700 ease-out">
            <div
              className="bg-pastel-sage"
              style={{ width: `${displayProb}%` }}
            />
            <div className="bg-pastel-sage/15 flex-grow" />
          </div>
        </div>
        {/* Compact simulation details */}
        {hasSimulation && (
          <div className="flex justify-between mt-1">
            <span className="text-[8px] font-mono text-white/55">
              {simulation.team1Projected.toFixed(1)} vs{" "}
              {simulation.team2Projected.toFixed(1)} proj
            </span>
            <span className="text-[8px] font-mono text-white/55">
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
          <span className="font-varsity text-xs text-pastel-cream uppercase">
            Win chance
          </span>
          {hasSimulation && (
            <span
              // border-current/20 and bg-current/5 compiled to nothing: Tailwind
              // cannot build an alpha channel from the `currentColor` keyword, so
              // this badge had no border colour and no fill. color-mix keeps the
              // original intent — both derived from whatever ${confidence.color}
              // sets — and is a real declaration rather than a dead class.
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-mono border ${confidence.color}`}
              style={{
                borderColor: 'color-mix(in srgb, currentColor 20%, transparent)',
                backgroundColor: 'color-mix(in srgb, currentColor 5%, transparent)',
              }}
            >
              <BarChart3 className="w-2.5 h-2.5" />
              {confidence.label}
            </span>
          )}
          {isStale && (
            <span className="text-[9px] font-mono text-white/55">
              updating...
            </span>
          )}
        </div>
        <span className="font-display font-bold text-pastel-cream">
          {displayProb}%
        </span>
      </div>

      {/* Win probability bar */}
      <div className="h-8 rounded-full overflow-hidden border-3 border-white/10 bg-[#1A2A20] backdrop-blur-sm shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]">
        <div className="flex h-full transition-all duration-700 ease-out">
          <div
            className="bg-pastel-sage relative"
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
            className="bg-pastel-sage/15 relative flex-grow"
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
          <div className="bg-[#1A2A20] rounded-lg px-2.5 py-1.5 border border-pastel-sage/20">
            <div className="text-[9px] font-varsity text-white/60 uppercase">
              Projected
            </div>
            <div className="font-mono text-xs text-pastel-cream">
              <span className="font-bold">
                {simulation.team1Projected.toFixed(1)}
              </span>
              <span className="text-white/55 mx-1">vs</span>
              <span className="font-bold">
                {simulation.team2Projected.toFixed(1)}
              </span>
            </div>
            <div className="text-[8px] font-mono text-white/55">
              ±{simulation.team1Std.toFixed(1)} / ±{simulation.team2Std.toFixed(1)}
            </div>
          </div>

          {/* Margin */}
          <div className="bg-[#1A2A20] rounded-lg px-2.5 py-1.5 border border-pastel-sage/20">
            <div className="text-[9px] font-varsity text-white/60 uppercase">
              Margin
            </div>
            <div className="flex items-center gap-1">
              {simulation.marginMean > 0 ? (
                <TrendingUp className="w-3 h-3 text-pastel-sage" aria-hidden="true" />
              ) : (
                <TrendingDown className="w-3 h-3 text-pastel-cream" />
              )}
              <span className="font-mono text-xs font-bold text-pastel-cream">
                {simulation.marginMean > 0 ? "+" : ""}
                {simulation.marginMean.toFixed(1)}
              </span>
            </div>
            <div className="text-[8px] font-mono text-white/55">
              ±{simulation.marginStd.toFixed(1)} std
            </div>
          </div>

          {/* Tail Risk */}
          <div className="bg-[#1A2A20] rounded-lg px-2.5 py-1.5 border border-pastel-sage/20">
            <div className="text-[9px] font-varsity text-white/60 uppercase">
              Tail Risk
            </div>
            <div className="font-mono text-[10px] text-pastel-cream space-y-0.5">
              <div className="flex justify-between">
                <span className="text-white/55">Win 20+</span>
                <span className="font-bold">
                  {(simulation.pBlowoutWin * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/55">Lose 20+</span>
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
          <span className="text-[8px] font-mono text-white/55">
            95% CI: ({(simulation.ci95[0] * 100).toFixed(1)}%,{" "}
            {(simulation.ci95[1] * 100).toFixed(1)}%)
          </span>
          <span className="text-[8px] font-mono text-white/55">
            {simulation.nSims.toLocaleString()} Monte Carlo simulations
          </span>
        </div>
      )}
    </div>
  );
};

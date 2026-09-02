import { useEffect, useRef, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { MatchupPlayer } from "./types";
import { MatchupPositionGroup } from "./MatchupPositionGroup";
import { organizeMatchupData } from "./matchupUtils";
import { ScoringCalculator, ScoringSettings } from "@/utils/scoringUtils";
import { NEUTRAL_CHIP, POSITION_CHIP_BASE } from "@/components/roster/positionChip";

/**
 * Bench visibility is a per-viewer preference (2026-09-01). A hockey bench is
 * 4–6 rows × 2 columns of players whose points do not count; on a phone that
 * is a full screen of noise under the lineup. Collapsed by default below the
 * lg breakpoint, open on desktop, and whichever way the viewer last left it
 * wins on every later visit. localStorage can be absent (SSR), blocked
 * (Safari private mode throws on access), or full — every touch is guarded
 * and a failure simply means "use the default".
 */
export const BENCH_OPEN_STORAGE_KEY = 'citrus:matchup:bench-open';

const isMobileViewport = (): boolean =>
  typeof window !== 'undefined' && window.innerWidth < 1024;

const readBenchOpen = (): boolean => {
  try {
    const stored = window.localStorage.getItem(BENCH_OPEN_STORAGE_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    // Storage unavailable — fall through to the viewport default.
  }
  return !isMobileViewport();
};

const writeBenchOpen = (open: boolean): void => {
  try {
    window.localStorage.setItem(BENCH_OPEN_STORAGE_KEY, open ? '1' : '0');
  } catch {
    // Preference simply does not persist this session.
  }
};

interface MatchupComparisonProps {
  userStarters: MatchupPlayer[];
  opponentStarters: MatchupPlayer[];
  userBench?: MatchupPlayer[];
  opponentBench?: MatchupPlayer[];
  userSlotAssignments: Record<string, string>;
  opponentSlotAssignments: Record<string, string>;
  onPlayerClick?: (player: MatchupPlayer) => void;
  selectedDate?: string | null; // Optional: show stats for specific date
  dailyStatsMap?: Map<number, { daily_total_points?: number; [key: string]: unknown }>; // Optional: daily stats map for the selected date
  // Callback to report calculated totals back to parent (for WeeklySchedule sync)
  onTotalsCalculated?: (userTotal: number, opponentTotal: number, date?: string) => void;
  // For weekly view: use calculated daily totals (same as weekly selector)
  calculatedDailyTotals?: Map<string, { myTotal: number; oppTotal: number }>;
  // Pre-calculated weekly totals from parent (ensures consistency with scorecard)
  weeklyUserTotal?: number;
  weeklyOpponentTotal?: number;
  // League scoring settings for dynamic calculations
  scoringSettings?: ScoringSettings;
  // Team identity for the sticky column header (2026-08-25). Before this,
  // team names appeared ONLY in the ScoreCard at the top of the page — scroll
  // down into the lineup and both columns were anonymous, so "which side is
  // mine" had to be remembered rather than read.
  userTeamName?: string;
  opponentTeamName?: string;
  /**
   * True only when the LEFT column is the viewer's own team. False when
   * viewing another matchup from the league dropdown — see the note on
   * ScoreCard's identically-named prop.
   */
  isOwnTeam?: boolean;
}

export const MatchupComparison = ({
  userStarters,
  opponentStarters,
  userBench = [],
  opponentBench = [],
  userSlotAssignments,
  opponentSlotAssignments,
  onPlayerClick,
  selectedDate,
  dailyStatsMap,
  onTotalsCalculated,
  calculatedDailyTotals,
  weeklyUserTotal,
  weeklyOpponentTotal,
  scoringSettings,
  userTeamName,
  opponentTeamName,
  isOwnTeam = false
}: MatchupComparisonProps) => {
  // Create scoring calculator with league-specific settings
  const scorer = useMemo(() => new ScoringCalculator(scoringSettings), [scoringSettings]);
  // Organize players by slot order (flattened, no position grouping)
  const positionGroups = organizeMatchupData(
    userStarters,
    opponentStarters,
    userSlotAssignments,
    opponentSlotAssignments
  );

  // Flatten all players into one continuous list, tracking which are UTIL
  // slots and which slot position each row is (so an empty row still knows
  // what it is an empty row OF).
  const allUserPlayers: (MatchupPlayer | null)[] = [];
  const allOpponentPlayers: (MatchupPlayer | null)[] = [];
  const isUtilSlot: boolean[] = [];
  const slotPositions: string[] = [];

  positionGroups.forEach(group => {
    const isUtil = group.position === 'Util';
    const maxLength = Math.max(group.userPlayers.length, group.opponentPlayers.length);
    for (let i = 0; i < maxLength; i++) {
      isUtilSlot.push(isUtil);
      slotPositions.push(group.position);
    }
    allUserPlayers.push(...group.userPlayers);
    allOpponentPlayers.push(...group.opponentPlayers);
  });

  // Bench: rows, not players — the section hides/shows both columns at once.
  const benchRows = Math.max(userBench.length, opponentBench.length);
  const [benchOpen, setBenchOpen] = useState<boolean>(readBenchOpen);
  const toggleBench = () => {
    const next = !benchOpen;
    setBenchOpen(next);
    writeBenchOpen(next);
  };

  // Calculate daily contribution - handles dropped players with same fallback as PlayerCard
  const isShowingDailyView = selectedDate !== null && selectedDate !== undefined;
  
  // For weekly view: Use pre-calculated totals from parent (same as scorecard)
  // This ensures consistency and fixes demo league 0.0 issue
  const weeklyTotalFromDaily = useMemo(() => {
    // Priority 1: Use passed weekly totals (most reliable, matches scorecard exactly)
    // These come from sum of calculatedDailyTotals or myTeamPoints - always use them when provided
    if (!isShowingDailyView && weeklyUserTotal !== undefined && weeklyOpponentTotal !== undefined) {
      return { myTotal: weeklyUserTotal, oppTotal: weeklyOpponentTotal };
    }
    
    // Priority 2: Calculate from calculatedDailyTotals (same as weekly selector)
    if (!isShowingDailyView && calculatedDailyTotals && calculatedDailyTotals.size >= 7) {
      let myTotal = 0;
      let oppTotal = 0;
      calculatedDailyTotals.forEach((totals) => {
        myTotal += totals.myTotal;
        oppTotal += totals.oppTotal;
      });
      return { myTotal, oppTotal };
    }
    
    return null;
  }, [isShowingDailyView, calculatedDailyTotals, weeklyUserTotal, weeklyOpponentTotal]);
  
  // For weekly view, use weeklyTotalFromDaily if available (even if 0 - it's the calculated value)
  // For daily view, calculate from players
  const userTotal = (!isShowingDailyView && weeklyTotalFromDaily) 
    ? weeklyTotalFromDaily.myTotal 
    : allUserPlayers.reduce((sum, player) => {
    if (!player) return sum;
    if (isShowingDailyView) {
      // For dropped players, use the same fallback chain as PlayerCard
      if (player.wasDropped) {
        // Try dailyStatsMap first
        if (dailyStatsMap) {
          const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
          const stats = dailyStatsMap.get(playerId);
          if (stats?.daily_total_points !== undefined) {
            return sum + stats.daily_total_points;
          }
        }
        // Fallback to player properties (total_points = their daily contribution since dropped mid-game)
        return sum + (player.daily_total_points ?? player.total_points ?? player.points ?? 0);
      }
      // Non-dropped: use daily_total_points from dailyStatsMap (single source of truth for daily view)
      // First check dailyStatsMap (most reliable for selected date)
      if (dailyStatsMap) {
        const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
        const stats = dailyStatsMap.get(playerId);
        if (stats?.daily_total_points !== undefined && stats.daily_total_points !== null) {
          return sum + stats.daily_total_points;
        }
      }
      // Fallback to player.daily_total_points (set by enrichment)
      if (player.daily_total_points !== undefined && player.daily_total_points !== null) {
        return sum + player.daily_total_points;
      }
      // If no daily stats available, return 0 (don't use weekly totals for daily view)
      return sum + 0;
    }
    // Weekly view: prefer total_points (matchup week points) over points (season points)
    // total_points is specifically set for matchup week, so it's more reliable
    // This ensures demo leagues show correct weekly totals
    // Also try to calculate from matchupStats if total_points is missing or 0
    if (player.total_points !== undefined && player.total_points !== null && player.total_points > 0) {
      return sum + player.total_points;
    }
    // Fallback: try to calculate from matchupStats if available (even if total_points is 0)
    if (player.matchupStats) {
      const isGoalie = player.position === 'G' || player.position === 'Goalie';
      const calculatedPoints = scorer.calculatePoints(player.matchupStats, isGoalie);
      return sum + calculatedPoints; // Use matchup week stats with league scoring
    }
    // Last resort: For demo leagues, if no matchup stats, use season stats from player.stats
    // This is a fallback when matchup lines aren't populated yet
    if (player.stats) {
      const isGoalie = player.position === 'G' || player.position === 'Goalie';
      if (isGoalie && player.goalieStats) {
        const goaliePoints = scorer.calculatePoints(player.goalieStats, true);
        return sum + goaliePoints;
      } else if (!isGoalie) {
        // Calculate from season stats (approximation for demo when matchup stats unavailable)
        const skaterPoints = scorer.calculatePoints(player.stats, false);
        return sum + skaterPoints;
      }
    }
    // Final fallback: use total_points even if 0, or points (season), or 0
    return sum + (player.total_points ?? player.points ?? 0);
  }, 0);
  
  // For weekly view, use weeklyTotalFromDaily if available (even if 0 - it's the calculated value)
  // For daily view, calculate from players
  const opponentTotal = (!isShowingDailyView && weeklyTotalFromDaily) 
    ? weeklyTotalFromDaily.oppTotal 
    : allOpponentPlayers.reduce((sum, player) => {
    if (!player) return sum;
    if (isShowingDailyView) {
      // For dropped players, use the same fallback chain as PlayerCard
      if (player.wasDropped) {
        // Try dailyStatsMap first
        if (dailyStatsMap) {
          const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
          const stats = dailyStatsMap.get(playerId);
          if (stats?.daily_total_points !== undefined) {
            return sum + stats.daily_total_points;
          }
        }
        // Fallback to player properties (total_points = their daily contribution since dropped mid-game)
        return sum + (player.daily_total_points ?? player.total_points ?? player.points ?? 0);
      }
      // Non-dropped: use daily_total_points from dailyStatsMap (single source of truth for daily view)
      // First check dailyStatsMap (most reliable for selected date)
      if (dailyStatsMap) {
        const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
        const stats = dailyStatsMap.get(playerId);
        if (stats?.daily_total_points !== undefined && stats.daily_total_points !== null) {
          return sum + stats.daily_total_points;
        }
      }
      // Fallback to player.daily_total_points (set by enrichment)
      if (player.daily_total_points !== undefined && player.daily_total_points !== null) {
        return sum + player.daily_total_points;
      }
      // If no daily stats available, return 0 (don't use weekly totals for daily view)
      return sum + 0;
    }
    // Weekly view: prefer total_points (matchup week points) over points (season points)
    // total_points is specifically set for matchup week, so it's more reliable
    // This ensures demo leagues show correct weekly totals
    // Also try to calculate from matchupStats if total_points is missing or 0
    if (player.total_points !== undefined && player.total_points !== null && player.total_points > 0) {
      return sum + player.total_points;
    }
    // Fallback: try to calculate from matchupStats if available (even if total_points is 0)
    if (player.matchupStats) {
      const isGoalie = player.position === 'G' || player.position === 'Goalie';
      const calculatedPoints = scorer.calculatePoints(player.matchupStats, isGoalie);
      return sum + calculatedPoints; // Use matchup week stats with league scoring
    }
    // Last resort: For demo leagues, if no matchup stats, use season stats from player.stats
    // This is a fallback when matchup lines aren't populated yet
    if (player.stats) {
      const isGoalie = player.position === 'G' || player.position === 'Goalie';
      if (isGoalie && player.goalieStats) {
        const goaliePoints = scorer.calculatePoints(player.goalieStats, true);
        return sum + goaliePoints;
      } else if (!isGoalie) {
        // Calculate from season stats (approximation for demo when matchup stats unavailable)
        const skaterPoints = scorer.calculatePoints(player.stats, false);
        return sum + skaterPoints;
      }
    }
    // Final fallback: use total_points even if 0, or points (season), or 0
    return sum + (player.total_points ?? player.points ?? 0);
  }, 0);
  
  // Track previous values to prevent redundant callbacks
  const prevTotalsRef = useRef<{ user: number; opp: number; date: string | null } | null>(null);
  
  // Report calculated totals to parent (for WeeklySchedule synchronization)
  useEffect(() => {
    if (onTotalsCalculated && isShowingDailyView && selectedDate) {
      // Only call if values actually changed (prevent flicker)
      const prev = prevTotalsRef.current;
      if (!prev || 
          prev.date !== selectedDate ||
          Math.abs(prev.user - userTotal) >= 0.01 || 
          Math.abs(prev.opp - opponentTotal) >= 0.01) {
        
        onTotalsCalculated(userTotal, opponentTotal, selectedDate || undefined);
        prevTotalsRef.current = { user: userTotal, opp: opponentTotal, date: selectedDate };
      }
    }
  }, [userTotal, opponentTotal, isShowingDailyView, onTotalsCalculated, selectedDate]);

  return (
    <div className="w-full">
      {/* Sticky team header — the only place below the fold that answers
          "which column is mine". Mirrors the grid's 47%/6%/47% columns so
          each label sits over its own side. Orange + YOU on the left is the
          same identity signal used in Standings and the ScoreCard. */}
      {(userTeamName || opponentTeamName) && (
        <div className="matchup-team-header bg-[#1A2A20]/95 backdrop-blur-sm border-b border-white/10 mb-1">
          <div className="matchup-team-header-side matchup-team-header-user">
            {isOwnTeam && (
              <span className="inline-flex items-center bg-pastel-orange/20 text-pastel-orange-soft ring-1 ring-pastel-orange/40 rounded-md font-jbmono uppercase font-bold text-[8px] px-1 py-0 tracking-wide flex-shrink-0">
                You
              </span>
            )}
            <span
              className={`font-varsity text-[11px] md:text-xs uppercase truncate ${
                isOwnTeam ? 'text-pastel-orange-soft' : 'text-pastel-cream'
              }`}
            >
              {userTeamName || 'My Team'}
            </span>
          </div>
          <div className="matchup-team-header-center">
            <span className="font-mono text-[9px] text-white/55 uppercase">vs</span>
          </div>
          <div className="matchup-team-header-side matchup-team-header-opponent">
            <span className="font-varsity text-[11px] md:text-xs uppercase truncate text-pastel-cream">
              {opponentTeamName || 'Opponent'}
            </span>
          </div>
        </div>
      )}

      <div className="matchup-position-group">
        <MatchupPositionGroup
          userPlayers={allUserPlayers}
          opponentPlayers={allOpponentPlayers}
          isUtilSlot={isUtilSlot}
          slotPositions={slotPositions}
          onPlayerClick={onPlayerClick}
          selectedDate={selectedDate}
          dailyStatsMap={dailyStatsMap}
        />
      </div>

      {/* Total Points Row - Shows daily total when date selected, weekly otherwise */}
      <div className="matchup-total-row">
        <div className="matchup-total-card matchup-total-user">
          <div className="matchup-total-label">
            {isShowingDailyView ? 'Daily Total' : 'Total'}
          </div>
          <div className="matchup-total-score font-jbmono tabular-nums">{userTotal.toFixed(1)}</div>
        </div>
        <div className="matchup-center-column matchup-total-center">
          <span className="position-label">{isShowingDailyView ? 'DAY' : 'TOT'}</span>
          {/* Mobile: the same 32px chip the slot rows carry, neutral —
              a sum is not a position. Keeps the centre axis unbroken
              from the team header down through the total. */}
          <span className={cn('matchup-slot-chip lg:hidden', POSITION_CHIP_BASE, NEUTRAL_CHIP)} aria-hidden="true">
            {isShowingDailyView ? 'DAY' : 'TOT'}
          </span>
        </div>
        <div className="matchup-total-card matchup-total-opponent">
          <div className="matchup-total-label">
            {isShowingDailyView ? 'Daily Total' : 'Total'}
          </div>
          <div className="matchup-total-score font-jbmono tabular-nums">{opponentTotal.toFixed(1)}</div>
        </div>
      </div>

      {/* Bench Section — collapsible. Rows render only while open, so a
          collapsed bench costs nothing to keep on the page. */}
      {benchRows > 0 && (
        <section className="mt-6" data-testid="matchup-bench" data-open={benchOpen ? 'true' : 'false'}>
          <button
            type="button"
            onClick={toggleBench}
            aria-expanded={benchOpen}
            aria-controls="matchup-bench-rows"
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2.5 min-h-[44px] text-left',
              'bg-pastel-surface-tile border-y border-white/10',
              'focus-citrus transition-colors hover:bg-pastel-surface-high',
            )}
          >
            <span className="font-jbmono uppercase tracking-[0.22em] text-[10px] text-white/55">
              {`Bench (${benchRows})`}
            </span>
            {!benchOpen && (
              <span className="font-display text-[10px] text-white/55">
                Points do not count
              </span>
            )}
            <ChevronDown
              className={cn(
                'ml-auto h-4 w-4 text-white/55 transition-transform',
                benchOpen && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>
          {benchOpen && (
            <div id="matchup-bench-rows" className="matchup-position-group">
              <MatchupPositionGroup
                userPlayers={userBench}
                opponentPlayers={opponentBench}
                isUtilSlot={[]}
                isBench={true}
                onPlayerClick={onPlayerClick}
                selectedDate={selectedDate}
                dailyStatsMap={dailyStatsMap}
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
};


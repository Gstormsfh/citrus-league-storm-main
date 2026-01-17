import { useEffect, useRef, useMemo } from "react";
import { MatchupPlayer } from "./types";
import { MatchupPositionGroup } from "./MatchupPositionGroup";
import { organizeMatchupData } from "./matchupUtils";
import { ScoringCalculator, ScoringSettings } from "@/utils/scoringUtils";

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
  scoringSettings
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

  // Flatten all players into one continuous list, tracking which are UTIL slots
  const allUserPlayers: (MatchupPlayer | null)[] = [];
  const allOpponentPlayers: (MatchupPlayer | null)[] = [];
  const isUtilSlot: boolean[] = [];

  positionGroups.forEach(group => {
    const isUtil = group.position === 'Util';
    const maxLength = Math.max(group.userPlayers.length, group.opponentPlayers.length);
    for (let i = 0; i < maxLength; i++) {
      isUtilSlot.push(isUtil);
    }
    allUserPlayers.push(...group.userPlayers);
    allOpponentPlayers.push(...group.opponentPlayers);
  });

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
      <div className="matchup-position-group">
        <MatchupPositionGroup
          userPlayers={allUserPlayers}
          opponentPlayers={allOpponentPlayers}
          isUtilSlot={isUtilSlot}
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
          <div className="matchup-total-score">{userTotal.toFixed(1)}</div>
        </div>
        <div className="matchup-center-column matchup-total-center">
          <span className="position-label">{isShowingDailyView ? 'DAY' : 'TOT'}</span>
        </div>
        <div className="matchup-total-card matchup-total-opponent">
          <div className="matchup-total-label">
            {isShowingDailyView ? 'Daily Total' : 'Total'}
          </div>
          <div className="matchup-total-score">{opponentTotal.toFixed(1)}</div>
        </div>
      </div>

      {/* Bench Section */}
      {(userBench.length > 0 || opponentBench.length > 0) && (
        <>
          <div className="mt-8 mb-4">
            <div className="bg-muted/30 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-y">
              Bench
            </div>
          </div>
          <div className="matchup-position-group">
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
        </>
      )}
    </div>
  );
};


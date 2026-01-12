import { useEffect, useRef } from "react";
import { MatchupPlayer } from "./types";
import { MatchupPositionGroup } from "./MatchupPositionGroup";
import { organizeMatchupData } from "./matchupUtils";

interface MatchupComparisonProps {
  userStarters: MatchupPlayer[];
  opponentStarters: MatchupPlayer[];
  userBench?: MatchupPlayer[];
  opponentBench?: MatchupPlayer[];
  userSlotAssignments: Record<string, string>;
  opponentSlotAssignments: Record<string, string>;
  onPlayerClick?: (player: MatchupPlayer) => void;
  selectedDate?: string | null; // Optional: show stats for specific date
  dailyStatsMap?: Map<number, { daily_total_points?: number; [key: string]: any }>; // Optional: daily stats map for the selected date
  // Callback to report calculated totals back to parent (for WeeklySchedule sync)
  onTotalsCalculated?: (userTotal: number, opponentTotal: number, date?: string) => void;
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
  onTotalsCalculated
}: MatchupComparisonProps) => {
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
  
  const userTotal = allUserPlayers.reduce((sum, player) => {
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
      // Non-dropped: use daily_total_points
      return sum + (player.daily_total_points ?? 0);
    }
    // Weekly view: use weekly points
    return sum + (player.points || 0);
  }, 0);
  
  const opponentTotal = allOpponentPlayers.reduce((sum, player) => {
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
      // Non-dropped: use daily_total_points
      return sum + (player.daily_total_points ?? 0);
    }
    // Weekly view: use weekly points
    return sum + (player.points || 0);
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


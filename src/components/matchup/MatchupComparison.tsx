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
}

export const MatchupComparison = ({
  userStarters,
  opponentStarters,
  userBench = [],
  opponentBench = [],
  userSlotAssignments,
  opponentSlotAssignments,
  onPlayerClick,
  selectedDate
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

  // Calculate totals - use daily_total_points when date is selected, otherwise weekly points
  const isShowingDailyView = selectedDate !== null && selectedDate !== undefined;
  
  const userTotal = allUserPlayers.reduce((sum, player) => {
    if (!player) return sum;
    // When showing daily view, use daily_total_points (for that day's points)
    // Otherwise use weekly points
    const pts = isShowingDailyView 
      ? (player.daily_total_points ?? 0) 
      : (player.points || 0);
    return sum + pts;
  }, 0);
  
  const opponentTotal = allOpponentPlayers.reduce((sum, player) => {
    if (!player) return sum;
    const pts = isShowingDailyView 
      ? (player.daily_total_points ?? 0) 
      : (player.points || 0);
    return sum + pts;
  }, 0);

  return (
    <div className="w-full">
      <div className="matchup-position-group">
        <MatchupPositionGroup
          userPlayers={allUserPlayers}
          opponentPlayers={allOpponentPlayers}
          isUtilSlot={isUtilSlot}
          onPlayerClick={onPlayerClick}
          selectedDate={selectedDate}
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
            />
          </div>
        </>
      )}
    </div>
  );
};


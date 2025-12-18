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
}

export const MatchupComparison = ({
  userStarters,
  opponentStarters,
  userBench = [],
  opponentBench = [],
  userSlotAssignments,
  opponentSlotAssignments,
  onPlayerClick
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

  // Calculate totals
  const userTotal = allUserPlayers.reduce((sum, player) => sum + (player?.points || 0), 0);
  const opponentTotal = allOpponentPlayers.reduce((sum, player) => sum + (player?.points || 0), 0);

  return (
    <div className="w-full">
      <div className="matchup-position-group">
        <MatchupPositionGroup
          userPlayers={allUserPlayers}
          opponentPlayers={allOpponentPlayers}
          isUtilSlot={isUtilSlot}
          onPlayerClick={onPlayerClick}
        />
      </div>
      
      {/* Total Points Row */}
      <div className="matchup-total-row">
        <div className="matchup-total-card matchup-total-user">
          <div className="matchup-total-label">Total</div>
          <div className="matchup-total-score">{userTotal.toFixed(1)}</div>
        </div>
        <div className="matchup-center-column matchup-total-center">
          <span className="position-label">TOT</span>
        </div>
        <div className="matchup-total-card matchup-total-opponent">
          <div className="matchup-total-label">Total</div>
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
            />
          </div>
        </>
      )}
    </div>
  );
};


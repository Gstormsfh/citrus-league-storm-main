import { MatchupPlayer } from "./types";
import { PlayerCard } from "./PlayerCard";
import { CenterColumn } from "./CenterColumn";

interface MatchupComparisonRowProps {
  userPlayer: MatchupPlayer | null;
  opponentPlayer: MatchupPlayer | null;
  position: string;
  isBench?: boolean;
  onPlayerClick?: (player: MatchupPlayer) => void;
  selectedDate?: string | null;
}

export const MatchupComparisonRow = ({
  userPlayer,
  opponentPlayer,
  position,
  isBench = false,
  onPlayerClick,
  selectedDate
}: MatchupComparisonRowProps) => {
  // Calculate projected points for tonight (points / 20 is the standard projection calculation)
  const userProjectedPoints = userPlayer ? (userPlayer.points || 0) / 20 : 0;
  const opponentProjectedPoints = opponentPlayer ? (opponentPlayer.points || 0) / 20 : 0;
  
  // Add projectedPoints to players if not already present
  const userPlayerWithProjection = userPlayer ? { ...userPlayer, projectedPoints: userProjectedPoints } : null;
  const opponentPlayerWithProjection = opponentPlayer ? { ...opponentPlayer, projectedPoints: opponentProjectedPoints } : null;
  
  return (
    <div className="matchup-comparison-row">
      {/* User Team Player Card */}
      <PlayerCard 
        player={userPlayerWithProjection} 
        isUserTeam={true}
        isBench={isBench}
        onPlayerClick={onPlayerClick}
        selectedDate={selectedDate}
      />
      
      {/* Center Column - hidden on mobile, visible on desktop */}
      {!isBench && (
        <CenterColumn 
          position={position}
          userPlayer={userPlayer ? { projectedPoints: userProjectedPoints, position: userPlayer.position } : null}
          opponentPlayer={opponentPlayer ? { projectedPoints: opponentProjectedPoints, position: opponentPlayer.position } : null}
        />
      )}
      {isBench && (
        <div className="matchup-center-column opacity-40 bg-muted/50 border-muted">
          <span className="position-label text-muted-foreground/60">{position}</span>
        </div>
      )}
      
      {/* Opponent Team Player Card */}
      <PlayerCard 
        player={opponentPlayerWithProjection} 
        isUserTeam={false}
        isBench={isBench}
        onPlayerClick={onPlayerClick}
        selectedDate={selectedDate}
      />
    </div>
  );
};


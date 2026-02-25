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
  dailyStatsMap?: Map<number, { daily_total_points?: number; [key: string]: unknown }>; // Optional: daily stats map for the selected date
}

export const MatchupComparisonRow = ({
  userPlayer,
  opponentPlayer,
  position,
  isBench = false,
  onPlayerClick,
  selectedDate,
  dailyStatsMap
}: MatchupComparisonRowProps) => {
  // Calculate projected points using actual fantasy PPG from season stats
  const calcPPG = (p: HockeyPlayer | null) => {
    if (!p || !p.stats?.gamesPlayed) return 0;
    const s = p.stats;
    return ((s.goals || 0) * 3 + (s.assists || 0) * 2 + (s.shots || 0) * 0.4 + (s.blocks || 0) * 0.5 + (s.hits || 0) * 0.2 + (s.pim || 0) * 0.5) / s.gamesPlayed;
  };
  const userProjectedPoints = calcPPG(userPlayer);
  const opponentProjectedPoints = calcPPG(opponentPlayer);
  
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
        dailyStatsMap={dailyStatsMap}
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
        dailyStatsMap={dailyStatsMap}
      />
    </div>
  );
};


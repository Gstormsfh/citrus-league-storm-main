import { MatchupPlayer } from "./types";
import { PlayerCard } from "./PlayerCard";
import { CenterColumn } from "./CenterColumn";
import { ScoringCalculator } from "@/utils/scoringUtils";

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
  const scorer = new ScoringCalculator();
  const calcPPG = (p: MatchupPlayer | null) => {
    if (!p || !p.stats?.gamesPlayed) return 0;
    const s = p.stats;
    return scorer.calculatePointsPerGame({
      goals: s.goals || 0, assists: s.assists || 0, sog: s.sog || 0,
      blocks: s.blk || 0, hits: (s as any).hits || 0, pim: (s as any).pim || 0,
      ppp: s.powerPlayPoints || 0, shp: (s as any).shortHandedPoints || 0
    }, false, s.gamesPlayed);
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
      
      {/* Center Column — the slot label on desktop, the 32px slot chip on
          mobile. Bench rows get the neutral BN chip. */}
      <CenterColumn
        position={position}
        isBench={isBench}
        userPlayer={userPlayer ? { projectedPoints: userProjectedPoints, position: userPlayer.position } : null}
        opponentPlayer={opponentPlayer ? { projectedPoints: opponentProjectedPoints, position: opponentPlayer.position } : null}
      />
      
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


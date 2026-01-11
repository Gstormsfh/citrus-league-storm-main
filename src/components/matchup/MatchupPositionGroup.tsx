import { MatchupPlayer } from "./types";
import { MatchupComparisonRow } from "./MatchupComparisonRow";

interface MatchupPositionGroupProps {
  userPlayers: (MatchupPlayer | null)[];
  opponentPlayers: (MatchupPlayer | null)[];
  isUtilSlot?: boolean[];
  isBench?: boolean;
  onPlayerClick?: (player: MatchupPlayer) => void;
  selectedDate?: string | null;
  dailyStatsMap?: Map<number, { daily_total_points?: number; [key: string]: any }>; // Optional: daily stats map for the selected date
}

export const MatchupPositionGroup = ({
  userPlayers,
  opponentPlayers,
  isUtilSlot = [],
  isBench = false,
  onPlayerClick,
  selectedDate,
  dailyStatsMap
}: MatchupPositionGroupProps) => {
  // Ensure both arrays have the same length
  const maxLength = Math.max(userPlayers.length, opponentPlayers.length);
  const paddedUserPlayers = [...userPlayers];
  const paddedOpponentPlayers = [...opponentPlayers];
  
  while (paddedUserPlayers.length < maxLength) {
    paddedUserPlayers.push(null);
  }
  while (paddedOpponentPlayers.length < maxLength) {
    paddedOpponentPlayers.push(null);
  }

  return (
    <>
      {paddedUserPlayers.map((userPlayer, index) => {
        // For UTIL slot, use "UTIL" as position for display, but player's actual position for color
        const isUtil = isUtilSlot[index] || false;
        const position = isUtil ? 'UTIL' : (userPlayer?.position || opponentPlayers[index]?.position || '');
        return (
          <MatchupComparisonRow
            key={index}
            userPlayer={userPlayer}
            opponentPlayer={paddedOpponentPlayers[index]}
            position={position}
            isBench={isBench}
            onPlayerClick={onPlayerClick}
            selectedDate={selectedDate}
            dailyStatsMap={dailyStatsMap}
          />
        );
      })}
    </>
  );
};


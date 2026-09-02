import { MatchupPlayer } from "./types";
import { MatchupComparisonRow } from "./MatchupComparisonRow";

interface MatchupPositionGroupProps {
  userPlayers: (MatchupPlayer | null)[];
  opponentPlayers: (MatchupPlayer | null)[];
  isUtilSlot?: boolean[];
  /**
   * The SLOT each row belongs to (C / LW / RW / D / G / F), indexed like the
   * player arrays. Without it a row that is empty on BOTH sides has no
   * position at all — the label used to be derived from whichever player
   * happened to occupy the row, so a double-empty G2 rendered a blank
   * centre. The slot is what the row is; the occupant is a fallback.
   */
  slotPositions?: string[];
  isBench?: boolean;
  onPlayerClick?: (player: MatchupPlayer) => void;
  selectedDate?: string | null;
  dailyStatsMap?: Map<number, { daily_total_points?: number; [key: string]: unknown }>; // Optional: daily stats map for the selected date
}

export const MatchupPositionGroup = ({
  userPlayers,
  opponentPlayers,
  isUtilSlot = [],
  slotPositions = [],
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
        const position = isUtil
          ? 'UTIL'
          : (slotPositions[index] || userPlayer?.position || opponentPlayers[index]?.position || '');
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

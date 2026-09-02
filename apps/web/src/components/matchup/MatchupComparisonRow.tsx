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

/**
 * One row of the comparison: the user's card, the slot column, the
 * opponent's card. The players go to the cards UNTOUCHED (audit M11): this
 * row used to build a `ScoringCalculator` and a season points-per-game
 * figure for each side on every render, spread it onto a fresh copy of
 * each player as `projectedPoints`, and hand that copy down — a field
 * neither `PlayerCard` nor `CenterColumn` ever read. The fresh copy also
 * defeated `PlayerCard`'s `memo` on all 52 cards of a live refresh.
 */
export const MatchupComparisonRow = ({
  userPlayer,
  opponentPlayer,
  position,
  isBench = false,
  onPlayerClick,
  selectedDate,
  dailyStatsMap
}: MatchupComparisonRowProps) => {
  return (
    <div className="matchup-comparison-row">
      {/* User Team Player Card */}
      <PlayerCard
        player={userPlayer}
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
        userPlayer={userPlayer ? { position: userPlayer.position } : null}
        opponentPlayer={opponentPlayer ? { position: opponentPlayer.position } : null}
      />

      {/* Opponent Team Player Card */}
      <PlayerCard
        player={opponentPlayer}
        isUserTeam={false}
        isBench={isBench}
        onPlayerClick={onPlayerClick}
        selectedDate={selectedDate}
        dailyStatsMap={dailyStatsMap}
      />
    </div>
  );
};

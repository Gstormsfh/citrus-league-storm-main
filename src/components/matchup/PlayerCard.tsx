/**
 * PlayerCard - NFL-Style Clean Horizontal Card
 * ~65px height, dense layout, citrus themed
 */

import { MatchupPlayer } from "./types";
import { cn } from "@/lib/utils";
import { PointsTooltip } from "./PointsTooltip";
import { MiniScheduleIcons } from "./MiniScheduleIcons";
import { getTodayMST } from "@/utils/timezoneUtils";
import { Badge } from "@/components/ui/badge";

interface PlayerCardProps {
  player: MatchupPlayer | null;
  isUserTeam: boolean;
  isBench?: boolean;
  onPlayerClick?: (player: MatchupPlayer) => void;
  selectedDate?: string | null;
  dailyStatsMap?: Map<number, { daily_total_points?: number; [key: string]: unknown }>;
}

export const PlayerCard = ({ player, isUserTeam, isBench = false, onPlayerClick, selectedDate }: PlayerCardProps) => {
  // Empty slot
  if (!player) {
    return (
      <div className={cn(
        "nfl-card nfl-card-empty",
        isUserTeam ? "nfl-card-user" : "nfl-card-opponent"
      )}>
        <div className="nfl-card-left">
          <span className="nfl-player-name text-gray-400">Empty Slot</span>
        </div>
      </div>
    );
  }

  const todayStr = getTodayMST();
  const isGoalie = player.isGoalie || player.position === 'G' || player.position === 'Goalie';
  
  // Projection logic
  const dailyProjection = isGoalie ? player.goalieProjection : player.daily_projection;
  const projectedPoints = dailyProjection?.total_projected_points || 0;
  const dailyTotalPoints = player.daily_total_points || 0;
  
  // Game status
  const dateToCheck = selectedDate || todayStr;
  const dateGames = player.games?.filter(g => g?.game_date?.split('T')[0] === dateToCheck) || [];
  const hasGameOnDate = dateGames.length > 0;
  const gameStatus = (dateGames[0]?.status || 'scheduled').toLowerCase();
  const isGameFinal = gameStatus === 'final';
  const isGameLive = gameStatus === 'live' || gameStatus === 'intermission';
  const isViewingPastDate = selectedDate ? selectedDate < todayStr : false;
  
  // Should show actual points vs projection
  const shouldShowDailyPoints = isViewingPastDate || isGameFinal || isGameLive || player.daily_total_points !== undefined;
  
  // Points to display in progress bar
  const displayPoints = shouldShowDailyPoints ? dailyTotalPoints : projectedPoints;
  const maxPoints = 15;
  const fillPercentage = Math.min((displayPoints / maxPoints) * 100, 100);
  
  // Stats for right box
  const fantasyPoints = player.total_points ?? 0;
  const ppp = player.stats?.powerPlayPoints ?? 0;
  const xGoals = player.stats?.xGoals ?? 0;
  const savePct = player.goalieStats?.savePct ?? 0;
  const gsax = player.goalieStats?.goalsSavedAboveExpected ?? 0;

  return (
    <div 
      className={cn(
        "nfl-card",
        isUserTeam ? "nfl-card-user" : "nfl-card-opponent",
        isBench && "nfl-card-bench",
        player.isToday && "nfl-card-today",
        isGameLive && "nfl-card-live"
      )}
      onClick={() => onPlayerClick?.(player)}
    >
      {/* MAIN ROW: Left info + Right stats box */}
      <div className="nfl-card-main">
        {/* LEFT SIDE: Name, Team, Stats + Icons */}
        <div className="nfl-card-left">
          {/* Line 1: Player Name + Badges */}
          <div className="nfl-player-name">
            {player.name}
            {(player.roster_status && player.roster_status !== 'ACT') && (
              <Badge variant="destructive" className="nfl-badge-ir">IR</Badge>
            )}
            {player.wasDropped && (
              <Badge variant="secondary" className="nfl-badge-dropped">Dropped</Badge>
            )}
          </div>
          
          {/* Line 2: Team */}
          <div className="nfl-player-team">{player.team}</div>
          
          {/* Line 3: Stats + Mini Schedule Icons */}
          <div className="nfl-player-stats-row">
            <span className="nfl-player-stats">
              {isGoalie ? (
                <>W: {player.goalieStats?.wins || 0}, SV%: {((savePct) * 100).toFixed(1)}%, GAA: {(player.goalieStats?.gaa || 0).toFixed(2)}</>
              ) : (
                <>{player.stats?.goals ?? 0} G, {player.stats?.assists ?? 0} A, {player.stats?.sog ?? 0} SOG</>
              )}
            </span>
            {/* Mini schedule icons - inline, max 5 */}
            {player.games && player.team && (
              <MiniScheduleIcons 
                games={player.games} 
                playerTeam={player.team}
                maxIcons={5}
              />
            )}
          </div>
          
          {/* Line 4: Status (if live or today) */}
          {(isGameLive || player.isToday) && (
            <div className="nfl-player-status">
              {isGameLive ? (
                <span className="nfl-status-live">● LIVE</span>
              ) : player.isToday ? (
                <span className="nfl-status-today">Game Today</span>
              ) : null}
            </div>
          )}
        </div>
        
        {/* RIGHT SIDE: Stats Box */}
        <div className="nfl-stats-box">
          <div className="nfl-stat-row">
            <span className="nfl-stat-label">F PTS:</span>
            <span className="nfl-stat-value nfl-stat-fpts">
              {player.stats_breakdown ? (
                <PointsTooltip breakdown={player.stats_breakdown} totalPoints={fantasyPoints} />
              ) : (
                fantasyPoints.toFixed(1)
              )}
            </span>
          </div>
          {isGoalie ? (
            <>
              <div className="nfl-stat-row">
                <span className="nfl-stat-label">SV%:</span>
                <span className="nfl-stat-value">{(savePct * 100).toFixed(1)}%</span>
              </div>
              <div className="nfl-stat-row">
                <span className="nfl-stat-label">GSAx:</span>
                <span className="nfl-stat-value">{gsax >= 0 ? '+' : ''}{gsax.toFixed(1)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="nfl-stat-row">
                <span className="nfl-stat-label">PPP:</span>
                <span className="nfl-stat-value">{ppp}</span>
              </div>
              <div className="nfl-stat-row">
                <span className="nfl-stat-label">xG:</span>
                <span className="nfl-stat-value">{xGoals.toFixed(1)}</span>
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* BOTTOM: Thin Progress Bar */}
      <div className="nfl-progress-container">
        <div className="nfl-progress-bar">
          <div 
            className={cn(
              "nfl-progress-fill",
              shouldShowDailyPoints ? "nfl-progress-actual" : "nfl-progress-projected"
            )}
            style={{ width: `${fillPercentage}%` }}
          />
        </div>
        <span className="nfl-progress-label">
          {shouldShowDailyPoints 
            ? `${dailyTotalPoints.toFixed(1)} pts` 
            : hasGameOnDate 
              ? `Proj: ${projectedPoints.toFixed(1)} pts`
              : 'No game'
          }
        </span>
      </div>
      
      {/* Bench overlay */}
      {isBench && dailyTotalPoints > 0 && (
        <div className="nfl-bench-overlay">
          <span>BENCH</span>
          <span className="text-xs">{dailyTotalPoints.toFixed(1)} pts (not counted)</span>
        </div>
      )}
    </div>
  );
};

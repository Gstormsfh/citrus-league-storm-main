/**
 * PlayerCard - NFL-Style COMPACT Layout with Citrus Theme
 * TIGHT spacing, NO wasted space
 */

import { MatchupPlayer } from "./types";
import { cn } from "@/lib/utils";
import { PointsTooltip } from "./PointsTooltip";
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
  if (!player) {
    return (
      <div className={cn(
        "nfl-card nfl-card-empty",
        isUserTeam ? "nfl-card-user" : "nfl-card-opponent"
      )}>
        <span className="text-citrus-charcoal/50 text-xs">Empty Slot</span>
      </div>
    );
  }

  const todayStr = getTodayMST();
  const isGoalie = player.isGoalie || player.position === 'G' || player.position === 'Goalie';
  
  // Projection
  const dailyProjection = isGoalie ? player.goalieProjection : player.daily_projection;
  const projectedPoints = dailyProjection?.total_projected_points || 0;
  const dailyTotalPoints = player.daily_total_points || 0;
  
  // Game status
  const dateToCheck = selectedDate || todayStr;
  const dateGames = player.games?.filter(g => g?.game_date?.split('T')[0] === dateToCheck) || [];
  const hasGameOnDate = dateGames.length > 0;
  const currentGame = dateGames[0];
  const gameStatus = (currentGame?.status || 'scheduled').toLowerCase();
  const isGameFinal = gameStatus === 'final';
  const isGameLive = gameStatus === 'live' || gameStatus === 'intermission';
  const isViewingPastDate = selectedDate ? selectedDate < todayStr : false;
  
  const shouldShowDailyPoints = isViewingPastDate || isGameFinal || isGameLive || player.daily_total_points !== undefined;
  const displayPoints = shouldShowDailyPoints ? dailyTotalPoints : projectedPoints;
  const maxPoints = 10;
  const fillPercentage = Math.min((displayPoints / maxPoints) * 100, 100);
  
  // Stats
  const fantasyPoints = player.total_points ?? 0;
  const xGoals = player.stats?.xGoals ?? 0;
  
  // Live game info
  const getGameText = () => {
    if (!currentGame) return null;
    const playerTeamUpper = player.team?.toUpperCase() || '';
    const isHome = currentGame.home_team?.toUpperCase() === playerTeamUpper;
    
    if (isGameLive) {
      const period = currentGame.period || '1st';
      return `LIVE: ${currentGame.away_score}-${currentGame.home_score} (${period})`;
    }
    if (isGameFinal) {
      return `Final: ${currentGame.away_score}-${currentGame.home_score}`;
    }
    const opponent = isHome ? currentGame.away_team : currentGame.home_team;
    const prefix = isHome ? 'vs' : '@';
    return `${prefix} ${opponent} ${currentGame.game_time || ''}`;
  };
  
  // Schedule games (max 5)
  const scheduleGames = (player.games || [])
    .filter(g => g && g.game_date)
    .sort((a, b) => a.game_date.localeCompare(b.game_date))
    .slice(0, 5);

  const gameText = getGameText();

  return (
    <div 
      className={cn(
        "nfl-card",
        isUserTeam ? "nfl-card-user" : "nfl-card-opponent",
        isBench && "nfl-card-bench",
        isGameLive && "nfl-card-live"
      )}
      onClick={() => onPlayerClick?.(player)}
    >
      {/* TOP ROW: Name + Stats Box */}
      <div className="nfl-top">
        <div className="nfl-left">
          {/* Name */}
          <div className="nfl-name">
            {player.name}
            {(player.roster_status && player.roster_status !== 'ACT') && (
              <Badge variant="destructive" className="nfl-ir">IR</Badge>
            )}
          </div>
          {/* Stats line - tight under name */}
          <div className="nfl-stats-line">
            {isGoalie ? (
              `${player.goalieStats?.wins || 0} W, ${((player.goalieStats?.savePct || 0) * 100).toFixed(1)}% SV, ${(player.goalieStats?.gaa || 0).toFixed(2)} GAA`
            ) : (
              `${player.stats?.goals ?? 0} G, ${player.stats?.assists ?? 0} A, ${player.stats?.sog ?? 0} SOG, ${player.stats?.powerPlayPoints ?? 0} PPP`
            )}
          </div>
          {/* Game status + Schedule Icons */}
          <div className="nfl-game-row">
            <span className={cn("nfl-game-text", isGameLive && "nfl-live-text")}>
              {gameText || 'No game'}
            </span>
            {/* SCHEDULE ICONS - RIGHT */}
            <div className="nfl-icons">
              {scheduleGames.map((game, idx) => {
                const gameDateStr = game.game_date.split('T')[0];
                const isToday = gameDateStr === todayStr;
                const isPast = gameDateStr < todayStr;
                const live = game.status === 'live' || game.status === 'intermission';
                
                const playerTeamUpper = player.team?.toUpperCase() || '';
                const isHome = game.home_team?.toUpperCase() === playerTeamUpper;
                const opponent = isHome ? game.away_team : game.home_team;
                if (!opponent) return null;
                
                const logoUrl = `https://assets.nhle.com/logos/nhl/svg/${opponent.toUpperCase()}_light.svg`;
                
                return (
                  <div 
                    key={idx} 
                    className={cn(
                      "nfl-icon",
                      live && "nfl-icon-live",
                      isToday && !live && "nfl-icon-today",
                      (isPast || game.status === 'final') && "nfl-icon-past"
                    )}
                    title={`${isHome ? 'vs' : '@'} ${opponent}`}
                  >
                    <img src={logoUrl} alt={opponent} className="nfl-logo" />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        
        {/* STATS BOX - Right */}
        <div className="nfl-box">
          <div className="nfl-box-row">
            <span className="nfl-box-label">F Pts</span>
            <span className="nfl-box-value nfl-fpts">
              {player.stats_breakdown ? (
                <PointsTooltip breakdown={player.stats_breakdown} totalPoints={fantasyPoints} />
              ) : fantasyPoints.toFixed(1)}
            </span>
          </div>
          <div className="nfl-box-row">
            <span className="nfl-box-label">xG</span>
            <span className="nfl-box-value">{xGoals.toFixed(1)}</span>
          </div>
        </div>
      </div>
      
      {/* BOTTOM: Progress Bar */}
      <div className="nfl-bar-row">
        <div className="nfl-bar-track">
          <div 
            className={cn("nfl-bar-fill", shouldShowDailyPoints ? "nfl-bar-actual" : "nfl-bar-proj")}
            style={{ width: `${fillPercentage}%` }}
          />
        </div>
        <span className="nfl-bar-label">
          {shouldShowDailyPoints ? `${dailyTotalPoints.toFixed(1)} pts` : hasGameOnDate ? `Proj: ${projectedPoints.toFixed(1)}` : 'No game'}
        </span>
      </div>
      
      {/* Bench overlay */}
      {isBench && (
        <div className="nfl-bench">BENCH</div>
      )}
    </div>
  );
};

/**
 * PlayerCard - NFL-Style Layout with Citrus Theme
 * Exact structure matching the screenshot
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
  // Empty slot
  if (!player) {
    return (
      <div className={cn(
        "player-card-nfl player-card-nfl-empty",
        isUserTeam ? "player-card-nfl-user" : "player-card-nfl-opponent"
      )}>
        <span className="text-citrus-charcoal/50 text-sm">Empty Slot</span>
      </div>
    );
  }

  const todayStr = getTodayMST();
  const isGoalie = player.isGoalie || player.position === 'G' || player.position === 'Goalie';
  
  // Projection logic
  const dailyProjection = isGoalie ? player.goalieProjection : player.daily_projection;
  const projectedPoints = dailyProjection?.total_projected_points || 0;
  const dailyTotalPoints = player.daily_total_points || 0;
  
  // Game status for selected date
  const dateToCheck = selectedDate || todayStr;
  const dateGames = player.games?.filter(g => g?.game_date?.split('T')[0] === dateToCheck) || [];
  const hasGameOnDate = dateGames.length > 0;
  const currentGame = dateGames[0];
  const gameStatus = (currentGame?.status || 'scheduled').toLowerCase();
  const isGameFinal = gameStatus === 'final';
  const isGameLive = gameStatus === 'live' || gameStatus === 'intermission';
  const isViewingPastDate = selectedDate ? selectedDate < todayStr : false;
  
  // Should show actual points vs projection
  const shouldShowDailyPoints = isViewingPastDate || isGameFinal || isGameLive || player.daily_total_points !== undefined;
  
  // Points to display in progress bar
  const displayPoints = shouldShowDailyPoints ? dailyTotalPoints : projectedPoints;
  const maxPoints = 10;
  const fillPercentage = Math.min((displayPoints / maxPoints) * 100, 100);
  
  // Fantasy points for stats box
  const fantasyPoints = player.total_points ?? 0;
  const xGoals = player.stats?.xGoals ?? 0;
  
  // Get live game info
  const getLiveGameInfo = () => {
    if (!currentGame) return null;
    
    const playerTeamUpper = player.team?.toUpperCase() || '';
    const isHome = currentGame.home_team?.toUpperCase() === playerTeamUpper;
    const homeScore = currentGame.home_score || 0;
    const awayScore = currentGame.away_score || 0;
    
    if (isGameLive) {
      const period = currentGame.period || '1st';
      const periodTime = currentGame.period_time || '';
      return {
        text: `LIVE: ${awayScore}-${homeScore} (${period}${periodTime ? ' ' + periodTime : ''})`,
        isLive: true
      };
    }
    
    if (isGameFinal) {
      return {
        text: `Final: ${awayScore}-${homeScore}`,
        isLive: false
      };
    }
    
    // Upcoming game
    const gameTime = currentGame.game_time || 'TBD';
    const opponent = isHome ? currentGame.away_team : currentGame.home_team;
    const prefix = isHome ? 'vs' : '@';
    return {
      text: `${prefix} ${opponent} ${gameTime}`,
      isLive: false
    };
  };
  
  const gameInfo = getLiveGameInfo();
  
  // Schedule icons - get games for the week (max 5)
  const scheduleGames = (player.games || [])
    .filter(g => g && g.game_date)
    .sort((a, b) => a.game_date.localeCompare(b.game_date))
    .slice(0, 5);

  return (
    <div 
      className={cn(
        "player-card-nfl",
        isUserTeam ? "player-card-nfl-user" : "player-card-nfl-opponent",
        isBench && "player-card-nfl-bench",
        isGameLive && "player-card-nfl-live"
      )}
      onClick={() => onPlayerClick?.(player)}
    >
      {/* ROW 1: Player Name + Stats Box */}
      <div className="nfl-row-1">
        <div className="nfl-name-section">
          <span className="nfl-player-name">
            {player.name}
          </span>
          {(player.roster_status && player.roster_status !== 'ACT') && (
            <Badge variant="destructive" className="nfl-badge">IR</Badge>
          )}
          {player.wasDropped && (
            <Badge className="nfl-badge nfl-badge-dropped">Dropped</Badge>
          )}
        </div>
        
        {/* Stats Box - Top Right */}
        <div className="nfl-stats-box">
          <div className="nfl-stat-row">
            <span className="nfl-stat-label">F Pts</span>
            <span className="nfl-stat-value nfl-stat-highlight">
              {player.stats_breakdown ? (
                <PointsTooltip breakdown={player.stats_breakdown} totalPoints={fantasyPoints} />
              ) : (
                fantasyPoints.toFixed(1)
              )}
            </span>
          </div>
          <div className="nfl-stat-row">
            <span className="nfl-stat-label">xG</span>
            <span className="nfl-stat-value">{xGoals.toFixed(1)}</span>
          </div>
        </div>
      </div>
      
      {/* ROW 2: Stats Line */}
      <div className="nfl-row-2">
        {isGoalie ? (
          <span className="nfl-stats-text">
            {player.goalieStats?.wins || 0} W, {((player.goalieStats?.savePct || 0) * 100).toFixed(1)}% SV, {(player.goalieStats?.gaa || 0).toFixed(2)} GAA, {player.goalieStats?.shutouts || 0} SO
          </span>
        ) : (
          <span className="nfl-stats-text">
            {player.stats?.goals ?? 0} G, {player.stats?.assists ?? 0} A, {player.stats?.sog ?? 0} SOG, {player.stats?.powerPlayPoints ?? 0} PPP
          </span>
        )}
      </div>
      
      {/* ROW 3: Game Status + Schedule Icons (RIGHT) */}
      <div className="nfl-row-3">
        <span className={cn("nfl-game-status", gameInfo?.isLive && "nfl-game-live")}>
          {gameInfo?.text || 'No game'}
        </span>
        
        {/* Schedule Icons - RIGHT SIDE */}
        <div className="nfl-schedule-icons">
          {scheduleGames.map((game, idx) => {
            const gameDateStr = game.game_date.split('T')[0];
            const isToday = gameDateStr === todayStr;
            const isPast = gameDateStr < todayStr;
            const isLive = game.status === 'live' || game.status === 'intermission';
            const isFinal = game.status === 'final' || isPast;
            
            const playerTeamUpper = player.team?.toUpperCase() || '';
            const isHome = game.home_team?.toUpperCase() === playerTeamUpper;
            const opponent = isHome ? game.away_team : game.home_team;
            
            if (!opponent) return null;
            
            const logoUrl = `https://assets.nhle.com/logos/nhl/svg/${opponent.toUpperCase()}_light.svg`;
            
            return (
              <div 
                key={idx} 
                className={cn(
                  "nfl-schedule-icon",
                  isLive && "nfl-icon-live",
                  isToday && !isLive && "nfl-icon-today",
                  isFinal && "nfl-icon-past"
                )}
                title={`${isHome ? 'vs' : '@'} ${opponent} - ${gameDateStr}`}
              >
                <img
                  src={logoUrl}
                  alt={opponent}
                  className="nfl-icon-logo"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
      
      {/* ROW 4: Projection/Daily Points Bar */}
      <div className="nfl-row-4">
        <div className="nfl-progress-track">
          <div 
            className={cn(
              "nfl-progress-fill",
              shouldShowDailyPoints ? "nfl-fill-actual" : "nfl-fill-projected"
            )}
            style={{ width: `${fillPercentage}%` }}
          />
        </div>
        <span className="nfl-progress-label">
          {shouldShowDailyPoints 
            ? `${dailyTotalPoints.toFixed(1)} pts` 
            : hasGameOnDate 
              ? `Proj: ${projectedPoints.toFixed(1)}`
              : 'No game'
          }
        </span>
      </div>
      
      {/* ROW 5: Last 10 Games - Placeholder for now */}
      <div className="nfl-row-5">
        <span className="nfl-last10-label">Last 10:</span>
        <div className="nfl-last10-dots">
          {/* Will populate with actual game data - placeholder dots for now */}
          {[...Array(10)].map((_, i) => (
            <div 
              key={i} 
              className={cn(
                "nfl-dot",
                i < 3 ? "nfl-dot-high" : i < 6 ? "nfl-dot-med" : "nfl-dot-low"
              )}
            />
          ))}
        </div>
      </div>
      
      {/* Bench overlay */}
      {isBench && (
        <div className="nfl-bench-overlay">
          <span>BENCH</span>
        </div>
      )}
    </div>
  );
};

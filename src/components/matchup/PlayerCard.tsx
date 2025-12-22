import { MatchupPlayer } from "./types";
import { cn } from "@/lib/utils";
import { getTeamColor } from "@/utils/teamColors";
import { PointsTooltip } from "./PointsTooltip";
import { GameLogosBar } from "./GameLogosBar";
import { ProjectionTooltip } from "./ProjectionTooltip";
import { GoalieProjectionTooltip } from "./GoalieProjectionTooltip";
import { getTodayMST } from "@/utils/timezoneUtils";

interface PlayerCardProps {
  player: MatchupPlayer | null;
  isUserTeam: boolean;
  isBench?: boolean;
  onPlayerClick?: (player: MatchupPlayer) => void;
  selectedDate?: string | null; // Optional: to determine if showing daily stats
}

// Get position color classes for border - Citrus Pastel Theme (Distinct Colors)
const getPositionColorClasses = (position: string): string => {
  const pos = position?.toUpperCase() || '';
  if (pos.includes('C') && !pos.includes('LW') && !pos.includes('RW')) {
    // Center - Bright Lemon Peel (#F9E076)
    return 'md:border-l-[3px] border-l-4 md:border-fantasy-primary border-fantasy-primary md:bg-fantasy-primary/15 bg-fantasy-primary/20';
  }
  if (pos.includes('LW') || pos === 'L' || pos === 'LEFT' || pos === 'LEFTWING') {
    // Left Wing - Deep Lime Green (#459345)
    return 'md:border-l-[3px] border-l-4 md:border-fantasy-secondary border-fantasy-secondary md:bg-fantasy-secondary/15 bg-fantasy-secondary/20';
  }
  if (pos.includes('RW') || pos === 'R' || pos === 'RIGHT' || pos === 'RIGHTWING') {
    // Right Wing - Zesty Tangerine (#F9A436)
    return 'md:border-l-[3px] border-l-4 md:border-fantasy-tertiary border-fantasy-tertiary md:bg-fantasy-tertiary/15 bg-fantasy-tertiary/20';
  }
  if (pos.includes('D')) {
    // Defense - Yellow-Green (#A8D85C)
    return 'md:border-l-[3px] border-l-4 md:border-[#A8D85C] border-[#A8D85C] md:bg-[#A8D85C]/15 bg-[#A8D85C]/20';
  }
  if (pos.includes('G')) {
    // Goalie - Contrast Grapefruit Pink (#FF6F80)
    return 'md:border-l-[3px] border-l-4 md:border-[#FF6F80] border-[#FF6F80] md:bg-[#FF6F80]/15 bg-[#FF6F80]/20';
  }
  if (pos === 'UTIL' || pos === 'UTILITY') {
    // Utility - Citrus Apricot (#FFB84D) - distinct orange-yellow blend
    return 'md:border-l-[3px] border-l-4 md:border-[#FFB84D] border-[#FFB84D] md:bg-[#FFB84D]/15 bg-[#FFB84D]/20';
  }
  return '';
};

// Use full name (no abbreviation)
const formatPlayerName = (name: string): string => {
  if (!name) return '';
  return name.trim();
};

// Calculate percentages for data bars (mock calculations based on available stats)
const calculatePercentages = (player: MatchupPlayer) => {
  // Calculate shot percentage (goals / shots, capped at 100%)
  const shotPct = player.stats?.sog > 0 
    ? Math.min((player.stats.goals / player.stats.sog) * 100, 100) 
    : 0;
  
  // Calculate point production rate (points per game, normalized)
  const pointRate = player.stats?.gamesPlayed && player.stats.gamesPlayed > 0
    ? Math.min((player.points / player.stats.gamesPlayed) * 10, 100) // Normalize to 0-100
    : 0;
  
  return { shotPct, pointRate };
};

export const PlayerCard = ({ player, isUserTeam, isBench = false, onPlayerClick, selectedDate }: PlayerCardProps) => {
  if (!player) {
    return (
      <div className={cn(`player-card player-card-empty ${isUserTeam ? 'user-team' : 'opponent-team'} opacity-50`)}>
        <div className="player-card-content">
          <div className="player-card-header">
            <div className="player-name">Empty Slot</div>
          </div>
          <div className="player-card-body">
            <div className="text-muted-foreground/60 text-xs">No player assigned</div>
          </div>
        </div>
      </div>
    );
  }

  const displayName = formatPlayerName(player.name);
  const positionColors = getPositionColorClasses(player.position);
  const { shotPct, pointRate } = calculatePercentages(player);
  
  // Check if player is goalie
  const isGoalie = player.isGoalie || player.position === 'G' || player.position === 'Goalie';
  
  // Use appropriate projection based on player type
  const dailyProjection = isGoalie ? player.goalieProjection : player.daily_projection;
  const projectedPoints = dailyProjection?.total_projected_points || 0;
  
  // Determine if we're showing daily stats (when a date is selected or defaulting to today)
  const hasDailyStats = player.daily_total_points !== undefined;
  const dailyTotalPoints = player.daily_total_points || 0;
  
  // Check if a specific date was selected (vs defaulting to today)
  const isDateExplicitlySelected = selectedDate !== null;
  
  // Get today's date string for comparison
  const todayStr = getTodayMST();
  
  // Check if viewing a past date (Historical Record)
  // Past dates should ALWAYS show actual points, not projections
  const isViewingPastDate = selectedDate ? selectedDate < todayStr : false;
  
  // Are we in "daily view mode"? (Either a date is explicitly selected OR viewing past dates)
  const isInDailyViewMode = isDateExplicitlySelected || isViewingPastDate;
  
  // Check if player has a game on the selected date (or today if no date selected)
  const dateToCheck = selectedDate || todayStr;
  const dateGames = (player.games && Array.isArray(player.games) && player.games.length > 0)
    ? player.games.filter(g => {
        if (!g || typeof g !== 'object') return false;
        // Match game_date - handle both 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:MM:SS' formats
        const gameDate = g.game_date?.split('T')[0];
        return gameDate === dateToCheck;
      }) 
    : [];
  const hasGameOnDate = dateGames.length > 0;
  
  // Check if game has started/finished (for determining projection vs daily points)
  const gameStatus = dateGames[0]?.status || 'scheduled';
  const gameHasStarted = gameStatus === 'live' || gameStatus === 'final' || gameStatus === 'FINAL';
  
  // LOGIC GATE for what to show in projection/daily points area:
  // 1. If it's a past date (Dec 15-21), ALWAYS show Daily Points (Actuals).
  // 2. If it's a selected date (current/future), show Daily Points (Actuals).
  // 3. If it's the default view (today), show Actuals if game started, else Projections.
  const shouldShowDailyPoints = hasDailyStats && (
    isViewingPastDate ||        // Past dates always show actual points
    isDateExplicitlySelected || // Explicitly selected dates show daily points
    gameHasStarted              // Today's games show daily points once started
  );
  
  // Zero Projection Logic: If projectedPoints === 0 but hasGameOnDate is true, show "TBD" or "Calculating"
  // For goalies, also check starter_confirmed flag
  // Only applies when NOT viewing past dates (past dates always show actuals)
  const hasProjection = dailyProjection && projectedPoints > 0;
  const isStarterConfirmed = isGoalie ? (player.goalieProjection?.starter_confirmed ?? false) : true;
  const showTBD = !isViewingPastDate && hasGameOnDate && !gameHasStarted && !isDateExplicitlySelected && (!hasProjection || (isGoalie && !isStarterConfirmed));
  
  // Max points for bar display - 15 for all players (skaters and goalies)
  const maxBarPoints = 15;
  // Calculate how many "chunks" to fill (out of 15)
  const dailyFilledChunks = Math.min(Math.floor(dailyTotalPoints), maxBarPoints);
  const dailyPartialChunk = Math.min(dailyTotalPoints % 1, 1); // Partial fill for decimal
  const projectionFilledChunks = Math.min(Math.floor(projectedPoints), maxBarPoints);
  const projectionPartialChunk = Math.min(projectedPoints % 1, 1);
  
  // Get unique stats for top right corner
  const getUniqueStats = () => {
    const stats: Array<{ label: string; value: string }> = [];
    
    // F Pts - Fantasy Points (MATCHUP WEEK total for mini stats box)
    stats.push({ 
      label: 'F Pts', 
      value: (player.total_points ?? 0).toFixed(1)  // Matchup week total
    });
    
    if (isGoalie) {
      // Goalie stats: SV%, GSAx
      const savePct = player.goalieStats?.savePct ?? 0;
      stats.push({ 
        label: 'SV%', 
        value: (savePct * 100).toFixed(1) + '%'
      });
      
      const gsax = player.goalieStats?.goalsSavedAboveExpected;
      if (gsax !== undefined && gsax !== null) {
        const gsaxSign = gsax >= 0 ? '+' : '';
        stats.push({ 
          label: 'GSAx', 
          value: `${gsaxSign}${gsax.toFixed(1)}`
        });
      }
    } else {
      // Skater stats: xG, GAR %
      const xG = player.stats?.xGoals ?? 0;
      stats.push({ 
        label: 'xG', 
        value: xG.toFixed(1) 
      });
      
      // Season GAR % - Goals Above Replacement as percentage (season total)
      if (player.garPercentage !== undefined) {
        const garSign = player.garPercentage >= 0 ? '+' : '';
        stats.push({ 
          label: 'Season GAR', 
          value: `${garSign}${player.garPercentage.toFixed(1)}%` 
        });
      }
    }
    
    return stats;
  };

  const uniqueStats = getUniqueStats();
  
  // Get status tag
  const getStatusTag = () => {
    if (player.status === 'In Game') return { text: 'LIVE', color: 'bg-primary text-primary-foreground' };
    if (player.status === 'Final') return { text: 'FINAL', color: 'bg-muted text-muted-foreground' };
    if (player.isToday) return { text: 'TODAY', color: 'bg-primary/10 text-primary border border-primary/20' };
    return null;
  };

  const statusTag = getStatusTag();

  return (
    <div 
      className={cn(
        `player-card ${isUserTeam ? 'user-team' : 'opponent-team'} cursor-pointer relative`,
        !isBench && positionColors,
        player.isToday && !isBench && 'ring-2 ring-primary/30',
        isBench && 'opacity-40 grayscale bg-muted/50 border-muted'
      )}
      onClick={() => onPlayerClick?.(player)}
    >
      {/* Background Position */}
      <div className="player-card-bg-text">{player.position}</div>
      
      <div className="player-card-content">
        {/* Header Section with Unique Stats in Top Right */}
        <div className="player-card-header">
          <div className="player-header-left">
            <div className="player-name" title={player.name}>
              {displayName}
            </div>
            {/* Team Name - Below player name */}
            {player.team && (
              <div className="player-team-name" title={player.team}>
                {player.team}
              </div>
            )}
            {/* Key Stats Below Name - Show DAILY stats when date selected, goalie season stats for goalies */}
            <div className="player-key-stats">
              {isGoalie ? (
                // Goalie: show season stats (always)
                <>
                  GP: {player.goalieStats?.gamesPlayed || 0}, 
                  W: {player.goalieStats?.wins || 0}, 
                  SV%: {((player.goalieStats?.savePct || 0) * 100).toFixed(1)}%, 
                  GAA: {(player.goalieStats?.gaa || 0).toFixed(2)}, 
                  SO: {player.goalieStats?.shutouts || 0}
                </>
              ) : isInDailyViewMode ? (
                // DAILY VIEW MODE: Show that day's stats
                // If player has daily stats from RPC, use them
                // If player had NO GAME that day, show 0, 0, 0
                hasGameOnDate && hasDailyStats ? (
                  <>
                    {player.matchupStats?.goals || 0} G, {player.matchupStats?.assists || 0} A, {player.matchupStats?.sog || 0} SOG
                  </>
                ) : (
                  // No game on this date = 0, 0, 0
                  <>0 G, 0 A, 0 SOG</>
                )
              ) : (
                // DEFAULT VIEW (no date selected): Show weekly totals
                <>
                  {player.stats?.goals || 0} G, {player.stats?.assists || 0} A, {player.stats?.sog || 0} SOG
                </>
              )}
            </div>
          </div>
          {/* Unique Stats Box - Top Right Corner */}
          {uniqueStats.length > 0 && (
            <div className="player-unique-stats-box">
              {uniqueStats.map((stat, idx) => {
                // Use PointsTooltip for F Pts if stats_breakdown is available
                if (stat.label === 'F Pts' && player.stats_breakdown && typeof player.stats_breakdown === 'object') {
                  const totalPoints = typeof player.total_points === 'number' ? player.total_points : 0;
                  return (
                    <div key={idx} className="unique-stat-item">
                      <span className="unique-stat-label">{stat.label}:</span>
                      <span className="unique-stat-value">
                        <PointsTooltip 
                          breakdown={player.stats_breakdown} 
                          totalPoints={totalPoints}
                        />
                      </span>
                    </div>
                  );
                }
                // Use high-contrast color for F Pts (season total in mini stats)
                const isFpts = stat.label === 'F Pts';
                return (
                  <div key={idx} className="unique-stat-item">
                    <span className="unique-stat-label">{stat.label}:</span>
                    <span className={`unique-stat-value ${isFpts ? 'text-orange-500 font-bold' : ''}`}>
                      {stat.value}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Game Logos Bar - Show opponent logos for each game */}
        {player.games && Array.isArray(player.games) && player.games.length > 0 && player.team && (
          <div className="mt-1 mb-1">
            <GameLogosBar 
              games={player.games} 
              playerTeam={player.team}
              selectedDate={selectedDate}
            />
          </div>
        )}

        {/* Daily Points Bar OR Projection Bar - Logic depends on view mode and game status */}
        {shouldShowDailyPoints ? (
          // CASE 1: Show daily total points (game finished, have stats)
          (() => {
            // Get projection for underlay comparison
            const projectedForDay = isGoalie 
              ? (player.goalieProjection?.total_projected_points || 0)
              : (player.daily_projection?.total_projected_points || 0);
            const projectedChunks = Math.min(Math.floor(projectedForDay), maxBarPoints);
            const projectedPartial = projectedForDay % 1;
            
            return (
              <div className="player-projection-bar-container">
                {/* Label */}
                <div className="text-[10px] text-gray-400 mb-0.5">Daily Points</div>
                {/* Centered total above bar */}
                <div className="flex justify-center mb-1">
                  {player.daily_stats_breakdown && Object.keys(player.daily_stats_breakdown).length > 0 ? (
                    <PointsTooltip 
                      breakdown={player.daily_stats_breakdown} 
                      totalPoints={dailyTotalPoints}
                    />
                  ) : (
                    <span className="text-lg font-bold text-fantasy-secondary">
                      {dailyTotalPoints.toFixed(1)} pts
                    </span>
                  )}
                </div>
                {/* Battery-style bar with 15 chunks + projection underlay */}
                <div className="flex gap-[2px] w-full">
                  {Array.from({ length: maxBarPoints }, (_, i) => {
                    const isFilled = i < dailyFilledChunks;
                    const isPartialFilled = i === dailyFilledChunks && dailyPartialChunk > 0;
                    const isWithinProjection = i < projectedChunks;
                    const isPartialProjection = i === projectedChunks && projectedPartial > 0;
                    
                    return (
                      <div 
                        key={i}
                        className={`flex-1 h-3 rounded-[2px] overflow-hidden relative
                          ${!isFilled && !isPartialFilled 
                            ? 'border border-muted-foreground/20 bg-muted/20' 
                            : 'bg-muted/30'
                          }`}
                      >
                        {/* Projection underlay (yellow) - shows where projection was */}
                        {projectedForDay > 0 && (isWithinProjection || isPartialProjection) && !isFilled && !isPartialFilled && (
                          <div 
                            className="absolute inset-0 bg-fantasy-primary/25"
                            style={{ 
                              width: isPartialProjection ? `${projectedPartial * 100}%` : '100%' 
                            }}
                          />
                        )}
                        {/* Actual points fill (green) */}
                        {isFilled && (
                          <div className="w-full h-full bg-fantasy-secondary" />
                        )}
                        {isPartialFilled && (
                          <div 
                            className="h-full bg-fantasy-secondary/70" 
                            style={{ width: `${dailyPartialChunk * 100}%` }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()
        ) : !hasGameOnDate ? (
          // CASE 2: NO GAME scheduled for this date - clean message
          <div className="player-projection-bar-container">
            <div className="w-full py-2 text-center text-muted-foreground text-sm bg-muted/30 rounded">
              No game {isInDailyViewMode ? 'this day' : 'today'}
            </div>
          </div>
        ) : isInDailyViewMode && !hasDailyStats ? (
          // CASE 3: PAST/SELECTED DATE - Game was scheduled but no stats (player scratched or data missing)
          <div className="player-projection-bar-container">
            {/* Label */}
            <div className="text-[10px] text-gray-400 mb-0.5">Daily Points</div>
            {/* Centered total above bar */}
            <div className="flex justify-center mb-1">
              <span className="text-lg font-bold text-muted-foreground">0.0 pts</span>
            </div>
            {/* Empty battery-style bar with clear visibility */}
            <div className="flex gap-[2px] w-full">
              {Array.from({ length: maxBarPoints }, (_, i) => (
                <div 
                  key={i}
                  className="flex-1 h-3 rounded-[2px] border border-muted-foreground/20 bg-muted/20"
                />
              ))}
            </div>
          </div>
        ) : (
          // CASE 4: TODAY/FUTURE - Show projection bar (game hasn't started)
          <div className="player-projection-bar-container">
            {/* Label */}
            <div className="text-[10px] text-gray-400 mb-0.5">Projected Tonight</div>
            {/* Centered total above bar */}
            <div className="flex justify-center items-center gap-1 mb-1">
              <span className="text-lg font-bold text-fantasy-primary">
                {hasProjection && isStarterConfirmed
                  ? `${projectedPoints.toFixed(1)} pts`
                  : showTBD 
                    ? (isGoalie && !isStarterConfirmed ? 'Probable' : 'TBD')
                    : '0.0 pts'
                }
              </span>
              {hasProjection && dailyProjection && (
                isGoalie ? (
                  <GoalieProjectionTooltip projection={player.goalieProjection} />
                ) : (
                  <ProjectionTooltip projection={player.daily_projection} />
                )
              )}
            </div>
            {/* Battery-style projection bar */}
            {hasProjection && isStarterConfirmed ? (
              <div className="flex gap-[2px] w-full">
                {Array.from({ length: maxBarPoints }, (_, i) => {
                  const isFilled = i < projectionFilledChunks;
                  const isPartial = i === projectionFilledChunks && projectionPartialChunk > 0;
                  return (
                    <div 
                      key={i}
                      className={`flex-1 h-3 rounded-[2px] overflow-hidden
                        ${!isFilled && !isPartial 
                          ? 'border border-muted-foreground/20 bg-muted/20' 
                          : 'bg-muted/30'
                        }`}
                    >
                      {isFilled && (
                        <div className="w-full h-full bg-fantasy-primary" />
                      )}
                      {isPartial && (
                        <div 
                          className="h-full bg-fantasy-primary/60" 
                          style={{ width: `${projectionPartialChunk * 100}%` }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : showTBD ? (
              <div className="flex gap-[2px] w-full">
                {Array.from({ length: maxBarPoints }, (_, i) => (
                  <div 
                    key={i}
                    className="flex-1 h-3 rounded-[2px] border border-muted-foreground/20 bg-muted/20 animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="flex gap-[2px] w-full">
                {Array.from({ length: maxBarPoints }, (_, i) => (
                  <div 
                    key={i}
                    className="flex-1 h-3 rounded-[2px] border border-muted-foreground/20 bg-muted/20"
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Benched Overlay - Show if player is on bench and has daily stats */}
      {isBench && hasDailyStats && dailyTotalPoints > 0 && (
        <div className="absolute inset-0 bg-muted/80 backdrop-blur-sm flex items-center justify-center z-10 rounded-lg pointer-events-none">
          <div className="text-center p-4">
            <div className="text-sm font-bold text-muted-foreground mb-1">BENCHED</div>
            <div className="text-xs text-muted-foreground">
              {dailyTotalPoints.toFixed(1)} pts today
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Points don't count toward total
            </div>
          </div>
        </div>
      )}

      {/* Mobile-only score display with tooltip - Show matchup total with high contrast */}
      <div className="player-mobile-score md:hidden">
        {player.stats_breakdown && typeof player.stats_breakdown === 'object' ? (
          <PointsTooltip 
            breakdown={player.stats_breakdown} 
            totalPoints={typeof player.total_points === 'number' ? player.total_points : 0}
          />
        ) : (
          <span className="text-orange-500 font-bold">
            {(typeof player.total_points === 'number' ? player.total_points : 0).toFixed(1)}
          </span>
        )}
      </div>
    </div>
  );
};


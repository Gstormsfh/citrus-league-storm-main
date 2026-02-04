import { MatchupPlayer } from "./types";
import { cn } from "@/lib/utils";
import { getTeamColor } from "@/utils/teamColors";
import { PointsTooltip } from "./PointsTooltip";
import { GameLogosBar } from "./GameLogosBar";
import { ProjectionTooltip } from "./ProjectionTooltip";
import { GoalieProjectionTooltip } from "./GoalieProjectionTooltip";
import { getTodayMST } from "@/utils/timezoneUtils";
import { Badge } from "@/components/ui/badge";

interface PlayerCardProps {
  player: MatchupPlayer | null;
  isUserTeam: boolean;
  isBench?: boolean;
  onPlayerClick?: (player: MatchupPlayer) => void;
  selectedDate?: string | null; // Optional: to determine if showing daily stats
  dailyStatsMap?: Map<number, { daily_total_points?: number; [key: string]: unknown }>; // Optional: daily stats map for the selected date
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

export const PlayerCard = ({ player, isUserTeam, isBench = false, onPlayerClick, selectedDate, dailyStatsMap }: PlayerCardProps) => {
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
  
  // Check if viewing a future date (beyond today)
  const isViewingFutureDate = selectedDate ? selectedDate > todayStr : false;
  
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
  
  // Check if game is final or live (for determining projection vs daily points)
  const gameStatus = (dateGames[0]?.status || 'scheduled').toLowerCase();
  // Our database uses: 'scheduled', 'live', 'intermission', 'final'
  const isGameFinal = gameStatus === 'final';
  // Show actual points during live games and intermissions
  const isGameLive = gameStatus === 'live' || gameStatus === 'intermission' || gameStatus === 'crit';
  // CRITICAL: Also check if game has started by looking at scores/period (handles stale status)
  const gameHasStarted = dateGames[0] && (
    (dateGames[0].home_score || 0) + (dateGames[0].away_score || 0) > 0 ||
    (dateGames[0].period !== null && dateGames[0].period !== undefined && dateGames[0].period !== '')
  );
  
  // Simplified logic: Show Daily Points when:
  // 1. Past dates (past games are always final, show 0 if no data)
  // 2. OR game is FINAL (show data if exists, or 0 if no data)
  // 3. OR game is LIVE (always show actual points during live games, even if 0)
  // 4. OR game has STARTED (has scores/period - handles stale status field)
  // 5. OR player HAS daily stats data (this is the safest check - if we have data, show it!)
  // For live/started games, we want to show actual points (even if 0) instead of projections
  const shouldShowDailyPoints = isViewingPastDate || isGameFinal || isGameLive || gameHasStarted || hasDailyStats;
  
  // Zero Projection Logic: If projectedPoints === 0 but hasGameOnDate is true, show "TBD" or "Calculating"
  // For goalies, also check starter_confirmed flag
  // Only applies when game is not final, not live, and not started (show projections until game starts)
  const hasProjection = dailyProjection && projectedPoints > 0;
  const isStarterConfirmed = isGoalie ? (player.goalieProjection?.starter_confirmed ?? false) : true;
  const showTBD = hasGameOnDate && !isGameFinal && !isGameLive && !gameHasStarted && (!hasProjection || (isGoalie && !isStarterConfirmed));
  
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
      // Goalie stats: SV%, GSAx (season stats)
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
      // Skater stats: PPP (Power Play Points), xG (Expected Goals) - SEASON TOTALS
      // Use season stats from player.stats (fallback to ppp for safety)
      const ppp = player.stats?.powerPlayPoints ?? (player as { ppp?: number }).ppp ?? 0;
      const xGoals = player.stats?.xGoals ?? 0;
      
      stats.push({ 
        label: 'PPP', 
        value: ppp.toFixed(0) 
      });
      
      stats.push({ 
        label: 'xG', 
        value: xGoals.toFixed(1) 
      });
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
        isBench && 'opacity-40 grayscale bg-muted/50 border-muted',
        player.wasDropped && !isBench && 'border-citrus-orange/30 bg-citrus-orange/5 opacity-95'
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
              {/* IR Badge - Display if roster_status is not ACT */}
              {(player.roster_status && player.roster_status !== 'ACT') || player.is_ir_eligible ? (
                <Badge 
                  variant="destructive" 
                  className="ml-1 text-[9px] px-1 py-0"
                  title={`Roster Status: ${player.roster_status || 'IR'}`}
                >
                  IR
                </Badge>
              ) : null}
              {/* Dropped Badge - Display if player was dropped but points still count */}
              {player.wasDropped ? (
                <Badge 
                  variant="secondary"
                  className="ml-1 text-[9px] px-1 py-0 border-citrus-orange/40 bg-citrus-orange/20 text-citrus-orange font-semibold"
                  title="Player was dropped but points still count from when they were in the lineup"
                >
                  Dropped
                </Badge>
              ) : null}
            </div>
            {/* Team Name - Below player name */}
            {player.team && (
              <div className="player-team-name" title={player.team}>
                {player.team}
              </div>
            )}
            {/* Key Stats Below Name - Show DAILY stats when date selected, season stats otherwise */}
            <div className="player-key-stats">
              {isGoalie ? (
                // Goalie: ALWAYS show SEASON TOTALS
                <>
                  GP: {player.goalieStats?.gamesPlayed || 0}, 
                  W: {player.goalieStats?.wins || 0}, 
                  SV%: {((player.goalieStats?.savePct || 0) * 100).toFixed(1)}%, 
                  GAA: {(player.goalieStats?.gaa || 0).toFixed(2)}, 
                  SO: {player.goalieStats?.shutouts || 0}
                </>
              ) : (
                // Skater: ALWAYS show SEASON TOTALS (G, A, SOG)
                <>
                  {player.stats?.goals ?? 0} G, {player.stats?.assists ?? 0} A, {player.stats?.sog ?? 0} SOG
                </>
              )}
              {/* Show matchup points contribution for dropped players */}
              {player.wasDropped && (() => {
                // For daily view: Try to get points from daily_total_points, or calculate from daily stats
                let contributingPoints = 0;
                let pointsLabel = '';
                
                if (isInDailyViewMode && selectedDate) {
                  // In daily view - try multiple sources for points
                  // 1. First try dailyStatsMap (same source as WeeklySchedule uses)
                  if (dailyStatsMap) {
                    const playerId = typeof player.id === 'string' ? parseInt(player.id, 10) : player.id;
                    const dailyStats = dailyStatsMap.get(playerId);
                    if (dailyStats?.daily_total_points !== undefined && dailyStats.daily_total_points !== null) {
                      contributingPoints = dailyStats.daily_total_points;
                      pointsLabel = 'pts contributing today';
                    }
                  }
                  
                  // 2. Fallback to player.daily_total_points if not found in map
                  if (contributingPoints === 0 && player.daily_total_points !== undefined && player.daily_total_points !== null) {
                    contributingPoints = player.daily_total_points;
                    pointsLabel = 'pts contributing today';
                  }
                  
                  // 3. Calculate from breakdown if available
                  if (contributingPoints === 0 && player.daily_stats_breakdown && Object.keys(player.daily_stats_breakdown).length > 0) {
                    contributingPoints = Object.values(player.daily_stats_breakdown).reduce(
                      (sum, stat) => sum + (stat.points || 0), 
                      0
                    );
                    pointsLabel = 'pts contributing today';
                  }
                  
                  // 4. Final fallback to weekly total
                  if (contributingPoints === 0) {
                    contributingPoints = player.total_points || player.points || 0;
                    pointsLabel = 'pts contributing this week';
                  }
                } else {
                  // Weekly view - use total_points or points
                  contributingPoints = player.total_points || player.points || 0;
                  pointsLabel = 'pts contributing this week';
                }
                
                // Always show the indicator for dropped players (even if 0, to show they're being counted)
                return (
                  <div className="mt-1 text-[10px] font-semibold text-citrus-orange flex items-center gap-1">
                    <span className="inline-flex items-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-citrus-orange mr-1" />
                      {contributingPoints > 0 
                        ? `${contributingPoints.toFixed(1)} ${pointsLabel}`
                        : 'Points counted from lineup'
                      }
                    </span>
                  </div>
                );
              })()}
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

        {/* Game Logos Bar - PREMIUM SHOWCASE - COMPACT WITH OVERLAP */}
        {player.games && Array.isArray(player.games) && player.games.length > 0 && player.team && (
          <div className="-mt-1 mb-0 px-0.5 py-0 bg-gradient-to-r from-citrus-sage/5 via-citrus-peach/5 to-citrus-sage/5 rounded border border-citrus-sage/20">
            <GameLogosBar 
              games={player.games} 
              playerTeam={player.team}
              selectedDate={selectedDate}
            />
          </div>
        )}

        {/* Daily Points Bar OR Projection Bar - VARSITY SCOREBOARD STYLE - COMPACT */}
        {shouldShowDailyPoints ? (
          // CASE 1: Show daily total points (game is FINAL and data exists)
          <div className="player-projection-bar-container relative bg-gradient-to-br from-citrus-sage/10 via-citrus-cream/30 to-citrus-peach/10 p-1 rounded border border-citrus-sage/30 shadow-sm">
            {/* Label - Varsity Badge Style - COMPACT */}
            <div className="text-[7px] font-varsity font-bold text-citrus-forest uppercase tracking-wider mb-0.5 flex items-center gap-0.5 bg-[#E8EED9]/50 backdrop-blur-sm/70 px-1 py-0 rounded border border-citrus-sage/30 w-fit">
              <span className="w-1 h-1 rounded-full bg-citrus-sage animate-pulse" />
              Daily Points
            </div>
            {/* Centered total above bar - Premium Badge - COMPACT */}
            <div className="flex justify-center mb-0.5">
              {player.daily_stats_breakdown && Object.keys(player.daily_stats_breakdown).length > 0 ? (
                <PointsTooltip 
                  breakdown={player.daily_stats_breakdown} 
                  totalPoints={dailyTotalPoints}
                />
              ) : (
                <span className="text-xs font-varsity font-black text-citrus-orange bg-citrus-peach/30 px-1.5 py-0.5 rounded border border-citrus-peach/50 shadow-[inset_0_1px_1px_rgba(0,0,0,0.1)]">
                  {dailyTotalPoints.toFixed(1)} pts
                </span>
              )}
            </div>
            {/* Collegiate Battery Bar with Stitched Style - COMPACT */}
            <div className="flex gap-0.5 w-full">
              {Array.from({ length: maxBarPoints }, (_, i) => {
                const isFilled = i < dailyFilledChunks;
                const isPartialFilled = i === dailyFilledChunks && dailyPartialChunk > 0;
                
                return (
                  <div 
                    key={i}
                    className={`flex-1 h-2 rounded overflow-hidden transition-all duration-300
                      ${!isFilled && !isPartialFilled 
                        ? 'border-2 border-dashed border-citrus-sage/30 bg-[#E8EED9]/50 backdrop-blur-sm/50' 
                        : 'bg-[#E8EED9]/50 backdrop-blur-sm border-2 border-citrus-sage/40'
                      }`}
                  >
                    {/* Actual points fill (green gradient) */}
                    {isFilled && (
                      <div className="w-full h-full bg-gradient-to-br from-citrus-sage via-[#7CB518] to-citrus-sage shadow-[inset_0_1px_2px_rgba(255,255,255,0.3)]" />
                    )}
                    {isPartialFilled && (
                      <div 
                        className="h-full bg-gradient-to-br from-citrus-sage/70 via-[#7CB518]/70 to-citrus-sage/70" 
                        style={{ width: `${dailyPartialChunk * 100}%` }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : !hasGameOnDate ? (
          // CASE 2: NO GAME scheduled for this date - Varsity Badge Message - COMPACT
          <div className="player-projection-bar-container">
            <div className="w-full py-1 text-center font-display text-xs text-citrus-charcoal/60 bg-[#E8EED9]/50 backdrop-blur-sm/50 rounded border border-dashed border-citrus-sage/30 italic">
              No game {isInDailyViewMode ? 'this day' : 'today'}
            </div>
          </div>
        ) : (
          // CASE 3: Show projection bar (game not final yet) - VARSITY SCOREBOARD - COMPACT
          <div className="player-projection-bar-container relative bg-gradient-to-br from-citrus-peach/10 via-citrus-cream/30 to-citrus-sage/10 p-1 rounded border border-citrus-peach/40 shadow-sm">
            {/* Label - Varsity Badge Style - COMPACT */}
            <div className="text-[7px] font-varsity font-bold text-citrus-forest uppercase tracking-wider mb-0.5 flex items-center gap-0.5 bg-[#E8EED9]/50 backdrop-blur-sm/70 px-1 py-0 rounded border border-citrus-peach/40 w-fit">
              <span className="w-1 h-1 rounded-full bg-citrus-orange animate-pulse" />
              Projected
            </div>
            {/* Centered total above bar - Premium Badge - COMPACT */}
            <div className="flex justify-center items-center gap-1 mb-0.5">
              <span className="text-xs font-varsity font-black text-citrus-orange bg-citrus-peach/30 px-1.5 py-0.5 rounded border border-citrus-peach/50 shadow-[inset_0_1px_1px_rgba(0,0,0,0.1)]">
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
            {/* Collegiate Battery Bar with Stitched Style - COMPACT */}
            {hasProjection && isStarterConfirmed ? (
              <div className="flex gap-0.5 w-full">
                {Array.from({ length: maxBarPoints }, (_, i) => {
                  const isFilled = i < projectionFilledChunks;
                  const isPartial = i === projectionFilledChunks && projectionPartialChunk > 0;
                  return (
                    <div 
                      key={i}
                      className={`flex-1 h-2 rounded overflow-hidden transition-all duration-300
                        ${!isFilled && !isPartial 
                          ? 'border-2 border-dashed border-citrus-peach/30 bg-[#E8EED9]/50 backdrop-blur-sm/50' 
                          : 'bg-[#E8EED9]/50 backdrop-blur-sm border-2 border-citrus-peach/40'
                        }`}
                    >
                      {isFilled && (
                        <div className="w-full h-full bg-gradient-to-br from-citrus-orange via-citrus-peach to-citrus-orange shadow-[inset_0_1px_2px_rgba(255,255,255,0.3)]" />
                      )}
                      {isPartial && (
                        <div 
                          className="h-full bg-gradient-to-br from-citrus-orange/70 via-citrus-peach/70 to-citrus-orange/70" 
                          style={{ width: `${projectionPartialChunk * 100}%` }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : showTBD ? (
              <div className="flex gap-0.5 w-full">
                {Array.from({ length: maxBarPoints }, (_, i) => (
                  <div 
                    key={i}
                    className="flex-1 h-2 rounded border border-dashed border-citrus-peach/30 bg-[#E8EED9]/50 backdrop-blur-sm/50 animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="flex gap-0.5 w-full">
                {Array.from({ length: maxBarPoints }, (_, i) => (
                  <div 
                    key={i}
                    className="flex-1 h-2 rounded border border-dashed border-citrus-peach/30 bg-[#E8EED9]/50 backdrop-blur-sm/50"
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


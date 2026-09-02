import { memo } from "react";
import { MatchupPlayer } from "./types";
import { cn } from "@/lib/utils";
import { getTeamColor } from "@/utils/teamColors";
import { PointsTooltip } from "./PointsTooltip";
import { GameLogosBar } from "./GameLogosBar";
import { ProjectionTooltip } from "./ProjectionTooltip";
import { GoalieProjectionTooltip } from "./GoalieProjectionTooltip";
import { getTodayMST } from "@/utils/timezoneUtils";
import { Badge } from "@/components/ui/badge";
import { Mug } from "@/components/roster/Mug";
import { opponentTint } from "./opponentTint";
import { useIsMobile } from "@/hooks/useIsMobile";
// The phone row type scale — the same four rungs the roster list and the
// Free Agents rows wear. Everything it names below is inside a `lg:hidden`
// block, so the desktop card is untouched.
import { ROW_HEADLINE, ROW_HEADLINE_LABEL, ROW_META, ROW_MICRO } from "@/components/phoneRowScale";

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

/**
 * The big number in the mobile score stack — the phone scale's HEADLINE
 * rung (17px JetBrains Mono, tabular).
 *
 * 15px → 17px (2026-09-02). The audit measured this row at name 14px /
 * score 15px: the number the row exists to show was one pixel bigger than
 * the name beside it, which reads as one flat band rather than as a
 * hierarchy. The column it sits in widened 38 → 42px in index.css to hold
 * a four-figure week total at this size; the width came out of the card's
 * screen-edge padding, not out of the name.
 */
const SCORE_ACTUAL_CLASS = `player-score-value ${ROW_HEADLINE}`;

/**
 * "Auston Matthews" → "A. Matthews" when `compact` (the phone row), the
 * full name otherwise. Pure: the caller decides what "compact" means —
 * the card passes `useIsMobile()`, which used to be a `window.innerWidth`
 * read inside this function on every render of every row (audit M11).
 */
const formatPlayerName = (name: string, compact: boolean = false): string => {
  if (!name) return '';
  const trimmed = name.trim();

  if (compact) {
    const parts = trimmed.split(' ');
    if (parts.length >= 2) {
      const firstInitial = parts[0].charAt(0);
      const lastName = parts.slice(1).join(' ');
      return `${firstInitial}. ${lastName}`;
    }
  }

  return trimmed;
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

export const PlayerCard = memo(({ player, isUserTeam, isBench = false, onPlayerClick, selectedDate, dailyStatsMap }: PlayerCardProps) => {
  // Before the early return — hooks run on every render, empty slot or not.
  const isMobile = useIsMobile();

  if (!player) {
    // "Empty", not "Empty Slot": the centre column already says WHICH slot
    // (the desktop label, the mobile chip), so the card only has to say
    // that nobody is in it.
    return (
      <div className={cn('player-card player-card-empty', isUserTeam ? 'user-team' : 'opponent-team', 'opacity-50')}>
        <div className="player-card-content">
          <div className="player-card-header">
            <div className="player-header-left">
              <div className="player-name">Empty</div>
              <div className="hidden lg:block text-white/55 text-xs">No player assigned</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const displayName = formatPlayerName(player.name, isMobile);
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

  // WEEK VIEW (2026-09-01, audit M9). With no day selected the page shows
  // the whole matchup week — the total row sums the week, the ScoreCard
  // shows the week — but the mobile score stack used to show TONIGHT's
  // number, and the weekly "F Pts" box with its scoring breakdown is
  // display:none on phones (index.css). So the phone had no way to reach
  // "what did he score this week, and for what". The stack now follows
  // the view's scope: week total (tap → weekly breakdown) in week view,
  // the day's number (tap → daily breakdown) in day view. Same sentinel as
  // MatchupComparison's isShowingDailyView, so row and total agree.
  const isWeekView = selectedDate === null || selectedDate === undefined;
  const weekPoints = typeof player.total_points === 'number' && Number.isFinite(player.total_points)
    ? player.total_points
    : 0;
  const weekBreakdown =
    player.stats_breakdown && typeof player.stats_breakdown === 'object' && Object.keys(player.stats_breakdown).length > 0
      ? player.stats_breakdown
      : undefined;
  // Tonight's game still to come, with a number on it: shown under the
  // week total as "+4.2" (orange = forecast), tappable for its breakdown.
  const tonightPending = hasGameOnDate && !isGameFinal && !isGameLive && !gameHasStarted && !!hasProjection && isStarterConfirmed;
  const tonightLive = hasGameOnDate && (isGameLive || (gameHasStarted && !isGameFinal));

  // OPPONENT TINT (2026-09-01, audit M10): the model's opponent multiplier
  // for this date colours the `vs/@ OPP` label — sage easier, orange-soft
  // tougher, default within ±5%. The projection tooltip carries the
  // legend, so the colour is never bare.
  const oppTint = opponentTint(player.daily_projection?.opponent_adjustment);
  
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
      
      // SWEEP FIX (2026-08-16): the ingest hasn't populated GSAx yet — every
      // goalie carries 0, and a card full of "+0.0" reads as broken. Show
      // the chip only when a real (non-zero) value exists; wins fill the
      // slot meanwhile.
      const gsax = player.goalieStats?.goalsSavedAboveExpected;
      if (gsax !== undefined && gsax !== null && gsax !== 0) {
        const gsaxSign = gsax >= 0 ? '+' : '';
        stats.push({
          label: 'GSAx',
          value: `${gsaxSign}${gsax.toFixed(1)}`
        });
      } else {
        stats.push({ label: 'W', value: String(player.goalieStats?.wins ?? 0) });
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
        // Bench: subdued, still legible. The old opacity-40 + grayscale left
        // a bench row at ~2:1 — a manager checking whether the guy on the
        // bench is outscoring the guy in the lineup could not read either.
        isBench && 'opacity-70 bg-muted/50 border-muted',
        player.wasDropped && !isBench && 'border-pastel-orange/30 bg-pastel-orange/5 opacity-95'
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
                  className="ml-1 text-[10px] leading-tight px-1 py-0"
                  title={`Roster Status: ${player.roster_status || 'IR'}`}
                >
                  IR
                </Badge>
              ) : null}
              {/* Dropped Badge - Display if player was dropped but points still count */}
              {player.wasDropped ? (
                <Badge 
                  variant="secondary"
                  className="ml-1 text-[10px] leading-tight px-1 py-0 border-pastel-orange/40 bg-pastel-orange/20 text-pastel-orange font-semibold"
                  title="Player was dropped but points still count from when they were in the lineup"
                >
                  Dropped
                </Badge>
              ) : null}
            </div>
            {/* Team Name - Below player name. `player-meta-row` lets the
                mobile stylesheet right-align this line on the opponent
                (mirrored) card. */}
            <div className="player-meta-row flex items-center gap-1">
              {player.team && (
                <span className="player-team-name" title={player.team}>
                  {player.team}
                </span>
              )}
              {/* Today's Game Info - MOBILE ONLY - Show game status, time, and live score */}
              {(() => {
                const todayStr = getTodayMST();
                const dateToShow = selectedDate || todayStr;
                const todaysGame = player.games?.find(g => g.game_date?.split('T')[0] === dateToShow);
                if (!todaysGame) return null;
                const isHome = todaysGame.home_team?.toUpperCase() === player.team?.toUpperCase();
                const opponent = isHome ? todaysGame.away_team : todaysGame.home_team;
                const opPrefix = isHome ? 'vs' : '@';
                const logoUrl = `https://assets.nhle.com/logos/nhl/svg/${opponent?.toUpperCase()}_light.svg`;
                const gameStatus = (todaysGame.status || 'scheduled').toLowerCase();
                const isLive = gameStatus === 'live' || gameStatus === 'intermission' || gameStatus === 'crit';
                const isFinal = gameStatus === 'final';
                const homeScore = todaysGame.home_score ?? 0;
                const awayScore = todaysGame.away_score ?? 0;
                const hasScores = homeScore > 0 || awayScore > 0;

                return (
                  /* ONE LINE THAT TRUNCATES, NEVER WRAPS (2026-09-02).
                     `flex-wrap` in an 85px name block put the live badge and
                     the score on a second and third line — and the mobile
                     card is `max-height: 64px; overflow: hidden`, so those
                     lines were not shown small, they were CUT. Nowrap +
                     min-w-0 + overflow-hidden makes the overflow an ellipsis
                     on the one shrinkable child instead.

                     TYPE (2026-09-02): the opponent label is the game's
                     identity and rides the scale's META rung (12px), level
                     with the team abbreviation beside it, which used to be
                     11px against this label's 10px — two halves of one line
                     disagreeing. Everything after it is a state qualifier
                     that only some rows carry, and it stays on the MICRO
                     rung: at 393px this column is 85px, the logo plus
                     "vs TOR" at 12px already spends 55px of it, and
                     promoting "TOR 1-2, P2" to 12px would push the score
                     under the ellipsis on every live row. Small and present
                     beats large and truncated. */
                  <div className="lg:hidden flex items-center gap-1 min-w-0 overflow-hidden">
                    {/* Opponent logo + abbrev, tinted by expected difficulty (M10) */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <img loading="lazy" decoding="async" src={logoUrl} alt={opponent || ''} className="w-3.5 h-3.5 object-contain" />
                      <span
                        className={cn('player-opponent', ROW_META, 'font-display font-semibold', oppTint.className)}
                        data-opponent-tier={oppTint.tier}
                      >
                        {opPrefix} {opponent}
                      </span>
                    </div>
                    {/* Live badge + score */}
                    {isLive && (
                      <span className={cn('inline-flex items-center gap-0.5 shrink-0 font-bold px-1 py-0.5 rounded-sm bg-red-500/15 text-red-600 border border-red-500/30 animate-pulse', ROW_MICRO, 'leading-none')}>
                        <span className="w-1 h-1 rounded-full bg-red-500" />
                        LIVE
                      </span>
                    )}
                    {isLive && hasScores && (
                      <span className={cn(ROW_MICRO, 'font-display font-bold text-pastel-cream truncate')}>
                        {isHome
                          ? `${player.team} ${homeScore}-${awayScore}`
                          : `${player.team} ${awayScore}-${homeScore}`}
                        {todaysGame.period ? `, ${todaysGame.period}` : ''}
                      </span>
                    )}
                    {/* Final badge + score */}
                    {isFinal && (
                      <span className={cn(ROW_MICRO, 'leading-none shrink-0 font-bold px-1 py-0.5 rounded-sm bg-white/10 text-white/60 border border-white/20')}>
                        F
                      </span>
                    )}
                    {isFinal && hasScores && (
                      <span className={cn(ROW_MICRO, 'font-display font-semibold text-white/60 shrink-0')}>
                        {isHome
                          ? `${homeScore}-${awayScore}`
                          : `${awayScore}-${homeScore}`}
                      </span>
                    )}
                    {/* Scheduled: show game time */}
                    {!isLive && !isFinal && player.gameInfo?.time && (
                      <span className={cn(ROW_MICRO, 'font-display text-white/55 truncate')}>
                        {player.gameInfo.time}
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
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
                  <div className="mt-1 text-[10px] font-semibold text-pastel-orange flex items-center gap-1">
                    <span className="inline-flex items-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-pastel-orange mr-1" />
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

        {/* Game Logos Bar - HIDDEN ON MOBILE */}
        {player.games && Array.isArray(player.games) && player.games.length > 0 && player.team && (
          <div className="hidden lg:block -mt-1 mb-0 px-0.5 py-0 bg-gradient-to-r from-pastel-sage/5 via-pastel-sage/5 to-pastel-sage/5 rounded border border-pastel-sage/20">
            <GameLogosBar 
              games={player.games} 
              playerTeam={player.team}
              selectedDate={selectedDate}
            />
          </div>
        )}

        {/* Daily Points Bar OR Projection Bar - VARSITY SCOREBOARD STYLE - COMPACT */}
        {!hasGameOnDate && !hasDailyStats ? (
          // CASE 1: NO GAME scheduled for this date AND no daily stats - Show "No game today"
          <div className="player-projection-bar-container">
            <div className="w-full py-1 text-center font-display text-xs text-white/60 bg-[#1A2A20] backdrop-blur-sm/50 rounded border border-dashed border-pastel-sage/30 italic">
              No game {isInDailyViewMode ? 'this day' : 'today'}
            </div>
          </div>
        ) : shouldShowDailyPoints ? (
          // CASE 2: Show daily total points (game is FINAL and data exists)
          <div className="player-projection-bar-container relative bg-gradient-to-br from-pastel-sage/10 via-white/30 to-pastel-sage/10 p-1 rounded border border-pastel-sage/30 shadow-sm">
            {/* Label - Varsity Badge Style - HIDDEN ON DESKTOP, SHOWN ON MOBILE */}
            <div className="lg:hidden flex text-[8px] font-varsity font-bold text-pastel-cream uppercase tracking-wider mb-0.5 items-center gap-0.5 bg-[#1A2A20] backdrop-blur-sm/70 px-1 py-0 rounded border border-pastel-sage/30 w-fit mx-auto">
              <span className="w-1 h-1 rounded-full bg-pastel-sage animate-pulse" />
              Daily Points
            </div>
            {/* Label - Varsity Badge Style - HIDDEN ON MOBILE */}
            <div className="hidden lg:flex text-[7px] font-varsity font-bold text-pastel-cream uppercase tracking-wider mb-0.5 items-center gap-0.5 bg-[#1A2A20] backdrop-blur-sm/70 px-1 py-0 rounded border border-pastel-sage/30 w-fit">
              <span className="w-1 h-1 rounded-full bg-pastel-sage animate-pulse" />
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
                <span className="text-xs font-varsity font-black text-pastel-orange bg-pastel-sage/30 px-1.5 py-0.5 rounded border border-pastel-sage/50 shadow-[inset_0_1px_1px_rgba(0,0,0,0.1)]">
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
                        ? 'border-2 border-dashed border-pastel-sage/30 bg-[#1A2A20] backdrop-blur-sm/50' 
                        : 'bg-[#1A2A20] backdrop-blur-sm border-2 border-pastel-sage/40'
                      }`}
                  >
                    {/* Actual points fill (green gradient) */}
                    {isFilled && (
                      <div className="w-full h-full bg-gradient-to-br from-pastel-sage via-[#7CB518] to-pastel-sage shadow-[inset_0_1px_2px_rgba(255,255,255,0.3)]" />
                    )}
                    {isPartialFilled && (
                      <div 
                        className="h-full bg-gradient-to-br from-pastel-sage/70 via-[#7CB518]/70 to-pastel-sage/70" 
                        style={{ width: `${dailyPartialChunk * 100}%` }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          // CASE 3: Show projection bar (game not final yet) - VARSITY SCOREBOARD - COMPACT
          <div className="player-projection-bar-container relative bg-gradient-to-br from-pastel-sage/10 via-white/30 to-pastel-sage/10 p-1 rounded border border-pastel-sage/40 shadow-sm">
            {/* Label - MOBILE */}
            <div className="lg:hidden flex text-[8px] font-varsity font-bold text-pastel-cream uppercase tracking-wider mb-0.5 items-center gap-0.5 bg-[#1A2A20] backdrop-blur-sm/70 px-1 py-0 rounded border border-pastel-sage/40 w-fit mx-auto">
              <span className="w-1 h-1 rounded-full bg-pastel-orange animate-pulse" />
              Projected
            </div>
            {/* Label + Confidence Badge - DESKTOP */}
            <div className="hidden lg:flex text-[7px] font-varsity font-bold text-pastel-cream uppercase tracking-wider mb-0.5 items-center gap-1 w-full">
              <div className="flex items-center gap-0.5 bg-[#1A2A20] backdrop-blur-sm/70 px-1 py-0 rounded border border-pastel-sage/40 w-fit">
                <span className="w-1 h-1 rounded-full bg-pastel-orange animate-pulse" />
                Projected
              </div>
              {/* Confidence label badge */}
              {hasProjection && dailyProjection?.confidence_label && (
                <span className={`text-[7px] px-1 py-0 rounded font-bold ${
                  dailyProjection.confidence_label === 'High' ? 'bg-pastel-sage/20 text-pastel-sage-soft border border-pastel-sage/30' :
                  dailyProjection.confidence_label === 'Medium' ? 'bg-pastel-butter/20 text-pastel-butter border border-pastel-butter/30' :
                  'bg-pastel-orange/20 text-pastel-orange-soft border border-pastel-orange/30'
                }`}>
                  {dailyProjection.confidence_label}
                </span>
              )}
            </div>
            {/* Centered total above bar - Premium Badge - COMPACT */}
            <div className="flex justify-center items-center gap-1 mb-0.5">
              {hasProjection && isStarterConfirmed && dailyProjection ? (
                isGoalie ? (
                  <GoalieProjectionTooltip projection={player.goalieProjection}>
                    <span className="text-xs font-varsity font-black text-pastel-orange bg-pastel-sage/30 px-1.5 py-0.5 rounded border border-pastel-sage/50 shadow-[inset_0_1px_1px_rgba(0,0,0,0.1)] cursor-pointer hover:text-pastel-cream transition-all">
                      {projectedPoints.toFixed(1)} pts
                    </span>
                  </GoalieProjectionTooltip>
                ) : (
                  <ProjectionTooltip projection={player.daily_projection}>
                    <span className="text-xs font-varsity font-black text-pastel-orange bg-pastel-sage/30 px-1.5 py-0.5 rounded border border-pastel-sage/50 shadow-[inset_0_1px_1px_rgba(0,0,0,0.1)] cursor-pointer hover:text-pastel-cream transition-all">
                      {projectedPoints.toFixed(1)} pts
                    </span>
                  </ProjectionTooltip>
                )
              ) : (
                <span className="text-xs font-varsity font-black text-pastel-orange bg-pastel-sage/30 px-1.5 py-0.5 rounded border border-pastel-sage/50 shadow-[inset_0_1px_1px_rgba(0,0,0,0.1)]">
                  {showTBD
                    ? (isGoalie && !isStarterConfirmed ? 'Probable' : 'TBD')
                    : '0.0 pts'
                  }
                </span>
              )}
            </div>
            {/* Likely Range - "3.2 – 5.8 likely" (50% CI) - HIDDEN ON MOBILE */}
            {hasProjection && isStarterConfirmed && dailyProjection?.likely_low != null && dailyProjection?.likely_high != null && (
              <div className="hidden lg:flex justify-center mb-0.5">
                <span className="text-[8px] font-display text-white/55">
                  Likely: {dailyProjection.likely_low.toFixed(1)} – {dailyProjection.likely_high.toFixed(1)}
                </span>
              </div>
            )}
            {/* Confidence Bar - gradient fill matching PlayerStatsModal style */}
            {hasProjection && isStarterConfirmed && dailyProjection?.dynamic_confidence != null ? (
              <div className="flex items-center gap-1 w-full">
                <div className="flex-1 h-1.5 bg-pastel-sage/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-pastel-sage to-pastel-orange rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(dailyProjection.dynamic_confidence * 100, 100)}%` }}
                  />
                </div>
                <span className="text-[8px] font-varsity font-black text-pastel-cream min-w-[20px] text-right">
                  {Math.round(dailyProjection.dynamic_confidence * 100)}%
                </span>
              </div>
            ) : hasProjection && isStarterConfirmed ? (
              <div className="flex gap-0.5 w-full">
                {Array.from({ length: maxBarPoints }, (_, i) => {
                  const isFilled = i < projectionFilledChunks;
                  const isPartial = i === projectionFilledChunks && projectionPartialChunk > 0;
                  return (
                    <div
                      key={i}
                      className={`flex-1 h-2 rounded overflow-hidden transition-all duration-300
                        ${!isFilled && !isPartial
                          ? 'border-2 border-dashed border-pastel-sage/30 bg-[#1A2A20] backdrop-blur-sm/50'
                          : 'bg-[#1A2A20] backdrop-blur-sm border-2 border-pastel-sage/40'
                        }`}
                    >
                      {isFilled && (
                        <div className="w-full h-full bg-gradient-to-br from-pastel-orange via-pastel-sage to-pastel-orange shadow-[inset_0_1px_2px_rgba(255,255,255,0.3)]" />
                      )}
                      {isPartial && (
                        <div
                          className="h-full bg-gradient-to-br from-pastel-orange/70 via-pastel-sage/70 to-pastel-orange/70"
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
                    className="flex-1 h-2 rounded border border-dashed border-pastel-sage/30 bg-[#1A2A20] backdrop-blur-sm/50 animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="flex gap-0.5 w-full">
                {Array.from({ length: maxBarPoints }, (_, i) => (
                  <div
                    key={i}
                    className="flex-1 h-2 rounded border border-dashed border-pastel-sage/30 bg-[#1A2A20] backdrop-blur-sm/50"
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile-only headshot (2026-09-01, audit M4). A 28px mug on the
          gutter side of the name block, between it and the score stack —
          the same DOM order on both cards, so the stylesheet's row-reverse
          mirrors it: `name · face · number | chip | number · face · name`.
          Each number therefore carries the face it belongs to, and the two
          faces meet across the slot chip the way the two numbers already
          did. Headshot → crest → initials (Mug), never a broken image, and
          a 14px crest badge names the team the way the roster rows do — on
          the corner facing the gutter, so the mirror holds.

          Mobile only. On desktop the card is already name + stats box +
          seven-crest GameLogosBar + projection bar, and at the 1024px
          breakpoint its name column is ~130px — a 36px mug there turns
          "Auston Matthews" into an ellipsis on every row. */}
      <Mug
        p={player}
        size="xs"
        crest
        crestSide={isUserTeam ? 'right' : 'left'}
        className="player-mug lg:hidden"
      />

      {/* Mobile-only score stack (2026-09-01) — sits at the gutter beside the
          slot chip on BOTH cards (the opponent card is mirrored by the
          stylesheet, so this block is the innermost element on each side).

          One colour pair, app-wide: sage = a number that has happened
          (live/final), orange = a number that is still a forecast. Once a
          game is live or final the actual sits over "proj 4.2" so the beat
          / miss reads at a glance. Bench rows carry cream — no state colour,
          because the number does not count. Tappable: the actual opens the
          scoring breakdown, the projection opens the projection breakdown.

          The stack is a fixed 38px column (index.css) so the mug beside it
          lines up row after row; "proj" and its number therefore sit on two
          lines rather than one — the width the one-liner needed is the
          width the face now has.

          Scope follows the view (audit M9): in WEEK view the number is the
          player's week so far and the tap opens the weekly scoring
          breakdown — the "F Pts" box the desktop card carries and phones
          never could reach; under it, tonight's projection ("+4.2", its own
          tap → projection breakdown) while his game is still to come, "live"
          while it is on, else the scope label. In DAY view it is the day's
          number as before. */}
      <div
        className={cn(
          'player-mobile-score lg:hidden flex flex-col justify-center leading-none',
          isUserTeam ? 'items-end text-right' : 'items-start text-left',
        )}
        data-side={isUserTeam ? 'user' : 'opponent'}
        data-scope={isWeekView ? 'week' : 'day'}
      >
        {isWeekView ? (
          <>
            {weekBreakdown ? (
              <PointsTooltip breakdown={weekBreakdown} totalPoints={weekPoints}>
                <span className={cn(SCORE_ACTUAL_CLASS, isBench ? 'text-pastel-cream' : 'text-pastel-sage', 'cursor-pointer')}>
                  {weekPoints.toFixed(1)}
                </span>
              </PointsTooltip>
            ) : (
              <span className={cn(SCORE_ACTUAL_CLASS, isBench ? 'text-pastel-cream' : 'text-pastel-sage')}>
                {weekPoints.toFixed(1)}
              </span>
            )}
            {tonightPending && dailyProjection ? (
              isGoalie ? (
                <GoalieProjectionTooltip projection={player.goalieProjection}>
                  <span className={cn('player-score-tonight font-jbmono tabular-nums text-[10px] font-bold leading-none mt-1 cursor-pointer', isBench ? 'text-pastel-cream' : 'text-pastel-orange')}>
                    +{projectedPoints.toFixed(1)}
                  </span>
                </GoalieProjectionTooltip>
              ) : (
                <ProjectionTooltip projection={player.daily_projection}>
                  <span className={cn('player-score-tonight font-jbmono tabular-nums text-[10px] font-bold leading-none mt-1 cursor-pointer', isBench ? 'text-pastel-cream' : 'text-pastel-orange')}>
                    +{projectedPoints.toFixed(1)}
                  </span>
                </ProjectionTooltip>
              )
            ) : (
              <span className={cn('player-score-label', ROW_HEADLINE_LABEL, 'mt-1 text-white/55')}>
                {tonightLive ? 'live' : 'week'}
              </span>
            )}
          </>
        ) : !hasGameOnDate && !hasDailyStats ? (
          // No game on this date and nothing scored — say so, not "0.0".
          <span className="player-score-none text-white/55 text-[10px] font-display italic leading-tight">
            No game
          </span>
        ) : shouldShowDailyPoints ? (
          // Live / final / started: the actual number, tappable when a
          // breakdown exists, over the projection it is measured against.
          <>
            {player.daily_stats_breakdown && Object.keys(player.daily_stats_breakdown).length > 0 ? (
              <PointsTooltip
                breakdown={player.daily_stats_breakdown}
                totalPoints={dailyTotalPoints}
              >
                <span className={cn(SCORE_ACTUAL_CLASS, isBench ? 'text-pastel-cream' : 'text-pastel-sage', 'cursor-pointer')}>
                  {dailyTotalPoints.toFixed(1)}
                </span>
              </PointsTooltip>
            ) : (
              <span className={cn(SCORE_ACTUAL_CLASS, isBench ? 'text-pastel-cream' : 'text-pastel-sage')}>
                {dailyTotalPoints.toFixed(1)}
              </span>
            )}
            {hasProjection ? (
              // Label over number: two flex-column lines; the whitespace
              // text node between them keeps the text "proj 4.2" for
              // copy/paste and assistive tech while rendering nothing.
              <span className={cn('player-score-proj', ROW_HEADLINE_LABEL, 'tabular-nums mt-1 text-white/55 flex flex-col gap-px')}>
                <span className="uppercase">proj</span>{' '}
                <span className="normal-case">{projectedPoints.toFixed(1)}</span>
              </span>
            ) : (
              <span className={cn('player-score-label', ROW_HEADLINE_LABEL, 'mt-1 text-white/55')}>
                {isGameLive || (gameHasStarted && !isGameFinal) ? 'live' : 'final'}
              </span>
            )}
          </>
        ) : hasProjection && projectedPoints > 0 ? (
          // Yet to play: the forecast, tappable for its breakdown.
          <>
            {isGoalie ? (
              <GoalieProjectionTooltip projection={player.goalieProjection}>
                <span className={cn(SCORE_ACTUAL_CLASS, isBench ? 'text-pastel-cream' : 'text-pastel-orange', 'cursor-pointer')}>
                  {projectedPoints.toFixed(1)}
                </span>
              </GoalieProjectionTooltip>
            ) : (
              <ProjectionTooltip projection={player.daily_projection}>
                <span className={cn(SCORE_ACTUAL_CLASS, isBench ? 'text-pastel-cream' : 'text-pastel-orange', 'cursor-pointer')}>
                  {projectedPoints.toFixed(1)}
                </span>
              </ProjectionTooltip>
            )}
            <span className={cn('player-score-label', ROW_HEADLINE_LABEL, 'mt-1 text-white/55')}>
              proj
            </span>
          </>
        ) : (
          // Has a game but no projection yet. "TBD" is what this row's
          // headline slot holds, so it wears the headline rung (13px was a
          // third size in a column that only has two jobs).
          <>
            <span className={cn('player-score-tbd', ROW_HEADLINE, 'text-pastel-cream/80')}>
              TBD
            </span>
            <span className={cn('player-score-label', ROW_HEADLINE_LABEL, 'mt-1 text-white/55')}>
              proj
            </span>
          </>
        )}
      </div>
    </div>
  );
});

PlayerCard.displayName = 'PlayerCard';

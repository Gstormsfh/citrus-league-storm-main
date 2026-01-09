import { NHLGame } from "@/services/ScheduleService";
import { getTeamColor } from "@/utils/teamColors";
import { getTodayMST, getTodayMSTDate, isTodayMST, formatTimeMST } from "@/utils/timezoneUtils";

interface GameLogosBarProps {
  games: NHLGame[]; // Games for the matchup week
  playerTeam: string; // Player's team abbreviation
  selectedDate?: string | null; // Optional: date being viewed (YYYY-MM-DD), defaults to today
}

export const GameLogosBar = ({ games, playerTeam, selectedDate }: GameLogosBarProps) => {
  if (!games || games.length === 0 || !playerTeam) {
    return null;
  }
  
  // Use Mountain Time for all date comparisons
  const todayMST = getTodayMSTDate();
  const todayStr = getTodayMST();
  
  // Use selectedDate if provided, otherwise default to today
  const viewDateStr = selectedDate || todayStr;
  
  // Sort games by date, with error handling
  const sortedGames = [...games]
    .filter(game => game && game.game_date) // Filter out invalid games
    .sort((a, b) => {
      try {
        const dateA = new Date(a.game_date);
        const dateB = new Date(b.game_date);
        return dateA.getTime() - dateB.getTime();
      } catch {
        return 0;
      }
    });
  
  if (sortedGames.length === 0) {
    return null;
  }
  
  return (
    <div className="flex gap-1.5 items-center flex-wrap justify-center py-0.5 -mt-1">
      {sortedGames.map((game, idx) => {
        try {
          const gameDateStr = game.game_date.split('T')[0];
          
          // Determine game state based on the selected/viewing date
          // If selectedDate is provided, use that date; otherwise use today
          const isSelectedDate = gameDateStr === viewDateStr; // Game is on the date being viewed
          const isToday = isTodayMST(gameDateStr); // Also check if it's actually today (for "Today" label)
          
          // Determine if game is live - show live indicator if:
          // 1. Game status is 'live' or 'intermission' (from DB)
          // 2. AND it's actually today (can't have a live game in the past or future)
          // The isSelectedDate check is removed so live games ALWAYS show as live regardless of which date you're viewing
          const gameStatusLower = (game.status || '').toLowerCase();
          const isLive = (gameStatusLower === 'live' || gameStatusLower === 'intermission' || gameStatusLower === 'crit') && isToday;
          
          // Check if game is in the past relative to the viewing date
          // If viewing a specific date, compare to that date; otherwise compare to today
          // CRITICAL: If game is in the past and marked as "scheduled", treat it as final
          // This handles cases where database hasn't been updated yet
          const isPastDate = gameDateStr < viewDateStr;
          const effectiveStatus = (isPastDate && game.status === 'scheduled') ? 'final' : game.status;
          
          const isPlayed = !isLive && (effectiveStatus === 'final' || isPastDate);
          const isSelectedDateScheduled = isSelectedDate && effectiveStatus === 'scheduled' && !isLive; // Selected date but not started
          const isUpcoming = !isPlayed && !isSelectedDate && !isLive; // Future games relative to viewing date
          
          // Determine opponent - handle cases where playerTeam might not match
          const playerTeamUpper = (playerTeam || '').toUpperCase();
          const homeTeamUpper = (game.home_team || '').toUpperCase();
          const awayTeamUpper = (game.away_team || '').toUpperCase();
          
          const isHome = homeTeamUpper === playerTeamUpper;
          const opponent = isHome ? (game.away_team || '') : (game.home_team || '');
          
          if (!opponent) {
            return null; // Skip if we can't determine opponent
          }
          
          const opponentPrefix = isHome ? 'vs' : '@';
          
          // Get team color for border
          const teamColor = getTeamColor(opponent);
          
          // Team logo URL from NHL assets
          const logoUrl = `https://assets.nhle.com/logos/nhl/svg/${opponent.toUpperCase()}_light.svg`;
          
          // Format game time in MST for tooltip
          let formattedTime = '';
          if (game.game_time) {
            try {
              const timeStr = String(game.game_time).trim();
              
              // Skip invalid/placeholder times
              if (!timeStr || 
                  timeStr === 'null' || 
                  timeStr === 'undefined' ||
                  timeStr.includes('0000-00-00') || 
                  timeStr === '0000-00-00 00:00:00') {
                // Invalid time - skip formatting
                formattedTime = '';
              } else {
                // Parse game_time (should be ISO string or timestamptz from database)
                const gameTimeDate = new Date(timeStr);
                
                // Validate the date is valid and reasonable (year between 2000 and 2100)
                if (!isNaN(gameTimeDate.getTime()) && 
                    gameTimeDate.getFullYear() >= 2000 && 
                    gameTimeDate.getFullYear() < 2100) {
                  
                  // Check if this is a placeholder midnight UTC time on the same date as game_date
                  // Only filter if it's exactly midnight UTC AND the date matches game_date (likely placeholder)
                  const isMidnightUTC = timeStr.endsWith('T00:00:00Z') || 
                                       timeStr.endsWith('T00:00:00+00:00') ||
                                       /T00:00:00\+00:00$/.test(timeStr);
                  
                  if (isMidnightUTC) {
                    // Check if the UTC date matches the game_date (likely a placeholder)
                    const utcDateStr = gameTimeDate.toISOString().split('T')[0];
                    if (utcDateStr === gameDateStr) {
                      // Same date at midnight UTC = likely placeholder, skip
                      formattedTime = '';
                    } else {
                      // Different date = valid time (e.g., Dec 19 game at midnight UTC = Dec 20 UTC = valid evening game)
                      formattedTime = gameTimeDate.toLocaleTimeString('en-US', {
                        timeZone: 'America/Denver',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      });
                    }
                  } else {
                    // Not midnight UTC, definitely valid
                    formattedTime = gameTimeDate.toLocaleTimeString('en-US', {
                      timeZone: 'America/Denver',
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true
                    });
                  }
                }
              }
            } catch (e) {
              // Silently skip invalid times - don't spam console
              formattedTime = '';
            }
          }
          
          // PREMIUM DESIGN: Compact logos with surfer varsity styling
          // Base container - COMPACT (8x8 instead of 12x12)
          let containerClasses = 'relative w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 bg-citrus-cream/50 backdrop-blur-sm';
          let borderStyle: React.CSSProperties | undefined;
          let glowEffect = '';
          
          if (isLive) {
            // 3. Live games - pulsing orange glow with compact border
            containerClasses += ' border-2 opacity-100 border-citrus-orange shadow-sm';
            glowEffect = 'animate-pulse';
            borderStyle = { 
              borderColor: '#DF7536', 
              boxShadow: '0 0 8px rgba(223, 117, 54, 0.6), 0 0 12px rgba(223, 117, 54, 0.4)' 
            };
          } else if (isPlayed) {
            // 1. Past games - subtle sage border, reduced opacity
            containerClasses += ' border opacity-40 grayscale border-citrus-sage/40';
          } else if (isSelectedDateScheduled) {
            // 2. Selected date's games - SAGE GREEN GLOW! (compact)
            containerClasses += ' border-2 opacity-100 shadow-sm border-citrus-sage';
            borderStyle = { 
              borderColor: '#AAD1A3', 
              boxShadow: '0 0 8px rgba(170, 209, 163, 0.6), 0 0 12px rgba(170, 209, 163, 0.4)' 
            };
          } else if (isUpcoming) {
            // 4. Upcoming games - peach border (softer)
            containerClasses += ' border opacity-100 border-citrus-peach/60';
          } else {
            // Fallback
            containerClasses += ' border opacity-100 border-citrus-sage/40';
            borderStyle = { borderColor: teamColor };
          }
          
          // Build tooltip text with properly formatted time
          let tooltipText = `${opponentPrefix} ${opponent} - ${gameDateStr}`;
          if (isLive) {
            tooltipText += ' (LIVE)';
          } else if (isSelectedDateScheduled) {
            // Show "Today" if it's actually today, otherwise show the date
            if (isToday) {
            tooltipText += formattedTime ? ` (Today at ${formattedTime} MST)` : ' (Today)';
            } else {
              tooltipText += formattedTime ? ` (${formattedTime} MST)` : ` (${gameDateStr})`;
            }
          } else if (isPlayed) {
            tooltipText += ' (Final)';
          } else if (isUpcoming) {
            tooltipText += formattedTime ? ` (${formattedTime} MST)` : ' (Upcoming)';
          }
          
          // Format date for display - show "Today" only if it's actually today
          // Use the same date parsing method as WeeklySchedule to ensure consistency
          let displayDate = '';
          if (isToday && (isSelectedDateScheduled || isLive)) {
            displayDate = 'Today';
          } else {
            // Parse date string (YYYY-MM-DD) to avoid timezone issues - same method as WeeklySchedule
            try {
              const [year, month, day] = gameDateStr.split('-').map(Number);
              const date = new Date(year, month - 1, day); // Month is 0-indexed, local timezone
              displayDate = date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
              });
            } catch {
              displayDate = gameDateStr;
            }
          }
          
          // Format game score if available (for live or final games)
          // NEVER show 0-0 scores - it's impossible for a hockey game to end 0-0
          let gameScore = '';
          if ((isLive || isPlayed) && game.home_score !== undefined && game.away_score !== undefined) {
            const homeScore = game.home_score ?? 0;
            const awayScore = game.away_score ?? 0;
            
            // Only show score if at least one team has scored (never show 0-0)
            if (homeScore !== 0 || awayScore !== 0) {
              // Determine if player's team is home or away
              const isPlayerHome = game.home_team === playerTeam;
              if (isPlayerHome) {
                // Player's team is home: "EDM 3-2 TOR"
                gameScore = `${game.home_team} ${homeScore}-${awayScore} ${game.away_team}`;
              } else {
                // Player's team is away: "TOR 2-3 EDM"
                gameScore = `${game.away_team} ${awayScore}-${homeScore} ${game.home_team}`;
              }
            }
          }
          
          return (
            <div key={idx} className="flex flex-col items-center gap-0.5">
              <div
                className={`${containerClasses} ${glowEffect} group cursor-pointer`}
                style={borderStyle}
                title={tooltipText}
              >
                {/* Premium Gradient Overlay on Hover */}
                <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-citrus-sage/0 to-citrus-orange/0 group-hover:from-citrus-sage/10 group-hover:to-citrus-orange/10 transition-all duration-300"></div>
                
                {/* Team Logo - COMPACT */}
                <img
                  src={logoUrl}
                  alt={opponent}
                  className={`w-6 h-6 object-contain relative z-10 transition-transform duration-300 group-hover:scale-110 ${isLive ? 'brightness-110' : ''}`}
                  onError={(e) => {
                    // Fallback to text abbreviation if logo fails to load
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent && !parent.querySelector('.fallback-text')) {
                      const fallback = document.createElement('span');
                      fallback.className = 'fallback-text text-sm font-varsity font-black relative z-10';
                      fallback.textContent = opponent;
                      fallback.style.color = isPlayed ? '#9CA3AF' : teamColor;
                      parent.appendChild(fallback);
                    }
                  }}
                />
                
                {/* Live Badge - COMPACT */}
                {isLive && (
                  <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-gradient-to-br from-citrus-orange via-citrus-orange to-red-500 rounded border border-citrus-cream shadow-sm animate-pulse">
                    <div className="absolute inset-0 bg-citrus-orange rounded animate-ping opacity-75"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[6px] font-varsity font-black text-citrus-cream relative z-10">L</span>
                    </div>
                    <span className="sr-only">Live</span>
                  </div>
                )}
                
                {/* Selected Date Badge - COMPACT */}
                {isSelectedDateScheduled && (
                  <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-gradient-to-br from-citrus-sage to-citrus-sage/80 rounded border border-citrus-forest shadow-sm">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[6px] font-varsity font-black text-citrus-forest">T</span>
                    </div>
                    <span className="sr-only">{isToday ? 'Today' : 'Scheduled'}</span>
                  </div>
                )}
              </div>
              
              {/* Game Score Display - COMPACT */}
              {gameScore && (
                <span className="game-score-display text-[7px] leading-tight whitespace-nowrap text-citrus-forest font-display font-bold">
                  {gameScore}
                </span>
              )}
              
              {/* Live Game Period & Time - COMPACT */}
              {isLive && game.period && (
                <span className="text-[7px] leading-tight whitespace-nowrap text-citrus-orange font-varsity font-black animate-pulse">
                  {game.period}{game.period_time ? ` ${game.period_time}` : ''}
                </span>
              )}
              
              {/* Date Display - COMPACT */}
              <span className={`text-[8px] leading-tight whitespace-nowrap font-display font-semibold ${
                isPlayed 
                  ? 'text-citrus-charcoal/40' 
                  : isSelectedDate && (isSelectedDateScheduled || isLive)
                    ? 'text-citrus-forest' 
                    : 'text-citrus-charcoal/60'
              }`}>
                {displayDate}
              </span>
            </div>
          );
        } catch (error) {
          console.warn('Error rendering game logo:', error, game);
          return null;
        }
      })}
    </div>
  );
};

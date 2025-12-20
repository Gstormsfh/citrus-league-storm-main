import { NHLGame } from "@/services/ScheduleService";
import { getTeamColor } from "@/utils/teamColors";
import { getTodayMST, getTodayMSTDate, isTodayMST, formatTimeMST } from "@/utils/timezoneUtils";

interface GameLogosBarProps {
  games: NHLGame[]; // Games for the matchup week
  playerTeam: string; // Player's team abbreviation
}

export const GameLogosBar = ({ games, playerTeam }: GameLogosBarProps) => {
  if (!games || games.length === 0 || !playerTeam) {
    return null;
  }
  
  // Use Mountain Time for all date comparisons
  const todayMST = getTodayMSTDate();
  const todayStr = getTodayMST();
  
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
    <div className="flex gap-1.5 items-center flex-wrap">
      {sortedGames.map((game, idx) => {
        try {
          const gameDateStr = game.game_date.split('T')[0];
          const gameDate = new Date(`${gameDateStr}T00:00:00`);
          
          // Determine game state - check live FIRST to prevent live games from being marked as played
          // CRITICAL: Only mark as live if status is 'live' AND it's today (prevent stale live status)
          const isToday = isTodayMST(gameDateStr); // Use MST comparison
          const isLive = game.status === 'live' && isToday; // Must be today AND live
          // Only mark as played if it's final AND not live, or if date is in the past (MST) AND not live
          const isPlayed = !isLive && (game.status === 'final' || (gameDate < todayMST && game.status !== 'live'));
          const isTodayScheduled = isToday && game.status === 'scheduled' && !isLive; // Today but not started
          const isUpcoming = !isPlayed && !isToday && !isLive; // Future games
          
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
          
          // Determine styling based on game state
          // IMPORTANT: Check isLive FIRST to prevent live games from being greyed out
          let containerClasses = 'relative w-8 h-8 rounded flex items-center justify-center transition-all duration-300';
          let borderStyle: React.CSSProperties | undefined;
          let glowEffect = '';
          
          if (isLive) {
            // 3. Live games - pulsing orange/red glow with animation (check FIRST)
            containerClasses += ' border-2 opacity-100 border-orange-500 shadow-lg shadow-orange-500/60';
            glowEffect = 'animate-pulse';
            borderStyle = { borderColor: '#f97316', boxShadow: '0 0 12px rgba(249, 115, 22, 0.6), 0 0 20px rgba(249, 115, 22, 0.4)' };
          } else if (isPlayed) {
            // 1. Past games - greyed out (perfect as is)
            containerClasses += ' border-2 opacity-30 grayscale border-gray-400';
          } else if (isTodayScheduled) {
            // 2. Today's games (scheduled) - colored ring/border around logo
            containerClasses += ' border-2 opacity-100 shadow-md';
            borderStyle = { 
              borderColor: teamColor, 
              boxShadow: `0 0 8px ${teamColor}40, 0 0 12px ${teamColor}20` 
            };
          } else if (isUpcoming) {
            // 4. Upcoming games - NO border, just colored logo (no border class)
            containerClasses += ' opacity-100';
            // No border for upcoming games - just the colored logo
          } else {
            // Fallback
            containerClasses += ' border-2 opacity-100 border-gray-300';
            borderStyle = { borderColor: teamColor };
          }
          
          // Build tooltip text with properly formatted time
          let tooltipText = `${opponentPrefix} ${opponent} - ${gameDateStr}`;
          if (isLive) {
            tooltipText += ' (LIVE)';
          } else if (isTodayScheduled) {
            tooltipText += formattedTime ? ` (Today at ${formattedTime} MST)` : ' (Today)';
          } else if (isPlayed) {
            tooltipText += ' (Final)';
          } else if (isUpcoming) {
            tooltipText += formattedTime ? ` (${formattedTime} MST)` : ' (Upcoming)';
          }
          
          return (
            <div
              key={idx}
              className={`${containerClasses} ${glowEffect}`}
              style={borderStyle}
              title={tooltipText}
            >
              {/* Team Logo */}
              <img
                src={logoUrl}
                alt={opponent}
                className={`w-6 h-6 object-contain ${isLive ? 'brightness-110' : ''}`}
                onError={(e) => {
                  // Fallback to text abbreviation if logo fails to load
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  const parent = target.parentElement;
                  if (parent && !parent.querySelector('.fallback-text')) {
                    const fallback = document.createElement('span');
                    fallback.className = 'fallback-text text-xs font-bold';
                    fallback.textContent = opponent;
                    fallback.style.color = isPlayed ? '#9CA3AF' : teamColor;
                    parent.appendChild(fallback);
                  }
                }}
              />
              
              {/* Live Badge - Enhanced */}
              {isLive && (
                <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-gradient-to-br from-orange-500 to-red-500 rounded-full border-2 border-white shadow-lg animate-pulse">
                  <div className="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-75"></div>
                  <span className="sr-only">Live</span>
                </div>
              )}
              
              {/* Today Badge - for scheduled games today (small dot) */}
              {isTodayScheduled && (
                <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full border border-white shadow-sm" style={{ backgroundColor: teamColor }}>
                  <span className="sr-only">Today</span>
                </div>
              )}
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

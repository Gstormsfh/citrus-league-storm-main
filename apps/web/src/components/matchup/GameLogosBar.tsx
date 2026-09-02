import { NHLGame } from "@/services/ScheduleService";
import { getTeamColor } from "@/utils/teamColors";
import { getTodayMST, getTodayMSTDate, isTodayMST, formatTimeMST } from "@/utils/timezoneUtils";
import { logger } from '@/utils/logger';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useState, useEffect } from "react";
import { X } from "lucide-react";

// Hook to detect mobile/tablet
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
};

/** Wrapper that shows a Popover on mobile tap, title tooltip on desktop */
const GameLogoWithTooltip = ({
  tooltipText,
  isMobile,
  children,
}: {
  tooltipText: string;
  isMobile: boolean;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);

  if (!isMobile) {
    // Desktop: just use native title tooltip
    return <>{children}</>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="touch-manipulation" onClick={(e) => e.stopPropagation()}>
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={6}
        className="bg-[#1A2A20]/95 backdrop-blur-md text-pastel-cream text-xs p-2.5 rounded-varsity border-2 border-pastel-sage/40 shadow-varsity w-auto max-w-[220px] !z-[9999]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-display">{tooltipText}</span>
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            className="text-pastel-sage/60 hover:text-pastel-cream transition-colors flex-shrink-0"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

interface GameLogosBarProps {
  games: NHLGame[]; // Games for the matchup week
  playerTeam: string; // Player's team abbreviation
  selectedDate?: string | null; // Optional: date being viewed (YYYY-MM-DD), defaults to today
}

export const GameLogosBar = ({ games, playerTeam, selectedDate }: GameLogosBarProps) => {
  const isMobile = useIsMobile();

  if (!games || games.length === 0 || !playerTeam) {
    return null;
  }
  
  // Use Mountain Time for all date comparisons
  const todayMST = getTodayMSTDate();
  const todayStr = getTodayMST();
  
  // Use selectedDate if provided, otherwise default to today
  const viewDateStr = selectedDate || todayStr;
  
  // Sort games by date, with error handling
  // Append 'T00:00:00' to force local-time parsing (avoid UTC midnight shift)
  const sortedGames = [...games]
    .filter(game => game && game.game_date) // Filter out invalid games
    .sort((a, b) => {
      try {
        const dateA = new Date(a.game_date.split('T')[0] + 'T00:00:00');
        const dateB = new Date(b.game_date.split('T')[0] + 'T00:00:00');
        return dateA.getTime() - dateB.getTime();
      } catch {
        return 0;
      }
    });
  
  if (sortedGames.length === 0) {
    return null;
  }
  
  return (
    <div className="flex gap-1.5 lg:gap-2 items-center flex-wrap justify-center py-0.5 lg:py-1 -mt-1">
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
          // Base container - slightly larger on desktop
          let containerClasses = 'relative w-8 h-8 lg:w-10 lg:h-10 rounded-lg flex items-center justify-center transition-all duration-300 bg-[#1A2A20] backdrop-blur-sm/50 backdrop-blur-sm';
          let borderStyle: React.CSSProperties | undefined;
          let glowEffect = '';
          
          if (isLive) {
            // 3. Live games - pulsing orange glow with compact border
            containerClasses += ' border-2 opacity-100 border-pastel-orange shadow-sm';
            glowEffect = 'animate-pulse';
            borderStyle = { 
              borderColor: '#DF7536', 
              boxShadow: '0 0 8px rgba(223, 117, 54, 0.6), 0 0 12px rgba(223, 117, 54, 0.4)' 
            };
          } else if (isPlayed) {
            // 1. Past games - subtle sage border, reduced opacity
            containerClasses += ' border opacity-40 grayscale border-pastel-sage/40';
          } else if (isSelectedDateScheduled) {
            // 2. Selected date's games - SAGE GREEN GLOW! (compact)
            containerClasses += ' border-2 opacity-100 shadow-sm border-pastel-sage';
            borderStyle = { 
              borderColor: '#AAD1A3', 
              boxShadow: '0 0 8px rgba(170, 209, 163, 0.6), 0 0 12px rgba(170, 209, 163, 0.4)' 
            };
          } else if (isUpcoming) {
            // 4. Upcoming games - peach border (softer)
            containerClasses += ' border opacity-100 border-pastel-sage/60';
          } else {
            // Fallback
            containerClasses += ' border opacity-100 border-pastel-sage/40';
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
            <GameLogoWithTooltip key={idx} tooltipText={tooltipText} isMobile={isMobile}>
            <div className="flex flex-col items-center gap-0.5">
              <div
                className={`${containerClasses} ${glowEffect} group cursor-pointer`}
                style={borderStyle}
                title={isMobile ? undefined : tooltipText}
              >
                {/* Premium Gradient Overlay on Hover */}
                <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-pastel-sage/0 to-pastel-orange/0 group-hover:from-pastel-sage/10 group-hover:to-pastel-orange/10 transition-all duration-300"></div>
                
                {/* Team Logo - slightly larger on desktop */}
                <img
                  src={logoUrl}
                  alt={opponent}
                  className={`w-6 h-6 lg:w-7 lg:h-7 object-contain relative z-10 transition-transform duration-300 group-hover:scale-110 ${isLive ? 'brightness-110' : ''}`}
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
                
                {/* Live Badge */}
                {isLive && (
                  <div className="absolute -top-1 -right-1 w-3.5 h-3.5 lg:w-4 lg:h-4 bg-gradient-to-br from-pastel-orange via-pastel-orange to-red-500 rounded border border-white/10 shadow-sm animate-pulse">
                    <div className="absolute inset-0 bg-pastel-orange rounded animate-ping opacity-75"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[6px] font-varsity font-black text-pastel-cream relative z-10">L</span>
                    </div>
                    <span className="sr-only">Live</span>
                  </div>
                )}
                
                {/* Selected Date Badge */}
                {isSelectedDateScheduled && (
                  <div className="absolute -top-1 -right-1 w-3.5 h-3.5 lg:w-4 lg:h-4 bg-gradient-to-br from-pastel-sage to-pastel-sage/80 rounded border border-white/10 shadow-sm">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[6px] font-varsity font-black text-pastel-cream">T</span>
                    </div>
                    <span className="sr-only">{isToday ? 'Today' : 'Scheduled'}</span>
                  </div>
                )}
              </div>
              
              {/* Game Score Display */}
              {gameScore && (
                <span className="game-score-display text-[7px] lg:text-[8px] leading-tight whitespace-nowrap text-pastel-cream font-display font-bold">
                  {gameScore}
                </span>
              )}
              
              {/* Live Game Period & Time */}
              {isLive && game.period && (
                <span className="text-[7px] lg:text-[8px] leading-tight whitespace-nowrap text-pastel-orange font-varsity font-black animate-pulse">
                  {game.period}{game.period_time ? ` ${game.period_time}` : ''}
                </span>
              )}
              
              {/* Date Display */}
              <span className={`text-[8px] lg:text-[9px] leading-tight whitespace-nowrap font-display font-semibold ${
                isPlayed
                  ? 'text-white/55'
                  : isSelectedDate && (isSelectedDateScheduled || isLive)
                    ? 'text-pastel-cream'
                    : 'text-white/60'
              }`}>
                {displayDate}
              </span>
            </div>
            </GameLogoWithTooltip>
          );
        } catch (error) {
          logger.warn('Error rendering game logo:', error, game);
          return null;
        }
      })}
    </div>
  );
};

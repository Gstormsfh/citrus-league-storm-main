/**
 * MiniScheduleIcons - Tiny inline schedule icons (max 5, 16px each)
 * Designed to fit in a small space inline with stats
 */

import { NHLGame } from "@/services/ScheduleService";
import { getTodayMST } from "@/utils/timezoneUtils";

interface MiniScheduleIconsProps {
  games: NHLGame[];
  playerTeam: string;
  maxIcons?: number;
}

export const MiniScheduleIcons = ({ games, playerTeam, maxIcons = 5 }: MiniScheduleIconsProps) => {
  if (!games || games.length === 0 || !playerTeam) return null;
  
  const todayStr = getTodayMST();
  
  // Sort games by date and take max
  const sortedGames = [...games]
    .filter(g => g && g.game_date)
    .sort((a, b) => a.game_date.localeCompare(b.game_date))
    .slice(0, maxIcons);
  
  if (sortedGames.length === 0) return null;
  
  return (
    <div className="inline-flex items-center gap-0.5 ml-2">
      {sortedGames.map((game, idx) => {
        const gameDateStr = game.game_date.split('T')[0];
        const isToday = gameDateStr === todayStr;
        const isPast = gameDateStr < todayStr;
        const isLive = game.status === 'live' || game.status === 'intermission';
        const isFinal = game.status === 'final' || isPast;
        
        // Determine opponent
        const playerTeamUpper = playerTeam.toUpperCase();
        const isHome = game.home_team?.toUpperCase() === playerTeamUpper;
        const opponent = isHome ? game.away_team : game.home_team;
        
        if (!opponent) return null;
        
        const logoUrl = `https://assets.nhle.com/logos/nhl/svg/${opponent.toUpperCase()}_light.svg`;
        
        // Style based on game status
        let containerClass = "w-4 h-4 rounded-full flex items-center justify-center overflow-hidden ";
        if (isLive) {
          containerClass += "ring-2 ring-orange-500 bg-orange-100";
        } else if (isToday) {
          containerClass += "ring-2 ring-green-500 bg-green-50";
        } else if (isFinal) {
          containerClass += "opacity-40 grayscale bg-gray-100";
        } else {
          containerClass += "bg-gray-50 border border-gray-200";
        }
        
        return (
          <div 
            key={idx} 
            className={containerClass}
            title={`${isHome ? 'vs' : '@'} ${opponent} - ${gameDateStr}${isLive ? ' (LIVE)' : isFinal ? ' (Final)' : isToday ? ' (Today)' : ''}`}
          >
            <img
              src={logoUrl}
              alt={opponent}
              className="w-3 h-3 object-contain"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

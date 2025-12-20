import { MatchupPlayer } from "./types";
import { cn } from "@/lib/utils";
import { getTeamColor } from "@/utils/teamColors";
import { PointsTooltip } from "./PointsTooltip";
import { GameLogosBar } from "./GameLogosBar";

interface PlayerCardProps {
  player: MatchupPlayer | null;
  isUserTeam: boolean;
  isBench?: boolean;
  onPlayerClick?: (player: MatchupPlayer) => void;
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

export const PlayerCard = ({ player, isUserTeam, isBench = false, onPlayerClick }: PlayerCardProps) => {
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
  
  // Calculate projection for TODAY'S GAMES ONLY
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  
  // Check if player has a game today - with defensive checks
  const todayGames = (player.games && Array.isArray(player.games) && player.games.length > 0)
    ? player.games.filter(g => g && typeof g === 'object' && g.game_date === todayStr) 
    : [];
  const hasGameToday = todayGames.length > 0;
  
  // Calculate projection: average points per game * 1 game (today only)
  const gamesPlayed = player.stats?.gamesPlayed || player.games_played || 1;
  const avgPointsPerGame = gamesPlayed > 0 ? (player.points / gamesPlayed) : 0;
  const projectedPoints = hasGameToday ? avgPointsPerGame * 1 : 0; // Only today's game(s)
  
  // Normalize to 0-100 for bar display (max ~8 points for a single game)
  const maxProjection = 8;
  const projectionPercentage = Math.min((projectedPoints / maxProjection) * 100, 100);
  
  // Get unique stats for top right corner: F Pts, xG, GAR %
  const getUniqueStats = () => {
    const stats: Array<{ label: string; value: string }> = [];
    
    // F Pts - Fantasy Points (MATCHUP WEEK total for mini stats box)
    stats.push({ 
      label: 'F Pts', 
      value: (player.total_points ?? 0).toFixed(1)  // Matchup week total
    });
    
    // xG - Expected Goals (use matchup stats if available, otherwise season stats)
    const xG = player.matchupStats?.xGoals ?? player.stats?.xGoals ?? 0;
    stats.push({ 
      label: 'xG', 
      value: xG.toFixed(1) 
    });
    
    // GAR % - Goals Above Replacement as percentage
    if (player.garPercentage !== undefined) {
      const garSign = player.garPercentage >= 0 ? '+' : '';
      stats.push({ 
        label: 'GAR', 
        value: `${garSign}${player.garPercentage.toFixed(1)}%` 
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
        `player-card ${isUserTeam ? 'user-team' : 'opponent-team'} cursor-pointer`,
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
            {/* Key Stats Below Name - Use matchup stats if available, otherwise season stats */}
            <div className="player-key-stats">
              {(player.matchupStats?.goals ?? player.stats?.goals) || 0} G, {(player.matchupStats?.assists ?? player.stats?.assists) || 0} A, {(player.matchupStats?.sog ?? player.stats?.sog) || 0} SOG
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
          <div className="mt-2 mb-2">
            <GameLogosBar 
              games={player.games} 
              playerTeam={player.team}
            />
          </div>
        )}

        {/* Projection Bar */}
        <div className="player-projection-bar-container">
          <div className="player-projection-bar-wrapper">
            <div 
              className="player-projection-bar" 
              style={{ width: `${projectionPercentage}%` }}
            />
          </div>
          <div className="player-projection-text">
            {hasGameToday 
              ? `${projectedPoints.toFixed(1)} pts projected`
              : 'No game today'
            }
          </div>
        </div>
      </div>

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


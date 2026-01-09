import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, Flame, Award } from 'lucide-react';
import { CitrusSparkle, CitrusLeaf, CitrusSlice } from '@/components/icons/CitrusIcons';
import { cn } from '@/lib/utils';
import { MatchupPlayer } from './types';
import { AdSpace } from '@/components/AdSpace';

interface MatchupSidebarProps {
  myStarters: MatchupPlayer[];
  opponentStarters: MatchupPlayer[];
  myTeamScore: number;
  opponentTeamScore: number;
  myTeamName: string;
  opponentTeamName: string;
  myTeamProjection: number;
  opponentTeamProjection: number;
  onPlayerClick?: (player: MatchupPlayer) => void;
}

export const MatchupSidebar: React.FC<MatchupSidebarProps> = ({
  myStarters,
  opponentStarters,
  myTeamScore,
  opponentTeamScore,
  myTeamName,
  opponentTeamName,
  myTeamProjection,
  opponentTeamProjection,
  onPlayerClick
}) => {
  // Get top performers from both teams
  const topPerformers = useMemo(() => {
    const allPlayers = [
      ...myStarters.map(p => ({ ...p, teamName: myTeamName, isMyTeam: true })),
      ...opponentStarters.map(p => ({ ...p, teamName: opponentTeamName, isMyTeam: false }))
    ];
    
    // Debug: Log player stats to see what's available
    if (allPlayers.length > 0 && allPlayers[0]) {
      console.log('[MatchupSidebar] Sample player data:', {
        player: allPlayers[0].name,
        total_points: allPlayers[0].total_points,
        points: allPlayers[0].points,
        stats: allPlayers[0].stats,
        matchupStats: allPlayers[0].matchupStats
      });
    }
    
    // Sort by total points (check multiple possible sources)
    const playersWithPoints = allPlayers.map(p => {
      // Try multiple sources for points
      let totalPoints = 0;
      
      // 1. Check total_points from DB
      if (p.total_points && p.total_points > 0) {
        totalPoints = p.total_points;
      }
      // 2. Check points property
      else if (p.points && p.points > 0) {
        totalPoints = p.points;
      }
      // 3. Check matchupStats for weekly totals
      else if (p.matchupStats) {
        const stats = p.matchupStats;
        totalPoints = (stats.goals || 0) + (stats.assists || 0) + (stats.sog || 0) * 0.2 + 
                     (stats.powerPlayPoints || 0) + (stats.shortHandedPoints || 0) + 
                     (stats.hits || 0) * 0.25 + (stats.blocks || 0) * 0.25;
      }
      
      return { ...p, calculatedPoints: totalPoints };
    });
    
    return playersWithPoints
      .filter(p => p.calculatedPoints > 0)
      .sort((a, b) => b.calculatedPoints - a.calculatedPoints)
      .slice(0, 5);
  }, [myStarters, opponentStarters, myTeamName, opponentTeamName]);

  // Get breakout players (projected vs actual)
  const breakoutPlayers = useMemo(() => {
    const allPlayers = [
      ...myStarters.map(p => ({ ...p, teamName: myTeamName, isMyTeam: true })),
      ...opponentStarters.map(p => ({ ...p, teamName: opponentTeamName, isMyTeam: false }))
    ];
    
    return allPlayers
      .map(p => {
        // Calculate actual points the same way as top performers
        let actualPoints = 0;
        if (p.total_points && p.total_points > 0) {
          actualPoints = p.total_points;
        } else if (p.points && p.points > 0) {
          actualPoints = p.points;
        } else if (p.matchupStats) {
          const stats = p.matchupStats;
          actualPoints = (stats.goals || 0) + (stats.assists || 0) + (stats.sog || 0) * 0.2 + 
                       (stats.powerPlayPoints || 0) + (stats.shortHandedPoints || 0) + 
                       (stats.hits || 0) * 0.25 + (stats.blocks || 0) * 0.25;
        }
        
        const projectedPoints = p.daily_projection?.total_projected_points || 
                               p.goalieProjection?.total_projected_points || 0;
        const differential = actualPoints - projectedPoints;
        return { ...p, differential, actualPoints };
      })
      .filter(p => p.differential > 2 && p.actualPoints > 0) // Beating projection by 2+ points
      .sort((a, b) => b.differential - a.differential)
      .slice(0, 3);
  }, [myStarters, opponentStarters, myTeamName, opponentTeamName]);

  return (
    <div className="space-y-4">
      {/* Top Performers Card */}
      <Card className="overflow-hidden bg-citrus-cream corduroy-texture border-4 border-citrus-forest rounded-[1.5rem] shadow-[0_4px_0_rgba(27,48,34,0.2)] relative">
        <CitrusSlice className="absolute bottom-2 left-2 w-12 h-12 text-citrus-orange opacity-10 pointer-events-none" />
        
        <CardHeader className="pb-3 relative z-10 bg-gradient-to-r from-citrus-sage/20 via-citrus-sage/10 to-citrus-cream border-b-3 border-citrus-sage/30">
          <CardTitle className="text-sm font-varsity font-black text-citrus-forest uppercase tracking-tight flex items-center gap-2">
            <Flame className="w-4 h-4 text-citrus-orange" />
            Top Performers
            <CitrusSparkle className="w-3 h-3 text-citrus-orange ml-auto" />
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 space-y-2 relative z-10">
          {topPerformers.length === 0 ? (
            <div className="text-center py-4 text-xs font-display text-citrus-charcoal">
              No scores yet this week
            </div>
          ) : (
            topPerformers.map((player, index) => {
              const totalPoints = player.calculatedPoints || 0;
              return (
                <button
                  key={player.id}
                  onClick={() => onPlayerClick?.(player)}
                  className={cn(
                    "w-full p-2 rounded-xl border-2 transition-all hover:shadow-patch hover:-translate-y-0.5",
                    player.isMyTeam 
                      ? "bg-citrus-sage/15 border-citrus-sage/50 hover:bg-citrus-sage/25"
                      : "bg-citrus-peach/15 border-citrus-peach/50 hover:bg-citrus-peach/25"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {/* Rank badge */}
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center border-2 font-varsity text-xs font-black shadow-sm",
                      index === 0 ? "bg-citrus-orange border-citrus-forest text-citrus-cream" :
                      index === 1 ? "bg-citrus-sage border-citrus-forest text-citrus-cream" :
                      "bg-citrus-peach border-citrus-forest text-citrus-cream"
                    )}>
                      {index + 1}
                    </div>
                    
                    {/* Player info */}
                    <div className="flex-1 text-left min-w-0">
                      <div className="font-varsity text-xs font-bold text-citrus-forest truncate">
                        {player.name}
                      </div>
                      <div className="font-display text-[10px] text-citrus-charcoal/70 truncate">
                        {player.teamName}
                      </div>
                    </div>
                    
                    {/* Points */}
                    <div className="font-varsity text-base font-black text-citrus-orange">
                      {totalPoints.toFixed(1)}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Breakout Players Card */}
      {breakoutPlayers.length > 0 && (
        <Card className="overflow-hidden bg-gradient-to-br from-citrus-orange/10 to-citrus-peach/10 corduroy-texture border-4 border-citrus-orange/50 rounded-[1.5rem] shadow-[0_4px_0_rgba(223,117,54,0.2)] relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_rgba(223,117,54,0.1)_0%,_transparent_60%)] pointer-events-none"></div>
          
          <CardHeader className="pb-3 relative z-10">
            <CardTitle className="text-sm font-varsity font-black text-citrus-orange uppercase tracking-tight flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Breakout Stars
              <Badge className="ml-auto bg-citrus-orange/30 border-2 border-citrus-orange text-citrus-forest font-mono text-[9px] px-1.5">
                HOT
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-2 relative z-10">
            {breakoutPlayers.map((player) => (
              <button
                key={player.id}
                onClick={() => onPlayerClick?.(player)}
                className="w-full p-2 rounded-xl bg-citrus-cream/60 border-2 border-citrus-orange/40 hover:bg-citrus-cream hover:shadow-patch hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-citrus-orange flex-shrink-0" />
                  <div className="flex-1 text-left min-w-0">
                    <div className="font-varsity text-xs font-bold text-citrus-forest truncate">
                      {player.name}
                    </div>
                    <div className="font-display text-[10px] text-citrus-charcoal/70">
                      +{player.differential.toFixed(1)} vs proj
                    </div>
                  </div>
                  <div className="font-varsity text-sm font-black text-citrus-orange">
                    {player.actualPoints.toFixed(1)}
                  </div>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Premium Ad Space - Varsity Sponsor Patch */}
      <AdSpace size="300x250" label="Featured Sponsor" />
    </div>
  );
};

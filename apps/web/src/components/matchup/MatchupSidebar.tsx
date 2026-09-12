import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, Flame, Award } from 'lucide-react';
import { CitrusSparkle, CitrusLeaf, CitrusSlice } from '@/components/icons/CitrusIcons';
import { cn } from '@/lib/utils';
import { MatchupPlayer } from './types';
import { sidebarFantasyPoints } from './sidebarPoints';
import { AdSpace } from '@/components/AdSpace';

/* 2026-08-19 visual audit — muted-text correction.
   text-citrus-charcoal is #5C5C5C, a soft charcoal designed for the
   original CREAM theme. At 20-70% opacity on the dark #1A2A20 tiles it
   composites to near-invisible (team codes on this page measured
   1.47:1). Remapped to cream at the alpha that preserves the intended
   hierarchy while clearing 4.5:1 on a dark tile. */


interface MatchupSidebarProps {
  myStarters: MatchupPlayer[];
  opponentStarters: MatchupPlayer[];
  myTeamScore: number;
  opponentTeamScore: number;
  myTeamName: string;
  opponentTeamName: string;
  myTeamProjection?: number;
  opponentTeamProjection?: number;
  scoringSettings?: unknown;
  scoringReady?: boolean;
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
  onPlayerClick,
  scoringSettings,
  scoringReady = false,
}) => {
  // Get top performers from both teams
  const topPerformers = useMemo(() => {
    const allPlayers = [
      ...myStarters.map(p => ({ ...p, teamName: myTeamName, isMyTeam: true })),
      ...opponentStarters.map(p => ({ ...p, teamName: opponentTeamName, isMyTeam: false }))
    ];
    
    return allPlayers
      .map(player => ({ ...player, calculatedPoints: sidebarFantasyPoints(player, scoringSettings, scoringReady) }))
      .filter((player): player is typeof player & { calculatedPoints: number } => player.calculatedPoints != null)
      .sort((a, b) => b.calculatedPoints - a.calculatedPoints)
      .slice(0, 5);
  }, [myStarters, opponentStarters, myTeamName, opponentTeamName, scoringSettings, scoringReady]);


  return (
    <div className="space-y-4">
      {/* Top Performers Card */}
      <Card className="overflow-hidden bg-[#1A2A20] border-4 border-citrus-sage/25 rounded-[1.5rem] shadow-[0_4px_0_rgba(0,0,0,0.3)] relative">
        <CitrusSlice className="absolute bottom-2 left-2 w-12 h-12 text-citrus-orange opacity-10 pointer-events-none" />

        <CardHeader className="pb-3 relative z-10 bg-gradient-to-r from-citrus-sage/20 via-citrus-sage/10 to-transparent border-b-3 border-citrus-sage/30">
          <CardTitle className="text-sm font-varsity font-black text-pastel-cream uppercase tracking-tight flex items-center gap-2">
            <Flame className="w-4 h-4 text-citrus-orange" aria-hidden="true" />
            Top Performers
            <CitrusSparkle className="w-3 h-3 text-citrus-orange ml-auto" />
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 space-y-2 relative z-10">
          {topPerformers.length === 0 ? (
            <div className="text-center py-4 text-xs font-display text-pastel-cream/85">
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
                      index === 0 ? "bg-citrus-orange border-citrus-forest text-[#0F1F15]" :
                      index === 1 ? "bg-citrus-sage border-citrus-forest text-[#0F1F15]" :
                      "bg-citrus-peach border-citrus-forest text-[#0F1F15]"
                    )}>
                      {index + 1}
                    </div>
                    
                    {/* Player info */}
                    <div className="flex-1 text-left min-w-0">
                      <div className="font-varsity text-xs font-bold text-pastel-cream truncate">
                        {player.name}
                      </div>
                      <div className="font-display text-[10px] text-pastel-cream/75 truncate">
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

      {/* Labelled "Featured Sponsor" until 2026-08-26. There is no sponsor:
          when AdSense is off — which is always in the native build, where it is
          prohibited — the placeholder renders a Citrus house card under that
          badge. Calling our own promo a sponsor is a small lie that costs
          nothing to stop telling. */}
      <AdSpace size="300x250" />
    </div>
  );
};

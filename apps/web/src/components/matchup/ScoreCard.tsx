import { Calendar } from "lucide-react";
import { CitrusWedge, CitrusSparkle, CitrusSlice, CitrusBurst } from "@/components/icons/CitrusIcons";
import { Badge } from "@/components/ui/badge";
import { WinProbabilityBar } from "./WinProbabilityBar";

interface ScoreCardProps {
  myTeamName: string;
  myTeamRecord: { wins: number; losses: number };
  opponentTeamName: string;
  opponentTeamRecord: { wins: number; losses: number };
  myTeamPoints: string;
  opponentTeamPoints: string;
  myTeamGamesRemaining?: number;
  opponentTeamGamesRemaining?: number;
  myTeamProjection?: number;
  opponentTeamProjection?: number;
  /** Matchup UUID for Monte Carlo simulation data */
  matchupId?: string;
}

export const ScoreCard = ({
  myTeamName,
  myTeamRecord,
  opponentTeamName,
  opponentTeamRecord,
  myTeamPoints,
  opponentTeamPoints,
  myTeamGamesRemaining = 0,
  opponentTeamGamesRemaining = 0,
  myTeamProjection = 0,
  opponentTeamProjection = 0,
  matchupId,
}: ScoreCardProps) => {
  // Calculate win probability based on scores and projections
  const myPointsNum = parseFloat(myTeamPoints) || 0;
  const oppPointsNum = parseFloat(opponentTeamPoints) || 0;
  const totalPoints = myPointsNum + oppPointsNum;
  
  // If no scores yet, use projections for win probability
  let winProbability = 50;
  if (totalPoints > 0) {
    winProbability = Math.round((myPointsNum / totalPoints) * 100);
  } else if (myTeamProjection > 0 || opponentTeamProjection > 0) {
    const totalProjection = myTeamProjection + opponentTeamProjection;
    winProbability = totalProjection > 0 ? Math.round((myTeamProjection / totalProjection) * 100) : 50;
  }
  
  const isWinning = myPointsNum > oppPointsNum;
  const isLosing = myPointsNum < oppPointsNum;
  const isTied = Math.abs(myPointsNum - oppPointsNum) < 0.01;
  
  return (
    <div className="mb-4 md:mb-6 rounded-xl md:rounded-[2rem] bg-[#1A2A20] ring-1 ring-white/10 md:ring-2 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.4)] overflow-hidden relative">
      {/* Floating Citrus Decorations - Hidden on mobile */}
      <CitrusSlice className="hidden md:block absolute top-3 right-3 w-8 h-8 text-citrus-sage/10 rotate-12" />
      <CitrusBurst className="hidden md:block absolute bottom-3 left-3 w-10 h-10 text-citrus-sage/10" />
      
      {/* Mobile: Compact single-row layout */}
      <div className="md:hidden px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          {/* Team 1 - Compact */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-full bg-citrus-sage border-2 border-citrus-forest flex items-center justify-center flex-shrink-0">
              <span className="font-varsity text-xs text-[#E8EED9]">H</span>
            </div>
            <div className="min-w-0">
              <div className="font-varsity text-[10px] text-citrus-sage uppercase truncate">{myTeamName}</div>
              <div className="font-mono text-[9px] text-citrus-forest">{myTeamRecord.wins}-{myTeamRecord.losses}</div>
            </div>
          </div>
          
          {/* Scores - Compact */}
          <div className="flex items-center gap-2">
            <div className={`font-varsity text-2xl tabular-nums ${isWinning ? 'text-pastel-sage' : 'text-white/70'}`}>{myTeamPoints}</div>
            <span className="text-xs text-white/55 font-bold">vs</span>
            <div className={`font-varsity text-2xl tabular-nums ${isLosing ? 'text-pastel-sage' : 'text-white/70'}`}>{opponentTeamPoints}</div>
          </div>
          
          {/* Team 2 - Compact */}
          <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
            <div className="min-w-0 text-right">
              <div className="font-varsity text-[10px] text-citrus-sage uppercase truncate">{opponentTeamName}</div>
              <div className="font-mono text-[9px] text-citrus-forest">{opponentTeamRecord.wins}-{opponentTeamRecord.losses}</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-citrus-peach border-2 border-citrus-forest flex items-center justify-center flex-shrink-0">
              <span className="font-varsity text-xs text-[#E8EED9]">A</span>
            </div>
          </div>
        </div>
        
        {/* Win probability - Compact (Monte Carlo powered) */}
        <WinProbabilityBar
          matchupId={matchupId}
          fallbackWinProbability={winProbability}
          team1Projected={myTeamProjection}
          team2Projected={opponentTeamProjection}
          compact
        />
      </div>
      
      {/* Desktop: Full layout */}
      <div className="hidden md:block relative px-4 py-4 md:px-6 md:py-5 bg-[#E8EED9]/50 backdrop-blur-sm border-b-4 border-citrus-forest">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Team 1 Badge - Embroidered patch */}
          <div className="flex items-center gap-3 p-3 bg-citrus-sage/15 rounded-2xl border-3 border-citrus-sage">
            <div className="w-12 h-12 rounded-full bg-citrus-sage border-4 border-citrus-forest flex items-center justify-center shadow-[inset_0_2px_4px_rgba(0,0,0,0.15)]">
              <span className="font-varsity text-xl text-[#E8EED9]">H</span>
            </div>
            <div>
              <div className="font-varsity text-sm text-citrus-sage uppercase">{myTeamName}</div>
              <div className="font-mono text-xs text-citrus-forest">{myTeamRecord.wins}-{myTeamRecord.losses}</div>
              <div className="flex flex-col gap-0.5 mt-1">
                {/* Games Remaining */}
                <div className="flex items-center gap-1 bg-[#E8EED9]/50 backdrop-blur-sm/60 px-2 py-0.5 rounded-md border border-citrus-sage/40">
                  <Calendar className="w-2.5 h-2.5 text-citrus-forest" />
                  <span className="text-[9px] font-varsity font-bold text-citrus-forest">
                    {myTeamGamesRemaining}
                  </span>
                  <span className="text-[8px] font-display text-citrus-charcoal/70">
                    left
                  </span>
                  <CitrusWedge className="w-2 h-2 text-citrus-sage opacity-60" />
                </div>
              </div>
            </div>
          </div>
          
          {/* Center scores with stitched divider */}
          <div className="flex items-center gap-6 relative">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-citrus-sage/80 border-2 border-citrus-sage text-[#E8EED9] font-script text-xl px-3 py-1 rounded-varsity shadow-patch">
              vs
            </div>
            <div className="text-center">
              <div className={`font-varsity text-6xl tabular-nums ${isWinning ? 'text-pastel-sage' : 'text-white/70'}`}>{myTeamPoints}</div>
            </div>
            <div className="w-1 h-20 border-l-2 border-dashed border-white/10"></div>
            <div className="text-center">
              <div className={`font-varsity text-6xl tabular-nums ${isLosing ? 'text-pastel-sage' : 'text-white/70'}`}>{opponentTeamPoints}</div>
            </div>
          </div>
          
          {/* Team 2 Badge */}
          <div className="flex items-center gap-3 p-3 bg-citrus-green-light/15 rounded-2xl border-3 border-citrus-green-light">
            <div>
              <div className="font-varsity text-sm text-citrus-sage uppercase text-right">{opponentTeamName}</div>
              <div className="font-mono text-xs text-citrus-forest text-right">{opponentTeamRecord.wins}-{opponentTeamRecord.losses}</div>
              <div className="flex flex-col gap-0.5 mt-1 items-end">
                {/* Games Remaining */}
                <div className="flex items-center gap-1 bg-[#E8EED9]/50 backdrop-blur-sm/60 px-2 py-0.5 rounded-md border border-citrus-peach/40">
                  <CitrusWedge className="w-2 h-2 text-citrus-peach opacity-60" />
                  <span className="text-[8px] font-display text-citrus-charcoal/70">
                    left
                  </span>
                  <span className="text-[9px] font-varsity font-bold text-citrus-forest">
                    {opponentTeamGamesRemaining}
                  </span>
                  <Calendar className="w-2.5 h-2.5 text-citrus-forest" />
                </div>
              </div>
            </div>
            <div className="w-12 h-12 rounded-full bg-citrus-peach border-4 border-citrus-forest flex items-center justify-center shadow-[inset_0_2px_4px_rgba(0,0,0,0.15)]">
              <span className="font-varsity text-xl text-[#E8EED9]">A</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Win probability - Desktop (Monte Carlo powered) */}
      <div className="hidden md:block">
        <WinProbabilityBar
          matchupId={matchupId}
          fallbackWinProbability={winProbability}
          team1Projected={myTeamProjection}
          team2Projected={opponentTeamProjection}
        />
      </div>
    </div>
  );
};

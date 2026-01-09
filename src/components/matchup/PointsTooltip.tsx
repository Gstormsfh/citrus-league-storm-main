import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatBreakdown } from "./types";

export const PointsTooltip = ({ 
  breakdown, 
  totalPoints 
}: { 
  breakdown: StatBreakdown | undefined;
  totalPoints: number;
}) => {
  if (!breakdown || Object.keys(breakdown).length === 0) {
    return (
      <span className="font-varsity font-black text-citrus-orange">
        {totalPoints.toFixed(1)} pts
      </span>
    );
  }

  // Convert breakdown to array and split into columns
  const breakdownArray = Object.entries(breakdown).map(([category, data]) => ({
    label: category.replace(/_/g, ' ').toUpperCase(),
    count: data.count,
    points: data.points
  }));

  const midPoint = Math.ceil(breakdownArray.length / 2);
  const leftColumn = breakdownArray.slice(0, midPoint);
  const rightColumn = breakdownArray.slice(midPoint);
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-citrus-orange/10 hover:bg-citrus-orange/20 border-2 border-citrus-orange/30 hover:border-citrus-orange/50 transition-all cursor-help hover:scale-105">
          <span className="font-varsity font-black text-citrus-orange">{totalPoints.toFixed(1)}</span>
          <span className="text-[8px] font-display font-bold text-citrus-orange/80 uppercase">pts</span>
        </button>
      </TooltipTrigger>
      <TooltipContent 
        className="p-0 bg-citrus-forest rounded-varsity shadow-varsity border-4 border-citrus-orange max-w-md"
        side="top"
        align="center"
        sideOffset={8}
        style={{ zIndex: 9999 }}
      >
        {/* 1970s SCOREBOARD HEADER */}
        <div className="relative bg-gradient-to-r from-citrus-orange via-citrus-orange to-citrus-peach p-3 rounded-t-xl border-b-3 border-citrus-forest">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,_#1B3022_1px,_transparent_1px)] bg-[length:24px_24px] opacity-10 rounded-t-xl"></div>
          <h4 className="font-varsity text-sm uppercase tracking-widest text-citrus-cream text-center relative z-10 drop-shadow-sm">
            🏒 Scoring Breakdown
          </h4>
        </div>

        {/* 2-COLUMN STAT GRID - HOCKEY SCOREBOARD */}
        <div className="p-4 grid grid-cols-2 gap-3">
          {/* Left Column */}
          <div className="space-y-2">
            {leftColumn.map((stat, idx) => (
              <div key={idx} className="bg-citrus-cream/10 border-2 border-citrus-orange/30 rounded-lg p-2 hover:bg-citrus-orange/20 hover:border-citrus-orange/50 transition-all">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[8px] font-display font-bold text-citrus-peach uppercase tracking-wider">{stat.label}</span>
                  <span className="text-[7px] font-display text-citrus-sage">×{stat.count}</span>
                </div>
                <div className="font-varsity text-sm font-black text-citrus-cream mt-0.5">+{stat.points.toFixed(2)}</div>
              </div>
            ))}
          </div>

          {/* Right Column */}
          <div className="space-y-2">
            {rightColumn.map((stat, idx) => (
              <div key={idx} className="bg-citrus-cream/10 border-2 border-citrus-orange/30 rounded-lg p-2 hover:bg-citrus-orange/20 hover:border-citrus-orange/50 transition-all">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[8px] font-display font-bold text-citrus-peach uppercase tracking-wider">{stat.label}</span>
                  <span className="text-[7px] font-display text-citrus-sage">×{stat.count}</span>
                </div>
                <div className="font-varsity text-sm font-black text-citrus-cream mt-0.5">+{stat.points.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* TOTAL POINTS BANNER - 1970s CHAMPIONSHIP STYLE */}
        <div className="relative bg-gradient-to-r from-citrus-sage via-[#7CB518] to-citrus-sage p-3 border-t-3 border-citrus-forest rounded-b-xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,_#1B3022_1px,_transparent_1px)] bg-[length:24px_24px] opacity-10 rounded-b-xl"></div>
          <div className="flex justify-between items-center relative z-10">
            <span className="font-varsity text-xs uppercase tracking-widest text-citrus-forest drop-shadow-sm">Total Points</span>
            <span className="font-varsity text-2xl font-black text-citrus-forest drop-shadow-sm">{totalPoints.toFixed(1)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

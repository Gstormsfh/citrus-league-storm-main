import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatBreakdown } from "./types";
import { cn } from "@/lib/utils";

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
        <button className="text-citrus-orange hover:text-citrus-forest cursor-help font-bold text-base font-varsity">
          {totalPoints.toFixed(1)}
        </button>
      </TooltipTrigger>
      <TooltipContent 
        className="p-0 bg-citrus-cream corduroy-texture rounded-[1.5rem] border-4 border-citrus-forest shadow-[0_6px_0_rgba(27,48,34,0.25)] max-w-md z-[999999]"
        side="top"
        align="center"
        sideOffset={10}
      >
        {/* Header patch */}
        <div className="bg-gradient-to-r from-citrus-orange via-citrus-peach to-citrus-orange px-5 py-4 rounded-t-[1.25rem] border-b-4 border-citrus-forest relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_rgba(255,255,255,0.2)_0%,_transparent_60%)]"></div>
          <h4 className="font-varsity text-base font-black text-citrus-cream uppercase tracking-tight text-center relative z-10">
            🏒 Scoring Breakdown
          </h4>
        </div>

        {/* Stats grid with stitched borders */}
        <div className="p-5 grid grid-cols-2 gap-4">
          {breakdownArray.map((stat) => (
            <div key={stat.label} className="p-3 bg-gradient-to-br from-citrus-orange/10 to-citrus-peach/10 rounded-xl border-3 border-dashed border-citrus-orange/50 shadow-sm hover:shadow-patch transition-all">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="font-mono text-xs text-citrus-orange uppercase tracking-wider font-bold">{stat.label}</span>
                <span className="text-sm font-varsity text-citrus-charcoal bg-citrus-cream/60 px-2 py-0.5 rounded-md border border-citrus-orange/30">×{stat.count}</span>
              </div>
              <div className="font-varsity text-2xl font-black text-citrus-forest">+{stat.points.toFixed(1)}</div>
            </div>
          ))}
        </div>

        {/* Footer patch */}
        <div className="bg-gradient-to-r from-citrus-sage via-[#7CB518] to-citrus-sage px-5 py-4 rounded-b-[1.25rem] border-t-4 border-citrus-forest">
          <div className="flex justify-between items-center">
            <span className="font-varsity text-sm font-bold text-citrus-cream uppercase tracking-wide">Total Fantasy Points</span>
            <span className="font-varsity text-3xl font-black text-citrus-cream">{totalPoints.toFixed(1)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

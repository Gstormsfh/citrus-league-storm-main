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
        <button className="text-citrus-orange hover:text-citrus-forest cursor-help font-bold text-base font-varsity">
          {totalPoints.toFixed(1)}
        </button>
      </TooltipTrigger>
      <TooltipContent 
        className="p-0 bg-citrus-cream corduroy-texture rounded-[1.5rem] border-4 border-citrus-forest shadow-[0_6px_0_rgba(27,48,34,0.25)] max-w-md"
        side="top"
        align="center"
        sideOffset={10}
        style={{ zIndex: 9999 }}
      >
        {/* Header patch */}
        <div className="bg-citrus-orange px-4 py-3 rounded-t-[1.25rem] border-b-3 border-citrus-forest">
          <h4 className="font-varsity text-sm text-citrus-cream uppercase tracking-tighter text-center">
            🏒 Scoring Breakdown
          </h4>
        </div>

        {/* Stats grid with stitched borders */}
        <div className="p-4 grid grid-cols-2 gap-3">
          {breakdownArray.map((stat) => (
            <div key={stat.label} className="p-2 bg-citrus-cream rounded-lg border-2 border-dashed border-citrus-sage/40">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[9px] text-citrus-sage uppercase">{stat.label}</span>
                <span className="text-[7px] font-display text-citrus-charcoal">×{stat.count}</span>
              </div>
              <div className="font-varsity text-base text-citrus-forest">+{stat.points.toFixed(2)}</div>
            </div>
          ))}
        </div>

        {/* Footer patch */}
        <div className="bg-citrus-peach px-4 py-3 rounded-b-[1.25rem] border-t-3 border-citrus-forest">
          <div className="flex justify-between items-center">
            <span className="font-varsity text-xs text-citrus-forest uppercase">Total</span>
            <span className="font-varsity text-2xl text-citrus-forest">{totalPoints.toFixed(1)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

  // Convert breakdown to array
  const breakdownArray = Object.entries(breakdown).map(([category, data]) => ({
    label: category.replace(/_/g, ' ').toUpperCase(),
    count: data.count,
    points: data.points
  }));
  
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="text-citrus-orange hover:text-citrus-forest active:scale-95 cursor-pointer font-bold text-base font-varsity px-2 py-1 rounded bg-citrus-orange/10 border border-citrus-orange/30 transition-all touch-manipulation">
          {totalPoints.toFixed(1)} pts
          <span className="ml-1 text-[10px] opacity-60">ⓘ</span>
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="p-0 bg-[#E8EED9]/95 backdrop-blur-md rounded-xl border-2 border-citrus-forest shadow-lg w-[280px] z-[999999]"
        side="top"
        align="center"
        sideOffset={8}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-citrus-orange via-citrus-peach to-citrus-orange px-4 py-3 rounded-t-xl border-b-2 border-citrus-forest">
          <h4 className="font-bold text-sm text-white uppercase tracking-tight text-center">
            🏒 Scoring Breakdown
          </h4>
        </div>

        {/* Stats grid - compact for mobile */}
        <div className="p-3 grid grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto">
          {breakdownArray.map((stat) => (
            <div key={stat.label} className="p-2 bg-white/50 rounded-lg border border-citrus-orange/30">
              <div className="flex items-baseline justify-between gap-1 mb-0.5">
                <span className="text-[10px] text-citrus-orange uppercase font-bold truncate">{stat.label}</span>
                <span className="text-xs text-gray-600 bg-gray-100 px-1 rounded">×{stat.count}</span>
              </div>
              <div className="font-bold text-lg text-green-700">+{stat.points.toFixed(1)}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="bg-gradient-to-r from-citrus-sage via-[#7CB518] to-citrus-sage px-4 py-3 rounded-b-xl border-t-2 border-citrus-forest">
          <div className="flex justify-between items-center">
            <span className="font-bold text-xs text-white uppercase">Total</span>
            <span className="font-black text-2xl text-white">{totalPoints.toFixed(1)}</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

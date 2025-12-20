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
      <span className="text-orange-500 font-bold">
        {totalPoints.toFixed(3)} pts
      </span>
    );
  }
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="text-orange-500 hover:underline cursor-help font-bold">
          {totalPoints.toFixed(3)} pts
        </button>
      </TooltipTrigger>
      <TooltipContent className="p-3 bg-gray-900 text-white rounded-lg shadow-xl border border-gray-700 z-50 max-w-xs">
        <h4 className="font-bold border-b border-gray-700 pb-1 mb-2">Scoring Breakdown</h4>
        <div className="space-y-1">
          {Object.entries(breakdown).map(([category, data]) => (
            <div key={category} className="flex justify-between text-sm gap-4">
              <span className="capitalize">{category.replace(/_/g, ' ')} ({data.count}):</span>
              <span className="font-mono text-fantasy-primary">+{data.points.toFixed(3)}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 pt-2 border-t border-gray-700 text-xs text-gray-400 italic">
          *Points calculated per league settings
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

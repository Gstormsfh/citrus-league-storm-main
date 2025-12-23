/**
 * ProjectionTooltip Component
 * Shows "Performance Outlook" - clean projected stat lines without math breakdown
 * Full traceability remains in backend logs (debug_projection.py)
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MatchupPlayer } from "./types";

interface ProjectionTooltipProps {
  projection: MatchupPlayer['daily_projection'];
}

export const ProjectionTooltip = ({ projection }: ProjectionTooltipProps) => {
  if (!projection) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="text-xs text-muted-foreground hover:text-foreground cursor-help transition-colors">
          ℹ️
        </button>
      </TooltipTrigger>
      <TooltipContent 
        className="p-4 bg-gray-900 text-white rounded-lg shadow-xl border border-gray-700 z-50 max-w-sm"
        side="top"
        align="end"
      >
        <h4 className="font-bold border-b border-gray-700 pb-2 mb-3">Performance Outlook</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between border-b border-gray-800 pb-1">
            <span className="text-gray-400">Projected Goals:</span>
            <span className="font-bold">{projection.projected_goals.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-800 pb-1">
            <span className="text-gray-400">Projected Assists:</span>
            <span className="font-bold">{projection.projected_assists.toFixed(2)}</span>
          </div>
          {(projection.projected_ppp !== undefined && projection.projected_ppp > 0) && (
            <div className="flex justify-between border-b border-gray-800 pb-1">
              <span className="text-gray-400">Projected PPP:</span>
              <span className="font-bold">{projection.projected_ppp.toFixed(2)}</span>
            </div>
          )}
          {(projection.projected_shp !== undefined && projection.projected_shp > 0) && (
            <div className="flex justify-between border-b border-gray-800 pb-1">
              <span className="text-gray-400">Projected SHP:</span>
              <span className="font-bold">{projection.projected_shp.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between border-b border-gray-800 pb-1">
            <span className="text-gray-400">Projected SOG:</span>
            <span className="font-bold">{projection.projected_sog.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-800 pb-1">
            <span className="text-gray-400">Projected Blocks:</span>
            <span className="font-bold">{projection.projected_blocks.toFixed(2)}</span>
          </div>
          {(projection.projected_hits !== undefined && projection.projected_hits > 0) && (
            <div className="flex justify-between border-b border-gray-800 pb-1">
              <span className="text-gray-400">Projected Hits:</span>
              <span className="font-bold">{projection.projected_hits.toFixed(2)}</span>
            </div>
          )}
          {(projection.projected_pim !== undefined && projection.projected_pim > 0) && (
            <div className="flex justify-between border-b border-gray-800 pb-1">
              <span className="text-gray-400">Projected PIM:</span>
              <span className="font-bold">{projection.projected_pim.toFixed(2)}</span>
            </div>
          )}
          <div className="pt-2 flex justify-between text-fantasy-primary font-black text-lg">
            <span>Total Points:</span>
            <span>{projection.total_projected_points.toFixed(1)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

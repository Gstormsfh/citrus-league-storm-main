/**
 * GoalieProjectionTooltip Component
 * Shows "Performance Outlook" for goalies - clean projected stat lines
 * Displays: GP, Wins, Saves, Shutouts, GAA, SV%
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MatchupPlayer } from "./types";

interface GoalieProjectionTooltipProps {
  projection: MatchupPlayer['goalieProjection'];
}

export const GoalieProjectionTooltip = ({ projection }: GoalieProjectionTooltipProps) => {
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
            <span className="text-gray-400">Projected GP:</span>
            <span className="font-bold">{projection.projected_gp.toFixed(1)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-800 pb-1">
            <span className="text-gray-400">Projected Wins:</span>
            <span className="font-bold">{projection.projected_wins.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-800 pb-1">
            <span className="text-gray-400">Projected Saves:</span>
            <span className="font-bold">{projection.projected_saves.toFixed(1)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-800 pb-1">
            <span className="text-gray-400">Projected Shutouts:</span>
            <span className="font-bold">{projection.projected_shutouts.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-800 pb-1">
            <span className="text-gray-400">Projected GAA:</span>
            <span className="font-bold">{projection.projected_gaa.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-b border-gray-800 pb-1">
            <span className="text-gray-400">Projected SV%:</span>
            <span className="font-bold">{(projection.projected_save_pct * 100).toFixed(1)}%</span>
          </div>
          <div className="pt-2 flex justify-between text-fantasy-primary font-black text-lg">
            <span>Total Points:</span>
            <span>{projection.total_projected_points.toFixed(1)}</span>
          </div>
          {!projection.starter_confirmed && (
            <div className="pt-2 text-xs text-yellow-400 italic">
              ⚠️ Probable starter - not yet confirmed
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

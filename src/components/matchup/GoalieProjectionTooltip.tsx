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

  // Goalie stats in 2 columns (3 per column)
  const leftColumn = [
    { label: 'GP', value: projection.projected_gp.toFixed(1) },
    { label: 'WINS', value: projection.projected_wins.toFixed(2) },
    { label: 'SAVES', value: projection.projected_saves.toFixed(1) },
  ];

  const rightColumn = [
    { label: 'SO', value: projection.projected_shutouts.toFixed(2) },
    { label: 'GAA', value: projection.projected_gaa.toFixed(2) },
    { label: 'SV%', value: `${(projection.projected_save_pct * 100).toFixed(1)}%` },
  ];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="w-5 h-5 rounded-lg bg-citrus-sage border-2 border-citrus-forest shadow-patch flex items-center justify-center hover:scale-110 hover:shadow-varsity transition-all group">
          <span className="text-[10px] font-varsity font-black text-citrus-forest group-hover:text-citrus-cream transition-colors">i</span>
        </button>
      </TooltipTrigger>
      <TooltipContent 
        className="p-0 bg-citrus-cream corduroy-texture rounded-[1.5rem] border-4 border-citrus-forest shadow-[0_6px_0_rgba(27,48,34,0.25)] max-w-md"
        side="top"
        align="end"
        sideOffset={10}
        style={{ zIndex: 9999 }}
      >
        {/* Header patch */}
        <div className="bg-citrus-sage px-4 py-3 rounded-t-[1.25rem] border-b-3 border-citrus-forest">
          <h4 className="font-varsity text-sm text-citrus-cream uppercase tracking-tighter text-center">
            🥅 Goalie Outlook
          </h4>
        </div>

        {/* Stats grid with stitched borders */}
        <div className="p-4 grid grid-cols-2 gap-3">
          <div className="space-y-2">
            {leftColumn.map((stat, idx) => (
              <div key={idx} className="p-2 bg-citrus-cream rounded-lg border-2 border-dashed border-citrus-sage/40">
                <div className="font-mono text-[9px] text-citrus-sage uppercase">{stat.label}</div>
                <div className="font-varsity text-base text-citrus-forest">{stat.value}</div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {rightColumn.map((stat, idx) => (
              <div key={idx} className="p-2 bg-citrus-cream rounded-lg border-2 border-dashed border-citrus-sage/40">
                <div className="font-mono text-[9px] text-citrus-sage uppercase">{stat.label}</div>
                <div className="font-varsity text-base text-citrus-forest">{stat.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Starter Warning Banner */}
        {!projection.starter_confirmed && (
          <div className="px-4 pb-2">
            <div className="bg-citrus-orange/20 border-2 border-citrus-orange rounded-lg p-2 text-center">
              <span className="text-[10px] font-display font-bold text-citrus-orange italic uppercase tracking-wide">
                ⚠️ Probable Starter
              </span>
            </div>
          </div>
        )}

        {/* Footer patch */}
        <div className="bg-citrus-peach px-4 py-3 rounded-b-[1.25rem] border-t-3 border-citrus-forest">
          <div className="flex justify-between items-center">
            <span className="font-varsity text-xs text-citrus-forest uppercase">Total</span>
            <span className="font-varsity text-2xl text-citrus-forest">{projection.total_projected_points.toFixed(1)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

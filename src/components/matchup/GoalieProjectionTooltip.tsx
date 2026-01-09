/**
 * GoalieProjectionTooltip Component
 * Shows "Performance Outlook" for goalies - clean projected stat lines
 * Displays: GP, Wins, Saves, Shutouts, GAA, SV%
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MatchupPlayer } from "./types";
import { cn } from "@/lib/utils";

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
        className="p-0 bg-citrus-cream corduroy-texture rounded-[1.5rem] border-4 border-citrus-forest shadow-[0_6px_0_rgba(27,48,34,0.25)] max-w-md z-[999999]"
        side="top"
        align="end"
        sideOffset={10}
      >
        {/* Header patch */}
        <div className="bg-gradient-to-r from-citrus-sage via-[#7CB518] to-citrus-sage px-5 py-4 rounded-t-[1.25rem] border-b-4 border-citrus-forest relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_rgba(255,255,255,0.2)_0%,_transparent_60%)]"></div>
          <h4 className="font-varsity text-base font-black text-citrus-cream uppercase tracking-tight text-center relative z-10">
            🥅 Goalie Outlook
          </h4>
        </div>

        {/* Stats grid with stitched borders */}
        <div className="p-5 grid grid-cols-2 gap-4">
          <div className="space-y-3">
            {leftColumn.map((stat, idx) => (
              <div key={idx} className="p-3 bg-gradient-to-br from-citrus-sage/10 to-citrus-sage/5 rounded-xl border-3 border-dashed border-citrus-sage/50 shadow-sm hover:shadow-patch transition-all">
                <div className="font-mono text-xs text-citrus-sage uppercase tracking-wider mb-1">{stat.label}</div>
                <div className="font-varsity text-2xl font-black text-citrus-forest">{stat.value}</div>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            {rightColumn.map((stat, idx) => (
              <div key={idx} className="p-3 bg-gradient-to-br from-citrus-sage/10 to-citrus-sage/5 rounded-xl border-3 border-dashed border-citrus-sage/50 shadow-sm hover:shadow-patch transition-all">
                <div className="font-mono text-xs text-citrus-sage uppercase tracking-wider mb-1">{stat.label}</div>
                <div className="font-varsity text-2xl font-black text-citrus-forest">{stat.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Starter Warning Banner */}
        {!projection.starter_confirmed && (
          <div className="px-5 pb-3">
            <div className="bg-citrus-orange/30 border-3 border-citrus-orange rounded-xl p-3 text-center shadow-sm">
              <span className="text-xs font-varsity font-black text-citrus-orange italic uppercase tracking-wide">
                ⚠️ Probable Starter
              </span>
            </div>
          </div>
        )}

        {/* Footer patch */}
        <div className="bg-gradient-to-r from-citrus-peach via-citrus-orange/50 to-citrus-peach px-5 py-4 rounded-b-[1.25rem] border-t-4 border-citrus-forest">
          <div className="flex justify-between items-center">
            <span className="font-varsity text-sm font-bold text-citrus-forest uppercase tracking-wide">Total Fantasy Points</span>
            <span className="font-varsity text-3xl font-black text-citrus-orange">{projection.total_projected_points.toFixed(1)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

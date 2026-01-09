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
        <button className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-citrus-sage/20 hover:bg-citrus-sage/40 border-2 border-citrus-sage/50 hover:border-citrus-sage transition-all cursor-help hover:scale-110">
          <span className="text-[10px] font-varsity font-black text-citrus-forest">i</span>
        </button>
      </TooltipTrigger>
      <TooltipContent 
        className="p-0 bg-citrus-forest rounded-varsity shadow-varsity border-4 border-citrus-sage max-w-md"
        side="top"
        align="end"
        sideOffset={8}
        style={{ zIndex: 9999 }}
      >
        {/* Premium Varsity Header */}
        <div className="relative bg-gradient-to-r from-citrus-sage via-citrus-sage to-citrus-peach p-3 rounded-t-xl border-b-3 border-citrus-forest">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,_#1B3022_1px,_transparent_1px)] bg-[length:24px_24px] opacity-10 rounded-t-xl"></div>
          <h4 className="font-varsity text-sm uppercase tracking-widest text-citrus-forest text-center relative z-10 drop-shadow-sm">
            🥅 Goalie Outlook
          </h4>
        </div>

        {/* 2x3 Stats Grid - Old School Scoreboard */}
        <div className="p-4 grid grid-cols-2 gap-3">
          {/* Left Column */}
          <div className="space-y-2">
            {leftColumn.map((stat, idx) => (
              <div key={idx} className="bg-citrus-cream/10 border-2 border-citrus-sage/30 rounded-lg p-2 hover:bg-citrus-sage/20 hover:border-citrus-sage/50 transition-all">
                <div className="text-[9px] font-display font-bold text-citrus-sage uppercase tracking-wider mb-0.5">{stat.label}</div>
                <div className="text-base font-varsity font-black text-citrus-cream">{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Right Column */}
          <div className="space-y-2">
            {rightColumn.map((stat, idx) => (
              <div key={idx} className="bg-citrus-cream/10 border-2 border-citrus-sage/30 rounded-lg p-2 hover:bg-citrus-sage/20 hover:border-citrus-sage/50 transition-all">
                <div className="text-[9px] font-display font-bold text-citrus-sage uppercase tracking-wider mb-0.5">{stat.label}</div>
                <div className="text-base font-varsity font-black text-citrus-cream">{stat.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Starter Warning Banner (if needed) */}
        {!projection.starter_confirmed && (
          <div className="px-4 pb-2">
            <div className="bg-citrus-orange/20 border-2 border-citrus-orange/40 rounded-lg p-2 text-center">
              <span className="text-[10px] font-display font-bold text-citrus-orange uppercase tracking-wide">
                ⚠️ Probable Starter
              </span>
            </div>
          </div>
        )}

        {/* Premium Total Points Banner */}
        <div className="relative bg-gradient-to-r from-citrus-orange via-citrus-orange to-citrus-peach p-3 border-t-3 border-citrus-forest rounded-b-xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,_#1B3022_1px,_transparent_1px)] bg-[length:24px_24px] opacity-10 rounded-b-xl"></div>
          <div className="flex justify-between items-center relative z-10">
            <span className="font-varsity text-xs uppercase tracking-widest text-citrus-cream drop-shadow-sm">Total Points</span>
            <span className="font-varsity text-2xl font-black text-citrus-cream drop-shadow-md">{projection.total_projected_points.toFixed(1)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

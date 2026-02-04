/**
 * GoalieProjectionTooltip Component
 * Shows "Performance Outlook" for goalies - clean projected stat lines
 * Displays: GP, Wins, Saves, Shutouts, GAA, SV%
 * Now uses Popover for better mobile support (tap to view, tap elsewhere to close)
 */

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MatchupPlayer } from "./types";

interface GoalieProjectionTooltipProps {
  projection: MatchupPlayer['goalieProjection'];
}

export const GoalieProjectionTooltip = ({ projection }: GoalieProjectionTooltipProps) => {
  if (!projection) return null;

  // Goalie stats - flat array for grid
  const stats = [
    { label: 'GP', value: projection.projected_gp.toFixed(1) },
    { label: 'WINS', value: projection.projected_wins.toFixed(2) },
    { label: 'SAVES', value: projection.projected_saves.toFixed(1) },
    { label: 'SO', value: projection.projected_shutouts.toFixed(2) },
    { label: 'GAA', value: projection.projected_gaa.toFixed(2) },
    { label: 'SV%', value: `${(projection.projected_save_pct * 100).toFixed(1)}%` },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="w-6 h-6 rounded-full bg-citrus-sage border-2 border-citrus-forest flex items-center justify-center active:scale-95 transition-all touch-manipulation">
          <span className="text-[10px] font-bold text-citrus-forest">i</span>
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="p-0 bg-[#E8EED9]/95 backdrop-blur-md rounded-xl border-2 border-citrus-forest shadow-lg w-[280px] z-[999999]"
        side="top"
        align="end"
        sideOffset={8}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-citrus-sage via-[#7CB518] to-citrus-sage px-4 py-3 rounded-t-xl border-b-2 border-citrus-forest">
          <h4 className="font-bold text-sm text-white uppercase tracking-tight text-center">
            🥅 Goalie Projected Stats
          </h4>
        </div>

        {/* Stats grid - compact for mobile */}
        <div className="p-3 grid grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto">
          {stats.map((stat) => (
            <div key={stat.label} className="p-2 bg-white/50 rounded-lg border border-citrus-sage/30">
              <div className="text-[10px] text-citrus-sage uppercase font-bold mb-0.5">{stat.label}</div>
              <div className="font-bold text-lg text-citrus-forest">{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Starter Warning Banner */}
        {!projection.starter_confirmed && (
          <div className="px-3 pb-2">
            <div className="bg-orange-100 border border-orange-400 rounded-lg p-2 text-center">
              <span className="text-xs font-bold text-orange-600">
                ⚠️ Probable Starter
              </span>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="bg-gradient-to-r from-citrus-peach via-citrus-orange/50 to-citrus-peach px-4 py-3 rounded-b-xl border-t-2 border-citrus-forest">
          <div className="flex justify-between items-center">
            <span className="font-bold text-xs text-citrus-forest uppercase">Projected Total</span>
            <span className="font-black text-2xl text-citrus-orange">{projection.total_projected_points.toFixed(1)}</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

/**
 * ProjectionTooltip Component
 * Shows "Performance Outlook" - clean projected stat lines without math breakdown
 * Full traceability remains in backend logs (debug_projection.py)
 * Works on hover (desktop) and tap (mobile)
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MatchupPlayer } from "./types";
import { useState } from "react";

interface ProjectionTooltipProps {
  projection: MatchupPlayer['daily_projection'];
}

export const ProjectionTooltip = ({ projection }: ProjectionTooltipProps) => {
  const [open, setOpen] = useState(false);
  
  if (!projection) return null;

  // ALWAYS show ALL 8 STATS for full transparency (even if 0)
  const stats = [
    { label: 'GOALS', value: (projection.projected_goals || 0).toFixed(2) },
    { label: 'ASSISTS', value: (projection.projected_assists || 0).toFixed(2) },
    { label: 'SOG', value: (projection.projected_sog || 0).toFixed(2) },
    { label: 'BLOCKS', value: (projection.projected_blocks || 0).toFixed(2) },
    { label: 'PPP', value: (projection.projected_ppp || 0).toFixed(2) },
    { label: 'SHP', value: (projection.projected_shp || 0).toFixed(2) },
    { label: 'HITS', value: (projection.projected_hits || 0).toFixed(2) },
    { label: 'PIM', value: (projection.projected_pim || 0).toFixed(2) },
  ];

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button 
          className="w-5 h-5 rounded-lg bg-citrus-sage border-2 border-citrus-forest shadow-patch flex items-center justify-center hover:scale-110 transition-all touch-manipulation"
          onClick={() => setOpen(!open)}
          onTouchStart={() => setOpen(true)}
        >
          <span className="text-[10px] font-varsity font-black text-citrus-forest">i</span>
        </button>
      </TooltipTrigger>
      <TooltipContent 
        className="p-0 bg-[#E8EED9]/95 backdrop-blur-md rounded-xl border-2 border-citrus-forest shadow-lg w-[280px] z-[999999]"
        side="top"
        align="end"
        sideOffset={8}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-citrus-sage via-[#7CB518] to-citrus-sage px-4 py-3 rounded-t-xl border-b-2 border-citrus-forest">
          <h4 className="font-bold text-sm text-white uppercase tracking-tight text-center">
            🏒 Projected Stats
          </h4>
        </div>

        {/* Stats grid */}
        <div className="p-3 grid grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto">
          {stats.map((stat) => (
            <div key={stat.label} className="p-2 bg-white/50 rounded-lg border border-citrus-sage/30">
              <div className="text-[10px] text-citrus-sage uppercase font-bold mb-0.5">{stat.label}</div>
              <div className="font-bold text-lg text-citrus-forest">{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="bg-gradient-to-r from-citrus-peach via-citrus-orange/50 to-citrus-peach px-4 py-3 rounded-b-xl border-t-2 border-citrus-forest">
          <div className="flex justify-between items-center">
            <span className="font-bold text-xs text-citrus-forest uppercase">Projected Total</span>
            <span className="font-black text-2xl text-citrus-orange">{projection.total_projected_points.toFixed(1)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

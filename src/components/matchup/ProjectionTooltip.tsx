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

  // Collect all stats into an array
  const stats = [
    { label: 'GOALS', value: projection.projected_goals.toFixed(2) },
    { label: 'ASSISTS', value: projection.projected_assists.toFixed(2) },
    { label: 'SOG', value: projection.projected_sog.toFixed(2) },
    { label: 'BLOCKS', value: projection.projected_blocks.toFixed(2) },
  ];

  // Add optional stats if they exist
  if (projection.projected_ppp !== undefined && projection.projected_ppp > 0) {
    stats.push({ label: 'PPP', value: projection.projected_ppp.toFixed(2) });
  }
  if (projection.projected_shp !== undefined && projection.projected_shp > 0) {
    stats.push({ label: 'SHP', value: projection.projected_shp.toFixed(2) });
  }
  if (projection.projected_hits !== undefined && projection.projected_hits > 0) {
    stats.push({ label: 'HITS', value: projection.projected_hits.toFixed(2) });
  }
  if (projection.projected_pim !== undefined && projection.projected_pim > 0) {
    stats.push({ label: 'PIM', value: projection.projected_pim.toFixed(2) });
  }

  // Split into two columns
  const midPoint = Math.ceil(stats.length / 2);
  const leftColumn = stats.slice(0, midPoint);
  const rightColumn = stats.slice(midPoint);

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
            Performance Outlook
          </h4>
        </div>

        {/* 2x4 Stats Grid - Old School Scoreboard */}
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

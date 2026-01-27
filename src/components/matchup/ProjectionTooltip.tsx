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
        <button className="w-5 h-5 rounded-lg bg-citrus-sage border-2 border-citrus-forest shadow-patch flex items-center justify-center hover:scale-110 hover:shadow-varsity transition-all group">
          <span className="text-[10px] font-varsity font-black text-citrus-forest group-hover:text-[#E8EED9] transition-colors">i</span>
        </button>
      </TooltipTrigger>
      <TooltipContent 
        className="p-0 bg-[#E8EED9]/90 backdrop-blur-md corduroy-texture rounded-[1.5rem] border-4 border-citrus-forest shadow-[0_6px_0_rgba(27,48,34,0.25)] max-w-md z-[999999]"
        side="top"
        align="end"
        sideOffset={10}
      >
        {/* Header patch */}
        <div className="bg-gradient-to-r from-citrus-sage via-[#7CB518] to-citrus-sage px-5 py-4 rounded-t-[1.25rem] border-b-4 border-citrus-forest relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_rgba(255,255,255,0.2)_0%,_transparent_60%)]"></div>
          <h4 className="font-varsity text-base font-black text-[#E8EED9] uppercase tracking-tight text-center relative z-10">
            🏒 Performance Outlook
          </h4>
        </div>

        {/* Stats grid with stitched borders */}
        <div className="p-5 grid grid-cols-2 gap-4">
          {stats.map((stat) => (
            <div key={stat.label} className="p-3 bg-gradient-to-br from-citrus-sage/10 to-citrus-sage/5 rounded-xl border-3 border-dashed border-citrus-sage/50 shadow-sm hover:shadow-patch transition-all">
              <div className="font-mono text-xs text-citrus-sage uppercase tracking-wider mb-1">{stat.label}</div>
              <div className="font-varsity text-2xl font-black text-citrus-forest">{stat.value}</div>
            </div>
          ))}
        </div>

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

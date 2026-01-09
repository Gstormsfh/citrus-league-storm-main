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
            Performance Outlook
          </h4>
        </div>

        {/* Stats grid with stitched borders */}
        <div className="p-4 grid grid-cols-2 gap-3">
          {stats.map((stat) => (
            <div key={stat.label} className="p-2 bg-citrus-cream rounded-lg border-2 border-dashed border-citrus-sage/40">
              <div className="font-mono text-[9px] text-citrus-sage uppercase">{stat.label}</div>
              <div className="font-varsity text-base text-citrus-forest">{stat.value}</div>
            </div>
          ))}
        </div>

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

/**
 * ProjectionTooltip Component
 * Shows "Performance Outlook" - clean projected stat lines without math breakdown
 * Full traceability remains in backend logs (debug_projection.py)
 * Works on hover (desktop) and tap (mobile)
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MatchupPlayer } from "./types";
import { useState, useEffect } from "react";
import { X } from "lucide-react";

// Hook to detect mobile
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  return isMobile;
};

interface ProjectionTooltipProps {
  projection: MatchupPlayer['daily_projection'];
}

export const ProjectionTooltip = ({ projection }: ProjectionTooltipProps) => {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  
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

  const content = (
    <>
      {/* Header */}
      <div className="bg-gradient-to-r from-citrus-sage via-[#7CB518] to-citrus-sage px-4 py-3 rounded-t-xl border-b-2 border-citrus-forest flex items-center justify-between">
        <h4 className="font-bold text-sm text-white uppercase tracking-tight">
          🏒 Projected Stats
        </h4>
        {isMobile && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            className="min-w-[44px] min-h-[44px] -m-2 p-2.5 rounded-full flex items-center justify-center text-white hover:text-citrus-cream hover:bg-white/10 transition-colors touch-manipulation"
          >
            <X className="h-5 w-5" />
          </button>
        )}
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

      {/* Likely Range + Confidence (Citrus 3.1) */}
      {projection.likely_low != null && projection.likely_high != null && (
        <div className="px-4 py-2 bg-white/30 border-t border-citrus-sage/20">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] font-display font-semibold text-citrus-charcoal/50 uppercase">Likely Range</span>
            <span className="text-xs font-varsity font-black text-citrus-forest">
              {projection.likely_low.toFixed(1)} – {projection.likely_high.toFixed(1)} pts
            </span>
          </div>
          {projection.dynamic_confidence != null && (
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-display text-citrus-charcoal/40">Confidence</span>
              <div className="flex-1 h-1.5 bg-citrus-sage/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-citrus-sage to-citrus-orange rounded-full"
                  style={{ width: `${Math.min(projection.dynamic_confidence * 100, 100)}%` }}
                />
              </div>
              <span className="text-[9px] font-varsity font-black text-citrus-forest">
                {Math.round(projection.dynamic_confidence * 100)}%
              </span>
              {projection.confidence_label && (
                <span className={`text-[8px] px-1 py-0 rounded font-bold ${
                  projection.confidence_label === 'High' ? 'bg-green-500/20 text-green-700' :
                  projection.confidence_label === 'Medium' ? 'bg-blue-500/20 text-blue-700' :
                  'bg-orange-500/20 text-orange-700'
                }`}>
                  {projection.confidence_label}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="bg-gradient-to-r from-citrus-peach via-citrus-orange/50 to-citrus-peach px-4 py-3 rounded-b-xl border-t-2 border-citrus-forest">
        <div className="flex justify-between items-center">
          <span className="font-bold text-xs text-citrus-forest uppercase">Projected Total</span>
          <span className="font-black text-2xl text-citrus-orange">{projection.total_projected_points.toFixed(1)}</span>
        </div>
      </div>
    </>
  );

  // Mobile: Use Popover (tap to open, stays open)
  if (isMobile) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="w-11 h-11 rounded-lg bg-citrus-sage border-2 border-citrus-forest shadow-patch flex items-center justify-center hover:scale-110 transition-all touch-manipulation"
            onClick={(e) => {
              e.stopPropagation();
              // Don't prevent default - let Popover handle the click
            }}
          >
            <span className="text-xs font-varsity font-black text-citrus-forest">i</span>
          </button>
        </PopoverTrigger>
        <PopoverContent 
          className="p-0 bg-[#E8EED9]/95 backdrop-blur-md rounded-xl border-2 border-citrus-forest shadow-lg w-[280px] !z-[9999]"
          side="top"
          align="end"
          sideOffset={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {content}
        </PopoverContent>
      </Popover>
    );
  }

  // Desktop: Use Tooltip (hover)
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          className="w-11 h-11 rounded-lg bg-citrus-sage border-2 border-citrus-forest shadow-patch flex items-center justify-center hover:scale-110 transition-all"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setOpen(!open);
          }}
        >
          <span className="text-xs font-varsity font-black text-citrus-forest">i</span>
        </button>
      </TooltipTrigger>
      <TooltipContent 
        className="p-0 bg-[#E8EED9]/95 backdrop-blur-md rounded-xl border-2 border-citrus-forest shadow-lg w-[280px] !z-[9999]"
        side="top"
        align="end"
        sideOffset={8}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
};

/**
 * ProjectionTooltip Component
 * Shows "Performance Outlook" - clean projected stat lines without math breakdown
 * Full traceability remains in backend logs (debug_projection.py)
 * Works on hover (desktop) and tap (mobile)
 *
 * Trigger is the children prop (e.g. the projected points badge).
 * Desktop: hover shows tooltip. Mobile: tap opens popover, tap outside closes.
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MatchupPlayer } from "./types";
import { useState, useEffect, ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { opponentTint, opponentTierTooltipClass } from "./opponentTint";

/* 2026-08-19 visual audit — muted-text correction.
   text-citrus-charcoal is #5C5C5C, a soft charcoal designed for the
   original CREAM theme. At 20-70% opacity on the dark #1A2A20 tiles it
   composites to near-invisible (team codes on this page measured
   1.47:1). Remapped to cream at the alpha that preserves the intended
   hierarchy while clearing 4.5:1 on a dark tile. */


/* 2026-08-19 visual audit: light "glass" surface on a dark page — see
   the surface-correction note in the armchair-gm components. bg-white/50
   composites to mid-grey on #0F1F15, where neither light nor dark text
   reaches 4.5:1. Uses the dark tile family instead. */


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
  children?: ReactNode;
}

export const ProjectionTooltip = ({ projection, children }: ProjectionTooltipProps) => {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  if (!projection) return null;

  // Opponent difficulty (2026-09-01, audit M10): the multiplier the model
  // applied for tonight's opponent, and the legend for the tint the row's
  // `vs/@ OPP` label wears because of it. Shown only when the model
  // supplied one — no number, no colour, nothing to explain.
  const opponentAdj =
    typeof projection.opponent_adjustment === 'number' && Number.isFinite(projection.opponent_adjustment)
      ? projection.opponent_adjustment
      : null;
  const tint = opponentTint(opponentAdj);

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
          <div key={stat.label} className="p-2 bg-white/5 rounded-lg border border-citrus-sage/30">
            <div className="text-[10px] text-citrus-sage uppercase font-bold mb-0.5">{stat.label}</div>
            <div className="font-bold text-lg text-pastel-cream">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Opponent difficulty + the one-line legend for the row's tint (M10) */}
      {opponentAdj !== null && (
        <div className="px-4 py-2 border-t border-citrus-sage/20" data-testid="projection-opponent">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-display font-semibold text-pastel-forest-soft uppercase">Opponent</span>
            <span
              data-testid="projection-opponent-tier"
              data-opponent-tier={tint.tier}
              className={cn('text-xs font-varsity font-black tabular-nums', opponentTierTooltipClass(tint.tier))}
            >
              {tint.label} · ×{opponentAdj.toFixed(2)}
            </span>
          </div>
          <p
            data-testid="projection-opponent-legend"
            className="mt-0.5 text-[10px] font-display text-pastel-forest-soft leading-tight flex items-center gap-1 flex-wrap"
          >
            <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full bg-pastel-sage" />
            <span>sage = easier than average</span>
            <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full bg-pastel-orange-soft ml-1" />
            <span>orange = tougher</span>
          </p>
        </div>
      )}

      {/* Likely Range + Confidence (Citrus 3.1) */}
      {projection.likely_low != null && projection.likely_high != null && (
        <div className="px-4 py-2 bg-white/30 border-t border-citrus-sage/20">
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] font-display font-semibold text-pastel-cream/65 uppercase">Likely Range</span>
            <span className="text-xs font-varsity font-black text-pastel-cream">
              {projection.likely_low.toFixed(1)} – {projection.likely_high.toFixed(1)} pts
            </span>
          </div>
          {projection.dynamic_confidence != null && (
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-display text-pastel-cream/60">Confidence</span>
              <div className="flex-1 h-1.5 bg-citrus-sage/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-citrus-sage to-citrus-orange rounded-full"
                  style={{ width: `${Math.min(projection.dynamic_confidence * 100, 100)}%` }}
                />
              </div>
              <span className="text-[9px] font-varsity font-black text-pastel-cream">
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
          <span className="font-bold text-xs text-pastel-cream uppercase">Projected Total</span>
          <span className="font-black text-2xl text-citrus-orange">{projection.total_projected_points.toFixed(1)}</span>
        </div>
      </div>
    </>
  );

  // Default trigger: the projected points value as a tappable/hoverable badge
  const defaultTrigger = (
    <span className="text-xs font-varsity font-black text-citrus-orange bg-citrus-peach/30 px-1.5 py-0.5 rounded border border-citrus-peach/50 shadow-[inset_0_1px_1px_rgba(0,0,0,0.1)] cursor-pointer hover:text-pastel-cream transition-all">
      {projection.total_projected_points.toFixed(1)} pts
    </span>
  );

  const trigger = children || defaultTrigger;

  // Mobile: Use Popover (tap to open, tap outside to close)
  if (isMobile) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="touch-manipulation"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            {trigger}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0 bg-[#E8EED9]/95 backdrop-blur-md rounded-xl border-2 border-citrus-forest shadow-lg w-[280px] !z-[9999]"
          side="top"
          align="center"
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
          className="transition-all"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setOpen(!open);
          }}
        >
          {trigger}
        </button>
      </TooltipTrigger>
      <TooltipContent
        className="p-0 bg-[#E8EED9]/95 backdrop-blur-md rounded-xl border-2 border-citrus-forest shadow-lg w-[280px] !z-[9999]"
        side="top"
        align="center"
        sideOffset={8}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
};

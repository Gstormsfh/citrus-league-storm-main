/**
 * GoalieProjectionTooltip Component
 * Shows "Performance Outlook" for goalies - clean projected stat lines
 * Displays: GP, Wins, Saves, Shutouts, GAA, SV%
 * Works on hover (desktop) and tap (mobile)
 *
 * Trigger is the children prop (e.g. the projected points badge).
 * Desktop: hover shows tooltip. Mobile: tap opens popover, tap outside closes.
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MatchupPlayer } from "./types";
import { useState, ReactNode } from "react";
import { X } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";

/* 2026-08-19 visual audit: light "glass" surface on a dark page — see
   the surface-correction note in the armchair-gm components. bg-white/50
   composites to mid-grey on #0F1F15, where neither light nor dark text
   reaches 4.5:1. Uses the dark tile family instead. */

interface GoalieProjectionTooltipProps {
  projection: MatchupPlayer['goalieProjection'];
  children?: ReactNode;
}

export const GoalieProjectionTooltip = ({ projection, children }: GoalieProjectionTooltipProps) => {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

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

  const content = (
    <>
      {/* Header */}
      <div className="bg-gradient-to-r from-citrus-sage via-[#7CB518] to-citrus-sage px-4 py-3 rounded-t-xl border-b-2 border-citrus-forest flex items-center justify-between">
        <h4 className="font-bold text-sm text-white uppercase tracking-tight">
          🥅 Goalie Projected Stats
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
          className="p-0 bg-[#E8EED9]/95 backdrop-blur-md rounded-xl border-2 border-citrus-forest shadow-lg w-[280px] !z-popover"
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
        className="p-0 bg-[#E8EED9]/95 backdrop-blur-md rounded-xl border-2 border-citrus-forest shadow-lg w-[280px] !z-popover"
        side="top"
        align="center"
        sideOffset={8}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
};

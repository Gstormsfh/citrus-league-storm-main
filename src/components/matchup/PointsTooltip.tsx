import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatBreakdown } from "./types";
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

export const PointsTooltip = ({ 
  breakdown, 
  totalPoints 
}: { 
  breakdown: StatBreakdown | undefined;
  totalPoints: number;
}) => {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  
  if (!breakdown || Object.keys(breakdown).length === 0) {
    return (
      <span className="font-varsity font-black text-citrus-orange">
        {totalPoints.toFixed(1)}
      </span>
    );
  }

  // Convert breakdown to array
  const breakdownArray = Object.entries(breakdown).map(([category, data]) => ({
    label: category.replace(/_/g, ' ').toUpperCase(),
    count: data.count,
    points: data.points
  }));
  
  const content = (
    <>
      {/* Header */}
      <div className="bg-gradient-to-r from-citrus-orange via-citrus-peach to-citrus-orange px-4 py-3 rounded-t-xl border-b-2 border-citrus-forest flex items-center justify-between">
        <h4 className="font-bold text-sm text-white uppercase tracking-tight">
          🏒 Scoring Breakdown
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
        {breakdownArray.map((stat) => (
          <div key={stat.label} className="p-2 bg-white/50 rounded-lg border border-citrus-orange/30">
            <div className="flex items-baseline justify-between gap-1 mb-0.5">
              <span className="text-[10px] text-citrus-orange uppercase font-bold truncate">{stat.label}</span>
              <span className="text-xs text-gray-600 bg-gray-100 px-1 rounded">×{stat.count}</span>
            </div>
            <div className="font-bold text-lg text-green-700">+{stat.points.toFixed(1)}</div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="bg-gradient-to-r from-citrus-sage via-[#7CB518] to-citrus-sage px-4 py-3 rounded-b-xl border-t-2 border-citrus-forest">
        <div className="flex justify-between items-center">
          <span className="font-bold text-xs text-white uppercase">Total</span>
          <span className="font-black text-2xl text-white">{totalPoints.toFixed(1)}</span>
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
            className="text-sm text-citrus-orange hover:text-citrus-forest cursor-pointer font-bold font-varsity transition-all touch-manipulation"
            onClick={(e) => {
              e.stopPropagation();
              // Don't prevent default - let Popover handle the click
            }}
          >
            {totalPoints.toFixed(1)}
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
          className="text-xs font-varsity font-black text-citrus-orange bg-citrus-peach/30 px-1.5 py-0.5 rounded border border-citrus-peach/50 shadow-[inset_0_1px_1px_rgba(0,0,0,0.1)] hover:text-citrus-forest cursor-pointer transition-all"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setOpen(!open);
          }}
        >
          {totalPoints.toFixed(1)} pts
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

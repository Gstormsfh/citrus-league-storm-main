import { useState } from 'react';
import { cn } from '@/lib/utils';
import { TeamCapData, formatCap, formatCapFull, SALARY_CAP_2025_26, MAX_CONTRACTS, MAX_ACTIVE_ROSTER } from '@/types/captracker';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TrendingUp, TrendingDown, Users, FileText, AlertTriangle, Shield, X } from 'lucide-react';
import { useIsMobile } from '@/components/mobile/AppShell';

interface CapSummaryBarProps {
  data: TeamCapData;
}

export default function CapSummaryBar({ data }: CapSummaryBarProps) {
  const capUsedPercent = Math.min((data.projectedCapHit / data.salaryCap) * 100, 100);
  const isOverCap = data.capSpace < 0;
  const isNearCap = data.capSpace >= 0 && data.capSpace < 3_000_000;
  const isMobile = useIsMobile();
  const [capPopoverOpen, setCapPopoverOpen] = useState(false);

  return (
    <div className="bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-citrus-sage/30 shadow-varsity overflow-hidden">
      {/* Team Header */}
      <div className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 bg-gradient-to-r from-citrus-sage/20 via-citrus-sage/10 to-citrus-sage/20 border-b-2 border-citrus-sage/30">
        <div className="flex items-center gap-3 sm:gap-4">
          <img
            src={data.logoUrl}
            alt={data.teamName}
            className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 object-contain drop-shadow-md"
          />
          <div className="flex-1 min-w-0">
            <h2 className="font-varsity text-lg sm:text-xl md:text-2xl text-citrus-forest tracking-tight truncate">
              {data.teamName}
            </h2>
            <p className="text-[10px] sm:text-xs text-citrus-charcoal/60 font-display">
              {data.conference} &middot; {data.division}
            </p>
          </div>
          <div className="hidden md:block text-right">
            <div className="text-[10px] text-citrus-charcoal/50 uppercase font-display font-bold tracking-wider">
              2025-26 Cap
            </div>
            <div className="font-varsity text-lg text-citrus-charcoal">
              {formatCap(SALARY_CAP_2025_26)}
            </div>
          </div>
        </div>
      </div>

      {/* Cap Bar Section */}
      <div className="px-3 sm:px-4 md:px-6 py-3 sm:py-4">
        {/* Numbers Row */}
        <div className="flex items-end justify-between mb-2">
          <div>
            <div className="text-[9px] sm:text-[10px] text-citrus-charcoal/50 uppercase font-display font-bold tracking-wider">
              Projected Cap Hit
            </div>
            <div className="font-varsity text-base sm:text-lg md:text-xl text-citrus-forest">
              {formatCapFull(data.projectedCapHit)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] sm:text-[10px] text-citrus-charcoal/50 uppercase font-display font-bold tracking-wider">
              Cap Space
            </div>
            <div className={cn(
              "font-varsity text-base sm:text-lg md:text-xl",
              isOverCap ? "text-red-600" : isNearCap ? "text-amber-600" : "text-citrus-sage"
            )}>
              {isOverCap ? '-' : ''}{formatCapFull(Math.abs(data.capSpace))}
            </div>
          </div>
        </div>

        {/* Visual Cap Bar */}
        {(() => {
          const barContent = (
            <div className="relative h-6 md:h-8 bg-citrus-cream rounded-full overflow-hidden border-2 border-dashed border-citrus-sage/40 shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)] cursor-help">
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out",
                  isOverCap
                    ? "bg-gradient-to-r from-red-500 via-red-400 to-red-500"
                    : isNearCap
                    ? "bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400"
                    : "bg-gradient-to-r from-citrus-sage via-[#7CB518] to-citrus-sage"
                )}
                style={{ width: `${capUsedPercent}%` }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />
              </div>
              {data.deadCap > 0 && (
                <div
                  className="absolute inset-y-0 bg-gray-400/50 border-r-2 border-gray-500/50"
                  style={{
                    left: `${Math.min(((data.projectedCapHit - data.deadCap) / data.salaryCap) * 100, 100)}%`,
                    width: `${Math.min((data.deadCap / data.salaryCap) * 100, 10)}%`,
                  }}
                />
              )}
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={cn(
                  "font-varsity text-[10px] md:text-xs font-bold tracking-wider drop-shadow-sm",
                  capUsedPercent > 50 ? "text-white" : "text-citrus-forest"
                )}>
                  {capUsedPercent.toFixed(1)}% USED
                </span>
              </div>
            </div>
          );
          const detailContent = (
            <div className="space-y-1 text-xs">
              {isMobile && <div className="flex justify-end"><button onClick={() => setCapPopoverOpen(false)} className="p-0.5 rounded-full hover:bg-citrus-cream/20"><X className="h-3.5 w-3.5" /></button></div>}
              <div className="flex justify-between gap-4"><span>Cap Ceiling:</span><span className="font-varsity">{formatCapFull(data.salaryCap)}</span></div>
              <div className="flex justify-between gap-4"><span>Projected Hit:</span><span className="font-varsity">{formatCapFull(data.projectedCapHit)}</span></div>
              {data.deadCap > 0 && <div className="flex justify-between gap-4"><span>Dead Cap:</span><span className="font-varsity">{formatCapFull(data.deadCap)}</span></div>}
              {data.ltirUsed > 0 && <div className="flex justify-between gap-4"><span>LTIR Relief:</span><span className="font-varsity">{formatCapFull(data.ltirUsed)}</span></div>}
              <hr className="border-citrus-cream/20" />
              <div className="flex justify-between gap-4 font-bold"><span>Remaining Space:</span><span className="font-varsity">{formatCapFull(data.capSpace)}</span></div>
            </div>
          );
          const contentClass = "bg-citrus-forest text-citrus-cream p-3 max-w-xs !z-[9999]";
          return isMobile ? (
            <Popover open={capPopoverOpen} onOpenChange={setCapPopoverOpen}>
              <PopoverTrigger asChild><button className="touch-manipulation w-full">{barContent}</button></PopoverTrigger>
              <PopoverContent side="top" align="center" sideOffset={4} className={contentClass} onOpenAutoFocus={(e) => e.preventDefault()}>{detailContent}</PopoverContent>
            </Popover>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>{barContent}</TooltipTrigger>
              <TooltipContent className={contentClass}>{detailContent}</TooltipContent>
            </Tooltip>
          );
        })()}

        {/* Quick Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 sm:gap-2 md:gap-3 mt-3 sm:mt-4">
          <QuickStat
            icon={<Users className="w-4 h-4" />}
            label="Active Roster"
            value={`${data.activeRosterSize}`}
            subValue={`/ ${MAX_ACTIVE_ROSTER}`}
            warning={data.activeRosterSize > MAX_ACTIVE_ROSTER}
          />
          <QuickStat
            icon={<FileText className="w-4 h-4" />}
            label="Total Contracts"
            value={`${data.totalContracts}`}
            subValue={`/ ${MAX_CONTRACTS}`}
            warning={data.totalContracts > MAX_CONTRACTS - 3}
          />
          <QuickStat
            icon={isOverCap ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
            label="Cap Space"
            value={formatCap(Math.abs(data.capSpace))}
            subValue={isOverCap ? 'OVER' : 'available'}
            warning={isOverCap}
          />
          <QuickStat
            icon={<Shield className="w-4 h-4" />}
            label="Dead Cap"
            value={data.deadCap > 0 ? formatCap(data.deadCap) : '$0'}
            subValue={data.ltirUsed > 0 ? `LTIR: ${formatCap(data.ltirUsed)}` : 'none'}
          />
        </div>
      </div>
    </div>
  );
}

function QuickStat({
  icon,
  label,
  value,
  subValue,
  warning,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
  warning?: boolean;
}) {
  return (
    <div className={cn(
      "flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 sm:py-2.5 rounded-xl border-2 transition-colors",
      warning
        ? "bg-red-50/50 border-red-200 text-red-700"
        : "bg-citrus-sage/10 border-citrus-sage/30 text-citrus-forest"
    )}>
      <div className={cn(
        "p-1 sm:p-1.5 rounded-lg flex-shrink-0",
        warning ? "bg-red-100" : "bg-citrus-sage/20"
      )}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[8px] sm:text-[9px] uppercase font-display font-bold tracking-wider opacity-60 truncate">{label}</div>
        <div className="flex items-baseline gap-1">
          <span className="font-varsity text-xs sm:text-sm">{value}</span>
          {subValue && (
            <span className="text-[8px] sm:text-[9px] font-display opacity-50">{subValue}</span>
          )}
        </div>
      </div>
    </div>
  );
}

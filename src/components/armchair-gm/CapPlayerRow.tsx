import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, Lock, FileText, X } from 'lucide-react';
import { PlayerContract, formatCap, formatCapFull } from '@/types/captracker';
import PlayerAvatar from './PlayerAvatar';

// Hook to detect mobile/tablet
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

interface CapPlayerRowProps {
  player: PlayerContract;
  rank: number;
  maxCapHit: number; // For scaling the cap bar
}

export default function CapPlayerRow({ player, rank, maxCapHit }: CapPlayerRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [capTooltipOpen, setCapTooltipOpen] = useState(false);
  const isMobile = useIsMobile();

  const capBarPercent = Math.min((player.capHit / maxCapHit) * 100, 100);

  const statusColor = {
    UFA: 'bg-red-500/80 text-white',
    RFA: 'bg-amber-500/80 text-white',
    ELC: 'bg-blue-500/80 text-white',
    Signed: 'bg-citrus-sage/80 text-citrus-forest',
    '35+': 'bg-purple-500/80 text-white',
  };

  const clauseLabel = {
    NMC: { label: 'NMC', color: 'bg-red-100 text-red-700 border-red-200' },
    'M-NTC': { label: 'M-NTC', color: 'bg-amber-100 text-amber-700 border-amber-200' },
    NTC: { label: 'NTC', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  };

  const rosterStatusBadge = {
    IR: 'bg-red-500 text-white',
    LTIR: 'bg-red-700 text-white',
    AHL: 'bg-slate-500 text-white',
    Buyout: 'bg-gray-600 text-white',
    Retained: 'bg-gray-500 text-white',
    NHL: '',
  };

  return (
    <div className="group">
      {/* Main Row */}
      <div
        className={cn(
          "grid grid-cols-[2rem_2.5rem_1fr_4rem_5.5rem_4rem_4.5rem_2rem] md:grid-cols-[2rem_3rem_1fr_3.5rem_6rem_5rem_5rem_3rem] items-center gap-1 md:gap-2 px-2 md:px-3 py-2 cursor-pointer transition-all",
          "hover:bg-citrus-sage/10",
          expanded && "bg-citrus-sage/15",
          rank % 2 === 0 ? "bg-white/40" : "bg-citrus-cream/30"
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Rank */}
        <span className="text-[10px] md:text-xs text-citrus-charcoal/50 font-display font-semibold text-center">
          {rank}
        </span>

        {/* Player Avatar */}
        <PlayerAvatar
          name={player.name}
          position={player.position}
          jerseyNumber={player.jerseyNumber}
          size="sm"
          className="md:w-10 md:h-10"
        />

        {/* Name + Position + Status Badges */}
        <div className="min-w-0 flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="font-display font-bold text-xs md:text-sm text-citrus-forest truncate">
              {player.name}
            </span>
            {player.rosterStatus !== 'NHL' && (
              <Badge className={cn("text-[7px] md:text-[8px] h-4 px-1", rosterStatusBadge[player.rosterStatus])}>
                {player.rosterStatus}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Badge className="bg-citrus-sage/20 text-citrus-forest text-[8px] md:text-[9px] h-4 px-1.5 font-varsity border border-citrus-sage/40">
              {player.position}
            </Badge>
            <span className="text-[9px] md:text-[10px] text-citrus-charcoal/60 font-display">
              #{player.jerseyNumber}
            </span>
            {player.clause && (
              <Badge className={cn("text-[7px] h-3.5 px-1 border", clauseLabel[player.clause].color)}>
                {clauseLabel[player.clause].label}
              </Badge>
            )}
          </div>
        </div>

        {/* Age */}
        <span className="text-[10px] md:text-xs text-citrus-charcoal/70 font-display text-center">
          {player.age}
        </span>

        {/* Cap Hit with mini bar */}
        {isMobile ? (
          <Popover open={capTooltipOpen} onOpenChange={setCapTooltipOpen}>
            <PopoverTrigger asChild>
              <button
                className="flex flex-col gap-0.5 w-full touch-manipulation"
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <span className="font-varsity text-xs md:text-sm text-citrus-forest text-right">
                  {formatCap(player.capHit)}
                </span>
                <div className="h-1.5 bg-citrus-cream rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-citrus-sage to-[#7CB518] transition-all duration-500"
                    style={{ width: `${capBarPercent}%` }}
                  />
                </div>
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="center"
              sideOffset={4}
              className="bg-citrus-forest text-citrus-cream text-xs p-2 w-auto !z-[9999]"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="flex items-center justify-between gap-2">
                <span>Cap Hit: {formatCapFull(player.capHit)}</span>
                <button onClick={(e) => { e.stopPropagation(); setCapTooltipOpen(false); }} className="text-citrus-sage/60 hover:text-citrus-cream transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </PopoverContent>
          </Popover>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex flex-col gap-0.5">
                <span className="font-varsity text-xs md:text-sm text-citrus-forest text-right">
                  {formatCap(player.capHit)}
                </span>
                <div className="h-1.5 bg-citrus-cream rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-citrus-sage to-[#7CB518] transition-all duration-500"
                    style={{ width: `${capBarPercent}%` }}
                  />
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent className="bg-citrus-forest text-citrus-cream text-xs p-2">
              Cap Hit: {formatCapFull(player.capHit)}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Years Remaining */}
        <div className="flex flex-col items-center">
          <span className="text-[10px] md:text-xs text-citrus-charcoal/70 font-display">
            {player.yearsRemaining}yr
          </span>
          <span className="text-[8px] md:text-[9px] text-citrus-charcoal/50">
            {player.expiryYear}
          </span>
        </div>

        {/* Expiry Status */}
        <Badge className={cn("text-[8px] md:text-[9px] h-5 px-1.5 font-varsity font-bold tracking-wide", statusColor[player.expiryStatus])}>
          {player.expiryStatus}
        </Badge>

        {/* Expand arrow */}
        <div className="flex justify-center">
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-citrus-charcoal/40" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-citrus-charcoal/40 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity" />
          )}
        </div>
      </div>

      {/* Expanded Detail */}
      {expanded && (
        <div className="px-4 md:px-6 py-3 bg-gradient-to-br from-citrus-sage/10 to-citrus-cream/50 border-t border-b border-citrus-sage/20 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <DetailItem label="Base Salary" value={formatCapFull(player.baseSalary)} />
            <DetailItem label="Signing Bonus" value={formatCapFull(player.signingBonus)} />
            <DetailItem label="Total Salary" value={formatCapFull(player.totalSalary)} />
            <DetailItem label="AAV" value={formatCapFull(player.aav)} />
            <DetailItem label="Cap Hit" value={formatCapFull(player.capHit)} highlight />
            <DetailItem label="Contract Length" value={`${player.contractYears} years`} />
            <DetailItem label="Expires" value={`${player.expiryYear} (${player.expiryStatus})`} />
            <DetailItem
              label="Waiver Exempt"
              value={player.isWaiverExempt ? 'Yes' : 'No'}
            />
            {player.performanceBonuses !== undefined && player.performanceBonuses > 0 && (
              <DetailItem label="Perf. Bonuses" value={formatCapFull(player.performanceBonuses)} />
            )}
            {player.clause && (
              <div className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-citrus-charcoal/50" />
                <div>
                  <div className="text-[9px] text-citrus-charcoal/50 uppercase font-display font-bold tracking-wider">Clause</div>
                  <div className="text-xs font-display font-semibold text-citrus-forest flex items-center gap-1">
                    {player.clause === 'NMC' && <Lock className="w-3 h-3" />}
                    {player.clause === 'NMC' ? 'No Movement Clause' : player.clause === 'M-NTC' ? 'Modified No-Trade Clause' : 'No-Trade Clause'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[9px] text-citrus-charcoal/50 uppercase font-display font-bold tracking-wider">{label}</div>
      <div className={cn(
        "text-xs font-display font-semibold",
        highlight ? "text-citrus-orange font-varsity text-sm" : "text-citrus-forest"
      )}>
        {value}
      </div>
    </div>
  );
}

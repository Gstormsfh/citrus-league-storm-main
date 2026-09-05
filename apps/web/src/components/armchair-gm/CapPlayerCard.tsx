import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Lock, FileText, X } from 'lucide-react';
import { useState, useEffect } from 'react';
import { PlayerContract, formatCap, formatCapFull } from '@/types/captracker';
import PlayerAvatar from './PlayerAvatar';

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


/* 2026-08-19 visual audit — surface correction.
   These panels used bg-white/55..80 ("frosted glass") on the #0F1F15
   dark page. Composited, that lands around rgb(159,165,161) — a MID-GREY
   dead zone where nothing reads: cream text measured 2.37:1 and the dark
   labels 1.58:1 against it. There is no text colour that fixes a
   mid-grey surface; the surface itself is the bug. Swapped to the dark
   tile family the rest of the app uses (ui/card.tsx is
   bg-pastel-surface-tile max-lg:bg-pressbox-tile + ring-white/10), so cream text lands at 13:1. */


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

interface CapPlayerCardProps {
  player: PlayerContract;
  maxCapHit: number;
}

const statusColor: Record<string, string> = {
  UFA: 'bg-red-500 text-white',
  RFA: 'bg-amber-500 text-white',
  ELC: 'bg-blue-500 text-white',
  Signed: 'bg-citrus-sage text-pastel-forest',
  '35+': 'bg-purple-500 text-white',
};

const clauseConfig: Record<string, { label: string; color: string; icon: boolean }> = {
  NMC: { label: 'NMC', color: 'bg-red-500/90 text-white border-red-600', icon: true },
  'M-NTC': { label: 'M-NTC', color: 'bg-amber-500/90 text-white border-amber-600', icon: false },
  NTC: { label: 'NTC', color: 'bg-orange-500/90 text-white border-orange-600', icon: false },
};

const rosterStatusConfig: Record<string, { color: string; pulse?: boolean }> = {
  IR: { color: 'bg-red-500 text-white' },
  LTIR: { color: 'bg-red-700 text-white', pulse: true },
  AHL: { color: 'bg-slate-500 text-white' },
  Buyout: { color: 'bg-gray-600 text-white' },
  Retained: { color: 'bg-gray-500 text-white' },
};

export default function CapPlayerCard({ player, maxCapHit }: CapPlayerCardProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const capBarPercent = Math.min((player.capHit / maxCapHit) * 100, 100);
  const isNonNHL = player.rosterStatus !== 'NHL';
  const rosterConfig = rosterStatusConfig[player.rosterStatus];

  const cardContent = (
        <div className={cn(
          "relative rounded-2xl max-lg:rounded-[12px] overflow-hidden transition-all duration-200 cursor-default group",
          "border-2 shadow-patch",
          isNonNHL
            ? "bg-white/5 border-citrus-charcoal/15 opacity-80 hover:opacity-100"
            : "bg-pastel-surface-tile max-lg:bg-pressbox-tile backdrop-blur-sm border-citrus-sage/40 hover:border-citrus-sage hover:shadow-varsity",
        )}>
          {/* ─── Top accent stripe ─── */}
          <div className="h-[3px] bg-gradient-to-r from-citrus-sage via-[#7CB518] to-citrus-sage" />

          {/* ─── Header: Name + Position ─── */}
          <div className="relative px-2 md:px-2.5 pt-1.5 md:pt-2 pb-1 md:pb-1.5 bg-gradient-to-br from-citrus-sage/20 via-citrus-sage/8 to-transparent">
            {/* Corduroy texture overlay */}
            <div className="absolute inset-0 opacity-[0.04]" style={{
              backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 1px, rgba(0,0,0,0.1) 1px, rgba(0,0,0,0.1) 2px)',
            }} />

            {/* Position badge - top right */}
            <Badge className="absolute top-1 right-1 md:top-1.5 md:right-1.5 bg-gradient-to-br from-citrus-sage to-[#7CB518] border md:border-2 border-citrus-forest/80 text-pastel-cream max-lg:text-pressbox-text font-varsity max-lg:font-condensed shadow-patch text-[7px] md:text-[9px] tracking-wider font-black h-4 md:h-5 px-1 md:px-2 z-10">
              {player.position}
            </Badge>

            {/* Non-NHL status badge - top left */}
            {isNonNHL && rosterConfig && (
              <Badge className={cn(
                "absolute top-1 left-1 md:top-1.5 md:left-1.5 text-[6px] md:text-[7px] h-3.5 md:h-4 px-1 md:px-1.5 font-varsity max-lg:font-condensed font-bold tracking-wider z-10 border",
                rosterConfig.color,
                rosterConfig.pulse && "animate-pulse",
              )}>
                {player.rosterStatus}
              </Badge>
            )}

            {/* Player info row */}
            <div className="flex items-center gap-1.5 md:gap-2.5 relative z-[1]">
              {/* Avatar: hidden on small tablets, shown on md+ */}
              <div className="hidden md:block">
                <PlayerAvatar
                  name={player.name}
                  position={player.position}
                  image={player.headshot}
                  team={player.team}
                  size="md"
                />
              </div>

              <div className="min-w-0 flex-1 pr-6 md:pr-7">
                <div className="font-display max-lg:font-barlow font-extrabold text-[10px] md:text-[11px] leading-tight text-pastel-cream max-lg:text-pressbox-text truncate group-hover:text-[#7CB518] transition-colors">
                  {player.name}
                </div>
                <div className="flex items-center gap-1 md:gap-1.5 mt-0.5">
                  {player.jerseyNumber > 0 && (
                    <span className="text-[8px] md:text-[9px] text-citrus-sage font-varsity max-lg:font-condensed font-bold">
                      #{player.jerseyNumber}
                    </span>
                  )}
                  {player.age > 0 && (
                    <>
                      <span className="text-[7px] text-pastel-cream/60 max-lg:text-pressbox-text/60">|</span>
                      <span className="text-[8px] md:text-[9px] text-pastel-cream/65 max-lg:text-pressbox-text/65 font-display max-lg:font-barlow font-semibold">
                        {player.age}yr
                      </span>
                    </>
                  )}
                  {player.clause && (
                    <>
                      <span className="hidden md:inline text-[7px] text-pastel-cream/60 max-lg:text-pressbox-text/60">|</span>
                      <Badge className={cn("hidden md:flex text-[6px] h-3.5 px-1 font-varsity max-lg:font-condensed font-bold border items-center gap-0.5", clauseConfig[player.clause].color)}>
                        {clauseConfig[player.clause].icon && <Lock className="w-2 h-2" />}
                        {clauseConfig[player.clause].label}
                      </Badge>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ─── Cap Hit Section ─── */}
          <div className="px-2 md:px-2.5 py-1.5 md:py-2 border-t-2 border-citrus-sage/20 bg-gradient-to-br from-citrus-cream/45 to-citrus-cream/25">
            {/* Cap hit + Status badge */}
            <div className="flex items-baseline justify-between gap-1">
              <span className="font-varsity max-lg:font-condensed text-xs md:text-base text-pastel-cream max-lg:text-pressbox-text leading-none tracking-tight">
                {formatCap(player.capHit)}
              </span>
              <Badge className={cn("text-[6px] md:text-[7px] h-3.5 md:h-4 px-1 md:px-1.5 font-varsity max-lg:font-condensed font-bold tracking-wider border-0 shadow-sm", statusColor[player.expiryStatus])}>
                {player.expiryStatus}
              </Badge>
            </div>

            {/* Cap bar */}
            <div className="relative h-1.5 md:h-2 mt-1 md:mt-1.5 bg-citrus-cream/60 rounded-full overflow-hidden border border-citrus-sage/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]">
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out",
                  capBarPercent > 80
                    ? "bg-gradient-to-r from-citrus-orange via-amber-400 to-citrus-orange"
                    : "bg-gradient-to-r from-citrus-sage via-[#7CB518] to-citrus-sage",
                )}
                style={{ width: `${capBarPercent}%` }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              </div>
            </div>

            {/* Term + Expiry */}
            <div className="flex items-center justify-between mt-1 md:mt-1.5">
              <span className="text-[8px] md:text-[9px] text-pastel-cream/65 max-lg:text-pressbox-text/65 font-display max-lg:font-barlow font-semibold">
                {player.yearsRemaining}yr
              </span>
              <span className="text-[8px] md:text-[9px] text-pastel-cream/60 max-lg:text-pressbox-text/60 font-display max-lg:font-barlow">
                exp. {player.expiryYear}
              </span>
            </div>
          </div>
        </div>
  );

  const detailContent = (
    <div>
      {/* Tooltip header */}
      <div className="flex items-center gap-2 border-b border-citrus-sage/30 pb-2 mb-2.5">
        <PlayerAvatar name={player.name} position={player.position} image={player.headshot} team={player.team} size="sm" />
        <div className="flex-1 min-w-0">
          <h4 className="font-varsity max-lg:font-condensed text-sm leading-tight truncate">{player.name}</h4>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[9px] text-citrus-sage/80 font-display max-lg:font-barlow">{player.position}</span>
            {player.age > 0 && <span className="text-[9px] text-citrus-sage/60 font-display max-lg:font-barlow">Age {player.age}</span>}
          </div>
        </div>
        {isMobile && (
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            className="min-w-[44px] min-h-[44px] -m-2 p-2.5 rounded-full flex items-center justify-center text-citrus-sage/60 hover:text-citrus-cream hover:bg-citrus-sage/10 transition-colors touch-manipulation"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Contract grid */}
      <div className="space-y-1.5">
        <TooltipRow label="Cap Hit" value={formatCapFull(player.capHit)} highlight />
        <TooltipRow label="AAV" value={formatCapFull(player.aav)} />
        <TooltipRow label="Base Salary" value={formatCapFull(player.baseSalary)} />
        {player.signingBonus > 0 && (
          <TooltipRow label="Signing Bonus" value={formatCapFull(player.signingBonus)} />
        )}
        <div className="border-t border-citrus-sage/20 my-1.5" />
        <TooltipRow label="Contract" value={`${player.contractYears}yr total`} />
        <TooltipRow label="Remaining" value={`${player.yearsRemaining}yr (exp. ${player.expiryYear})`} />
        <TooltipRow label="Status" value={player.expiryStatus === 'UFA' ? 'Unrestricted FA' : player.expiryStatus === 'RFA' ? 'Restricted FA' : player.expiryStatus} />
        {player.clause && (
          <div className="flex items-center gap-1.5 pt-1">
            <FileText className="w-3 h-3 text-citrus-sage/60" />
            <span className="text-[10px] font-display max-lg:font-barlow text-citrus-sage/80">
              {player.clause === 'NMC' ? 'No-Movement Clause' : player.clause === 'M-NTC' ? 'Modified No-Trade' : 'No-Trade Clause'}
            </span>
          </div>
        )}
      </div>
    </div>
  );

  const popoverClasses = "bg-citrus-forest/95 backdrop-blur-md text-citrus-cream p-4 max-w-[280px] rounded-2xl max-lg:rounded-[12px] border-2 border-citrus-sage/40 shadow-varsity !z-popover";

  // Mobile: Use Popover (tap to open, tap outside to close)
  if (isMobile) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="touch-manipulation text-left w-full" onClick={(e) => e.stopPropagation()}>
            {cardContent}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          sideOffset={8}
          className={popoverClasses}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {detailContent}
        </PopoverContent>
      </Popover>
    );
  }

  // Desktop: Use Tooltip (hover)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {cardContent}
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className={popoverClasses}
      >
        {detailContent}
      </TooltipContent>
    </Tooltip>
  );
}

function TooltipRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-[10px] font-display max-lg:font-barlow text-citrus-sage/70">{label}</span>
      <span className={cn("font-varsity max-lg:font-condensed text-[11px]", highlight ? "text-citrus-cream" : "text-citrus-sage/90")}>
        {value}
      </span>
    </div>
  );
}

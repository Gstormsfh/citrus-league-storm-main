import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Lock, FileText } from 'lucide-react';
import { PlayerContract, formatCap, formatCapFull } from '@/types/captracker';
import PlayerAvatar from './PlayerAvatar';

interface CapPlayerCardProps {
  player: PlayerContract;
  maxCapHit: number;
}

const statusColor: Record<string, string> = {
  UFA: 'bg-red-500 text-white',
  RFA: 'bg-amber-500 text-white',
  ELC: 'bg-blue-500 text-white',
  Signed: 'bg-citrus-sage text-citrus-forest',
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
  const capBarPercent = Math.min((player.capHit / maxCapHit) * 100, 100);
  const isNonNHL = player.rosterStatus !== 'NHL';
  const rosterConfig = rosterStatusConfig[player.rosterStatus];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn(
          "relative rounded-2xl overflow-hidden transition-all duration-200 cursor-default group",
          "border-2 shadow-patch",
          isNonNHL
            ? "bg-white/50 border-citrus-charcoal/15 opacity-80 hover:opacity-100"
            : "bg-white/80 backdrop-blur-sm border-citrus-sage/40 hover:border-citrus-sage hover:shadow-varsity",
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
            <Badge className="absolute top-1 right-1 md:top-1.5 md:right-1.5 bg-gradient-to-br from-citrus-sage to-[#7CB518] border md:border-2 border-citrus-forest/80 text-citrus-forest font-varsity shadow-patch text-[7px] md:text-[9px] tracking-wider font-black h-4 md:h-5 px-1 md:px-2 z-10">
              {player.position}
            </Badge>

            {/* Non-NHL status badge - top left */}
            {isNonNHL && rosterConfig && (
              <Badge className={cn(
                "absolute top-1 left-1 md:top-1.5 md:left-1.5 text-[6px] md:text-[7px] h-3.5 md:h-4 px-1 md:px-1.5 font-varsity font-bold tracking-wider z-10 border",
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
                  jerseyNumber={player.jerseyNumber}
                  size="md"
                />
              </div>

              <div className="min-w-0 flex-1 pr-6 md:pr-7">
                <div className="font-display font-extrabold text-[10px] md:text-[11px] leading-tight text-citrus-forest truncate group-hover:text-[#7CB518] transition-colors">
                  {player.name}
                </div>
                <div className="flex items-center gap-1 md:gap-1.5 mt-0.5">
                  {player.jerseyNumber > 0 && (
                    <span className="text-[8px] md:text-[9px] text-citrus-sage font-varsity font-bold">
                      #{player.jerseyNumber}
                    </span>
                  )}
                  {player.age > 0 && (
                    <>
                      <span className="text-[7px] text-citrus-charcoal/20">|</span>
                      <span className="text-[8px] md:text-[9px] text-citrus-charcoal/50 font-display font-semibold">
                        {player.age}yr
                      </span>
                    </>
                  )}
                  {player.clause && (
                    <>
                      <span className="hidden md:inline text-[7px] text-citrus-charcoal/20">|</span>
                      <Badge className={cn("hidden md:flex text-[6px] h-3.5 px-1 font-varsity font-bold border items-center gap-0.5", clauseConfig[player.clause].color)}>
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
          <div className="px-2 md:px-2.5 py-1.5 md:py-2 border-t-2 border-citrus-sage/20 bg-gradient-to-br from-white/60 to-citrus-cream/30">
            {/* Cap hit + Status badge */}
            <div className="flex items-baseline justify-between gap-1">
              <span className="font-varsity text-xs md:text-base text-citrus-forest leading-none tracking-tight">
                {formatCap(player.capHit)}
              </span>
              <Badge className={cn("text-[6px] md:text-[7px] h-3.5 md:h-4 px-1 md:px-1.5 font-varsity font-bold tracking-wider border-0 shadow-sm", statusColor[player.expiryStatus])}>
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
              <span className="text-[8px] md:text-[9px] text-citrus-charcoal/50 font-display font-semibold">
                {player.yearsRemaining}yr
              </span>
              <span className="text-[8px] md:text-[9px] text-citrus-charcoal/40 font-display">
                exp. {player.expiryYear}
              </span>
            </div>
          </div>
        </div>
      </TooltipTrigger>

      {/* ─── Tooltip: Full contract details ─── */}
      <TooltipContent
        side="top"
        className="bg-citrus-forest/95 backdrop-blur-md text-citrus-cream p-4 max-w-[280px] rounded-2xl border-2 border-citrus-sage/40 shadow-varsity z-[9999]"
      >
        {/* Tooltip header */}
        <div className="flex items-center gap-2 border-b border-citrus-sage/30 pb-2 mb-2.5">
          <PlayerAvatar name={player.name} position={player.position} jerseyNumber={player.jerseyNumber} size="sm" />
          <div className="flex-1 min-w-0">
            <h4 className="font-varsity text-sm leading-tight truncate">{player.name}</h4>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[9px] text-citrus-sage/80 font-display">{player.position}</span>
              {player.age > 0 && <span className="text-[9px] text-citrus-sage/60 font-display">Age {player.age}</span>}
            </div>
          </div>
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
              <span className="text-[10px] font-display text-citrus-sage/80">
                {player.clause === 'NMC' ? 'No-Movement Clause' : player.clause === 'M-NTC' ? 'Modified No-Trade' : 'No-Trade Clause'}
              </span>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function TooltipRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-[10px] font-display text-citrus-sage/70">{label}</span>
      <span className={cn("font-varsity text-[11px]", highlight ? "text-citrus-cream" : "text-citrus-sage/90")}>
        {value}
      </span>
    </div>
  );
}

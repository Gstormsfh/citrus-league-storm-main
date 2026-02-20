import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Shield } from 'lucide-react';
import { PlayerContract, formatCap, formatCapFull } from '@/types/captracker';

interface CapPlayerCardProps {
  player: PlayerContract;
  maxCapHit: number;
}

const statusColor: Record<string, string> = {
  UFA: 'bg-red-500/80 text-white',
  RFA: 'bg-amber-500/80 text-white',
  ELC: 'bg-blue-500/80 text-white',
  Signed: 'bg-citrus-sage/80 text-citrus-forest',
  '35+': 'bg-purple-500/80 text-white',
};

const clauseConfig: Record<string, { label: string; color: string }> = {
  NMC: { label: 'NMC', color: 'bg-red-100 text-red-700 border-red-200' },
  'M-NTC': { label: 'M-NTC', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  NTC: { label: 'NTC', color: 'bg-orange-100 text-orange-700 border-orange-200' },
};

const rosterStatusBadge: Record<string, string> = {
  IR: 'bg-red-500 text-white',
  LTIR: 'bg-red-700 text-white',
  AHL: 'bg-slate-500 text-white',
  Buyout: 'bg-gray-600 text-white',
  Retained: 'bg-gray-500 text-white',
  NHL: '',
};

export default function CapPlayerCard({ player, maxCapHit }: CapPlayerCardProps) {
  const [imageError, setImageError] = useState(false);

  const capBarPercent = Math.min((player.capHit / maxCapHit) * 100, 100);

  const headshotUrl = player.headshot
    || `https://cms.nhl.bamgrid.com/images/headshots/current/168x168/${player.playerId}.jpg`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="bg-white/70 backdrop-blur-sm rounded-xl border-2 border-citrus-sage/30 shadow-patch overflow-hidden transition-all hover:border-citrus-sage/60 hover:shadow-varsity cursor-default group">
          {/* Top accent bar */}
          <div className="h-1 bg-gradient-to-r from-citrus-sage via-[#7CB518] to-citrus-sage opacity-60" />

          {/* Header: headshot + name + position badge */}
          <div className="relative px-2 pt-2 pb-1.5 bg-gradient-to-br from-citrus-sage/15 via-citrus-sage/5 to-transparent">
            {/* Position badge */}
            <Badge className="absolute top-1 right-1 bg-gradient-to-br from-citrus-sage to-[#7CB518] border-2 border-citrus-forest text-citrus-forest font-varsity shadow-sm text-[8px] tracking-wider font-black h-4 px-1.5">
              {player.position}
            </Badge>

            {/* Roster status badge */}
            {player.rosterStatus !== 'NHL' && (
              <Badge className={cn("absolute top-1 left-1 text-[7px] h-3.5 px-1 font-bold", rosterStatusBadge[player.rosterStatus])}>
                {player.rosterStatus}
              </Badge>
            )}

            <div className="flex items-center gap-2">
              {/* Headshot */}
              <div className="w-10 h-10 rounded-full overflow-hidden bg-citrus-cream border-2 border-citrus-sage/40 flex-shrink-0">
                {!imageError ? (
                  <img
                    src={headshotUrl}
                    alt={player.name}
                    className="w-full h-full object-cover"
                    onError={() => setImageError(true)}
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Shield className="w-5 h-5 text-citrus-sage/50" />
                  </div>
                )}
              </div>

              {/* Name + Jersey */}
              <div className="min-w-0 flex-1 pr-6">
                <div className="font-display font-bold text-[10px] md:text-[11px] leading-tight text-citrus-forest truncate">
                  {player.name}
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-[8px] text-citrus-charcoal/50 font-display">
                    #{player.jerseyNumber || '—'}
                  </span>
                  {player.age > 0 && (
                    <>
                      <span className="text-[8px] text-citrus-charcoal/30">&middot;</span>
                      <span className="text-[8px] text-citrus-charcoal/50 font-display">
                        {player.age}yr
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Cap Hit + Status */}
          <div className="px-2 py-1.5 border-t border-citrus-sage/20">
            {/* Cap hit */}
            <div className="flex items-center justify-between gap-1">
              <span className="font-varsity text-xs md:text-sm text-citrus-forest leading-none">
                {formatCap(player.capHit)}
              </span>
              <Badge className={cn("text-[7px] h-4 px-1.5 font-varsity font-bold tracking-wide", statusColor[player.expiryStatus])}>
                {player.expiryStatus}
              </Badge>
            </div>

            {/* Cap bar */}
            <div className="h-1.5 mt-1 bg-citrus-cream rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-citrus-sage to-[#7CB518] transition-all duration-500"
                style={{ width: `${capBarPercent}%` }}
              />
            </div>

            {/* Contract term + clause */}
            <div className="flex items-center justify-between mt-1">
              <span className="text-[8px] text-citrus-charcoal/50 font-display">
                {player.yearsRemaining}yr &middot; {player.expiryYear}
              </span>
              {player.clause && (
                <Badge className={cn("text-[6px] h-3 px-1 border", clauseConfig[player.clause].color)}>
                  {clauseConfig[player.clause].label}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="bg-citrus-forest text-citrus-cream p-3 max-w-xs rounded-xl border-2 border-citrus-sage/50 z-[9999]">
        <h4 className="font-varsity text-sm border-b border-citrus-sage/30 pb-1 mb-2">
          {player.name}
        </h4>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="flex justify-between">
            <span className="font-display text-citrus-sage/80">Cap Hit:</span>
            <span className="font-varsity">{formatCapFull(player.capHit)}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-display text-citrus-sage/80">Base Salary:</span>
            <span className="font-varsity">{formatCapFull(player.baseSalary)}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-display text-citrus-sage/80">Signing Bonus:</span>
            <span className="font-varsity">{formatCapFull(player.signingBonus)}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-display text-citrus-sage/80">AAV:</span>
            <span className="font-varsity">{formatCapFull(player.aav)}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-display text-citrus-sage/80">Contract:</span>
            <span className="font-varsity">{player.contractYears}yr total</span>
          </div>
          <div className="flex justify-between">
            <span className="font-display text-citrus-sage/80">Expires:</span>
            <span className="font-varsity">{player.expiryYear} ({player.expiryStatus})</span>
          </div>
          {player.clause && (
            <div className="flex justify-between col-span-2">
              <span className="font-display text-citrus-sage/80">Clause:</span>
              <span className="font-varsity">
                {player.clause === 'NMC' ? 'No Movement' : player.clause === 'M-NTC' ? 'Mod. No-Trade' : 'No-Trade'}
              </span>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

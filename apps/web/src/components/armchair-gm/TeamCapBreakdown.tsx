import { useState } from 'react';
import { cn } from '@/lib/utils';
import { PlayerContract, formatCap } from '@/types/captracker';
import CapPlayerRow from './CapPlayerRow';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface TeamCapBreakdownProps {
  title: string;
  players: PlayerContract[];
  positionIcon: string; // Emoji or character
  defaultExpanded?: boolean;
}

export default function TeamCapBreakdown({
  title,
  players,
  positionIcon,
  defaultExpanded = true,
}: TeamCapBreakdownProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const totalCapHit = players.reduce((sum, p) => sum + p.capHit, 0);
  const maxCapHit = Math.max(...players.map((p) => p.capHit), 1);
  const avgCapHit = players.length > 0 ? totalCapHit / players.length : 0;

  const ufaCount = players.filter((p) => p.expiryStatus === 'UFA').length;
  const rfaCount = players.filter((p) => p.expiryStatus === 'RFA').length;

  return (
    <div className="bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-citrus-sage/30 shadow-varsity overflow-hidden">
      {/* Section Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 md:px-5 py-3 bg-gradient-to-r from-citrus-sage/25 via-citrus-sage/15 to-citrus-sage/25 border-b-2 border-citrus-sage/40 flex items-center gap-3 hover:from-citrus-sage/30 hover:to-citrus-sage/30 transition-colors"
      >
        {/* Position Icon */}
        <span className="text-xl">{positionIcon}</span>

        {/* Title + Count */}
        <div className="flex-1 text-left">
          <h3 className="font-varsity text-base md:text-lg text-citrus-forest tracking-tight">
            {title}
          </h3>
          <span className="text-[10px] text-citrus-charcoal/60 font-display">
            {players.length} players
          </span>
        </div>

        {/* Summary Stats */}
        <div className="hidden md:flex items-center gap-4">
          <div className="text-right">
            <div className="text-[8px] text-citrus-charcoal/50 uppercase font-display font-bold tracking-wider">
              Total Cap
            </div>
            <div className="font-varsity text-sm text-citrus-forest">
              {formatCap(totalCapHit)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[8px] text-citrus-charcoal/50 uppercase font-display font-bold tracking-wider">
              Avg Cap
            </div>
            <div className="font-varsity text-sm text-citrus-charcoal/70">
              {formatCap(avgCapHit)}
            </div>
          </div>
          {ufaCount > 0 && (
            <div className="px-2 py-1 bg-red-100 rounded-lg">
              <span className="text-[9px] font-varsity text-red-700 font-bold">
                {ufaCount} UFA
              </span>
            </div>
          )}
          {rfaCount > 0 && (
            <div className="px-2 py-1 bg-amber-100 rounded-lg">
              <span className="text-[9px] font-varsity text-amber-700 font-bold">
                {rfaCount} RFA
              </span>
            </div>
          )}
        </div>

        {/* Expand/collapse */}
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-citrus-charcoal/40" />
        ) : (
          <ChevronDown className="w-5 h-5 text-citrus-charcoal/40" />
        )}
      </button>

      {/* Mobile Summary (shown when collapsed) */}
      {!expanded && (
        <div className="md:hidden px-4 py-2 flex items-center justify-between bg-white/40">
          <span className="text-xs font-display text-citrus-charcoal/60">
            Total: <span className="font-varsity text-citrus-forest">{formatCap(totalCapHit)}</span>
          </span>
          <div className="flex gap-1">
            {ufaCount > 0 && (
              <span className="text-[8px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-varsity font-bold">
                {ufaCount} UFA
              </span>
            )}
            {rfaCount > 0 && (
              <span className="text-[8px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-varsity font-bold">
                {rfaCount} RFA
              </span>
            )}
          </div>
        </div>
      )}

      {/* Player Rows */}
      {expanded && (
        <div>
          {/* Column Headers */}
          <div className="grid grid-cols-[2rem_2.5rem_1fr_4rem_5.5rem_4rem_4.5rem_2rem] md:grid-cols-[2rem_3rem_1fr_3.5rem_6rem_5rem_5rem_3rem] items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 bg-citrus-sage/10 border-b border-citrus-sage/20">
            <span className="text-[8px] text-citrus-charcoal/40 uppercase font-display font-bold text-center">#</span>
            <span className="text-[8px] text-citrus-charcoal/40 uppercase font-display font-bold"></span>
            <span className="text-[8px] text-citrus-charcoal/40 uppercase font-display font-bold">Player</span>
            <span className="text-[8px] text-citrus-charcoal/40 uppercase font-display font-bold text-center">Age</span>
            <span className="text-[8px] text-citrus-charcoal/40 uppercase font-display font-bold text-right">Cap Hit</span>
            <span className="text-[8px] text-citrus-charcoal/40 uppercase font-display font-bold text-center">Term</span>
            <span className="text-[8px] text-citrus-charcoal/40 uppercase font-display font-bold text-center">Status</span>
            <span></span>
          </div>

          {/* Player list */}
          {players.map((player, index) => (
            <CapPlayerRow
              key={player.playerId || `${player.name}-${index}`}
              player={player}
              rank={index + 1}
              maxCapHit={maxCapHit}
            />
          ))}

          {/* Section Total */}
          <div className="px-4 md:px-5 py-2.5 bg-gradient-to-r from-citrus-sage/15 to-citrus-sage/10 border-t-2 border-citrus-sage/30 flex items-center justify-between">
            <span className="text-xs font-display font-bold text-citrus-charcoal/60 uppercase tracking-wider">
              {title} Total
            </span>
            <span className="font-varsity text-base text-citrus-forest">
              {formatCap(totalCapHit)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

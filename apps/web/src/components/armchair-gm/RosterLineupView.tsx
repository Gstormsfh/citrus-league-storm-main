import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { PlayerContract, TeamCapData, formatCap } from '@/types/captracker';
import CapPlayerCard from './CapPlayerCard';
import PlayerAvatar from './PlayerAvatar';
import { ChevronDown, ChevronUp } from 'lucide-react';

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


interface RosterLineupViewProps {
  data: TeamCapData;
}

interface ForwardLine {
  lw: PlayerContract | null;
  c: PlayerContract | null;
  rw: PlayerContract | null;
  lineCap: number;
}

interface DefensePair {
  ld: PlayerContract;
  rd: PlayerContract | null;
  pairCap: number;
}

function buildLineup(data: TeamCapData) {
  const forwards = [...data.forwards];
  const defense = [...data.defense];
  const goalies = [...data.goalies];
  const minorLeague = [...(data.minorLeague || [])];

  // Group forwards by position
  const centers = forwards.filter(p => p.position === 'C').sort((a, b) => b.capHit - a.capHit);
  const leftWingers = forwards.filter(p => p.position === 'LW' || p.position === 'L').sort((a, b) => b.capHit - a.capHit);
  const rightWingers = forwards.filter(p => p.position === 'RW' || p.position === 'R').sort((a, b) => b.capHit - a.capHit);

  // Build 4 forward lines
  const lines: ForwardLine[] = [];
  for (let i = 0; i < 4; i++) {
    const lw = leftWingers[i] || null;
    const c = centers[i] || null;
    const rw = rightWingers[i] || null;
    lines.push({
      lw,
      c,
      rw,
      lineCap: (lw?.capHit || 0) + (c?.capHit || 0) + (rw?.capHit || 0),
    });
  }

  // Extra forwards
  const usedForwards = new Set<string>();
  for (const line of lines) {
    if (line.lw) usedForwards.add(line.lw.name);
    if (line.c) usedForwards.add(line.c.name);
    if (line.rw) usedForwards.add(line.rw.name);
  }
  const extraForwards = forwards.filter(p => !usedForwards.has(p.name));

  // Build 3 defense pairs
  const sortedD = [...defense].sort((a, b) => b.capHit - a.capHit);
  const dPairs: DefensePair[] = [];
  for (let i = 0; i < 3; i++) {
    const ld = sortedD[i * 2];
    const rd = sortedD[i * 2 + 1] || null;
    if (ld) {
      dPairs.push({ ld, rd, pairCap: ld.capHit + (rd?.capHit || 0) });
    }
  }

  // Extra defensemen
  const usedD = new Set<string>();
  for (const pair of dPairs) {
    usedD.add(pair.ld.name);
    if (pair.rd) usedD.add(pair.rd.name);
  }
  const extraDefense = defense.filter(p => !usedD.has(p.name));

  // Max cap hit for bar scaling
  const allNHL = [...forwards, ...defense, ...goalies];
  const maxCapHit = Math.max(...allNHL.map(p => p.capHit), 1);

  return { lines, dPairs, goalies, extraForwards, extraDefense, minorLeague, maxCapHit };
}

const LINE_LABELS = ['1st Line', '2nd Line', '3rd Line', '4th Line'];
const PAIR_LABELS = ['1st Pair', '2nd Pair', '3rd Pair'];

export default function RosterLineupView({ data }: RosterLineupViewProps) {
  const lineup = useMemo(() => buildLineup(data), [data]);

  const forwardsCap = data.forwards.reduce((s, p) => s + p.capHit, 0);
  const defenseCap = data.defense.reduce((s, p) => s + p.capHit, 0);
  const goaliesCap = data.goalies.reduce((s, p) => s + p.capHit, 0);
  const minorCap = (data.minorLeague || []).reduce((s, p) => s + p.capHit, 0);

  const ufaForwards = data.forwards.filter(p => p.expiryStatus === 'UFA' && p.yearsRemaining <= 1).length;
  const rfaForwards = data.forwards.filter(p => p.expiryStatus === 'RFA' && p.yearsRemaining <= 1).length;
  const ufaDefense = data.defense.filter(p => p.expiryStatus === 'UFA' && p.yearsRemaining <= 1).length;
  const rfaDefense = data.defense.filter(p => p.expiryStatus === 'RFA' && p.yearsRemaining <= 1).length;

  return (
    <div className="space-y-6">
      {/* ═══════════════════════════════════════════════════════════
          FORWARD LINES
         ═══════════════════════════════════════════════════════════ */}
      <LineupSection
        title="Forward Lines"
        subtitle={`${data.forwards.length} players`}
        capTotal={forwardsCap}
        icon="🏒"
        ufaCount={ufaForwards}
        rfaCount={rfaForwards}
      >
        <div className="space-y-5">
          {lineup.lines.map((line, i) => (
            <div key={i}>
              {/* Line header */}
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-lg bg-gradient-to-br from-pastel-sage/30 to-[#7CB518]/20 border border-pastel-sage/40 flex items-center justify-center">
                    <span className="text-[9px] font-varsity max-lg:font-condensed font-black text-pastel-cream max-lg:text-pressbox-text">{i + 1}</span>
                  </div>
                  <span className="text-[10px] font-varsity max-lg:font-condensed text-pastel-cream max-lg:text-pressbox-text tracking-wider uppercase">
                    {LINE_LABELS[i]}
                  </span>
                </div>
                <div className="flex-1 h-px bg-gradient-to-r from-pastel-sage/30 to-transparent" />
                <span className="text-[9px] font-varsity max-lg:font-condensed text-white/55">
                  {formatCap(line.lineCap)}
                </span>
              </div>

              {/* Mobile: Compact row list (< sm) */}
              <div className="sm:hidden space-y-1">
                {[
                  { pos: 'LW', player: line.lw },
                  { pos: 'C', player: line.c },
                  { pos: 'RW', player: line.rw },
                ].map(({ pos, player }) =>
                  player ? (
                    <CompactPlayerRow key={player.name} player={player} maxCapHit={lineup.maxCapHit} />
                  ) : (
                    <div key={pos} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-dashed border-pastel-sage/20 bg-white/20">
                      <span className="text-[10px] font-varsity max-lg:font-condensed text-pastel-sage/40 max-lg:text-pressbox-sage/40 w-7 text-center">{pos}</span>
                      <span className="text-[10px] font-display max-lg:font-barlow text-white/25">Open Slot</span>
                    </div>
                  )
                )}
              </div>

              {/* Desktop: 3-column card grid (sm+) */}
              <div className="hidden sm:block">
                {/* Position column labels */}
                <div className="grid grid-cols-3 gap-2 md:gap-3 mb-1">
                  <div className="text-center">
                    <span className="text-[8px] font-varsity max-lg:font-condensed text-pastel-sage/50 max-lg:text-pressbox-sage/50 uppercase tracking-[0.15em]">LW</span>
                  </div>
                  <div className="text-center">
                    <span className="text-[8px] font-varsity max-lg:font-condensed text-pastel-sage/50 max-lg:text-pressbox-sage/50 uppercase tracking-[0.15em]">C</span>
                  </div>
                  <div className="text-center">
                    <span className="text-[8px] font-varsity max-lg:font-condensed text-pastel-sage/50 max-lg:text-pressbox-sage/50 uppercase tracking-[0.15em]">RW</span>
                  </div>
                </div>

                {/* LW - C - RW cards */}
                <div className="grid grid-cols-3 gap-2 md:gap-3">
                  {line.lw ? (
                    <CapPlayerCard player={line.lw} maxCapHit={lineup.maxCapHit} />
                  ) : (
                    <EmptySlot position="LW" />
                  )}
                  {line.c ? (
                    <CapPlayerCard player={line.c} maxCapHit={lineup.maxCapHit} />
                  ) : (
                    <EmptySlot position="C" />
                  )}
                  {line.rw ? (
                    <CapPlayerCard player={line.rw} maxCapHit={lineup.maxCapHit} />
                  ) : (
                    <EmptySlot position="RW" />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Extra Forwards */}
        {lineup.extraForwards.length > 0 && (
          <ExtraPlayersSection label="Extra Forwards" players={lineup.extraForwards} maxCapHit={lineup.maxCapHit} />
        )}
      </LineupSection>

      {/* ═══════════════════════════════════════════════════════════
          DEFENSE PAIRS
         ═══════════════════════════════════════════════════════════ */}
      <LineupSection
        title="Defense Pairs"
        subtitle={`${data.defense.length} players`}
        capTotal={defenseCap}
        icon="🛡️"
        ufaCount={ufaDefense}
        rfaCount={rfaDefense}
      >
        <div className="space-y-5">
          {lineup.dPairs.map((pair, i) => (
            <div key={i}>
              {/* Pair header */}
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-lg bg-gradient-to-br from-blue-200/50 to-blue-300/30 border border-blue-400/40 flex items-center justify-center">
                    <span className="text-[9px] font-varsity max-lg:font-condensed font-black text-pastel-cream max-lg:text-pressbox-text">{i + 1}</span>
                  </div>
                  <span className="text-[10px] font-varsity max-lg:font-condensed text-pastel-cream max-lg:text-pressbox-text tracking-wider uppercase">
                    {PAIR_LABELS[i]}
                  </span>
                </div>
                <div className="flex-1 h-px bg-gradient-to-r from-blue-300/30 to-transparent" />
                <span className="text-[9px] font-varsity max-lg:font-condensed text-white/55">
                  {formatCap(pair.pairCap)}
                </span>
              </div>

              {/* Mobile: Compact row list (< sm) */}
              <div className="sm:hidden space-y-1">
                <CompactPlayerRow player={pair.ld} maxCapHit={lineup.maxCapHit} />
                {pair.rd ? (
                  <CompactPlayerRow player={pair.rd} maxCapHit={lineup.maxCapHit} />
                ) : (
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-dashed border-pastel-sage/20 bg-white/20">
                    <span className="text-[10px] font-varsity max-lg:font-condensed text-pastel-sage/40 max-lg:text-pressbox-sage/40 w-7 text-center">D</span>
                    <span className="text-[10px] font-display max-lg:font-barlow text-white/25">Open Slot</span>
                  </div>
                )}
              </div>

              {/* Desktop: 2-column card grid (sm+) */}
              <div className="hidden sm:block">
                {/* Position labels */}
                <div className="grid grid-cols-2 gap-2 md:gap-3 max-w-2xl mx-auto mb-1">
                  <div className="text-center">
                    <span className="text-[8px] font-varsity max-lg:font-condensed text-pastel-sage max-lg:text-pressbox-sage uppercase tracking-[0.15em]">LD</span>
                  </div>
                  <div className="text-center">
                    <span className="text-[8px] font-varsity max-lg:font-condensed text-pastel-sage max-lg:text-pressbox-sage uppercase tracking-[0.15em]">RD</span>
                  </div>
                </div>

                {/* D - D cards */}
                <div className="grid grid-cols-2 gap-2 md:gap-3 max-w-2xl mx-auto">
                  <CapPlayerCard player={pair.ld} maxCapHit={lineup.maxCapHit} />
                  {pair.rd ? (
                    <CapPlayerCard player={pair.rd} maxCapHit={lineup.maxCapHit} />
                  ) : (
                    <EmptySlot position="D" />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Extra Defensemen */}
        {lineup.extraDefense.length > 0 && (
          <ExtraPlayersSection label="Extra Defensemen" players={lineup.extraDefense} maxCapHit={lineup.maxCapHit} />
        )}
      </LineupSection>

      {/* ═══════════════════════════════════════════════════════════
          GOALIES
         ═══════════════════════════════════════════════════════════ */}
      <LineupSection
        title="Goalies"
        subtitle={`${data.goalies.length} players`}
        capTotal={goaliesCap}
        icon="🥅"
      >
        {/* Mobile: Compact rows */}
        <div className="sm:hidden space-y-1">
          {lineup.goalies.map((g, i) => (
            <CompactPlayerRow key={g.name + i} player={g} maxCapHit={lineup.maxCapHit} />
          ))}
        </div>
        {/* Desktop: Card grid */}
        <div className="hidden sm:grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3 max-w-3xl mx-auto">
          {lineup.goalies.map((g, i) => (
            <CapPlayerCard key={g.name + i} player={g} maxCapHit={lineup.maxCapHit} />
          ))}
        </div>
      </LineupSection>

      {/* ═══════════════════════════════════════════════════════════
          IR / MINOR LEAGUE / OTHER
         ═══════════════════════════════════════════════════════════ */}
      {lineup.minorLeague.length > 0 && (
        <CollapsibleLineupSection
          title="IR / Minor League / Other"
          subtitle={`${lineup.minorLeague.length} contracts`}
          capTotal={minorCap}
          icon="📋"
        >
          {/* Mobile: Compact rows */}
          <div className="sm:hidden space-y-1">
            {lineup.minorLeague.map((p, i) => (
              <CompactPlayerRow key={p.name + i} player={p} maxCapHit={lineup.maxCapHit} />
            ))}
          </div>
          {/* Desktop: Card grid */}
          <div className="hidden sm:grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {lineup.minorLeague.map((p, i) => (
              <CapPlayerCard key={p.name + i} player={p} maxCapHit={lineup.maxCapHit} />
            ))}
          </div>
        </CollapsibleLineupSection>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Section Wrapper
   ═══════════════════════════════════════════════════════════════════ */

function LineupSection({
  title,
  subtitle,
  capTotal,
  icon,
  ufaCount = 0,
  rfaCount = 0,
  children,
}: {
  title: string;
  subtitle: string;
  capTotal: number;
  icon: string;
  ufaCount?: number;
  rfaCount?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-pastel-surface-tile max-lg:bg-pressbox-tile backdrop-blur-sm rounded-2xl max-lg:rounded-[12px] border-2 border-pastel-sage/30 shadow-varsity overflow-hidden">
      {/* Section Header */}
      <div className="px-4 md:px-5 py-3 bg-gradient-to-r from-pastel-sage/25 via-pastel-sage/15 to-pastel-sage/25 border-b-2 border-pastel-sage/40 flex items-center gap-3">
        <span className="text-xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <h3 className="font-varsity max-lg:font-condensed text-base md:text-lg text-pastel-cream max-lg:text-pressbox-text tracking-tight">
            {title}
          </h3>
          <span className="text-[10px] text-white/60 font-display max-lg:font-barlow">
            {subtitle}
          </span>
        </div>

        {/* UFA/RFA badges */}
        <div className="hidden md:flex items-center gap-2">
          {ufaCount > 0 && (
            <Badge className="bg-red-100 text-red-700 text-[8px] h-5 px-2 font-varsity max-lg:font-condensed border border-red-200">
              {ufaCount} UFA
            </Badge>
          )}
          {rfaCount > 0 && (
            <Badge className="bg-amber-100 text-amber-700 text-[8px] h-5 px-2 font-varsity max-lg:font-condensed border border-amber-200">
              {rfaCount} RFA
            </Badge>
          )}
        </div>

        {/* Total cap */}
        <div className="text-right flex-shrink-0">
          <div className="text-[8px] text-white/50 uppercase font-display max-lg:font-barlow font-bold tracking-wider">
            Total Cap
          </div>
          <div className="font-varsity max-lg:font-condensed text-sm text-pastel-cream max-lg:text-pressbox-text">
            {formatCap(capTotal)}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 md:p-5">
        {children}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Collapsible Section (for IR/Minor)
   ═══════════════════════════════════════════════════════════════════ */

function CollapsibleLineupSection({
  title,
  subtitle,
  capTotal,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  capTotal: number;
  icon: string;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-pastel-surface-tile max-lg:bg-pressbox-tile backdrop-blur-sm rounded-2xl max-lg:rounded-[12px] border-2 border-white/15 shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 md:px-5 py-3 bg-gradient-to-r from-white/5 via-transparent to-white/5 border-b border-white/10 flex items-center gap-3 hover:from-pastel-sage/10 hover:to-pastel-sage/10 transition-colors"
      >
        <span className="text-lg">{icon}</span>
        <div className="flex-1 min-w-0 text-left">
          <h3 className="font-varsity max-lg:font-condensed text-base text-pastel-cream max-lg:text-pressbox-text tracking-tight">
            {title}
          </h3>
          <span className="text-[10px] text-white/50 font-display max-lg:font-barlow">
            {subtitle}
          </span>
        </div>
        <div className="text-right flex-shrink-0 mr-2">
          <div className="text-[8px] text-white/55 uppercase font-display max-lg:font-barlow font-bold tracking-wider">
            Total Cap
          </div>
          <div className="font-varsity max-lg:font-condensed text-sm text-white/60">
            {formatCap(capTotal)}
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-white/55 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-white/55 flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="p-3 md:p-4 animate-in fade-in slide-in-from-top-2 duration-200">
          {children}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Extra Players Section (within a lineup section)
   ═══════════════════════════════════════════════════════════════════ */

function ExtraPlayersSection({
  label,
  players,
  maxCapHit,
}: {
  label: string;
  players: PlayerContract[];
  maxCapHit: number;
}) {
  const totalCap = players.reduce((s, p) => s + p.capHit, 0);

  return (
    <div className="mt-4 pt-4 border-t border-dashed border-pastel-sage/20">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-varsity max-lg:font-condensed text-white/55 uppercase tracking-wider">
          {label}
        </span>
        <div className="flex-1 h-px bg-pastel-sage/15" />
        <span className="text-[9px] font-varsity max-lg:font-condensed text-white/55">
          {formatCap(totalCap)}
        </span>
      </div>
      {/* Mobile: Compact rows */}
      <div className="sm:hidden space-y-1">
        {players.map((p, i) => (
          <CompactPlayerRow key={p.name + i} player={p} maxCapHit={maxCapHit} />
        ))}
      </div>
      {/* Desktop: Card grid */}
      <div className="hidden sm:grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {players.map((p, i) => (
          <CapPlayerCard key={p.name + i} player={p} maxCapHit={maxCapHit} />
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Empty Slot Placeholder
   ═══════════════════════════════════════════════════════════════════ */

function EmptySlot({ position }: { position: string }) {
  return (
    <div className="rounded-2xl max-lg:rounded-[12px] border-2 border-dashed border-pastel-sage/20 bg-white/20 flex flex-col items-center justify-center py-8 md:py-10">
      <div className="w-8 h-8 rounded-full bg-pastel-sage/10 border border-dashed border-pastel-sage/30 flex items-center justify-center mb-1.5">
        <span className="text-[10px] font-varsity max-lg:font-condensed text-pastel-sage/40 max-lg:text-pressbox-sage/40">{position}</span>
      </div>
      <span className="text-[9px] font-display max-lg:font-barlow text-white/25">Open Slot</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Compact Player Row (mobile only)
   Clean horizontal row: position | name | cap hit + status
   ═══════════════════════════════════════════════════════════════════ */

const statusColorCompact: Record<string, string> = {
  UFA: 'text-red-600',
  RFA: 'text-amber-600',
  ELC: 'text-pastel-butter',
  Signed: 'text-pastel-sage max-lg:text-pressbox-sage',
  '35+': 'text-purple-600',
};

const rosterStatusCompact: Record<string, string> = {
  IR: 'bg-red-500 text-white',
  LTIR: 'bg-red-700 text-white',
  AHL: 'bg-slate-500 text-white',
  Buyout: 'bg-gray-600 text-white',
  Retained: 'bg-gray-500 text-white',
};

function CompactPlayerRow({ player, maxCapHit }: { player: PlayerContract; maxCapHit: number }) {
  const capBarPercent = Math.min((player.capHit / maxCapHit) * 100, 100);
  const isNonNHL = player.rosterStatus !== 'NHL';

  return (
    <div className={cn(
      "flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-all",
      isNonNHL
        ? "bg-white/5 border-white/10 opacity-80"
        : "bg-pastel-surface-tile max-lg:bg-pressbox-tile border-pastel-sage/30",
    )}>
      {/* Position pill */}
      <span className="text-[9px] font-varsity max-lg:font-condensed font-black text-pastel-cream max-lg:text-pressbox-text bg-pastel-sage/20 border border-pastel-sage/30 rounded-md px-1.5 py-0.5 w-7 text-center flex-shrink-0">
        {player.position}
      </span>

      {/* Name + contract info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-display max-lg:font-barlow font-bold text-[11px] text-pastel-cream max-lg:text-pressbox-text truncate">
            {player.name}
          </span>
          {isNonNHL && (
            <Badge className={cn("text-[6px] h-3 px-1 font-varsity max-lg:font-condensed font-bold border-0 flex-shrink-0", rosterStatusCompact[player.rosterStatus])}>
              {player.rosterStatus}
            </Badge>
          )}
        </div>
        {/* Mini cap bar */}
        <div className="h-1 mt-0.5 bg-white/15 rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full",
              capBarPercent > 80
                ? "bg-gradient-to-r from-pastel-orange to-amber-400"
                : "bg-gradient-to-r from-pastel-sage to-[#7CB518]",
            )}
            style={{ width: `${capBarPercent}%` }}
          />
        </div>
      </div>

      {/* Cap hit + status */}
      <div className="text-right flex-shrink-0">
        <span className="font-varsity max-lg:font-condensed text-[11px] text-pastel-cream max-lg:text-pressbox-text leading-none">
          {formatCap(player.capHit)}
        </span>
        <div className="flex items-center justify-end gap-1 mt-0.5">
          <span className={cn("text-[8px] font-varsity max-lg:font-condensed font-bold", statusColorCompact[player.expiryStatus])}>
            {player.expiryStatus}
          </span>
          <span className="text-[8px] text-white/55 font-display max-lg:font-barlow">
            {player.yearsRemaining}yr
          </span>
        </div>
      </div>
    </div>
  );
}

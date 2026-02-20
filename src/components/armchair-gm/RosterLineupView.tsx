import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { PlayerContract, TeamCapData, formatCap } from '@/types/captracker';
import CapPlayerCard from './CapPlayerCard';

interface RosterLineupViewProps {
  data: TeamCapData;
}

interface ForwardLine {
  lw: PlayerContract | null;
  c: PlayerContract | null;
  rw: PlayerContract | null;
}

interface DefensePair {
  ld: PlayerContract;
  rd: PlayerContract | null;
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
    lines.push({
      lw: leftWingers[i] || null,
      c: centers[i] || null,
      rw: rightWingers[i] || null,
    });
  }

  // Extra forwards that don't fit in 4 lines
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
    dPairs.push({
      ld: sortedD[i * 2] || sortedD[0],
      rd: sortedD[i * 2 + 1] || null,
    });
  }
  // Filter out empty pairs
  const validPairs = dPairs.filter(p => p.ld);

  // Extra defensemen
  const usedD = new Set<string>();
  for (const pair of validPairs) {
    usedD.add(pair.ld.name);
    if (pair.rd) usedD.add(pair.rd.name);
  }
  const extraDefense = defense.filter(p => !usedD.has(p.name));

  // Max cap hit for bar scaling
  const allNHL = [...forwards, ...defense, ...goalies];
  const maxCapHit = Math.max(...allNHL.map(p => p.capHit), 1);

  return {
    lines,
    dPairs: validPairs,
    goalies,
    extraForwards,
    extraDefense,
    minorLeague,
    maxCapHit,
  };
}

export default function RosterLineupView({ data }: RosterLineupViewProps) {
  const lineup = useMemo(() => buildLineup(data), [data]);

  const forwardsCap = data.forwards.reduce((s, p) => s + p.capHit, 0);
  const defenseCap = data.defense.reduce((s, p) => s + p.capHit, 0);
  const goaliesCap = data.goalies.reduce((s, p) => s + p.capHit, 0);
  const minorCap = (data.minorLeague || []).reduce((s, p) => s + p.capHit, 0);

  return (
    <div className="space-y-6">
      {/* Forward Lines */}
      <LineupSection
        title="Forward Lines"
        subtitle={`${data.forwards.length} players`}
        capTotal={forwardsCap}
        icon="🏒"
      >
        {lineup.lines.map((line, i) => (
          <div key={i} className="space-y-1.5">
            {/* Line label */}
            <div className="flex items-center gap-2 px-1">
              <span className="text-[9px] font-varsity text-citrus-charcoal/50 uppercase tracking-wider">
                Line {i + 1}
              </span>
              <div className="flex-1 h-px bg-citrus-sage/20" />
              <div className="hidden md:flex items-center gap-3 text-[8px] font-display text-citrus-charcoal/40 uppercase tracking-wider">
                <span className="w-24 text-center">LW</span>
                <span className="w-24 text-center">C</span>
                <span className="w-24 text-center">RW</span>
              </div>
              <div className="flex-1 h-px bg-citrus-sage/20 hidden md:block" />
            </div>

            {/* LW - C - RW */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                {/* Mobile position label */}
                <div className="md:hidden text-[7px] font-varsity text-citrus-sage/60 uppercase tracking-wider text-center mb-0.5">LW</div>
                {line.lw ? (
                  <CapPlayerCard player={line.lw} maxCapHit={lineup.maxCapHit} />
                ) : (
                  <EmptySlot position="LW" />
                )}
              </div>
              <div>
                <div className="md:hidden text-[7px] font-varsity text-citrus-sage/60 uppercase tracking-wider text-center mb-0.5">C</div>
                {line.c ? (
                  <CapPlayerCard player={line.c} maxCapHit={lineup.maxCapHit} />
                ) : (
                  <EmptySlot position="C" />
                )}
              </div>
              <div>
                <div className="md:hidden text-[7px] font-varsity text-citrus-sage/60 uppercase tracking-wider text-center mb-0.5">RW</div>
                {line.rw ? (
                  <CapPlayerCard player={line.rw} maxCapHit={lineup.maxCapHit} />
                ) : (
                  <EmptySlot position="RW" />
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Extra Forwards */}
        {lineup.extraForwards.length > 0 && (
          <div className="space-y-1.5 mt-2">
            <div className="flex items-center gap-2 px-1">
              <span className="text-[9px] font-varsity text-citrus-charcoal/50 uppercase tracking-wider">
                Extra Forwards
              </span>
              <div className="flex-1 h-px bg-citrus-sage/20" />
            </div>
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {lineup.extraForwards.map((p, i) => (
                <CapPlayerCard key={p.name + i} player={p} maxCapHit={lineup.maxCapHit} />
              ))}
            </div>
          </div>
        )}
      </LineupSection>

      {/* Defense Pairs */}
      <LineupSection
        title="Defense Pairs"
        subtitle={`${data.defense.length} players`}
        capTotal={defenseCap}
        icon="🛡️"
      >
        {lineup.dPairs.map((pair, i) => (
          <div key={i} className="space-y-1.5">
            {/* Pair label */}
            <div className="flex items-center gap-2 px-1">
              <span className="text-[9px] font-varsity text-citrus-charcoal/50 uppercase tracking-wider">
                Pair {i + 1}
              </span>
              <div className="flex-1 h-px bg-citrus-sage/20" />
              <div className="hidden md:flex items-center gap-3 text-[8px] font-display text-citrus-charcoal/40 uppercase tracking-wider">
                <span className="w-24 text-center">LD</span>
                <span className="w-24 text-center">RD</span>
              </div>
              <div className="flex-1 h-px bg-citrus-sage/20 hidden md:block" />
            </div>

            {/* D - D */}
            <div className="grid grid-cols-2 gap-2 max-w-2xl mx-auto">
              <div>
                <div className="md:hidden text-[7px] font-varsity text-citrus-sage/60 uppercase tracking-wider text-center mb-0.5">LD</div>
                <CapPlayerCard player={pair.ld} maxCapHit={lineup.maxCapHit} />
              </div>
              <div>
                <div className="md:hidden text-[7px] font-varsity text-citrus-sage/60 uppercase tracking-wider text-center mb-0.5">RD</div>
                {pair.rd ? (
                  <CapPlayerCard player={pair.rd} maxCapHit={lineup.maxCapHit} />
                ) : (
                  <EmptySlot position="D" />
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Extra Defensemen */}
        {lineup.extraDefense.length > 0 && (
          <div className="space-y-1.5 mt-2">
            <div className="flex items-center gap-2 px-1">
              <span className="text-[9px] font-varsity text-citrus-charcoal/50 uppercase tracking-wider">
                Extra Defensemen
              </span>
              <div className="flex-1 h-px bg-citrus-sage/20" />
            </div>
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {lineup.extraDefense.map((p, i) => (
                <CapPlayerCard key={p.name + i} player={p} maxCapHit={lineup.maxCapHit} />
              ))}
            </div>
          </div>
        )}
      </LineupSection>

      {/* Goalies */}
      <LineupSection
        title="Goalies"
        subtitle={`${data.goalies.length} players`}
        capTotal={goaliesCap}
        icon="🥅"
      >
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-w-3xl mx-auto">
          {lineup.goalies.map((g, i) => (
            <CapPlayerCard key={g.name + i} player={g} maxCapHit={lineup.maxCapHit} />
          ))}
        </div>
      </LineupSection>

      {/* IR / Minor League / Other */}
      {lineup.minorLeague.length > 0 && (
        <LineupSection
          title="IR / Minor League / Other"
          subtitle={`${lineup.minorLeague.length} contracts`}
          capTotal={minorCap}
          icon="📋"
          defaultCollapsed
        >
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {lineup.minorLeague.map((p, i) => (
              <CapPlayerCard key={p.name + i} player={p} maxCapHit={lineup.maxCapHit} />
            ))}
          </div>
        </LineupSection>
      )}
    </div>
  );
}

/* ── Section Wrapper ────────────────────────────────── */

function LineupSection({
  title,
  subtitle,
  capTotal,
  icon,
  defaultCollapsed = false,
  children,
}: {
  title: string;
  subtitle: string;
  capTotal: number;
  icon: string;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white/60 backdrop-blur-sm rounded-2xl border-2 border-citrus-sage/30 shadow-varsity overflow-hidden">
      {/* Section Header */}
      <div className="px-4 md:px-5 py-3 bg-gradient-to-r from-citrus-sage/25 via-citrus-sage/15 to-citrus-sage/25 border-b-2 border-citrus-sage/40 flex items-center gap-3">
        <span className="text-xl">{icon}</span>
        <div className="flex-1">
          <h3 className="font-varsity text-base md:text-lg text-citrus-forest tracking-tight">
            {title}
          </h3>
          <span className="text-[10px] text-citrus-charcoal/60 font-display">
            {subtitle}
          </span>
        </div>
        <div className="text-right">
          <div className="text-[8px] text-citrus-charcoal/50 uppercase font-display font-bold tracking-wider">
            Total Cap
          </div>
          <div className="font-varsity text-sm text-citrus-forest">
            {formatCap(capTotal)}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 md:p-4 space-y-4">
        {children}
      </div>
    </div>
  );
}

/* ── Empty Slot Placeholder ─────────────────────────── */

function EmptySlot({ position }: { position: string }) {
  return (
    <div className="bg-citrus-cream/30 rounded-xl border-2 border-dashed border-citrus-sage/20 flex items-center justify-center py-6 md:py-8">
      <span className="text-[10px] font-display text-citrus-charcoal/30 uppercase tracking-wider">
        {position}
      </span>
    </div>
  );
}

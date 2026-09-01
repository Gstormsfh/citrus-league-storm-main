/**
 * Game-day strip + Fill sheet harness (2026-09-01, audit R1/R2/R5).
 *
 * Renders, at a phone viewport, the strip in every state it has (calm, amber
 * with the inline Auto Lineup, pending, past day) over the REAL
 * MobileRosterList with locked players and empty rows, wired the way
 * Roster.tsx wires it: an empty row tapped with nothing selected opens the
 * Fill sheet with the bench players eligible for that slot.
 *
 * `?fill=slot-LW-1` opens the Fill sheet on load so a driver can screenshot it.
 * `window.__log` records every callback, in order.
 */
import { createRoot } from 'react-dom/client';
import { useMemo, useState } from 'react';
import '../src/index.css';
import MobileRosterList from '../src/components/roster/MobileRosterList';
import { FillSlotSheet } from '../src/components/roster/FillSlotSheet';
import { TodayStrip } from '../src/components/roster/TodayStrip';
import { computeTodaySummary } from '../src/components/roster/todaySummary';
import { Toaster } from '../src/components/ui/toaster';
import type { HockeyPlayer } from '../src/components/roster/HockeyPlayerCard';

declare global { interface Window { __log: string[] } }
window.__log = [];
const log = (s: string) => { window.__log.push(s); };

type Game = 'none' | 'scheduled' | 'live' | 'final';

const mk = (id: string, name: string, position: string, team: string, proj: number, game: Game = 'scheduled', actual?: number): HockeyPlayer => {
  const isG = position === 'G';
  const projection = isG
    ? { goalieProjection: { total_projected_points: proj } }
    : { daily_projection: { total_projected_points: proj } };
  if (game === 'none') {
    return { id, name, position, number: 9, starter: true, team, teamAbbreviation: team, stats: {}, projectedPoints: 0 } as HockeyPlayer;
  }
  return {
    id, name, position, number: 9, starter: true, team, teamAbbreviation: team, stats: {},
    projectedPoints: proj,
    nextGame: {
      opponent: 'vs TOR', isToday: true,
      gameTime: game === 'scheduled' ? '7:30 PM' : undefined,
      gameStatus: game,
      score: game === 'scheduled' ? undefined : '2-1',
    },
    ...(game !== 'scheduled' ? { daily_actual_points: actual ?? 0, daily_actual_stats: { goals: 1, assists: 1, shots_on_goal: 4 } } : {}),
    ...projection,
  } as HockeyPlayer;
};

const P: Record<string, HockeyPlayer> = {
  mcdavid: mk('1', 'Connor McDavid', 'C', 'EDM', 5.2, 'live', 6.9),
  draisaitl: mk('2', 'Leon Draisaitl', 'C', 'EDM', 4.8, 'live', 2.5),
  makar: mk('3', 'Cale Makar', 'D', 'COL', 4.1),
  hughes: mk('4', 'Quinn Hughes', 'D', 'VAN', 3.9, 'none'),
  shesterkin: mk('5', 'Igor Shesterkin', 'G', 'NYR', 6.0),
  panarin: mk('6', 'Artemi Panarin', 'LW', 'NYR', 3.4),
  kaprizov: mk('7', 'Kirill Kaprizov', 'LW', 'MIN', 4.5),
  horvat: mk('8', 'Bo Horvat', 'C', 'NYI', 2.2, 'none'),
  rantanen: mk('9', 'Mikko Rantanen', 'RW', 'DAL', 4.4, 'final', 8.1),
};

// LW1, LW2, RW1, RW2, D2..D4, G2, UTIL are EMPTY on purpose.
const INITIAL: Record<string, string> = {
  '1': 'slot-C-1', '2': 'slot-C-2', '3': 'slot-D-1', '4': 'slot-D-2', '5': 'slot-G-1',
};

// The Oilers' game is live: their players are locked. Rantanen's is final.
const LOCKED = new Set(['1', '2', '9']);

const SLOT_POS = (slot: string) => (/^slot-([A-Z]+)/.exec(slot)?.[1] ?? 'UTIL');
const eligibleFor = (p: HockeyPlayer, slot: string) => {
  const pos = SLOT_POS(slot);
  if (slot === 'bench-grid') return true;
  if (pos === 'UTIL') return p.position !== 'G';
  return p.position === pos;
};

function App() {
  const [assign, setAssign] = useState<Record<string, string>>(INITIAL);
  const [selected, setSelected] = useState<string | number | null>(null);
  const [fillSlotId, setFillSlotId] = useState<string | null>(new URLSearchParams(location.search).get('fill'));

  const all = Object.values(P);
  const starters = all.filter((p) => (assign[p.id] || '').startsWith('slot-'));
  const bench = all.filter((p) => !assign[p.id] || assign[p.id] === 'bench-grid');

  const summary = useMemo(
    () => computeTodaySummary({ starters, bench, starterSlots: 13, lockedPlayerIds: LOCKED }),
    [starters, bench],
  );

  const eligible = useMemo(() => {
    if (!selected) return new Set<string>();
    const p = all.find((x) => x.id === selected);
    if (!p) return new Set<string>();
    const slots = ['slot-C-1', 'slot-C-2', 'slot-LW-1', 'slot-LW-2', 'slot-RW-1', 'slot-RW-2', 'slot-D-1', 'slot-D-2', 'slot-D-3', 'slot-D-4', 'slot-G-1', 'slot-G-2', 'slot-UTIL', 'bench-grid'];
    return new Set(slots.filter((s) => eligibleFor(p, s)));
  }, [selected, all]);

  const fillCandidates = useMemo(() => {
    if (!fillSlotId) return [];
    const plays = (p: HockeyPlayer) => p.nextGame?.isToday === true;
    return bench
      .filter((p) => eligibleFor(p, fillSlotId))
      .sort((a, b) => (plays(a) !== plays(b) ? (plays(a) ? -1 : 1) : (b.projectedPoints || 0) - (a.projectedPoints || 0)));
  }, [fillSlotId, bench]);

  const move = (playerId: string, slot: string) => {
    log(`move:${playerId}->${slot}`);
    setAssign((prev) => {
      const next = { ...prev };
      const occupant = Object.keys(prev).find((k) => prev[k] === slot && k !== playerId);
      const from = prev[playerId];
      if (slot === 'bench-grid') delete next[playerId];
      else next[playerId] = slot;
      if (occupant && slot !== 'bench-grid') {
        if (from) next[occupant] = from;
        else delete next[occupant];
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-[#0F1F15] p-3 space-y-3">
      {/* First, so its subscription exists before the list's first-run hint
          dispatches — in the app the Toaster lives at the root of App.tsx. */}
      <Toaster />
      <p className="font-jbmono text-[10px] uppercase tracking-[0.2em] text-white/55">
        Today strip states @ 393
      </p>
      <div data-testid="strip-live">
        <TodayStrip summary={summary} dayLabel="Today" editable onAutoLineup={() => log('autoLineup')} />
      </div>
      <div data-testid="strip-calm">
        <TodayStrip
          summary={{ ...summary, benchPlaying: 0, needsAttention: false, locked: 0 }}
          dayLabel="Today"
          editable
          onAutoLineup={() => log('autoLineup')}
        />
      </div>
      <div data-testid="strip-pending">
        <TodayStrip summary={summary} dayLabel="Wed Oct 15" pending editable onAutoLineup={() => {}} />
      </div>
      <div data-testid="strip-past">
        <TodayStrip summary={{ ...summary, locked: 0 }} dayLabel="Tue Oct 14" tense="past" editable={false} />
      </div>

      <p className="font-jbmono text-[10px] uppercase tracking-[0.2em] text-white/55 pt-2">
        Mobile roster — {selected ? `selected ${selected}` : fillSlotId ? `filling ${fillSlotId}` : 'nothing selected'}
      </p>
      <MobileRosterList
        starters={starters}
        bench={bench}
        ir={[]}
        slotAssignments={assign}
        lockedPlayerIds={LOCKED}
        tapSelectedPlayerId={selected}
        tapEligibleSlots={eligible}
        swapHint
        onPlayerTap={(p) => {
          log(`playerTap:${p.id}`);
          if (LOCKED.has(String(p.id))) { log('locked'); return; }
          if (!selected) { setSelected(p.id); return; }
          if (selected === p.id) { setSelected(null); return; }
          const target = assign[p.id] || 'bench-grid';
          if (!eligible.has(target)) { log(`rejected:${target}`); setSelected(p.id); return; }
          move(String(selected), target);
          setSelected(null);
        }}
        onPlayerNameTap={(p) => log(`nameTap:${p.id}`)}
        onSlotTap={(s) => {
          log(`slotTap:${s}`);
          if (!selected) return;
          move(String(selected), s);
          setSelected(null);
        }}
        onFillSlot={(s) => { log(`fillSlot:${s}`); setSelected(null); setFillSlotId(s); }}
        onBenchTap={() => log('benchTap')}
        onCancelSelection={() => { log('cancel'); setSelected(null); }}
        positionType="individual"
      />
      <FillSlotSheet
        slotId={fillSlotId}
        candidates={fillCandidates}
        lockedPlayerIds={LOCKED}
        open={fillSlotId != null}
        onOpenChange={(next) => { if (!next) { log('fillCancel'); setFillSlotId(null); } }}
        onPick={(id) => { if (fillSlotId) move(String(id), fillSlotId); setFillSlotId(null); }}
      />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);

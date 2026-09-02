/**
 * Slot-picker harness — the REAL MobileRosterList with Roster.tsx-shaped state.
 *
 * The isolated-component version of this file could not answer the question
 * that actually mattered: with the menu open, does a tap on a highlighted slot
 * UNDERNEATH it still complete the move? That depends on Radix's dismissal
 * behaviour and on pointerdown/click ordering, neither of which is safe to
 * reason about from the docs. So this mirrors the page's wiring instead.
 *
 * `window.__log` records every callback the page fires, in order, so a driver
 * can assert on the sequence rather than on a screenshot.
 */
import { createRoot } from 'react-dom/client';
import { useMemo, useState } from 'react';
import '../src/index.css';
import MobileRosterList from '../src/components/roster/MobileRosterList';
import type { HockeyPlayer } from '../src/components/roster/HockeyPlayerCard';
import { harnessPlayer, harnessRowPlayer } from './players';

declare global { interface Window { __log: string[] } }
window.__log = [];
const log = (s: string) => { window.__log.push(s); };

/**
 * REAL PLAYERS, REAL FACES (2026-09-02). These seven used to be names typed
 * into this file with no face field, so every row in the list this harness
 * exists to drive fell through `Mug` to an initials disc — the one thing no
 * production row does (801 of 801 `players` rows carry an NHL CDN headshot).
 * Identity and face come off the shared roster; the SLOT STATE below is
 * still written here, because that is what this file tests.
 */
const mk = (id: string, who: string, proj?: number): HockeyPlayer => {
  const p = harnessRowPlayer(harnessPlayer(who));
  return {
    id, ...p, starter: true, stats: {},
    nextGame: { opponent: 'vs TOR', isToday: true, gameTime: '7:30 PM', gameStatus: 'scheduled' },
    ...(proj != null
      ? p.position === 'G'
        ? { goalieProjection: { total_projected_points: proj } }
        : { daily_projection: { total_projected_points: proj } }
      : {}),
  } as HockeyPlayer;
};

const P = {
  mcdavid: mk('1', 'Connor McDavid', 5.2),
  draisaitl: mk('2', 'Leon Draisaitl', 4.8),
  makar: mk('3', 'Cale Makar', 4.1),
  hughes: mk('4', 'Quinn Hughes', 3.9),
  // The roster has no NYR goalie; Swayman is the goalie it has. The slot the
  // row occupies (slot-G-1) and the G eligibility it proves are unchanged.
  swayman: mk('5', 'Jeremy Swayman', 6.0),
  panarin: mk('6', 'Artemi Panarin', 3.4),
  kaprizov: mk('7', 'Kirill Kaprizov', 4.5),
};

// slot-LW-1 and slot-D-2 are deliberately EMPTY: the highlighted-empty-slot tap
// is the interaction this harness exists to prove.
// PAGE SHAPE: bench players (6, 7) have NO entry at all — on the real page
// the bench is an array, not an assignment. The sheet must count them anyway.
const INITIAL: Record<string, string> = {
  '1': 'slot-C-1', '2': 'slot-C-2', '3': 'slot-D-1',
  '5': 'slot-G-1',
};

const ELIGIBLE_BY_POS: Record<string, string[]> = {
  C: ['slot-C-1', 'slot-C-2', 'slot-UTIL', 'bench-grid'],
  LW: ['slot-LW-1', 'slot-LW-2', 'slot-UTIL', 'bench-grid'],
  D: ['slot-D-1', 'slot-D-2', 'slot-UTIL', 'bench-grid'],
  G: ['slot-G-1', 'slot-G-2', 'bench-grid'],
};

function App() {
  const [assign, setAssign] = useState<Record<string, string>>(INITIAL);
  const [selected, setSelected] = useState<string | number | null>(null);

  const all = Object.values(P);
  const starters = all.filter(p => (assign[p.id] || '').startsWith('slot-'));
  const bench = all.filter(p => !assign[p.id] || assign[p.id] === 'bench-grid');

  // Stands in for Roster.tsx's tapEligibleSlots — same shape, same contract.
  const eligible = useMemo(() => {
    if (!selected) return new Set<string>();
    const p = all.find(x => x.id === selected);
    return new Set(p ? ELIGIBLE_BY_POS[p.position] || [] : []);
  }, [selected, assign]);

  const move = (playerId: string, slot: string) => {
    setAssign(prev => {
      const next = { ...prev };
      const occupant = Object.keys(prev).find(k => prev[k] === slot && k !== playerId);
      const from = prev[playerId];  // undefined = came from bench
      if (slot === 'bench-grid') delete next[playerId];
      else next[playerId] = slot;
      if (occupant && slot !== 'bench-grid') {
        if (from) next[occupant] = from;
        else delete next[occupant];    // swapped back to the bench
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-[#0F1F15] p-3">
      <p className="font-jbmono text-[10px] uppercase tracking-[0.2em] text-white/55 mb-3">
        Mobile roster @ 393 — {selected ? `selected ${selected}` : 'nothing selected'}
      </p>
      <MobileRosterList
        starters={starters}
        bench={bench}
        ir={[]}
        slotAssignments={assign}
        tapSelectedPlayerId={selected}
        tapEligibleSlots={eligible}
        onPlayerTap={(p) => {
          log(`playerTap:${p.id}`);
          if (!selected) { setSelected(p.id); return; }
          if (selected === p.id) { setSelected(null); return; }
          const target = assign[p.id];
          if (!eligible.has(target)) { log(`rejected:${target}`); setSelected(p.id); return; }
          move(String(selected), target);
          setSelected(null);
        }}
        onPlayerNameTap={(p) => log(`nameTap:${p.id}`)}
        onSlotTap={(s) => {
          log(`slotTap:${s}`);
          if (!selected) { log('slotTap:IGNORED-no-selection'); return; }
          move(String(selected), s);
          setSelected(null);
        }}
        onBenchTap={() => log('benchTap')}
        onCancelSelection={() => { log('cancel'); setSelected(null); }}
        positionType="individual"
      />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);

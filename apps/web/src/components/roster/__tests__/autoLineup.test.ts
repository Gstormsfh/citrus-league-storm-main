// AUTO LINEUP PLANNER (2026-09-01, Sleeper parity audit R6)
//
// What would be WRONG rather than ugly:
//
//   * benching a starter whose game has begun — the bug this slice exists to
//     fix; the tap handlers already refuse it, the optimizer used to do it;
//   * promoting a bench player whose game has begun (he is just as locked);
//   * a plan whose projected total is LOWER than the lineup it replaces —
//     the preview shows the gain, so the number has to be a real gain;
//   * moves that change a slot NUMBER for no reason (C2 → C1 is churn);
//   * a starter without a slot, two starters in one slot, a player lost.
import { describe, it, expect } from 'vitest';
import { assignMaxWeight, planAutoLineup, slotGroup, summarisePlans, BENCH } from '../autoLineup';
import type { LineupState } from '../autoLineup';
import type { HockeyPlayer } from '../HockeyPlayerCard';

type Opts = { game?: boolean; proj?: number; eligible?: string[] };
const mk = (id: string, name: string, position: string, { game = true, proj = 0, eligible }: Opts = {}): HockeyPlayer =>
  ({
    id,
    name,
    position,
    eligible_positions: eligible ?? [position],
    number: 9,
    starter: false,
    team: 'EDM',
    teamAbbreviation: 'EDM',
    stats: {},
    projectedPoints: game ? proj : 0,
    nextGame: game ? { opponent: 'vs CGY', isToday: true } : undefined,
  }) as HockeyPlayer;

/** A small league: one of each, plus UTIL. Enough to reason about by hand. */
const SMALL = { C: 1, LW: 1, RW: 1, D: 1, G: 1, UTIL: 1 };
const INDIVIDUAL = { positionType: 'individual' as const, slotCounts: SMALL };
/** No UTIL: a second centre has nowhere to go but C1, so a displacement is the only way in. */
const NO_UTIL = { positionType: 'individual' as const, slotCounts: { ...SMALL, UTIL: 0 } };

const state = (starters: [HockeyPlayer, string][], bench: HockeyPlayer[]): LineupState => ({
  starters: starters.map(([p]) => ({ ...p, starter: true })),
  bench,
  slotAssignments: Object.fromEntries(starters.map(([p, slot]) => [String(p.id), slot])),
});

const moveLine = (m: { player: HockeyPlayer; from: string; to: string }) =>
  `${m.player.name} ${m.from} → ${m.to}`;

// ── assignment core ───────────────────────────────────────────────────────

function bruteForceBest(weights: number[][]): number {
  const n = weights.length;
  const m = weights[0].length;
  let best = -Infinity;
  const used = new Array<boolean>(m).fill(false);
  const go = (row: number, total: number) => {
    if (row === n) {
      best = Math.max(best, total);
      return;
    }
    for (let col = 0; col < m; col++) {
      if (used[col]) continue;
      used[col] = true;
      go(row + 1, total + weights[row][col]);
      used[col] = false;
    }
  };
  go(0, 0);
  return best;
}

describe('assignMaxWeight — the matching core', () => {
  it('finds the maximum-weight assignment on random instances (brute-force oracle)', () => {
    let seed = 20260901;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(rand() * 4);
      const m = n + Math.floor(rand() * 3);
      const weights = Array.from({ length: n }, () =>
        Array.from({ length: m }, () => (rand() < 0.15 ? -1e9 : Math.round(rand() * 2000) / 10)),
      );
      const cols = assignMaxWeight(weights);
      expect(new Set(cols).size).toBe(n); // distinct columns
      const total = cols.reduce((acc, col, row) => acc + weights[row][col], 0);
      expect(total).toBeCloseTo(bruteForceBest(weights), 6);
    }
  });

  it('refuses more rows than columns', () => {
    expect(() => assignMaxWeight([[1], [2]])).toThrow();
  });
});

describe('slotGroup', () => {
  it('reads the position group off a slot id', () => {
    expect(slotGroup('slot-C-2')).toBe('C');
    expect(slotGroup('slot-UTIL')).toBe('UTIL');
    expect(slotGroup('slot-UTIL-2')).toBe('UTIL');
    expect(slotGroup(BENCH)).toBe('BN');
    expect(slotGroup('ir-slot-1')).toBe('IR');
  });
});

// ── locks ─────────────────────────────────────────────────────────────────

describe('planAutoLineup — locks', () => {
  const IDLE_STARTER = mk('1', 'Idle Starter', 'C', { game: false });
  const HOT_BENCH = mk('2', 'Hot Bench', 'C', { game: true, proj: 6.0 });

  it('benches an idle starter for a bench player with a game when nobody is locked', () => {
    const plan = planAutoLineup(state([[IDLE_STARTER, 'slot-C-1']], [HOT_BENCH]), NO_UTIL);
    expect(plan.moves.map(moveLine)).toEqual(['Idle Starter slot-C-1 → bench-grid', 'Hot Bench bench-grid → slot-C-1']);
    expect(plan.after - plan.before).toBeCloseTo(6.0);
  });

  it('starts both when there is room: an idle starter is not benched just to make a point', () => {
    const plan = planAutoLineup(state([[IDLE_STARTER, 'slot-C-1']], [HOT_BENCH]), INDIVIDUAL);
    expect(plan.moves.map(moveLine)).toEqual(['Hot Bench bench-grid → slot-UTIL']);
    expect(plan.lineup.slotAssignments['1']).toBe('slot-C-1');
  });

  it('a locked starter stays in his slot — even when a better bench player is available', () => {
    const plan = planAutoLineup(state([[IDLE_STARTER, 'slot-C-1']], [HOT_BENCH]), {
      ...NO_UTIL,
      lockedPlayerIds: new Set(['1']),
    });
    expect(plan.lineup.slotAssignments['1']).toBe('slot-C-1');
    expect(plan.moves).toEqual([]);
    expect(plan.lineup.bench.map((p) => p.name)).toEqual(['Hot Bench']);
    expect(plan.pinned.map((p) => p.name)).toEqual(['Idle Starter']);
  });

  it('a locked starter only closes his own slot — the bench player still finds an open one', () => {
    const plan = planAutoLineup(state([[IDLE_STARTER, 'slot-C-1']], [HOT_BENCH]), {
      ...INDIVIDUAL,
      lockedPlayerIds: new Set(['1']),
    });
    expect(plan.lineup.slotAssignments['1']).toBe('slot-C-1');
    expect(plan.lineup.slotAssignments['2']).toBe('slot-UTIL');
    expect(plan.moves.some((m) => String(m.player.id) === '1')).toBe(false);
  });

  it('a locked starter in UTIL keeps UTIL, and nobody else is put there', () => {
    const plan = planAutoLineup(state([[IDLE_STARTER, 'slot-UTIL']], [HOT_BENCH]), {
      ...INDIVIDUAL,
      lockedPlayerIds: new Set(['1']),
    });
    expect(plan.lineup.slotAssignments['1']).toBe('slot-UTIL');
    expect(plan.lineup.slotAssignments['2']).toBe('slot-C-1');
  });

  it('a locked bench player is never promoted, however good his night looks', () => {
    const plan = planAutoLineup(state([[IDLE_STARTER, 'slot-C-1']], [HOT_BENCH]), {
      ...INDIVIDUAL,
      lockedPlayerIds: new Set(['2']),
    });
    expect(plan.moves).toEqual([]);
    expect(plan.lineup.bench.map((p) => p.name)).toEqual(['Hot Bench']);
    expect(plan.lineup.starters.map((p) => p.name)).toEqual(['Idle Starter']);
    expect(plan.pinned.map((p) => p.name)).toEqual(['Hot Bench']);
  });

  it('with everyone locked the plan is the current lineup', () => {
    const plan = planAutoLineup(state([[IDLE_STARTER, 'slot-C-1']], [HOT_BENCH]), {
      ...INDIVIDUAL,
      lockedPlayerIds: new Set(['1', '2']),
    });
    expect(plan.moves).toEqual([]);
    expect(plan.after).toBe(plan.before);
  });
});

// ── the plan itself ───────────────────────────────────────────────────────

describe('planAutoLineup — moves and totals', () => {
  it('reports every changed spot, out before in, per slot', () => {
    const A = mk('1', 'Player A', 'C', { game: false });
    const B = mk('2', 'Player B', 'LW', { game: true, proj: 3.1 });
    const plan = planAutoLineup(state([[A, 'slot-C-1']], [B]), INDIVIDUAL);
    // B is an LW: he takes the open LW slot rather than displacing A from C.
    // A has no game but his slot has no better taker, so he stays.
    expect(plan.moves.map(moveLine)).toEqual(['Player B bench-grid → slot-LW-1']);
    expect(plan.before).toBe(0);
    expect(plan.after).toBeCloseTo(3.1);
  });

  it('a player with a game always outranks one without, whatever the projections say', () => {
    const STALE = mk('1', 'Stale Starter', 'C', { game: false });
    (STALE as HockeyPlayer).projectedPoints = 5.0; // a stale number from another day
    const LIVE = mk('2', 'Plays Tonight', 'C', { game: true, proj: 0.4 });
    const plan = planAutoLineup(state([[STALE, 'slot-C-1']], [LIVE]), NO_UTIL);
    expect(plan.lineup.slotAssignments['2']).toBe('slot-C-1');
    expect(plan.lineup.bench.map((p) => p.name)).toEqual(['Stale Starter']);
  });

  it('an already-optimal lineup produces no moves and keeps every slot id', () => {
    const C = mk('1', 'Centre', 'C', { proj: 4.0 });
    const LW = mk('2', 'Winger', 'LW', { proj: 3.0 });
    const D = mk('3', 'Blueliner', 'D', { proj: 2.0 });
    const G = mk('4', 'Goalie', 'G', { proj: 5.0 });
    const BN = mk('5', 'Spare', 'C', { proj: 1.0 });
    const plan = planAutoLineup(
      state([[C, 'slot-C-1'], [LW, 'slot-LW-1'], [D, 'slot-D-1'], [G, 'slot-G-1'], [BN, 'slot-UTIL']], []),
      INDIVIDUAL,
    );
    expect(plan.moves).toEqual([]);
    expect(plan.lineup.slotAssignments).toEqual({
      '1': 'slot-C-1', '2': 'slot-LW-1', '3': 'slot-D-1', '4': 'slot-G-1', '5': 'slot-UTIL',
    });
    expect(plan.after).toBe(plan.before);
  });

  it('never renumbers a continuing starter (C2 stays C2 while C1 is filled from the bench)', () => {
    const TWO_C = { ...INDIVIDUAL, slotCounts: { ...SMALL, C: 2 } };
    const SECOND = mk('1', 'Second Line', 'C', { proj: 2.0 });
    const NEW = mk('2', 'From The Bench', 'C', { proj: 4.0 });
    const plan = planAutoLineup(state([[SECOND, 'slot-C-2']], [NEW]), TWO_C);
    expect(plan.lineup.slotAssignments['1']).toBe('slot-C-2');
    expect(plan.lineup.slotAssignments['2']).toBe('slot-C-1');
    expect(plan.moves.map(moveLine)).toEqual(['From The Bench bench-grid → slot-C-1']);
  });

  it('does not shuffle several players for a negligible gain', () => {
    // Swapping the two would gain 0.02 — below the churn threshold, so no plan.
    const A = mk('1', 'A', 'C', { proj: 3.00, eligible: ['C', 'LW'] });
    const B = mk('2', 'B', 'LW', { proj: 3.02, eligible: ['C', 'LW'] });
    const plan = planAutoLineup(state([[A, 'slot-C-1'], [B, 'slot-LW-1']], []), INDIVIDUAL);
    expect(plan.moves).toEqual([]);
  });

  it('finds the dual-eligibility optimum a position-by-position greedy misses', () => {
    // Greedy-by-position spends the C/LW player on C and leaves the pure LW
    // on the bench. The optimum moves him to LW and starts the pure C.
    const PURE_C = mk('1', 'Pure Centre', 'C', { proj: 3.0 });
    const DUAL = mk('2', 'Dual', 'C', { proj: 3.5, eligible: ['C', 'LW'] });
    const PURE_LW = mk('3', 'Pure Winger', 'LW', { proj: 2.8 });
    const ONE_EACH = { ...INDIVIDUAL, slotCounts: { C: 1, LW: 1, RW: 0, D: 0, G: 0, UTIL: 0 } };
    const plan = planAutoLineup(state([[DUAL, 'slot-C-1']], [PURE_C, PURE_LW]), ONE_EACH);
    expect(plan.lineup.slotAssignments).toEqual({ '1': 'slot-C-1', '2': 'slot-LW-1' });
    expect(plan.after).toBeCloseTo(6.5);
  });

  it('fills an open slot even with a player who has no game tonight', () => {
    const SPARE = mk('1', 'Spare D', 'D', { game: false });
    const plan = planAutoLineup(state([], [SPARE]), INDIVIDUAL);
    expect(plan.lineup.slotAssignments['1']).toBe('slot-D-1');
  });

  it('keeps goalies out of UTIL and skaters out of G', () => {
    const G1 = mk('1', 'Goalie One', 'G', { proj: 6.0 });
    const G2 = mk('2', 'Goalie Two', 'G', { proj: 5.0 });
    const SK = mk('3', 'Skater', 'RW', { proj: 1.0 });
    const plan = planAutoLineup(state([], [G1, G2, SK]), INDIVIDUAL);
    expect(plan.lineup.slotAssignments['1']).toBe('slot-G-1');
    expect(plan.lineup.slotAssignments['2']).toBeUndefined();
    expect(plan.lineup.slotAssignments['3']).toBe('slot-RW-1');
    expect(plan.lineup.bench.map((p) => p.name)).toEqual(['Goalie Two']);
  });

  it('maps C/LW/RW onto F slots in a forward league', () => {
    const FWD = { positionType: 'forward' as const, slotCounts: { F: 2, D: 1, G: 1, UTIL: 1 } };
    const C = mk('1', 'Centre', 'C', { proj: 3.0 });
    const RW = mk('2', 'Right Wing', 'RW', { proj: 2.0 });
    const plan = planAutoLineup(state([], [C, RW]), FWD);
    expect(plan.lineup.slotAssignments['1']).toBe('slot-F-1');
    expect(plan.lineup.slotAssignments['2']).toBe('slot-F-2');
  });

  it('numbers UTIL slots when the league has more than one', () => {
    const TWO_UTIL = { ...INDIVIDUAL, slotCounts: { ...SMALL, UTIL: 2 } };
    const A = mk('1', 'A', 'C', { proj: 3.0 });
    const B = mk('2', 'B', 'C', { proj: 2.0 });
    const Cc = mk('3', 'C', 'C', { proj: 1.0 });
    const plan = planAutoLineup(state([], [A, B, Cc]), TWO_UTIL);
    expect(Object.values(plan.lineup.slotAssignments).sort()).toEqual(['slot-C-1', 'slot-UTIL-1', 'slot-UTIL-2']);
  });

  it('never lowers the projected total, loses a player, or double-books a slot (property)', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const POS = ['C', 'LW', 'RW', 'D', 'G'];
    const FULL = { C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 1 };
    for (let trial = 0; trial < 150; trial++) {
      const players: HockeyPlayer[] = [];
      const n = 12 + Math.floor(rand() * 8);
      for (let i = 0; i < n; i++) {
        const pos = POS[Math.floor(rand() * POS.length)];
        const dual = pos !== 'G' && rand() < 0.25 ? [pos, POS[Math.floor(rand() * 4)]] : [pos];
        players.push(mk(String(i + 1), `P${i + 1}`, pos, { game: rand() < 0.7, proj: Math.round(rand() * 80) / 10, eligible: [...new Set(dual)] }));
      }
      // A random legal-ish current lineup: walk the slots, place any eligible player.
      const slotIds = [
        'slot-C-1', 'slot-C-2', 'slot-LW-1', 'slot-LW-2', 'slot-RW-1', 'slot-RW-2',
        'slot-D-1', 'slot-D-2', 'slot-D-3', 'slot-D-4', 'slot-G-1', 'slot-G-2', 'slot-UTIL',
      ];
      const starters: [HockeyPlayer, string][] = [];
      const left = [...players];
      for (const slot of slotIds) {
        if (rand() < 0.15) continue; // leave some slots empty
        const group = slotGroup(slot);
        const idx = left.findIndex((p) =>
          group === 'UTIL' ? !p.eligible_positions!.includes('G') : p.eligible_positions!.includes(group),
        );
        if (idx >= 0) starters.push([left.splice(idx, 1)[0], slot]);
      }
      const locked = new Set(players.filter(() => rand() < 0.2).map((p) => String(p.id)));
      const current = state(starters, left);
      const plan = planAutoLineup(current, { positionType: 'individual', slotCounts: FULL, lockedPlayerIds: locked });

      // Never worse.
      expect(plan.after).toBeGreaterThanOrEqual(plan.before - 1e-9);
      // Every player accounted for exactly once.
      const ids = [...plan.lineup.starters, ...plan.lineup.bench].map((p) => String(p.id)).sort();
      expect(ids).toEqual(players.map((p) => String(p.id)).sort());
      // Every starter has a slot, no slot has two starters.
      const slotsUsed = plan.lineup.starters.map((p) => plan.lineup.slotAssignments[String(p.id)]);
      expect(slotsUsed.every(Boolean)).toBe(true);
      expect(new Set(slotsUsed).size).toBe(slotsUsed.length);
      // Locked players did not move.
      for (const m of plan.moves) expect(locked.has(String(m.player.id))).toBe(false);
      // No move is a no-op.
      for (const m of plan.moves) expect(m.from).not.toBe(m.to);
    }
  });
});

describe('summarisePlans', () => {
  it('adds moves and totals across days', () => {
    const A = mk('1', 'A', 'C', { proj: 2 });
    const B = mk('2', 'B', 'C', { proj: 3 });
    const day1 = planAutoLineup(state([[A, 'slot-C-1']], [B]), INDIVIDUAL);
    const day2 = planAutoLineup(state([[B, 'slot-C-1']], [A]), INDIVIDUAL);
    const s = summarisePlans([day1, day2]);
    expect(s.moves).toBe(day1.moves.length + day2.moves.length);
    expect(s.before).toBeCloseTo(day1.before + day2.before);
    expect(s.after).toBeCloseTo(day1.after + day2.after);
  });
});

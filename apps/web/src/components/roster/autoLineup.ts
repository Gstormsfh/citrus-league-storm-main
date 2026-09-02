import type { HockeyPlayer } from './HockeyPlayerCard';
import { resolveFantasyPosition, getSlotPositions, type PositionType } from '@/utils/rosterUtils';

/**
 * AUTO LINEUP PLANNER (2026-09-01, Sleeper parity audit R6)
 *
 * The optimizer used to live inside Roster.tsx's `handleAutoLineup`: a greedy
 * pass over `[...starters, ...bench]` that rebuilt every slot, saved, and
 * toasted "Lineup Optimized". Three things were wrong with it, and they are
 * the reasons this module exists:
 *
 *   1. It never looked at `lockedPlayerIds`. The tap handlers refuse to move
 *      a player whose game has started; the optimizer would bench him. Here a
 *      locked starter is PINNED to his slot and a locked bench player stays
 *      on the bench — only unlocked players and unpinned slots take part.
 *
 *   2. It was greedy by position order (C, then LW, …), so a C/LW player was
 *      always spent on C even when LW was the thin group. That can produce a
 *      lineup WORSE than the one the manager set by hand — which matters the
 *      moment the moves are previewed with a projected gain next to them.
 *      This is a small assignment problem (≈20 players × ≈13 slots), so it
 *      is solved exactly: maximum-weight matching of players to slots.
 *
 *   3. It reported nothing. `planAutoLineup` returns the MOVES — who leaves
 *      which slot for which — and the projected total before and after, so
 *      the page can show them before anything is saved.
 *
 * Weights: a player with a game outranks any player without one (Yahoo's
 * Start Active Players rule), then projection decides. Two small bonuses
 * shape the tie-breaks: a filled slot beats an empty one, and staying in the
 * current position group beats moving for nothing — so the plan never
 * shuffles four players for +0.1, and slot NUMBERS never change on their own
 * (C2 → C1 for no reason is churn, not a move).
 *
 * Pure. Takes the page's enriched players (`projectedPoints`,
 * `nextGame.isToday` for the date) and its slot configuration; touches no
 * state, so it runs the same for today and for every day of the week.
 */

export const BENCH = 'bench-grid';

/** A player with a game always outranks one without, whatever the projections say. */
const GAME = 1000;
/** A filled slot beats an empty one, even when the player has no game tonight. */
const PRESENCE = 0.01;
/** Staying in the current position group beats moving for less than this. */
const STAY = 0.05;
/** Ineligible pairs. Large enough to never be chosen while an eligible pair or an empty slot exists. */
const NEVER = -1e9;

export interface LineupState {
  starters: HockeyPlayer[];
  bench: HockeyPlayer[];
  /** playerId -> slotId for starters (IR entries are ignored here). */
  slotAssignments: Record<string, string>;
}

export interface AutoLineupOptions {
  /** Starter slots per position, UTIL included — e.g. { C: 2, LW: 2, RW: 2, D: 4, G: 2, UTIL: 1 }. */
  slotCounts: Record<string, number>;
  positionType: PositionType;
  /** Players whose games have started. They keep their spot, whatever the numbers say. */
  lockedPlayerIds?: Set<string>;
}

export interface LineupMove {
  player: HockeyPlayer;
  /** Slot id, or BENCH. */
  from: string;
  /** Slot id, or BENCH. */
  to: string;
}

export interface AutoLineupPlan {
  /** The lineup after the moves. Starters carry `starter: true`, bench `false`. */
  lineup: LineupState;
  /** Every player whose spot changes, in reading order: per slot, out before in. */
  moves: LineupMove[];
  /** Σ starters' projected points before the moves. */
  before: number;
  /** Σ starters' projected points after the moves. */
  after: number;
  /** Locked players held where they are (starters and bench alike). */
  pinned: HockeyPlayer[];
}

/** `slot-C-2` → `C`, `slot-UTIL` / `slot-UTIL-2` → `UTIL`, bench → `BN`, `ir-slot-1` → `IR`. */
export function slotGroup(slotId: string): string {
  if (slotId === BENCH) return 'BN';
  if (/^ir-slot-/.test(slotId)) return 'IR';
  if (/^slot-UTIL(?:-\d+)?$/.test(slotId)) return 'UTIL';
  const m = /^slot-([A-Z]+)-\d+$/.exec(slotId);
  return m ? m[1] : slotId;
}

const plays = (p: HockeyPlayer): boolean => p.nextGame?.isToday === true;
const projected = (p: HockeyPlayer): number => {
  const n = Number(p.projectedPoints);
  return Number.isFinite(n) ? n : 0;
};

/** The position groups a player may start in, resolved for the league's position type. */
function eligibleGroups(p: HockeyPlayer, positionType: PositionType): Set<string> {
  const raw = p.eligible_positions && p.eligible_positions.length > 0 ? p.eligible_positions : [p.position];
  const groups = new Set<string>();
  for (const r of raw) {
    const g = resolveFantasyPosition(r, positionType);
    if (g !== 'OTHER') groups.add(g);
  }
  return groups;
}

/** Same rule as Roster.tsx's `isPositionValid`: UTIL takes any skater; G takes goalies only. */
function canPlay(groups: Set<string>, group: string): boolean {
  if (group === 'UTIL') return !groups.has('G');
  return groups.has(group);
}

/**
 * Maximum-weight assignment of rows to distinct columns (rows ≤ cols).
 * Returns the column chosen for each row. Hungarian method on cost = −weight,
 * O(rows² · cols) — trivial at roster size.
 */
export function assignMaxWeight(weights: number[][]): number[] {
  const n = weights.length;
  const m = n === 0 ? 0 : weights[0].length;
  if (n > m) throw new Error('assignMaxWeight: rows must not exceed columns');
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(INF);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = -weights[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const result = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j] > 0) result[p[j] - 1] = j - 1;
  return result;
}

/** Every starter slot id the league configures, in reading order, grouped. */
function buildSlots(slotCounts: Record<string, number>, positionType: PositionType): { id: string; group: string }[] {
  const out: { id: string; group: string }[] = [];
  for (const pos of getSlotPositions(positionType)) {
    const count = Math.max(0, Math.floor(Number(slotCounts[pos]) || 0));
    for (let i = 1; i <= count; i++) {
      if (pos === 'UTIL') out.push({ id: count === 1 ? 'slot-UTIL' : `slot-UTIL-${i}`, group: 'UTIL' });
      else out.push({ id: `slot-${pos}-${i}`, group: pos });
    }
  }
  return out;
}

export function planAutoLineup(current: LineupState, opts: AutoLineupOptions): AutoLineupPlan {
  const locked = opts.lockedPlayerIds ?? new Set<string>();
  const isLocked = (p: HockeyPlayer) => locked.has(String(p.id));
  const groupsOf = new Map<string, Set<string>>();
  const groupsFor = (p: HockeyPlayer) => {
    const k = String(p.id);
    let g = groupsOf.get(k);
    if (!g) {
      g = eligibleGroups(p, opts.positionType);
      groupsOf.set(k, g);
    }
    return g;
  };

  const slots = buildSlots(opts.slotCounts, opts.positionType);
  const slotIndex = new Map(slots.map((s, i) => [s.id, i]));
  const order = (slotId: string) => slotIndex.get(slotId) ?? Number.MAX_SAFE_INTEGER;

  /** Where each player sits now. A starter with no assignment reads as bench. */
  const fromOf = (p: HockeyPlayer, isStarter: boolean) =>
    isStarter ? current.slotAssignments[String(p.id)] ?? BENCH : BENCH;

  // ── 1. Pin the locked ─────────────────────────────────────────────────
  const pinnedSlot = new Map<string, HockeyPlayer>(); // slotId -> player
  const pinned: HockeyPlayer[] = [];
  const pool: { p: HockeyPlayer; from: string }[] = [];
  const takenSlotIds = new Set<string>();

  for (const p of current.starters) {
    const from = fromOf(p, true);
    if (!isLocked(p)) {
      pool.push({ p, from });
      continue;
    }
    pinned.push(p);
    let slotId = from !== BENCH ? from : null;
    if (slotId && slotGroup(slotId) === 'IR') slotId = null;
    if (slotId && takenSlotIds.has(slotId)) slotId = null;
    if (!slotId) {
      // A locked starter with no slot on record still cannot be benched: hold
      // him in the last free slot of a group he can play, UTIL last.
      const groups = groupsFor(p);
      const candidates = slots.filter((s) => !takenSlotIds.has(s.id) && canPlay(groups, s.group));
      const preferred = candidates.filter((s) => s.group !== 'UTIL');
      const ranked = preferred.length > 0 ? preferred : candidates;
      slotId = ranked.length > 0 ? ranked[ranked.length - 1].id : null;
    }
    if (slotId) {
      pinnedSlot.set(slotId, p);
      takenSlotIds.add(slotId);
    }
  }
  // A locked bench player stays exactly where he is: out of the pool, and
  // therefore never promoted over the players who can still be moved.
  for (const p of current.bench) {
    if (isLocked(p)) pinned.push(p);
    else pool.push({ p, from: BENCH });
  }

  // ── 2. Match the rest to the open slots ───────────────────────────────
  const openSlots = slots.filter((s) => !takenSlotIds.has(s.id));
  const cols = Math.max(openSlots.length, pool.length);
  const weights: number[][] = openSlots.map((slot) =>
    Array.from({ length: cols }, (_, j) => {
      const entry = pool[j];
      if (!entry) return 0; // dummy column: the slot stays empty
      const groups = groupsFor(entry.p);
      if (!canPlay(groups, slot.group)) return NEVER;
      const stay = slotGroup(entry.from) === slot.group ? STAY : 0;
      return (plays(entry.p) ? GAME : 0) + projected(entry.p) + PRESENCE + stay;
    }),
  );
  const chosen = openSlots.length > 0 ? assignMaxWeight(weights) : [];

  /** group -> players landing in that group (unlocked), with where they came from. */
  const landing = new Map<string, { p: HockeyPlayer; from: string }[]>();
  chosen.forEach((col, row) => {
    const entry = pool[col];
    if (!entry) return;
    if (weights[row][col] <= NEVER / 2) return; // forced onto an ineligible slot: leave it empty instead
    const group = openSlots[row].group;
    const list = landing.get(group) ?? [];
    list.push(entry);
    landing.set(group, list);
  });

  // ── 3. Relabel: keep a continuing starter's exact slot id ─────────────
  const newAssignments: Record<string, string> = {};
  for (const [slotId, p] of pinnedSlot) newAssignments[String(p.id)] = slotId;

  const groupOrder = [...new Set(slots.map((s) => s.group))];
  for (const group of groupOrder) {
    const list = landing.get(group) ?? [];
    const free = openSlots.filter((s) => s.group === group).map((s) => s.id);
    const remaining = new Set(free);
    const newcomers: { p: HockeyPlayer; from: string }[] = [];
    for (const entry of list) {
      if (slotGroup(entry.from) === group && remaining.has(entry.from)) {
        newAssignments[String(entry.p.id)] = entry.from;
        remaining.delete(entry.from);
      } else {
        newcomers.push(entry);
      }
    }
    const freeInOrder = free.filter((id) => remaining.has(id));
    newcomers.forEach((entry, i) => {
      const id = freeInOrder[i];
      if (id) newAssignments[String(entry.p.id)] = id;
    });
  }

  // ── 4. Assemble ───────────────────────────────────────────────────────
  const startersById = new Map<string, HockeyPlayer>();
  for (const p of [...current.starters, ...current.bench]) {
    if (newAssignments[String(p.id)]) startersById.set(String(p.id), p);
  }
  const newStarters = [...startersById.values()]
    .sort((a, b) => order(newAssignments[String(a.id)]) - order(newAssignments[String(b.id)]))
    .map((p) => ({ ...p, starter: true }));
  const newBench = [...current.bench, ...current.starters]
    .filter((p) => !startersById.has(String(p.id)))
    .map((p) => ({ ...p, starter: false }));

  const moves: LineupMove[] = [];
  const consider = (p: HockeyPlayer, isStarter: boolean) => {
    const from = fromOf(p, isStarter);
    const to = newAssignments[String(p.id)] ?? BENCH;
    if (from !== to) moves.push({ player: p, from, to });
  };
  current.starters.forEach((p) => consider(p, true));
  current.bench.forEach((p) => consider(p, false));
  moves.sort((a, b) => {
    const ka = order(a.to === BENCH ? a.from : a.to);
    const kb = order(b.to === BENCH ? b.from : b.to);
    if (ka !== kb) return ka - kb;
    const oa = a.to === BENCH ? 0 : 1;
    const ob = b.to === BENCH ? 0 : 1;
    return oa - ob;
  });

  const sum = (list: HockeyPlayer[]) => list.reduce((acc, p) => acc + projected(p), 0);

  return {
    lineup: { starters: newStarters, bench: newBench, slotAssignments: newAssignments },
    moves,
    before: sum(current.starters),
    after: sum(newStarters),
    pinned,
  };
}

/** Σ over several plans — the week view's headline. */
export function summarisePlans(plans: AutoLineupPlan[]): { moves: number; before: number; after: number } {
  return plans.reduce(
    (acc, plan) => ({
      moves: acc.moves + plan.moves.length,
      before: acc.before + plan.before,
      after: acc.after + plan.after,
    }),
    { moves: 0, before: 0, after: 0 },
  );
}

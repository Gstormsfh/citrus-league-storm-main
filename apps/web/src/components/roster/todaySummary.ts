import type { HockeyPlayer } from './HockeyPlayerCard';

/**
 * GAME-DAY SUMMARY (2026-09-01, Sleeper parity audit R1)
 *
 * The roster page carried a season Record / Rank / Total Pts header and a
 * thirteen-row list, but nothing between them answered the only question a
 * manager has at 4pm on a game day: "is my lineup set for tonight?" Sleeper
 * answers it with D/OUT/BYE alerts, Yahoo with Start Active Players. Citrus
 * answers it with one row of arithmetic over data the rows already render.
 *
 * Pure: the page's `displayRoster` has already decided who has a game today
 * (`nextGame.isToday`, set only when a projection row exists for the date)
 * and what each starter is worth (`projectedPoints`). This module only adds
 * them up, so it can be tested without a render and cannot disagree with
 * the rows beneath it.
 */

export interface TodaySummaryInput {
  /** Players currently in starter slots, enriched for the selected date. */
  starters: HockeyPlayer[];
  /** Bench players, enriched for the selected date. */
  bench: HockeyPlayer[];
  /** IR players — only consulted for the locked count. */
  ir?: HockeyPlayer[];
  /** Total starter slots in this league's lineup (UTIL included). */
  starterSlots: number;
  /** Players whose games have started. Omit to skip the locked count. */
  lockedPlayerIds?: Set<string>;
}

export interface TodaySummary {
  /** Starters with a game on the selected date. */
  startersPlaying: number;
  /** Total starter slots — the denominator the manager reads against. */
  starterSlots: number;
  /** Starters WITHOUT a game — each one is a slot scoring nothing tonight. */
  idleStarters: number;
  /** Starter slots with nobody in them. */
  emptySlots: number;
  /** Bench players with a game — points sitting on the bench. */
  benchPlaying: number;
  /** Σ starters' projected points for the date. */
  projected: number;
  /** Rostered players whose games have started. */
  locked: number;
  /**
   * A bench player has a game AND a starter spot is wasted (empty or idle).
   * That is the one state where the strip turns amber and offers Auto
   * Lineup. It is a heuristic, not a proof — the bench player may not be
   * eligible for the idle slot — which is exactly why the fix on offer is
   * the optimizer rather than a specific move.
   */
  needsAttention: boolean;
}

/** `nextGame.isToday` is tri-state (true / false / undefined); only true counts. */
const playsToday = (p: HockeyPlayer): boolean => p.nextGame?.isToday === true;

export function computeTodaySummary({
  starters,
  bench,
  ir = [],
  starterSlots,
  lockedPlayerIds,
}: TodaySummaryInput): TodaySummary {
  const slots = Math.max(0, Math.floor(Number(starterSlots) || 0));
  const startersPlaying = starters.filter(playsToday).length;
  const idleStarters = starters.length - startersPlaying;
  const emptySlots = Math.max(0, slots - starters.length);
  const benchPlaying = bench.filter(playsToday).length;
  const projected = starters.reduce((sum, p) => sum + (Number(p.projectedPoints) || 0), 0);
  const locked = lockedPlayerIds
    ? [...starters, ...bench, ...ir].filter((p) => lockedPlayerIds.has(String(p.id))).length
    : 0;

  return {
    startersPlaying,
    starterSlots: slots,
    idleStarters,
    emptySlots,
    benchPlaying,
    projected,
    locked,
    needsAttention: benchPlaying > 0 && (emptySlots > 0 || idleStarters > 0),
  };
}

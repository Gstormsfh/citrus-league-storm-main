// T14 architect Entry 13 (2026-08-09) — DRAFT GUIDE COMPUTATION CORE.
//
// Pure functions for the post-twelve draft guide page. Build-ahead:
// UI is deferred; today we ship the math + tests so wiring the page
// later is a thin adapter.
//
// PROVIDED FUNCTIONS
//   (a) reweightProjections(projections, scoringSettings) → ranked list
//   (b) computeTiers(ranked, leagueSize, rosterShape) → tiers + cliffs
//   (c) scarcityByPosition(ranked, rosterShape) → per-position scarcity
//
// NON-GOALS (deliberate)
//   - No UI, no rendering.
//   - No data fetching. Callers pass raw rows in.
//   - No knowledge of specific NHL positions beyond what appears in
//     the input data (position discovery is data-driven).
//   - No opinion on category-league vs points-league math beyond
//     honoring the ScoringSettings shape from @citrus/shared.
//
// KI-042 DISCIPLINE
//   All player_id fields on the input types are typed `number`
//   (canonical numeric NHL-id). Uuid-domain rows (demo leagues)
//   MUST be filtered upstream — passing a uuid string to these
//   functions is a type error at the boundary. Ensures no
//   uuid rows leak into scarcity math where "same player_id
//   equality" is load-bearing.
//
// SETTINGS EDGE-CASE HANDLING
//   - Missing categories in ScoringSettings.skater / .goalie → skipped
//     (treated as 0 contribution).
//   - Zero-size guards: computeTiers with leagueSize=0 → returns []
//     ranked-list, no tiers. scarcityByPosition with empty rosterShape
//     → returns {} (per-position map is empty).
//   - Negative projection values allowed (net-negative players are
//     legitimate at bottom of pool).

import type { ScoringSettings } from './scoring';

// ── Input types ─────────────────────────────────────────────────────

/**
 * A raw player projection row. Per-category totals for the projection
 * period (season, ROS, weekly — the function doesn't care which; it
 * just multiplies category × scoring weight). Skater fields and
 * goalie fields co-exist in the shape; `isGoalie` disambiguates.
 */
export interface PlayerProjection {
  /** Canonical numeric NHL player id (KI-042 discipline). */
  playerId: number;
  /** Display name (opaque to math; useful for downstream UI). */
  playerName: string;
  /** Primary position (e.g., 'C', 'LW', 'RW', 'D', 'G'). */
  position: string;
  /** True for goalie projections; the goalie sub-object of scoring applies. */
  isGoalie: boolean;

  // Skater categories (null / undefined → treated as 0).
  goals?: number | null;
  assists?: number | null;
  power_play_points?: number | null;
  short_handed_points?: number | null;
  shots_on_goal?: number | null;
  blocks?: number | null;
  hits?: number | null;
  penalty_minutes?: number | null;

  // Goalie categories.
  wins?: number | null;
  shutouts?: number | null;
  saves?: number | null;
  goals_against?: number | null;
}

/**
 * Roster shape input for tier + scarcity math. Position → starter count.
 * Bench slots are not modeled here; use a positive integer per starter
 * slot (a league with 2 C starters passes `{ C: 2 }`).
 *
 * Example (Citrus default): { C: 2, LW: 2, RW: 2, D: 4, G: 2 }.
 */
export type RosterShape = Readonly<Record<string, number>>;

// ── Output types ────────────────────────────────────────────────────

export interface RankedPlayer {
  playerId: number;
  playerName: string;
  position: string;
  isGoalie: boolean;
  /** Sum of (category × scoring weight) for the input projection. */
  projectedPoints: number;
  /** 1-indexed overall rank (best = 1). */
  rank: number;
}

/**
 * A tier is a contiguous slice of the ranked list where projected
 * points cluster before the next "cliff" (large gap to next player).
 * `cliffMagnitude` is the drop-off from the LAST player in this tier
 * to the FIRST player in the next; useful for UI cliff markers.
 */
export interface Tier {
  /** 1-indexed tier number. Tier 1 is the top group. */
  tier: number;
  /** Rank range covered by this tier (inclusive on both ends). */
  startRank: number;
  endRank: number;
  /** Players in this tier, in rank order. */
  players: RankedPlayer[];
  /**
   * Point drop-off between this tier's last player and the next
   * tier's first player. Null for the final tier.
   */
  cliffMagnitude: number | null;
}

export interface PositionScarcity {
  position: string;
  /** How many starters at this position across the league. */
  demand: number;
  /** How many "startable" players exist at this position (see below). */
  supply: number;
  /**
   * Scarcity score: supply / demand. <1.0 = more starters than
   * players (severe scarcity); ~1.0 = balanced; >1.0 = surplus.
   */
  ratio: number;
}

// ── (a) reweightProjections ─────────────────────────────────────────

/** Coerce a `number | null | undefined` to a numeric value (0 default). */
function n(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Reweight a batch of projections by a league's scoring settings.
 *
 * SKATER contributions are summed as:
 *   goals × w.goals + assists × w.assists + PPP × w.power_play_points +
 *   SHP × w.short_handed_points + SOG × w.shots_on_goal +
 *   blocks × w.blocks + hits × w.hits + PIM × w.penalty_minutes
 *
 * GOALIE contributions:
 *   W × w.wins + SO × w.shutouts + SV × w.saves + GA × w.goals_against
 *   (goals_against weight is expected NEGATIVE by convention.)
 *
 * Ranking: sorted by projectedPoints DESC. Ties broken by playerId
 * ASC for stable ordering under the same inputs.
 *
 * MISSING SCORING CATEGORIES: a scoringSettings sub-object that
 * omits a category treats that category as 0-weighted. This lets
 * partial scoring settings (e.g., points-only league that never
 * awards blocks) render honestly without a required-field burden.
 */
export function reweightProjections(
  projections: readonly PlayerProjection[],
  scoringSettings: ScoringSettings,
): RankedPlayer[] {
  const s = scoringSettings.skater ?? ({} as ScoringSettings['skater']);
  const g = scoringSettings.goalie ?? ({} as ScoringSettings['goalie']);

  const scored: Array<Omit<RankedPlayer, 'rank'>> = projections.map((p) => {
    const projectedPoints = p.isGoalie
      ? n(p.wins) * n(g.wins) +
        n(p.shutouts) * n(g.shutouts) +
        n(p.saves) * n(g.saves) +
        n(p.goals_against) * n(g.goals_against)
      : n(p.goals) * n(s.goals) +
        n(p.assists) * n(s.assists) +
        n(p.power_play_points) * n(s.power_play_points) +
        n(p.short_handed_points) * n(s.short_handed_points) +
        n(p.shots_on_goal) * n(s.shots_on_goal) +
        n(p.blocks) * n(s.blocks) +
        n(p.hits) * n(s.hits) +
        n(p.penalty_minutes) * n(s.penalty_minutes);
    return {
      playerId: p.playerId,
      playerName: p.playerName,
      position: p.position,
      isGoalie: p.isGoalie,
      projectedPoints,
    };
  });

  scored.sort((a, b) => {
    if (b.projectedPoints !== a.projectedPoints) return b.projectedPoints - a.projectedPoints;
    return a.playerId - b.playerId;
  });

  return scored.map((p, i) => ({ ...p, rank: i + 1 }));
}

// ── (b) computeTiers ────────────────────────────────────────────────

/**
 * Total demand across a roster shape (sum of all position counts).
 */
function totalDemand(shape: RosterShape): number {
  let sum = 0;
  for (const k of Object.keys(shape)) sum += shape[k] ?? 0;
  return sum;
}

/**
 * Group a ranked list into tiers by finding cliff-magnitude gaps.
 *
 * ALGORITHM
 *   1. Consider only the top `leagueSize × totalDemand(rosterShape)`
 *      players — the "startable pool". Cliffs below that don't matter.
 *      Zero-size guard: leagueSize=0 OR empty rosterShape → return [].
 *   2. Compute pairwise gaps: gap[i] = points[i] - points[i+1].
 *   3. Cliffs are the top-K largest gaps where
 *      K = ceil(startablePool / 12). This heuristic yields roughly
 *      1 cliff per 12 players — comparable to Yahoo/ESPN "tier"
 *      pacing. K is capped at (startablePool - 1) to avoid empty
 *      tiers.
 *   4. Cliff positions carve the pool into contiguous tiers.
 *
 * The final "tier" reported has cliffMagnitude=null (there's no
 * next tier to compare to).
 */
export function computeTiers(
  ranked: readonly RankedPlayer[],
  leagueSize: number,
  rosterShape: RosterShape,
): Tier[] {
  const perTeamDemand = totalDemand(rosterShape);
  const poolSize = Math.min(ranked.length, leagueSize * perTeamDemand);
  if (poolSize <= 0) return [];
  const pool = ranked.slice(0, poolSize);
  if (pool.length === 1) {
    return [
      { tier: 1, startRank: 1, endRank: 1, players: [pool[0]], cliffMagnitude: null },
    ];
  }

  // Pairwise gaps between consecutive ranks.
  interface Gap { atIndex: number; magnitude: number; }
  const gaps: Gap[] = [];
  for (let i = 0; i < pool.length - 1; i++) {
    gaps.push({ atIndex: i, magnitude: pool[i].projectedPoints - pool[i + 1].projectedPoints });
  }

  // K cliffs: 1 per 12 players, capped at (pool - 1) to prevent
  // singleton empty-tail cases.
  const rawK = Math.ceil(pool.length / 12);
  const K = Math.max(0, Math.min(rawK, pool.length - 1));

  // Pick the K largest-magnitude gaps by copy-and-sort. Ties broken
  // by earlier atIndex (top-of-list cliffs win — matches human
  // intuition of "biggest early drops are the real tier boundaries").
  const cliffIndices = [...gaps]
    .sort((a, b) => (b.magnitude !== a.magnitude ? b.magnitude - a.magnitude : a.atIndex - b.atIndex))
    .slice(0, K)
    .map((g) => g.atIndex)
    .sort((a, b) => a - b);

  // Convert cliff positions to tier boundaries.
  const tiers: Tier[] = [];
  let startRank = 1;
  let tierNumber = 1;
  const cliffIndexSet = new Set(cliffIndices);
  for (let i = 0; i < pool.length; i++) {
    const isLast = i === pool.length - 1;
    const isCliff = cliffIndexSet.has(i);
    if (isCliff || isLast) {
      const endRank = i + 1;
      const players = pool.slice(startRank - 1, endRank);
      tiers.push({
        tier: tierNumber,
        startRank,
        endRank,
        players,
        cliffMagnitude: isCliff && !isLast ? pool[i].projectedPoints - pool[i + 1].projectedPoints : null,
      });
      tierNumber += 1;
      startRank = endRank + 1;
    }
  }
  return tiers;
}

// ── (c) scarcityByPosition ──────────────────────────────────────────

/**
 * Per-position scarcity report.
 *
 * DEMAND for a position = starters per team × leagueSize. Since
 * `leagueSize` isn't in the RosterShape (it's per-team), this
 * function accepts the roster shape only and reports per-team-normalized
 * demand. Callers multiply by leagueSize downstream if they want
 * league-wide demand.
 *
 * SUPPLY at a position = count of ranked players whose `position`
 * matches. This is a raw count — no attempt to trim to "starter-
 * quality" (that's a downstream policy call).
 *
 * RATIO = supply / demand. Special cases:
 *   - demand=0 → ratio=Infinity (not a scarcity concern).
 *   - supply=0 → ratio=0 (extreme scarcity).
 *
 * NOTE: multi-position eligibility (a player who is both LW and RW)
 * is NOT modeled. The function uses `position` field verbatim as the
 * primary position. Multi-eligibility is a downstream concern.
 */
export function scarcityByPosition(
  ranked: readonly RankedPlayer[],
  rosterShape: RosterShape,
): PositionScarcity[] {
  const out: PositionScarcity[] = [];
  for (const position of Object.keys(rosterShape)) {
    const demand = rosterShape[position] ?? 0;
    let supply = 0;
    for (const p of ranked) {
      if (p.position === position) supply++;
    }
    const ratio = demand === 0 ? Infinity : supply / demand;
    out.push({ position, demand, supply, ratio });
  }
  // Sort by ratio ASC (most scarce first). Ties broken by position
  // alpha for stable ordering.
  out.sort((a, b) => {
    if (a.ratio !== b.ratio) return a.ratio - b.ratio;
    return a.position.localeCompare(b.position);
  });
  return out;
}

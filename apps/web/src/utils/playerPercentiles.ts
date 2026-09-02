/**
 * PERCENTILE MATH FOR PLAYER METRICS, WITH COHORTS THAT DO NOT LIE.
 *
 * A pure module — no React, no components — for the reason
 * `components/roster/positionChip.ts` and `components/phoneRowScale.ts` give:
 * a file that exports both a component and plain values breaks react-refresh,
 * so editing the card during dev would force a full reload instead of a hot
 * swap. It also puts the arithmetic somewhere a test can reach without a DOM.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY COHORTS, AND WHICH ONES
 *
 * A percentile is a claim about a comparison set. Get the set wrong and the
 * number is worse than no number, because it looks authoritative.
 *
 * SKATERS AND GOALIES ARE NEVER POOLED. This one is not a judgement call:
 * `/api/players/dashboard-index` carries no `xg_per_60`, no `gar_per_60` and
 * no GAR components for goalies at all (PlayerDashboardService joins
 * `player_gar_components` and `player_talent_metrics`, neither of which has
 * goalie rows), so a goalie placed on a skater scale is not merely unfair —
 * it is a null being ranked against 900 real numbers. Goalies get their own
 * cohort and their own metrics.
 *
 * FORWARDS AND DEFENCEMEN ARE ALSO NEVER POOLED, for a softer but real
 * reason. A defenceman takes a small share of his team's shots and almost
 * none of them from the slot, so his xG/60 sits structurally below a
 * forward's; GAR/60 is the same story from the other end, since a
 * defenceman's value concentrates in `evd` (even-strength defence) where a
 * forward's concentrates in `evo`. Pool them and essentially every
 * defenceman lands in the bottom quartile of a "league" percentile — which
 * tells a manager nothing, because the comparison he is actually making is
 * against the other defencemen competing for his D slot. Roster construction
 * decides the cohort: fantasy rosters have D slots, so D is a cohort.
 *
 * FORWARDS ARE **NOT** SPLIT C / LW / RW. Two reasons, both practical.
 * Dual-position eligibility (`eligible_positions`, max 2) crosses centre and
 * wing constantly, so the split would not be stable per player; and three
 * cohorts of roughly 200 qualified skaters each have noisy tails, where one
 * pooled forward cohort of ~600 does not. F is the honest granularity for
 * what this payload can support.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A MINIMUM SAMPLE, AND WHY 10 GAMES
 *
 * A 2-GP call-up must not set the floor or the ceiling of a distribution.
 * Per-60 rates are ratios with a small denominator: on 12 minutes of ice a
 * single scoring chance writes an xG/60 that would top the league, and every
 * other player's percentile is then measured against a number that describes
 * one shift.
 *
 * So the DISTRIBUTION is built from players with at least
 * `DISTRIBUTION_MIN_GP` games. A player below it is still PLACED against
 * that distribution — he just does not help define it — and comes back
 * flagged (`lowSample`) so the UI can say so.
 *
 * 10, and not the 20 that `citrus2/PercentileBullet` uses for its own LOW
 * SAMPLE flag, because the two thresholds have different jobs:
 *
 *   * 20 GP answers "should I trust THIS player's number?" — a per-player
 *     warning, and PercentileBullet already renders it.
 *   * 10 GP answers "is this player steady enough to help define the SCALE?"
 *     A scale needs members more than it needs certainty about each one, and
 *     at 20 the qualified cohort is empty through October and thin through
 *     November — every card in the first six weeks of a season would read
 *     "no data", which is a worse lie than a slightly noisy scale.
 *
 * At ~17 minutes a night, 10 games is ~170 minutes of ice: enough that no
 * single game can double a per-60 rate. Both numbers are pinned in
 * `__tests__/playerPercentiles.test.ts`.
 *
 * KNOWN LIMITATION, stated rather than hidden: the right denominator for a
 * rate stat is time on ice, not games. `PlayerDashboardService` already
 * SELECTS `toi_total_minutes` from `player_gar_components` but does not put
 * it on `DashboardIndexEntry`, so GP is the only sample field this payload
 * exposes. Surfacing TOI is a one-line server change and is the correct
 * follow-up; it is deliberately not made on this branch.
 */

/**
 * The three comparison sets. Deliberately coarse — see the header for why
 * forwards are not split three ways.
 */
export type PlayerCohort = 'F' | 'D' | 'G';

/**
 * Which end of a distribution is good. `gaa` is the reason this exists: a
 * 2.10 goals-against average is an elite number and a naive "fraction of the
 * league at or below you" would rank it near the floor.
 */
export type MetricDirection = 'higher' | 'lower';

/** Games below which a player is placed but does not define the scale. */
export const DISTRIBUTION_MIN_GP = 10;

/** The minimum a row needs for this module to cohort it. */
export interface CohortSubject {
  position: string;
  is_goalie: boolean;
  gp: number;
}

/** A metric's qualified values within one cohort, sorted ascending. */
export interface MetricScale {
  /** Ascending, finite, qualified-only. Empty when nothing qualified. */
  values: readonly number[];
  direction: MetricDirection;
}

export interface PercentileResult {
  /**
   * 0–100, rounded, or null when the value is missing/non-finite or the
   * cohort is empty. Null is a first-class answer here: "we do not know"
   * renders as "No data" in PercentileBullet, which is the truth.
   */
  percentile: number | null;
  /** How many players actually set this scale. Surface it, don't hide it. */
  cohortSize: number;
  /** This player's own sample was too small to join the distribution. */
  lowSample: boolean;
}

const EMPTY_SCALE: MetricScale = { values: [], direction: 'higher' };

/**
 * Position string → cohort.
 *
 * `is_goalie` wins over `position` because the payload sets it explicitly
 * (`position_code === 'G'` server-side) and a directory row can carry a
 * stale or blank position_code. Anything that is not a goalie and not a
 * defenceman is a forward: C / LW / RW / L / R / F / W all land in F, and so
 * does an unrecognised string, because a skater with a garbled position is
 * far more likely to be a forward (there are roughly twice as many) than to
 * deserve its own cohort of one.
 */
export function playerCohort(p: Pick<CohortSubject, 'position' | 'is_goalie'>): PlayerCohort {
  if (p.is_goalie) return 'G';
  const raw = (p.position ?? '').trim().toUpperCase();
  if (raw === 'G' || raw === 'GOALIE' || raw === 'GOALTENDER') return 'G';
  if (raw === 'D' || raw === 'DEFENCE' || raw === 'DEFENSE' || raw === 'DEFENCEMAN' || raw === 'DEFENSEMAN') {
    return 'D';
  }
  return 'F';
}

/**
 * The rows that DEFINE a scale: right cohort, enough games.
 *
 * Filtering once and reusing the result for every metric is the difference
 * between one pass over ~2k rows and seven. The card builds seven scales.
 */
export function qualifiedCohort<T extends CohortSubject>(
  players: readonly T[],
  cohort: PlayerCohort,
  minGp: number = DISTRIBUTION_MIN_GP,
): T[] {
  const out: T[] = [];
  for (const p of players) {
    if (!p) continue;
    if (playerCohort(p) !== cohort) continue;
    if (!Number.isFinite(p.gp) || p.gp < minGp) continue;
    out.push(p);
  }
  return out;
}

/**
 * Qualified members + a value selector → a sorted scale.
 *
 * Non-finite values (null, undefined, NaN, Infinity) are dropped rather than
 * coerced to 0. A missing GAR row is not a GAR of zero, and treating it as
 * one would drag every real number's percentile up.
 */
export function scaleFrom<T>(
  members: readonly T[],
  select: (p: T) => number | null | undefined,
  direction: MetricDirection = 'higher',
): MetricScale {
  const values: number[] = [];
  for (const m of members) {
    const v = select(m);
    if (typeof v === 'number' && Number.isFinite(v)) values.push(v);
  }
  values.sort((a, b) => a - b);
  return { values, direction };
}

/** `qualifiedCohort` + `scaleFrom` in one call, for a single-metric caller. */
export function buildMetricScale<T extends CohortSubject>(
  players: readonly T[],
  cohort: PlayerCohort,
  select: (p: T) => number | null | undefined,
  direction: MetricDirection = 'higher',
  minGp: number = DISTRIBUTION_MIN_GP,
): MetricScale {
  return scaleFrom(qualifiedCohort(players, cohort, minGp), select, direction);
}

/** First index whose value is > `x`. Binary search on an ascending array. */
function upperBound(values: readonly number[], x: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose value is >= `x`. Binary search on an ascending array. */
function lowerBound(values: readonly number[], x: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Where `value` sits on `scale`, 0–100.
 *
 * DEFINITION: the inclusive CDF — the share of the distribution at or below
 * you (at or above, for a `lower`-is-better metric). This is deliberately
 * the SAME definition `pages/Players.tsx` has always used for its dashboard
 * panel, so the panel and the card can never print two different percentiles
 * for the same player and the same metric. Consequences worth knowing:
 *
 *   * the best value in a cohort is always the 100th percentile;
 *   * TIES SHARE A PERCENTILE, and it is the ties' HIGHEST position — four
 *     players on 0.0 in a cohort of ten all read 40th, not 10th/20th/30th/
 *     40th. That is the correct read of "at or below me" and it keeps the
 *     card from splitting identical numbers into a false ranking;
 *   * a cohort of one places its only member at 100th. Not wrong — he is the
 *     best of everyone we measured — but `cohortSize` is returned alongside
 *     precisely so a caller can decline to show it.
 */
export function percentileOnScale(
  scale: MetricScale,
  value: number | null | undefined,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = scale.values.length;
  if (n === 0) return null;
  const atOrBeyond =
    scale.direction === 'lower'
      ? n - lowerBound(scale.values, value) // count of values >= value
      : upperBound(scale.values, value); // count of values <= value
  return Math.round((100 * atOrBeyond) / n);
}

/**
 * `percentileOnScale` plus the two facts a UI needs to caveat it: how big
 * the comparison set was, and whether this player's own sample was thin.
 *
 * `gp` is optional so a caller placing a value that is not a player (a test,
 * a league average) can omit it; when omitted the player is never flagged.
 */
export function placeOnScale(
  scale: MetricScale,
  value: number | null | undefined,
  gp?: number | null,
  minGp: number = DISTRIBUTION_MIN_GP,
): PercentileResult {
  return {
    percentile: percentileOnScale(scale, value),
    cohortSize: scale.values.length,
    lowSample: typeof gp === 'number' && Number.isFinite(gp) ? gp < minGp : false,
  };
}

/** An always-empty scale, for the "endpoint returned nothing" path. */
export function emptyScale(direction: MetricDirection = 'higher'): MetricScale {
  return direction === 'higher' ? EMPTY_SCALE : { values: [], direction };
}

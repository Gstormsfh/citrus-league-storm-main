/**
 * winProbability — a calibrated "Win chance" for a head-to-head points matchup.
 *
 * WHY THIS EXISTS (2026-09-01, Sleeper parity audit M1). The ScoreCard used
 * to print `my / (my + opp)`: the SHARE of the points scored so far, not a
 * probability. On Monday morning a 10.5–3.2 lead read "77%" — the exact
 * "too-early certain victory" Sleeper publicly rebuilt their bar to avoid.
 *
 * THE MODEL. Each side's final score is what it has already banked plus what
 * its starters are still expected to score:
 *
 *     E[final] = points so far + Σ (fraction of game left × projected points)
 *
 * The margin between two sums of many small, roughly independent game scores
 * is close to normal (CLT), so
 *
 *     p(my side wins) = Φ( (E[my final] − E[opp final]) / σ_margin )
 *     σ_margin²       = Σ fraction_i × σ_i²   over every starter-game still to
 *                       be played on BOTH sides
 *
 * σ_i is the projection model's per-game `projection_std_dev` when it is
 * present (the Monte Carlo layer's SD of a player's single-game fantasy
 * points), else DEFAULT_GAME_SD. A live game contributes only the fraction
 * of its expectation and variance that is still unplayed.
 *
 * The result is clamped to [0.02, 0.98] while anything is left to play, so
 * the bar never claims certainty mid-week. Once nothing is left (σ = 0) the
 * matchup is decided and the true 100% / 0% / 50% is returned instead.
 *
 * Everything in this file is pure: dates and "now" are inputs, never read
 * from the clock, so every branch is unit-testable.
 */

/**
 * Standard deviation of one starter-game's fantasy points when the model
 * supplies none. Derived from the default scoring (G 6 / A 4 / PPP 2 /
 * SOG 0.9 / BLK 1 / W 5 / SV 0.6 / GA −3) with Poisson-ish per-game counts:
 *
 *   top-six forward  goals λ≈0.30 → 36·0.30 = 10.8   assists λ≈0.50 → 16·0.50 = 8.0
 *                    SOG var≈2.0 → 0.81·2.0 = 1.6    blocks ≈ 0.8, PPP ≈ 0.8
 *                    ⇒ var ≈ 22, SD ≈ 4.7
 *   defenceman       goals 3.6 + assists 6.4 + SOG 1.5 + blocks 1.6 + PPP 0.6
 *                    ⇒ var ≈ 14, SD ≈ 3.7
 *   goalie start     W 25·0.25 = 6.3   saves 0.36·25 = 9.0   GA 9·2.8 = 25
 *                    SO 25·0.07 = 1.6  ⇒ var ≈ 42, SD ≈ 6.5
 *
 * A default lineup is 6 F + 4 D + 2 G, so the mean variance per starter-game
 * is (6·22 + 4·14 + 2·42) / 12 ≈ 22 → SD ≈ 4.6. Rounded to 4.5. Over a full
 * 7-day week of ~50 starter-games that spreads one side's total by
 * ±32 points (√50 × 4.5) — wide enough that a one-goal lead on Monday reads
 * as a coin flip, which is the calibration Sleeper's rebuild aimed for.
 */
export const DEFAULT_GAME_SD = 4.5;

/**
 * Floor for a model-supplied per-game SD. The pipeline's fallback path writes
 * `std_dev = points × 0.3`, which for a 3-point projection is 0.9 — less
 * than a single assist is worth. Nothing that can swing 4–6 points on one
 * play has a per-game SD under 2.
 */
export const MIN_GAME_SD = 2;

/** Mid-week clamp: the bar never reads "certain" while games remain. */
export const WIN_PROB_FLOOR = 0.02;
export const WIN_PROB_CEIL = 0.98;

/** Wall-clock length of an NHL game, for the no-schedule fallback. */
const GAME_DURATION_MS = 2.5 * 60 * 60 * 1000;

/** One starter-game still to be played (wholly or in part). */
export interface RemainingGame {
  /** Full-game projected fantasy points for this starter. */
  projected: number;
  /** Per-game standard deviation from the projection model, when known. */
  stdDev?: number;
  /** Share of the game still unplayed: 1 = not started, 0 = final. Default 1. */
  fractionRemaining?: number;
}

/** One side of the matchup: what it has banked plus what is still to come. */
export interface TeamOutlook {
  /** Fantasy points scored so far this week. */
  points: number;
  /** Every starter-game still to be played, from `collectRemainingGames`. */
  remaining: ReadonlyArray<RemainingGame>;
}

export interface TeamProjection {
  /** Points so far + expected points still to come. */
  expectedFinal: number;
  /** Variance of the points still to come. */
  variance: number;
  /** Starter-games still to be played (a live game counts as one). */
  gamesLeft: number;
}

export interface WinProbabilityResult {
  /** p(my side wins), 0–1. Clamped to [0.02, 0.98] unless settled. */
  probability: number;
  myExpectedFinal: number;
  oppExpectedFinal: number;
  myGamesLeft: number;
  oppGamesLeft: number;
  /** Expected margin, positive = my side favoured. */
  margin: number;
  /** Standard deviation of the margin (0 when settled). */
  sigma: number;
  /** True when nothing is left to play on either side — the result is final. */
  settled: boolean;
}

const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, value));

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

/**
 * Standard normal CDF, Abramowitz & Stegun 26.2.17 (|error| < 7.5e-8).
 */
export function normalCdf(z: number): number {
  if (Number.isNaN(z)) return 0.5;
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  const x = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * x);
  const poly =
    t * (0.319381530 +
      t * (-0.356563782 +
        t * (1.781477937 +
          t * (-1.821255978 +
            t * 1.330274429))));
  const density = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const upper = 1 - density * poly;
  return z >= 0 ? upper : 1 - upper;
}

/** Sum a side's banked points with its remaining expectation and variance. */
export function projectTeam(points: number, remaining: ReadonlyArray<RemainingGame>): TeamProjection {
  let expectedFinal = toNumber(points);
  let variance = 0;
  let gamesLeft = 0;
  for (const game of remaining) {
    const fraction = clamp(game.fractionRemaining ?? 1, 0, 1);
    if (fraction <= 0) continue;
    const sd = Math.max(game.stdDev ?? DEFAULT_GAME_SD, MIN_GAME_SD);
    expectedFinal += fraction * toNumber(game.projected);
    variance += fraction * sd * sd;
    gamesLeft += 1;
  }
  return { expectedFinal, variance, gamesLeft };
}

export interface WinProbabilityFromTotalsInput {
  myExpectedFinal: number;
  oppExpectedFinal: number;
  myGamesLeft: number;
  oppGamesLeft: number;
  /**
   * Combined variance of everything still to be played on both sides. When
   * omitted it is rebuilt from the games-left counts at DEFAULT_GAME_SD.
   */
  variance?: number;
}

/**
 * Win probability from already-aggregated numbers — the entry point for a
 * caller that has expected finals and games-left counts but no per-game
 * detail (the ScoreCard's own fallback).
 */
export function winProbabilityFromTotals(input: WinProbabilityFromTotalsInput): {
  probability: number;
  margin: number;
  sigma: number;
  settled: boolean;
} {
  const myGamesLeft = Math.max(0, toNumber(input.myGamesLeft));
  const oppGamesLeft = Math.max(0, toNumber(input.oppGamesLeft));
  const margin = toNumber(input.myExpectedFinal) - toNumber(input.oppExpectedFinal);
  const variance = input.variance !== undefined
    ? Math.max(0, toNumber(input.variance))
    : (myGamesLeft + oppGamesLeft) * DEFAULT_GAME_SD * DEFAULT_GAME_SD;

  if (variance <= 0) {
    // Nothing left to play: the scoreboard is the answer.
    const probability = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
    return { probability, margin, sigma: 0, settled: true };
  }

  const sigma = Math.sqrt(variance);
  const probability = clamp(normalCdf(margin / sigma), WIN_PROB_FLOOR, WIN_PROB_CEIL);
  return { probability, margin, sigma, settled: false };
}

/**
 * Full computation from per-game detail on both sides.
 */
export function computeWinProbability(my: TeamOutlook, opp: TeamOutlook): WinProbabilityResult {
  const mine = projectTeam(my.points, my.remaining);
  const theirs = projectTeam(opp.points, opp.remaining);
  const { probability, margin, sigma, settled } = winProbabilityFromTotals({
    myExpectedFinal: mine.expectedFinal,
    oppExpectedFinal: theirs.expectedFinal,
    myGamesLeft: mine.gamesLeft,
    oppGamesLeft: theirs.gamesLeft,
    variance: mine.variance + theirs.variance,
  });
  return {
    probability,
    myExpectedFinal: mine.expectedFinal,
    oppExpectedFinal: theirs.expectedFinal,
    myGamesLeft: mine.gamesLeft,
    oppGamesLeft: theirs.gamesLeft,
    margin,
    sigma,
    settled,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Bridge from the matchup page's data shapes to RemainingGame[]
// ────────────────────────────────────────────────────────────────────────────

/** The slice of an `NHLGame` row this module reads. */
export interface GameLike {
  game_date?: string | null;
  /** 'scheduled' | 'live' | 'intermission' | 'crit' | 'final' | 'postponed' */
  status?: string | null;
  /** '1st' | '2nd' | '3rd' | 'OT' | 'SO' — written by scrape_live_nhl_stats.py */
  period?: string | null;
  /** 'mm:ss' left in the period, 'INT' between periods, null otherwise. */
  period_time?: string | null;
  home_score?: number | null;
  away_score?: number | null;
}

/** The slice of a `get_daily_projections` row this module reads. */
export interface ProjectionLike {
  total_projected_points?: number | string | null;
  projection_std_dev?: number | string | null;
  /** TIMESTAMPTZ of puck drop; used only when the schedule row is missing. */
  game_start_time?: string | null;
}

/** The slice of a `MatchupPlayer` this module reads. */
export interface StarterLike {
  id: number | string;
  games?: ReadonlyArray<GameLike | null | undefined> | null;
}

/** A day of the matchup week and who starts for one side that day. */
export interface StarterDay {
  /** YYYY-MM-DD */
  date: string;
  starters: ReadonlyArray<StarterLike>;
}

const gameDateOf = (game: GameLike): string => (game.game_date ?? '').split('T')[0];

const hasStarted = (game: GameLike): boolean => {
  const status = (game.status ?? '').toLowerCase();
  if (status === 'live' || status === 'intermission' || status === 'crit') return true;
  if ((game.home_score ?? 0) + (game.away_score ?? 0) > 0) return true;
  const period = game.period;
  return period !== null && period !== undefined && period !== '';
};

/**
 * Share of a game still unplayed, from its schedule row.
 *   not started → 1 · final/postponed → 0 · OT/SO → 0.05 ·
 *   in period p with mm:ss on the clock → ((3 − p)·20 + mm:ss) / 60 ·
 *   intermission after period p → (3 − p) / 3 · period known, clock unknown →
 *   mid-period · started but nothing parseable → 0.5
 */
export function gameFractionRemaining(game: GameLike): number {
  const status = (game.status ?? '').toLowerCase();
  if (status === 'final' || status === 'postponed') return 0;
  if (!hasStarted(game)) return 1;

  const period = (game.period ?? '').trim().toUpperCase();
  if (period.startsWith('OT') || period.startsWith('SO')) return 0.05;

  const periodNumber = parseInt(period, 10);
  if (!Number.isFinite(periodNumber) || periodNumber < 1) return 0.5;
  if (periodNumber > 3) return 0.05;

  const clock = (game.period_time ?? '').trim().toUpperCase();
  const fullPeriodsLeft = 3 - periodNumber;
  if (clock === 'INT') return clamp(fullPeriodsLeft / 3, 0, 1);

  const clockMatch = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (clockMatch) {
    const minutesLeft = parseInt(clockMatch[1], 10) + parseInt(clockMatch[2], 10) / 60;
    return clamp((fullPeriodsLeft * 20 + minutesLeft) / 60, 0, 1);
  }
  return clamp((fullPeriodsLeft + 0.5) / 3, 0, 1);
}

/** No schedule row: fall back to wall-clock time since the listed puck drop. */
function fractionFromStartTime(startTime: string | null | undefined, nowMs: number): number {
  if (!startTime) return 1;
  const startMs = Date.parse(startTime);
  if (!Number.isFinite(startMs)) return 1;
  if (nowMs < startMs) return 1;
  return clamp(1 - (nowMs - startMs) / GAME_DURATION_MS, 0, 1);
}

const stdDevOf = (projection: ProjectionLike | undefined): number | undefined => {
  if (!projection) return undefined;
  const raw = projection.projection_std_dev;
  if (raw === null || raw === undefined) return undefined;
  const sd = toNumber(raw);
  return sd > 0 ? sd : undefined;
};

/**
 * Walk each remaining day of the week and collect every starter-game that is
 * still (wholly or partly) unplayed, with its projection for that date.
 *
 * - Days before `todayStr` are banked and skipped.
 * - A starter's schedule row for the day decides how much of the game is
 *   left; a missing row falls back to the projection's `game_start_time`,
 *   and a day with neither a schedule row nor a projection is a day off.
 * - A scheduled game with no projection row still counts (for games-left and
 *   variance) but contributes 0 expected points — the nightly batch projects
 *   every remaining game, so this is a call-up or a data gap, not the norm.
 */
export function collectRemainingGames(
  days: ReadonlyArray<StarterDay>,
  projectionsByDate: ReadonlyMap<string, ReadonlyMap<number, ProjectionLike> | undefined>,
  todayStr: string,
  nowMs: number = Date.now(),
): RemainingGame[] {
  const out: RemainingGame[] = [];
  for (const day of days) {
    if (day.date < todayStr) continue;
    const dayProjections = projectionsByDate.get(day.date);
    for (const starter of day.starters) {
      const projection = dayProjections?.get(Number(starter.id));
      const game = (starter.games ?? []).find(
        (g): g is GameLike => !!g && gameDateOf(g) === day.date,
      );

      let fraction: number;
      if (game) {
        fraction = gameFractionRemaining(game);
      } else if (projection) {
        fraction = fractionFromStartTime(projection.game_start_time, nowMs);
      } else {
        continue;
      }
      if (fraction <= 0) continue;

      out.push({
        projected: toNumber(projection?.total_projected_points),
        stdDev: stdDevOf(projection),
        fractionRemaining: fraction,
      });
    }
  }
  return out;
}

/** YYYY-MM-DD strings from `start` to `end` inclusive (date-only, DST-safe). */
export function enumerateWeekDates(start: string, end: string, maxDays = 10): string[] {
  const dates: string[] = [];
  if (!start || !end) return dates;
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) return dates;
  while (cursor <= last && dates.length < maxDays) {
    dates.push(cursor.toISOString().split('T')[0]);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

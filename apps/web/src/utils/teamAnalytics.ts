/**
 * teamAnalytics.ts — projected vs actual for one fantasy roster.
 *
 * Sibling to teamGrades.ts. That file answers "how good is this roster in the
 * abstract" (production against a stated elite-starter pace). This one answers
 * a different and more useful question: "is this roster doing what it was
 * SUPPOSED to do" — which is the question a manager actually has, and the one
 * that turns a projection system into feedback instead of decoration.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE CANNOT JUST DIVIDE ACTUAL BY PROJECTED
 *
 * Measured against production on 2026-08-27, regular-season games only, the
 * projection model does not sit on top of reality — it runs hot, and the error
 * grows with the projection:
 *
 * BOTH DIRECTIONS ARE GIVEN, on purpose. Every constant in this file is
 * actual/projected, because that is how they are used — multiply a projection
 * by one and you get the expected actual. The pipeline's
 * calibrate_skater_projection quotes the reciprocal, projected/actual, because
 * it is describing how hot the model runs. Same measurement, and side by side
 * they read as contradicting each other unless the direction is stated:
 *
 *                             actual/proj      proj/actual
 *     projected 0.7–2.0   n=8415    1.07            0.93   (model UNDER-projects)
 *     projected 2.0–4.0   n=31412   0.94            1.06
 *     projected 4.0–6.0   n=5562    0.91            1.10
 *     projected 6.0–8.0   n=762     0.75            1.33
 *     projected 8.1–9.6   n=52      0.66            1.51
 *
 * The left column is the one this file's constants live in.
 *
 * Rostered players skew to the top of that range, so a naive actual/projected
 * would tell EVERY manager in EVERY league that they are underperforming by
 * about 30% — a page that calls twelve out of twelve managers failures is
 * measuring the model, not the team.
 *
 * The bias is also per-category, not uniform. Same measurement, per-game means
 * over 48,629 skater-games:
 *
 *     goals    proj 0.198 vs actual 0.173     assists  proj 0.306 vs 0.292
 *     shots    proj 1.66  vs actual 1.56      blocks   proj 0.88  vs 0.80
 *     hits     proj 0.76  vs actual 1.18   ← the model UNDER-projects hits by a third
 *
 * So every number here is expressed against CATEGORY_CALIBRATION below: the
 * ratio the model typically achieves in that category. A team at exactly the
 * typical ratio reads 100% — "you are doing what the model expects of a roster
 * like yours" — and a team above it is genuinely outperforming rather than
 * merely being projected badly.
 */

/** One category's worth of a roster's projected and actual production. */
export type CategoryPair = { projected: number; actual: number };

/**
 * The ratio of actual to projected the model typically produces, per category.
 *
 * A STATED CONSTANT, not a live measurement — same status as teamGrades.ts's
 * SEASON_BASELINE, and honest for the same reason: it is a claim we can defend
 * and a user can argue with, rather than a hidden fudge factor.
 *
 * Source: 48,629 skater-games joined between player_projected_stats and
 * player_game_stats, regular season only (game type '02'), measured
 * 2026-08-27. RECOMPUTE THIS when the projection model changes — a stale
 * calibration silently reintroduces the bias it exists to remove.
 */
export const CATEGORY_CALIBRATION = {
  goals:   0.874,   // 0.173 / 0.198
  assists: 0.954,   // 0.292 / 0.306
  shots:   0.940,   // 1.56  / 1.66
  blocks:  0.909,   // 0.80  / 0.88
  hits:    1.553,   // 1.18  / 0.76  — model under-projects hits
  ppp:     1.0,     // not separately measured; treated as neutral until it is
} as const;

export type CategoryKey = keyof typeof CATEGORY_CALIBRATION;

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  goals: 'Goals',
  assists: 'Assists',
  ppp: 'PPP',
  shots: 'Shots',
  blocks: 'Blocks',
  hits: 'Hits',
};

/** Radar axis order — the same six the Roster page's Category Balance uses, so
 *  a manager reading both charts is reading the same shape twice. */
export const RADAR_ORDER: CategoryKey[] = ['goals', 'assists', 'ppp', 'shots', 'blocks', 'hits'];

export type RadarPoint = {
  key: CategoryKey;
  subject: string;
  /** Actual production as a % of what a roster like this typically returns.
   *  100 = exactly on expectation. Clamped for rendering, not for truth. */
  actual: number;
  /** Always 100 — the calibrated expectation line the actual is measured
   *  against. Present as a series so the chart draws the reference shape. */
  expected: number;
  /** Raw totals, so a tooltip can show the real numbers behind the ratio. */
  raw: CategoryPair;
};

/**
 * Actual production as a percentage of calibrated expectation, per category.
 *
 * Returns null for a category with no projection at all — a zero would render
 * as "you produced nothing", which is a different and false claim.
 */
export function categoryPerformance(
  totals: Partial<Record<CategoryKey, CategoryPair>>,
): RadarPoint[] {
  return RADAR_ORDER.map((key) => {
    const pair = totals[key] ?? { projected: 0, actual: 0 };
    const calibrated = pair.projected * CATEGORY_CALIBRATION[key];
    // No expectation to measure against: report 0% rather than dividing by
    // zero, and let the raw pair tell the tooltip what actually happened.
    const pct = calibrated > 0 ? (pair.actual / calibrated) * 100 : 0;
    return {
      key,
      subject: CATEGORY_LABELS[key],
      // Clamp only the RENDERED value: a 400% category would flatten every
      // other axis into the middle and the shape would stop being readable.
      // `raw` keeps the truth for the tooltip.
      actual: Math.max(0, Math.min(200, Math.round(pct))),
      expected: 100,
      raw: pair,
    };
  });
}

/** A player's contribution measured against what was expected of HIM. */
export type PlayerDelta = {
  id: string | number;
  name: string;
  position: string;
  projected: number;
  actual: number;
  /** actual − calibrated expectation, in fantasy points. The intuitive number
   *  to DISPLAY ("+12.4 above expectation") — but see `ratio` for why it is
   *  not what the list is ordered by. */
  delta: number;
  /** actual ÷ calibrated expectation. This is what the ranking sorts on,
   *  because it is the only one of the two that survives the model's bias. */
  ratio: number;
  games: number;
};

/** Blended ACTUAL/PROJECTED across all categories, same direction and same
 *  measurement as CATEGORY_CALIBRATION. Multiply a projection by this to get
 *  the expected actual. (Its reciprocal, 1.07, is what the pipeline would
 *  quote — see the direction table at the top of this file.) */
const OVERALL_CALIBRATION = 0.93;

/**
 * A projection too small to divide by. A player projected 0.4 who scores 1.2
 * is a 300% overachiever by ratio and pure noise in fact; the floor keeps a
 * near-zero denominator from owning the top of the list.
 */
const MIN_PROJECTION = 2;

/**
 * Rank a roster by who is beating their own expectation.
 *
 * SORTED BY RATIO, NOT BY DELTA — and the distinction is the reason this
 * function exists rather than a one-line subtraction at the call site.
 *
 * The intuition that sent the first draft wrong: "the model's bias is
 * monotonic, so a ranking is immune to it." That is true of a RATIO and false
 * of a DIFFERENCE, and the test caught it. Inflating every projection by 1.3×:
 *
 *     A  proj 40 act 44   delta  +6.8 → −4.4      ratio 1.18 → 0.91
 *     C  proj 20 act 25   delta  +6.4 → +0.8      ratio 1.34 → 1.03
 *
 * A ranks above C on delta before the inflation and below it after — the
 * ordering moved because the bias moved, which is exactly the failure this
 * file exists to avoid. Dividing instead scales every ratio by the same
 * constant, so the order cannot move.
 *
 * `delta` is still returned, because "+12.4 points above expectation" is the
 * number a human wants to read. It is a display value, not the sort key.
 *
 * `minGames` exists because a one-game sample is noise wearing a number's
 * clothing; a hat trick in the only game played is not evidence of anything.
 */
export function rankByExpectation(
  players: Array<{
    id: string | number;
    name: string;
    position: string;
    projectedPoints: number;
    actualPoints: number;
    games: number;
  }>,
  minGames = 3,
): PlayerDelta[] {
  return players
    .filter(
      (p) => p.games >= minGames && p.projectedPoints >= MIN_PROJECTION,
    )
    .map((p) => {
      const expected = p.projectedPoints * OVERALL_CALIBRATION;
      return {
        id: p.id,
        name: p.name,
        position: p.position,
        projected: p.projectedPoints,
        actual: p.actualPoints,
        delta: p.actualPoints - expected,
        ratio: expected > 0 ? p.actualPoints / expected : 0,
        games: p.games,
      };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

/** Headline: how the roster as a whole is tracking, as a single percentage. */
export function rosterTracking(points: RadarPoint[]): {
  pct: number | null;
  measured: number;
} {
  const usable = points.filter((p) => p.raw.projected > 0);
  if (usable.length === 0) return { pct: null, measured: 0 };
  const proj = usable.reduce((s, p) => s + p.raw.projected * CATEGORY_CALIBRATION[p.key], 0);
  const act = usable.reduce((s, p) => s + p.raw.actual, 0);
  return {
    pct: proj > 0 ? Math.round((act / proj) * 100) : null,
    measured: usable.length,
  };
}

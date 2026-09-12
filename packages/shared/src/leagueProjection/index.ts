/**
 * ONE PLAYER'S REST-OF-SEASON PROJECTION, SCORED UNDER ONE LEAGUE'S RULES.
 *
 * Moved out of `apps/web/src/components/draft/draftDecision.ts` and
 * `apps/web/src/components/player/projectionScoring.ts` on 2026-09-11,
 * unchanged, because the API server now needs the same answer: the player
 * writeup's projection sentence is rendered server-side and has to agree
 * with the number the card prints two inches above it.
 *
 * There are 16 distinct scoring shapes across the 68 leagues in production.
 * A projection scored under the wrong one is not a rounding error, it is a
 * different player, so the weights always come from the league and never
 * from a default the caller forgot to pass.
 *
 * The web homes re-export from here so the draft room and the modal keep
 * their import paths.
 */
import { DEFAULT_SCORING, ScoringCalculator, type ScoringSettings } from '../utils/scoring';
import type { DashboardIndexEntry } from '../types/playerDashboard';

/** What one player is projected to be worth to THIS league, rest of season. */
export interface DraftProjection {
  /** Rest-of-season fantasy points under the league's own scoring. */
  total: number;
  /** The same, per remaining game. The number that survives a bye week. */
  perGp: number;
  /** Games the projection covers. Printed as the caveat on the total. */
  gamesRemaining: number;
}

/**
 * A league's stored weights, normalised to the full category vocabulary.
 *
 * MISSING CATEGORIES IN A CONFIGURED LEAGUE ARE DISABLED, NEVER
 * DEFAULT-WEIGHTED. A league that has written its own scoring document and
 * left `hits` out of it does not score hits; falling back to the default
 * weight for the absent key would hand every banger fifty points the league
 * does not award. Only a league with NO document at all gets the defaults.
 */
export function projectionSettings(raw: unknown): ScoringSettings {
  if (raw == null) return DEFAULT_SCORING;
  const source = raw as Record<string, Record<string, unknown>>;
  return Object.fromEntries(
    Object.entries(DEFAULT_SCORING).map(([group, defaults]) => [
      group,
      Object.fromEntries(
        Object.keys(defaults).map((stat) => {
          const value = source[group]?.[stat];
          return [stat, typeof value === 'number' && Number.isFinite(value) ? value : 0];
        }),
      ),
    ]),
  ) as unknown as ScoringSettings;
}

/**
 * Fallback for older index payloads without projected goals against.
 * Uses the goalie's own saves and save percentage; missing inputs yield null.
 */
export function projectedGoalsAgainst(
  projSaves: number | null | undefined,
  savePct: number | null | undefined,
): number | null {
  if (typeof projSaves !== 'number' || !Number.isFinite(projSaves) || projSaves < 0) return null;
  const rate = normalizeSavePctValue(savePct);
  if (rate === null) return null;
  return projSaves / rate - projSaves;
}

/**
 * The save-percentage column arrives as a fraction (0.918) or as per-mille
 * (918), and both shapes are in production.
 *
 * `<= 1` rather than `< 1`: a rate of exactly 1.000 is a real value (a
 * goalie with a small sample and no goals against), and treating it as
 * per-mille turns it into 0.001 — which, fed through the goals-against
 * derivation, projected 899,100 goals against. Caught by
 * `draftDecision.test.ts`, not by any screenshot.
 */
export function normalizeSavePctValue(v: number | null | undefined): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  const rate = v <= 1 ? v : v / 1000;
  return rate > 0 && rate <= 1 ? rate : null;
}

/**
 * Score the raw projected categories under the supplied league settings.
 * Skaters include goals, assists, PPP, SHP, SOG, blocks, hits and PIM.
 * Goalies use projected wins, saves, shutouts and goals against, with a
 * historical-rate fallback only for older responses missing the GA field.
 * Plus/minus has no projection. Missing projection rows return null.
 */
/**
 * The `projected_*` vocabulary of `player_projected_stats` and
 * `player_ros_projections`, in either table's spelling.
 */
export interface ProjectedStatRow {
  is_goalie?: boolean | null;
  /**
   * The stored total, baked with DEFAULT scoring. Present on both tables and
   * carried here only as the fallback for a row with no components; no league
   * surface reads it on its own.
   */
  total_projected_points?: number | string | null;
  projected_goals?: number | string | null;
  projected_assists?: number | string | null;
  projected_ppp?: number | string | null;
  projected_shp?: number | string | null;
  projected_sog?: number | string | null;
  projected_blocks?: number | string | null;
  projected_hits?: number | string | null;
  projected_pim?: number | string | null;
  projected_wins?: number | string | null;
  projected_saves?: number | string | null;
  projected_shutouts?: number | string | null;
  projected_goals_against?: number | string | null;
  /** player_ros_projections spells the goalie columns with a _ros suffix. */
  projected_wins_ros?: number | string | null;
  projected_saves_ros?: number | string | null;
  projected_shutouts_ros?: number | string | null;
  projected_ga_ros?: number | string | null;
}

const projectedNumber = (value: unknown): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/**
 * ONE PROJECTION ROW, SCORED UNDER ONE LEAGUE'S RULES.
 *
 * `total_projected_points` on both projection tables is baked with DEFAULT
 * scoring - routes/players.ts:184 says so in as many words - so a surface
 * that reads it puts the projection on a different scale than the actual
 * points printed beside it. In a league that scores hits, or zeroes blocks,
 * or pays 6 for a goal, that is not a rounding error. Sixteen distinct
 * scoring shapes are in production.
 *
 * The component columns are on the row and fully populated, so the honest
 * number is a rescore, not a lookup. This is the same calculation
 * projectionFor does for a draft board, against the other table's column
 * names.
 */
const anyPresent = (...values: Array<number | string | null | undefined>): boolean =>
  values.some((v) => v !== null && v !== undefined && v !== '');

/**
 * The league-scored value of a row, or null when the row carries no component
 * stats to score from.
 *
 * Null rather than 0 (2026-09-12, caught by the suite): a backfilled or older
 * row that has only the stored total would otherwise rescore to zero and take
 * a player's projection off the screen entirely. A missing input is not a
 * measurement of nothing. Callers that need a number use projectedPointsFor,
 * which falls back to the stored total.
 */
export function scoreProjectedStats(
  row: ProjectedStatRow | null | undefined,
  scorer: ScoringCalculator,
): number | null {
  if (!row) return null;

  if (row.is_goalie === true) {
    if (
      !anyPresent(
        row.projected_wins ?? row.projected_wins_ros,
        row.projected_saves ?? row.projected_saves_ros,
        row.projected_shutouts ?? row.projected_shutouts_ros,
        row.projected_goals_against ?? row.projected_ga_ros,
      )
    ) {
      return null;
    }
    return scorer.calculatePoints(
      {
        wins: projectedNumber(row.projected_wins ?? row.projected_wins_ros),
        saves: projectedNumber(row.projected_saves ?? row.projected_saves_ros),
        shutouts: projectedNumber(row.projected_shutouts ?? row.projected_shutouts_ros),
        goals_against: projectedNumber(row.projected_goals_against ?? row.projected_ga_ros),
      },
      true,
    );
  }

  if (
    !anyPresent(
      row.projected_goals,
      row.projected_assists,
      row.projected_ppp,
      row.projected_sog,
      row.projected_blocks,
      row.projected_hits,
      row.projected_pim,
      row.projected_shp,
    )
  ) {
    return null;
  }

  return scorer.calculatePoints(
    {
      goals: projectedNumber(row.projected_goals),
      assists: projectedNumber(row.projected_assists),
      ppp: projectedNumber(row.projected_ppp),
      sog: projectedNumber(row.projected_sog),
      blocks: projectedNumber(row.projected_blocks),
      hits: projectedNumber(row.projected_hits),
      pim: projectedNumber(row.projected_pim),
      shp: projectedNumber(row.projected_shp),
    },
    false,
  );
}

/**
 * What this row is worth to this league, as a number.
 *
 * The league-scored value where the components are there; the stored
 * default-scored total where they are not, because a row with no components
 * is a row we cannot rescore, not a player projected to score nothing.
 */
export function projectedPointsFor(
  row: ProjectedStatRow | null | undefined,
  scorer: ScoringCalculator,
): number {
  const scored = scoreProjectedStats(row, scorer);
  if (scored !== null) return scored;
  const stored = projectedNumber(row?.total_projected_points);
  return stored;
}

export function projectionFor(
  entry: DashboardIndexEntry | null | undefined,
  scorer: ScoringCalculator,
  settings?: ScoringSettings | null,
): DraftProjection | null {
  if (!entry) return null;
  const gamesRemaining = entry.proj_gp;
  if (typeof gamesRemaining !== 'number' || !Number.isFinite(gamesRemaining) || gamesRemaining < 0) {
    return null;
  }

  if (gamesRemaining === 0) {
    const counts = entry.is_goalie
      ? [entry.proj_wins, entry.proj_saves, entry.proj_shutouts, entry.proj_goals_against]
      : [entry.proj_goals, entry.proj_assists, entry.proj_sog, entry.proj_blocks];
    return counts.every(value => typeof value === 'number' && Number.isFinite(value) && value === 0)
      ? { total: 0, perGp: 0, gamesRemaining: 0 } : null;
  }

  if (entry.is_goalie) {
    /**
     * The EFFECTIVE weight, not the raw field. `ScoringCalculator` falls back
     * to `DEFAULT_SCORING` when it is handed null, and default scoring puts
     * goals against at -3 — so reading `settings?.goalie?.goals_against` and
     * treating undefined as "not scored" would skip the derivation for every
     * league on default settings, which is most of them, and inflate every
     * goalie by roughly forty per cent. That is the exact defect the
     * derivation exists to prevent.
     */
    const gaWeight = settings
      ? settings.goalie?.goals_against
      : DEFAULT_SCORING.goalie.goals_against;
    // Only pay for the derivation when the league actually scores goals
    // against. A league that zeroes it does not need the number and must not
    // lose a goalie's projection because his save percentage is missing.
    let goalsAgainst = 0;
    if (typeof gaWeight === 'number' && gaWeight !== 0) {
      const derived = entry.proj_goals_against != null && Number.isFinite(entry.proj_goals_against)
        ? entry.proj_goals_against
        : projectedGoalsAgainst(entry.proj_saves, entry.save_pct);
      if (derived === null) return null;
      goalsAgainst = derived;
    }
    const total = scorer.calculatePoints(
      {
        wins: entry.proj_wins ?? 0,
        saves: entry.proj_saves ?? 0,
        shutouts: entry.proj_shutouts ?? 0,
        goals_against: goalsAgainst,
      },
      true,
    );
    return { total, perGp: total / gamesRemaining, gamesRemaining };
  }

  const total = scorer.calculatePoints(
    {
      goals: entry.proj_goals ?? 0,
      assists: entry.proj_assists ?? 0,
      ppp: entry.proj_ppp ?? 0,
      sog: entry.proj_sog ?? 0,
      blocks: entry.proj_blocks ?? 0,
      hits: entry.proj_hits ?? 0,
      pim: entry.proj_pim ?? 0,
      shp: entry.proj_shp ?? 0,
    },
    false,
  );
  return { total, perGp: total / gamesRemaining, gamesRemaining };
}

/** Daily forecast counts with explicit goalie availability. Never mutates raw caches. */
export function expectedDailyProjection(
  row: Record<string, unknown> | null | undefined,
  scoring: unknown,
  isGoalie: boolean,
): (Record<string, unknown> & { total_projected_points: number; projected_gp: number }) | null {
  if (!row) return null;
  const keys = isGoalie
    ? ['projected_wins', 'projected_saves', 'projected_shutouts', 'projected_goals_against']
    : [];
  if (keys.some(key => row[key] == null || !Number.isFinite(Number(row[key])))) return null;
  let exposure = 1;
  let multiplier = 1;
  if (isGoalie) {
    const basis = row.projection_basis;
    if (basis !== 'conditional_on_start' && basis !== 'unconditional') return null;
    const raw = row.expected_starts ?? (basis === 'conditional_on_start' ? row.start_probability : row.projected_gp);
    exposure = raw == null ? NaN : Number(raw);
    if (!Number.isFinite(exposure) || exposure < 0 || exposure > 1) return null;
    multiplier = basis === 'conditional_on_start' ? exposure : 1;
  }
  const result: Record<string, unknown> = { ...row, is_goalie: isGoalie };
  for (const key of ['projected_goals', 'projected_assists', 'projected_sog', 'projected_blocks', 'projected_hits', 'projected_pim', 'projected_ppp', 'projected_shp', 'projected_wins', 'projected_saves', 'projected_shutouts', 'projected_goals_against']) {
    if (row[key] != null) result[key] = Number(row[key]) * multiplier;
  }
  // Conditional/default-scoring intervals are not expected custom-league
  // intervals. No covariance or start-mixture model is available to convert them.
  for (const key of ['projection_mean', 'projection_std_dev', 'projection_ci_lower', 'projection_ci_upper', 'projection_ci_50_lower', 'projection_ci_50_upper', 'projection_median', 'likely_low', 'likely_high']) delete result[key];
  const scorer = new ScoringCalculator(projectionSettings(scoring));
  const points = scoreProjectedStats(result as ProjectedStatRow, scorer);
  if (points == null || !Number.isFinite(points)) return null;
  return { ...result, projection_basis: 'unconditional', expected_starts: isGoalie ? exposure : null,
    projected_gp: exposure, starter_confirmed: false, total_projected_points: points };
}

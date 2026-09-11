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
export function projectionFor(
  entry: DashboardIndexEntry | null | undefined,
  scorer: ScoringCalculator,
  settings?: ScoringSettings | null,
): DraftProjection | null {
  if (!entry) return null;
  const gamesRemaining = entry.proj_gp;
  if (typeof gamesRemaining !== 'number' || !Number.isFinite(gamesRemaining) || gamesRemaining <= 0) {
    return null;
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

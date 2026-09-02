/**
 * Default fantasy scoring — the ONE source, typed.
 *
 * The numbers live in `./scoringDefaults.json` (next to this file) so that
 * `scripts/gen-scoring-defaults.mjs` can read them with nothing but
 * `JSON.parse` and emit the Python module and the docs table. This module
 * is the typed TypeScript view of that JSON: every TS home (the shared
 * `DEFAULT_SCORING`, the CreateLeague / league-settings stat rows, the
 * commissioner form, the server-side creation fallback, Stormy's prompt)
 * derives from `SCORING_DEFAULTS` and carries no weight literal of its own.
 * `apps/web/src/__tests__/industryStandardScoringGuard.test.ts` scans the
 * repo for restated copies and diffs the generated files against the JSON.
 *
 * To change a default: edit the JSON, run `npm run gen:scoring`, ship the
 * SQL migration for the DB homes (stat_catalog, the zero-UUID
 * league_scoring_rules rows, the leagues.scoring_settings column default,
 * the projection-rebuild RPCs — those still carry literals), update the
 * EXPECTED object in the guard test. That is the whole list.
 *
 * INDUSTRY-STANDARD DEFAULTS (2026-09-01). Aligned with Yahoo Fantasy
 * Hockey's default points scoring (help.yahoo.com/kb/SLN6815). The old
 * Citrus defaults (G3/A2/.../W4/SV0.2/GA-1) undervalued goals vs
 * peripherals and rewarded penalty minutes (+0.5/PIM — no major platform
 * does that). One documented deviation: Yahoo scores plus/minus at 2;
 * Citrus ships it at 0 because the projection engine cannot model
 * plus/minus (see `SCORING_DEFAULTS.provenance.deviations`).
 */
import scoringDefaultsJson from './scoringDefaults.json';

export type ScoringStatGroup = 'skater' | 'goalie';
export type ScoringStatCategory = 'Offense' | 'Defense' | 'Goalie';

export type SkaterScoringKey =
  | 'goals'
  | 'assists'
  | 'power_play_points'
  | 'short_handed_points'
  | 'shots_on_goal'
  | 'blocks'
  | 'hits'
  | 'penalty_minutes'
  | 'plus_minus';

export type GoalieScoringKey = 'wins' | 'shutouts' | 'saves' | 'goals_against';

export type ScoringStatKey = SkaterScoringKey | GoalieScoringKey;

/** The stats that ship disabled; commissioners opt in and get `suggested`. */
export type OptInScoringKey = 'short_handed_points' | 'hits' | 'penalty_minutes' | 'plus_minus';

/** One row of the catalog in `scoringDefaults.json`. */
export interface ScoringStatDefault {
  /** Canonical key in `leagues.scoring_settings` JSONB (`goals`, `shots_on_goal`, ...). */
  readonly key: ScoringStatKey;
  /** Short id the league-settings form uses (`g`, `sog`, `shg`, ...). */
  readonly id: string;
  /** Display name (`Power Play Points`). */
  readonly name: string;
  /** Box-score abbreviation (`PPP`, `+/-`, `GA`). */
  readonly abbr: string;
  readonly group: ScoringStatGroup;
  readonly category: ScoringStatCategory;
  /** Points per unit in a default league. Always 0 for opt-in stats. */
  readonly points: number;
  /** True when the stat ships disabled. */
  readonly optIn: boolean;
  /** Weight offered when a commissioner enables an opt-in stat; null otherwise. */
  readonly suggested: number | null;
  /** Per-game stat key in the Python pipeline vocabulary (`ppp`, `sog`, `pim`); null when the pipeline has no such stat. */
  readonly pipelineKey: string | null;
  /** Key in nightly_projection_batch's legacy vocabulary (`blocked_shots`, `powerplay_points`); null when absent there. */
  readonly legacyBatchKey: string | null;
}

export interface ScoringDefaultsProvenance {
  readonly standard: string;
  readonly sourceUrl: string;
  /** ISO date the defaults took effect. */
  readonly effectiveDate: string;
  readonly deviations: ReadonlyArray<{ readonly key: ScoringStatKey; readonly note: string }>;
  readonly optInRationale: string;
}

interface ScoringDefaultsSource {
  readonly provenance: ScoringDefaultsProvenance;
  readonly stats: ReadonlyArray<ScoringStatDefault>;
}

// The cast narrows the JSON's `string` keys to the unions above. A field of
// the wrong type fails `tsc` here; a missing field or an unknown key is
// caught by the generator's validation (`npm run gen:scoring`) and by the
// guard test, both of which run in CI.
const source: ScoringDefaultsSource = scoringDefaultsJson as ScoringDefaultsSource;

const weightsFor = <K extends ScoringStatKey>(group: ScoringStatGroup): Readonly<Record<K, number>> => {
  const out: Partial<Record<ScoringStatKey, number>> = {};
  for (const stat of source.stats) {
    if (stat.group === group) out[stat.key] = stat.points;
  }
  return out as Readonly<Record<K, number>>;
};

const suggestedFor = (): Readonly<Record<OptInScoringKey, number>> => {
  const out: Partial<Record<ScoringStatKey, number>> = {};
  for (const stat of source.stats) {
    if (stat.optIn) out[stat.key] = stat.suggested ?? 0;
  }
  return out as Readonly<Record<OptInScoringKey, number>>;
};

/**
 * The default scoring set, plus everything the homes need to derive
 * themselves from it: the full stat catalog (ids, names, categories),
 * the opt-in set with suggested weights, and provenance.
 */
export const SCORING_DEFAULTS = {
  /** Default points per unit for every skater stat (opt-in stats are 0). */
  skater: weightsFor<SkaterScoringKey>('skater'),
  /** Default points per unit for every goalie stat. */
  goalie: weightsFor<GoalieScoringKey>('goalie'),
  /** Opt-in stats → the weight a commissioner is offered on enabling one. */
  optIn: suggestedFor(),
  /** The catalog, in league-settings display order. */
  stats: source.stats,
  provenance: source.provenance,
} as const;

/** Shape of one row in `LeagueFormatSettings.stats` / the CreateLeague form. */
export interface LeagueStatSetting {
  id: string;
  name: string;
  points: number;
  default: boolean;
  category: string;
  enabled: boolean;
}

/**
 * Build the league-settings stat rows a new fantasy league starts from.
 * Enabled stats carry their default weight; opt-in stats ship disabled
 * (so `ptsFor()` writes 0 into `scoring_settings`) but carry the
 * suggested weight a commissioner gets on toggling them on.
 *
 * Returns fresh objects on every call — callers mutate these rows.
 */
export function defaultLeagueStats(): LeagueStatSetting[] {
  return SCORING_DEFAULTS.stats.map((stat) => ({
    id: stat.id,
    name: stat.name,
    points: stat.optIn ? (stat.suggested ?? 0) : stat.points,
    default: !stat.optIn,
    category: stat.category,
    enabled: !stat.optIn,
  }));
}

const formatWeight = (points: number): string =>
  points < 0 ? `−${Math.abs(points)}` : `${points}`;

/**
 * Two-line, prompt-ready description of the defaults, in the shape
 *
 *   **Skaters:** <abbr> <weight> | <abbr> <weight> | … (<opt-in abbrs> are opt-in, 0 by default)
 *   **Goalies:** <abbr> <weight> | …
 *
 * Negative weights use the typographic minus. Stormy's system prompt
 * splices this in at module load, so the prose can never drift from the
 * constant; the guard test pins the exact rendering.
 */
export function describeScoringDefaults(): string {
  const line = (group: ScoringStatGroup): string => {
    const stats = SCORING_DEFAULTS.stats.filter((s) => s.group === group);
    const enabled = stats
      .filter((s) => !s.optIn)
      .map((s) => `${s.abbr} ${formatWeight(s.points)}`)
      .join(' | ');
    const optIns = stats.filter((s) => s.optIn).map((s) => s.abbr);
    return optIns.length > 0 ? `${enabled} (${optIns.join('/')} are opt-in, 0 by default)` : enabled;
  };
  return `**Skaters:** ${line('skater')}\n**Goalies:** ${line('goalie')}`;
}

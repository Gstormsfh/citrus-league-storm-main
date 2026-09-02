import {
  DISTRIBUTION_MIN_GP,
  buildMetricScale,
  percentileOnScale,
  placeOnScale,
  playerCohort,
  qualifiedCohort,
  scaleFrom,
  type MetricDirection,
  type PercentileResult,
  type PlayerCohort,
} from '@/utils/playerPercentiles';
import type { DashboardIndexEntry } from '@/hooks/usePlayerDashboardIndex';
import type { PercentileCategory } from '@/components/citrus2/PercentileBullet';

/**
 * WHAT THE ADVANCED PLAYER CARD SAYS, AND WHY EACH NUMBER IS ALLOWED ON IT.
 *
 * A pure module — the house idiom (`roster/positionChip.ts`,
 * `phoneRowScale.ts`): a file that exports both a component and plain values
 * breaks react-refresh. It also means the verdict line, which is the one
 * piece of PROSE on the card, is unit-tested rather than eyeballed.
 *
 * EVERY FIELD BELOW WAS CHECKED AGAINST THE REAL PAYLOAD before it was used
 * — `DashboardIndexEntry` in `usePlayerDashboardIndex.ts`, which mirrors
 * `server/src/services/PlayerDashboardService.ts`. Anything the endpoint
 * does not carry is absent from this file rather than invented.
 *
 * WHAT WE DELIBERATELY DO NOT SHOW, and why (all are server changes, none of
 * which belong on a UI branch):
 *
 *   * GSAx for goalies. `goalie_gsax_primary` holds `raw_gsax` /
 *     `regressed_gsax` for 98 goalies in 2025 and it is the single best
 *     goalie metric we own — but `PlayerDashboardService` does not join that
 *     table, so it is not on `DashboardIndexEntry` and cannot be rendered
 *     honestly here. FOLLOW-UP: add the join + four columns server-side,
 *     then a GSAx bullet is a ten-line change to this file.
 *   * A career trend sparkline. `player_xg_season` carries nine seasons
 *     (2017–2025) — genuinely a thing Sleeper cannot show — but the endpoint
 *     reads `getCurrentSeason()` only. `citrus2/SparklineMicroChart` is
 *     therefore NOT used on this card: with one season in hand the only way
 *     to draw a line would be to make points up. FOLLOW-UP: a
 *     `/api/players/:id/xg-history` read, or a `xg_history` array on this
 *     payload.
 *   * `citrus2/StaleDataBadge`. It needs an `asOf` timestamp and the
 *     payload has none; passing null makes it render a permanent "Very
 *     outdated · Update timestamp unavailable" chip on every card, which is
 *     itself a false claim. FOLLOW-UP: surface `player_season_stats`'
 *     refresh timestamp on the payload and the badge drops straight in.
 *   * `vopa_score`, `avg_toi_per_game` (`player_talent_metrics`) and
 *     `toi_total_minutes` (`player_gar_components`): the service SELECTs the
 *     last one and drops it; the other two it never reads.
 */

// ── Formatting ──────────────────────────────────────────────────────
//
// PRECISION IS A TRUTH CLAIM. Each formatter below prints a number to the
// precision its source supports and no further, and every one matches what
// `pages/Players.tsx` already prints for the same field, so the two surfaces
// can never disagree about the same player.

/** GAR components, xG/60 — modelled rates, two decimals. */
export function fmt2(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '-' : (Math.round(v * 100) / 100).toFixed(2);
}

/** Expected goals and fantasy-point totals — one decimal. */
export function fmt1(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '-' : (Math.round(v * 10) / 10).toFixed(1);
}

/** Signed, one decimal: `+4.2`, `-3.1`, `0.0`. */
export function fmtSigned1(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '-';
  const r = Math.round(v * 10) / 10;
  // `-0.0` is a real IEEE value and reads as a claim the player is behind.
  const safe = Object.is(r, -0) ? 0 : r;
  return `${safe > 0 ? '+' : ''}${safe.toFixed(1)}`;
}

/**
 * Save percentage, `.918` style.
 *
 * The column arrives as either a fraction (0.918) or per-mille (918) — the
 * same both-shapes handling `pages/Players.tsx` has carried since the page
 * shipped. Normalising in ONE place matters more here than there: a scale
 * built from a mix of the two units is not a scale, it is noise.
 */
export function normalizeSavePct(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v === 0) return null;
  return v < 1 ? v : v / 1000;
}

export function fmtSavePct(v: number | null | undefined): string {
  const n = normalizeSavePct(v);
  return n == null ? '-' : n.toFixed(3).replace(/^0/, '');
}

/** 1st / 2nd / 3rd / 11th / 21st. */
export function ordinal(n: number): string {
  const r = Math.round(n);
  const v = Math.abs(r) % 100;
  const ones = Math.abs(r) % 10;
  const suffix = v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][ones] ?? 'th');
  return `${r}${suffix}`;
}

/** How the card names a cohort in prose. Canadian spelling, per STYLEGUIDE. */
export const COHORT_NOUN: Record<PlayerCohort, string> = {
  F: 'forwards',
  D: 'defencemen',
  G: 'goalies',
};

// ── Metric definitions ──────────────────────────────────────────────

export interface MetricSpec {
  key: string;
  /** What the row is called. Matches `pages/Players.tsx` wording exactly. */
  label: string;
  /** One inline caption — units, or what the metric means. */
  context?: string;
  category: PercentileCategory;
  direction: MetricDirection;
  select: (p: DashboardIndexEntry) => number | null | undefined;
  format: (v: number | null | undefined) => string;
  /** Compact cards show only the first `COMPACT_METRIC_COUNT` of these. */
}

/**
 * SKATER METRICS, in the order they are read.
 *
 * xG/60 leads because it is the moat metric: our own model scored 118,975
 * shots for 2025 at a calibration of 1.0010, and 10,047 of them carry the
 * proprietary pass-context features nobody else has. Then total impact, then
 * the decomposition — which is the part a Sleeper card structurally cannot
 * print, because it has no GAR model to decompose.
 *
 * `gar_ppd` is "PP Defense" in the GAR framework, i.e. the penalty kill.
 * Labelled exactly as `pages/Players.tsx` labels it rather than renamed
 * here, because two names for one column is how two surfaces start
 * disagreeing.
 */
export const SKATER_METRICS: MetricSpec[] = [
  {
    key: 'xg_per_60',
    label: 'xG/60',
    context: 'shot quality',
    category: 'offense',
    direction: 'higher',
    select: (p) => p.xg_per_60,
    format: fmt2,
  },
  {
    // "Total GAR/60" rather than "GAR/60", verbatim from the label
    // `pages/Players.tsx` already prints — and because the five component
    // rows below it carry "GAR/60" as their unit caption, so a bare
    // "GAR/60" label would appear six times on one card.
    key: 'gar_per_60',
    label: 'Total GAR/60',
    // No context caption: measured at 353px (the width this card gets in
    // PlayerStatsModal at 393), "goals above replacement" truncated mid-word
    // and pushed the value off its own row. The label carries the unit; the
    // section eyebrow carries the cohort.
    context: undefined,
    category: 'neutral',
    direction: 'higher',
    select: (p) => p.gar_per_60,
    format: fmt2,
  },
  {
    key: 'gar_evo',
    label: 'EV Offense',
    context: 'GAR/60',
    category: 'offense',
    direction: 'higher',
    select: (p) => p.gar_evo,
    format: fmt2,
  },
  {
    key: 'gar_evd',
    label: 'EV Defense',
    context: 'GAR/60',
    category: 'defense',
    direction: 'higher',
    select: (p) => p.gar_evd,
    format: fmt2,
  },
  {
    key: 'gar_ppo',
    label: 'PP Offense',
    context: 'GAR/60',
    category: 'special',
    direction: 'higher',
    select: (p) => p.gar_ppo,
    format: fmt2,
  },
  {
    key: 'gar_ppd',
    label: 'PP Defense',
    context: 'GAR/60',
    category: 'special',
    direction: 'higher',
    select: (p) => p.gar_ppd,
    format: fmt2,
  },
  {
    key: 'gar_pen',
    label: 'Penalty',
    context: 'GAR/60',
    category: 'neutral',
    direction: 'higher',
    select: (p) => p.gar_pen,
    format: fmt2,
  },
];

/**
 * GOALIE METRICS. A goalie must never be shown an empty skater card — he
 * has no xG/60 and no GAR row in this payload at all — so he gets his own
 * set built from what the endpoint does carry.
 *
 * GAA is the one `lower`-is-better metric on the card; `MetricDirection`
 * exists for it.
 */
export const GOALIE_METRICS: MetricSpec[] = [
  {
    key: 'save_pct',
    label: 'Save rate',
    context: 'SV%',
    category: 'defense',
    direction: 'higher',
    select: (p) => normalizeSavePct(p.save_pct),
    format: (v) => (v == null || !Number.isFinite(v) ? '-' : v.toFixed(3).replace(/^0/, '')),
  },
  {
    key: 'gaa',
    label: 'Goals against',
    context: 'per game',
    category: 'defense',
    direction: 'lower',
    select: (p) => (p.gaa > 0 ? p.gaa : null),
    format: fmt2,
  },
  {
    key: 'wins',
    label: 'Wins',
    context: 'season',
    category: 'offense',
    direction: 'higher',
    select: (p) => (p.gp > 0 ? p.wins : null),
    format: (v) => (v == null || !Number.isFinite(v) ? '-' : String(Math.round(v))),
  },
  {
    key: 'shutouts',
    label: 'Shutouts',
    context: 'season',
    category: 'special',
    direction: 'higher',
    select: (p) => (p.gp > 0 ? p.shutouts : null),
    format: (v) => (v == null || !Number.isFinite(v) ? '-' : String(Math.round(v))),
  },
];

/**
 * How many rows the condensed card shows. PWS-1 asks for ~180–240px of
 * height; a `PercentileBullet size="sm"` row measures ~30px with its gap, so
 * four rows plus the identity strip plus the verdict is the budget. The
 * remaining rows live in the `expanded` variant, which the modal uses
 * because a modal has the height a list row does not.
 */
export const COMPACT_METRIC_COUNT = 4;

export function metricsFor(cohort: PlayerCohort): MetricSpec[] {
  return cohort === 'G' ? GOALIE_METRICS : SKATER_METRICS;
}

// ── Finishing: G − xG ───────────────────────────────────────────────

/**
 * Goals minus expected goals. The most Citrus-specific number on the card:
 * it only exists because we scored every shot ourselves.
 *
 * GUARDED ON `x_goals > 0`, not on `gp > 0`. `PlayerDashboardService`
 * coalesces a missing stats row to `x_goals: 0`, so a player with games but
 * no xG data would compute `goals - 0` and the card would announce
 * "+11.0 goals over expected" about a player we have modelled nothing for.
 * No xG, no finishing number.
 */
export function finishing(p: DashboardIndexEntry): number | null {
  if (p.is_goalie) return null;
  if (!Number.isFinite(p.x_goals) || p.x_goals <= 0) return null;
  if (!Number.isFinite(p.goals)) return null;
  return p.goals - p.x_goals;
}

// ── Resolved card data ──────────────────────────────────────────────

export interface ResolvedMetric extends PercentileResult {
  spec: MetricSpec;
  value: number | null;
  display: string;
}

export interface AdvancedCardData {
  cohort: PlayerCohort;
  cohortNoun: string;
  /** How many players set the scales. Printed, so the reader can weigh it. */
  cohortSize: number;
  metrics: ResolvedMetric[];
  /** G − xG plus its placement, or null when we have no xG for him. */
  finishing: { value: number; display: string; percentile: number | null } | null;
  /** One honest sentence, or null. Never fabricated — see `deriveVerdict`. */
  verdict: string | null;
  /** True when this player's own sample is too thin to trust the numbers. */
  lowSample: boolean;
}

/**
 * Build every number the card renders, in one pass over the payload.
 *
 * The cohort is filtered ONCE and reused for all seven scales — the
 * difference between one walk of ~2k rows and seven. Callers memoise on
 * `[index, player.id]`; the index array is the module-level cache in
 * `usePlayerDashboardIndex`, so its identity is stable for the session.
 */
export function buildAdvancedCardData(
  player: DashboardIndexEntry,
  index: readonly DashboardIndexEntry[],
): AdvancedCardData {
  const cohort = playerCohort(player);
  const members = qualifiedCohort(index, cohort);
  const specs = metricsFor(cohort);

  const metrics: ResolvedMetric[] = specs.map((spec) => {
    const scale = scaleFrom(members, spec.select, spec.direction);
    const value = spec.select(player) ?? null;
    const placed = placeOnScale(scale, value, player.gp);
    return {
      spec,
      value: typeof value === 'number' && Number.isFinite(value) ? value : null,
      display: spec.format(value),
      ...placed,
    };
  });

  const fin = finishing(player);
  const finScale = scaleFrom(
    // Only players we actually modelled belong on the finishing scale, for
    // the same reason `finishing()` guards: a coalesced 0 xG is not a 0
    // finishing differential.
    members.filter((m) => Number.isFinite(m.x_goals) && m.x_goals > 0),
    (m) => m.goals - m.x_goals,
    'higher',
  );
  const finPercentile = percentileOnScale(finScale, fin);

  return {
    cohort,
    cohortNoun: COHORT_NOUN[cohort],
    cohortSize: members.length,
    metrics,
    finishing:
      fin == null ? null : { value: fin, display: fmtSigned1(fin), percentile: finPercentile },
    verdict: deriveVerdict(player, cohort, metrics, fin, finPercentile),
    lowSample: player.gp < DISTRIBUTION_MIN_GP,
  };
}

// ── The verdict line ────────────────────────────────────────────────

/**
 * ONE SENTENCE, DERIVED, OR NOTHING.
 *
 * PWS-1 asks for "one-line Stormy verdict … ~80-100 chars max". It does NOT
 * license a model call and it does not license a claim the numbers do not
 * support, so this is a decision table over data we hold, and every branch
 * requires the inputs it cites to be non-null. If none fires, the caller
 * gets `null` and the card omits the line entirely: an absent verdict is
 * cheaper than a wrong one.
 *
 * NOTHING IS SAID ABOUT A PLAYER WITH FEWER THAN `DISTRIBUTION_MIN_GP`
 * GAMES. Ten games is the floor at which this module is willing to call a
 * rate a trait rather than a streak; below it every sentence here would be
 * describing noise in a confident voice, which is the exact failure the
 * repo's fabrication guard exists to prevent.
 *
 * Rule order is deliberate. The shot-quality-vs-finishing rules come first
 * because that pairing is the one read a Sleeper card cannot produce, and it
 * is the read that changes a draft decision (elite looks + cold stick is a
 * buy; cold looks + hot stick is a sell).
 *
 * ── VOICE (2026-09-02) ────────────────────────────────────────────
 *
 * These sentences are the product's own writing, on a card a manager reads
 * before a draft pick, so they are written to the same brief as the rest of
 * the copy: a beat writer's fantasy note, not a dashboard caption.
 *
 *   * NO EM DASH. `src/__tests__/aiVoiceGuard.test.ts` fails the build on
 *     one, and every line here used to open with a clause, an em dash and
 *     a statistic, which is the single most recognisable AI tell in the
 *     product.
 *   * THE SOURCE IS NAMED IN THE SENTENCE. "Citrus xG", "Citrus GAR".
 *     A number a reader cannot attribute is a number they cannot check,
 *     and this module's whole claim is that its numbers are real.
 *   * THE FANTASY IMPLICATION IS STATED where the data carries one. "Buy
 *     low" and "Sell high" are the two calls the finishing gap actually
 *     licenses, and they are the same calls `CitrusNewsService` already
 *     tags its bounce-back and regression notes with.
 *
 * LENGTH BUDGET moved from 115 to `VERDICT_MAX_CHARS` (140). Naming the
 * source costs roughly ten characters a line and it is not optional. The
 * longest branch measures 105; the budget is the ceiling the unit test
 * pins, not a target.
 */
export function deriveVerdict(
  player: DashboardIndexEntry,
  cohort: PlayerCohort,
  metrics: ResolvedMetric[],
  fin: number | null,
  finPercentile: number | null,
): string | null {
  if (!Number.isFinite(player.gp) || player.gp < DISTRIBUTION_MIN_GP) return null;

  const noun = COHORT_NOUN[cohort];
  const by = (key: string) => metrics.find((m) => m.spec.key === key);

  if (cohort === 'G') {
    const sv = by('save_pct');
    if (sv?.percentile != null && sv.value != null) {
      const rate = sv.display;
      // The rate itself is NHL.com's; the ranking is ours, off the cohort
      // this module builds. The sentence keeps the two apart on purpose.
      if (sv.percentile >= 75) {
        return `Stopping more than his share. ${rate} save rate, ${ordinal(sv.percentile)} among ${noun} on the Citrus board.`;
      }
      if (sv.percentile <= 25) {
        return `Leaking more than he should. ${rate} save rate, ${ordinal(sv.percentile)} among ${noun} on the Citrus board.`;
      }
      return `${rate} save rate over ${player.gp} appearances, ${ordinal(sv.percentile)} among ${noun} on the Citrus board.`;
    }
    return null;
  }

  const xg = by('xg_per_60');
  const xgPct = xg?.percentile ?? null;

  // Shot quality vs finishing. `fin` is already guarded on real xG data.
  if (xgPct != null && fin != null && Math.abs(fin) >= 1.5) {
    if (xgPct >= 75 && fin <= -1.5) {
      return `Elite looks, cold stick. Citrus xG has him ${fmt1(Math.abs(fin))} goals under expected on ${ordinal(xgPct)}-percentile chances. Buy low.`;
    }
    if (xgPct >= 75 && fin >= 1.5) {
      return `Elite looks and burying them. Citrus xG has him ${fmtSigned1(fin)} goals over expected on ${ordinal(xgPct)}-percentile chances.`;
    }
    if (xgPct <= 40 && fin >= 1.5) {
      return `Outrunning his chances. Citrus xG has him ${fmtSigned1(fin)} goals over expected on ${ordinal(xgPct)}-percentile looks. Sell high.`;
    }
    if (xgPct <= 40 && fin <= -1.5) {
      return `Thin looks and not burying them. Citrus xG has him ${fmt1(Math.abs(fin))} goals under expected on ${ordinal(xgPct)}-percentile chances.`;
    }
  }

  // Where the GAR actually comes from. The decomposition IS the content.
  const components = ['gar_evo', 'gar_evd', 'gar_ppo', 'gar_ppd', 'gar_pen']
    .map(by)
    .filter((m): m is ResolvedMetric => !!m && m.value != null);
  if (components.length > 0) {
    const driver = components.reduce((a, b) =>
      Math.abs(b.value as number) > Math.abs(a.value as number) ? b : a,
    );
    const v = driver.value as number;
    const name = DRIVER_PHRASE[driver.spec.key] ?? driver.spec.label.toLowerCase();
    if (v > 0 && driver.percentile != null && driver.percentile >= 60) {
      return `Value is mostly ${name}. Citrus GAR has him at ${fmt2(v)} there, ${ordinal(driver.percentile)} among ${noun}.`;
    }
    if (v < 0 && driver.percentile != null && driver.percentile <= 40) {
      return `${capitalise(name)} is the drag. Citrus GAR has him at ${fmt2(v)}, ${ordinal(driver.percentile)} among ${noun}.`;
    }
  }

  // Nothing sharper survived; fall back to the honest headline, if we have it.
  const gar = by('gar_per_60');
  if (gar?.percentile != null && gar.value != null) {
    return `Citrus GAR puts him ${ordinal(gar.percentile)}-percentile for total impact among ${noun} over ${player.gp} games.`;
  }
  if (finPercentile != null && fin != null) {
    return `Citrus xG has him ${fmtSigned1(fin)} goals over expected, ${ordinal(finPercentile)} among ${noun} at finishing.`;
  }
  return null;
}

/**
 * The ceiling the unit test pins on every branch above.
 *
 * PWS-1's "~80-100 chars" was written before the source-attribution rule.
 * Naming Citrus xG or Citrus GAR inside the sentence costs about ten
 * characters and it is not negotiable, so the ceiling moved to 140. The
 * longest branch as written measures 105. Measured at 353px (the width the
 * card gets inside PlayerStatsModal on a 393px phone) a 140-character
 * verdict wraps to four lines, which is the most the tile can hold before
 * it pushes the metric rows off the card.
 */
export const VERDICT_MAX_CHARS = 140;

/** Prose names for the GAR components. Hockey words, per the STYLEGUIDE. */
const DRIVER_PHRASE: Record<string, string> = {
  gar_evo: 'even-strength offence',
  gar_evd: 'even-strength defence',
  gar_ppo: 'the power play',
  gar_ppd: 'the penalty kill',
  gar_pen: 'penalties drawn',
};

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Lookup ──────────────────────────────────────────────────────────

/**
 * Find a player in the shared index by the id a host surface holds.
 *
 * Every surface that opens a player card carries the NHL player id:
 * `PlayerService.Player.id` is documented as "string ID … but will store NHL
 * ID", `servicePlayerToHockeyPlayer` passes it straight through to
 * `HockeyPlayer.id`, and `DashboardIndexEntry.id` is
 * `player_directory.player_id`. So the join is a numeric compare — but it is
 * done defensively, because a surface that ever hands over a roster row id
 * instead must degrade to "no card", not to the WRONG player's card.
 */
export function findDashboardPlayer(
  index: readonly DashboardIndexEntry[],
  id: number | string | null | undefined,
): DashboardIndexEntry | null {
  if (id == null) return null;
  const numeric = typeof id === 'number' ? id : Number.parseInt(String(id), 10);
  if (!Number.isFinite(numeric)) return null;
  return index.find((p) => p.id === numeric) ?? null;
}

/**
 * Deep link to this player's full dashboard.
 *
 * Was `/players?player=<id>` when this module shipped, because the route
 * PWS-1 asks for did not exist — `App.tsx` registered `/players` and
 * `Players.tsx` read a `?player=` param. Component 6.5 shipped the real
 * page, so the link now goes where the spec always said it should. The
 * `?player=` deep link into the Players TABLE still works and is still what
 * that table sets on a row tap; this is the link to the deep-dive.
 */
export function playerDashboardHref(id: number): string {
  return `/players/${id}`;
}

// Re-exported so the card imports one module, not three.
export { DISTRIBUTION_MIN_GP, buildMetricScale, playerCohort };
export type { PlayerCohort, MetricDirection };

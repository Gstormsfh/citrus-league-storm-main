import type { SparklinePoint } from '@/components/citrus2/SparklineMicroChart';
import type { RinkMode, ShotEvent } from '@/components/citrus2/RinkHeatmap';
import type { DashboardSeasonRow, DashboardShot } from '@/hooks/usePlayerDashboard';

/**
 * WHERE THE PLAYER DASHBOARD'S NUMBERS COME FROM, AND WHAT MAKES EACH ONE
 * ALLOWED ON THE PAGE.
 *
 * A pure module, the house idiom (`playerAdvancedMetrics.ts`,
 * `phoneRowScale.ts`, `roster/positionChip.ts`): a file that exports both a
 * component and plain values breaks react-refresh, and it means the
 * geometry below — which decides where a dot lands on the hero rink — is
 * unit-tested rather than eyeballed against a screenshot.
 *
 * Everything here is derived from `/api/players/:playerId/dashboard`
 * (`server/src/services/PlayerDashboardService.ts`). Nothing is invented,
 * nothing is smoothed, and where a number cannot be computed honestly the
 * function returns null and the page renders the absence.
 */

// ── The rink frame ───────────────────────────────────────────────────
//
// `nhl_shots.x_adj` / `y_adj` are FEET on the model's own mirrored frame:
// every shot flipped to a single attacking end, goal line at x = 89, y = 0
// at centre ice, boards at y = ±42.5. That is not a guess — the
// `nhl_shot_features` view in the same schema computes
// `(x_adj > 89) AS f_behind_net` and `abs(y_adj) AS f_yabs`, which pins the
// origin and the units. `x_norm`/`y_norm` are the fallback on rows where
// the adjusted pair is null, on the same frame.

/** NHL goal line: 11 ft from the end boards on a 200 ft sheet. */
export const GOAL_LINE_X = 89;
/** Half the 85 ft width. */
export const HALF_WIDTH = 42.5;
/** Goal line to the far blue line: 64 ft. This is the rink the hero draws. */
export const ZONE_DEPTH = 64;

/**
 * How far a placement may disagree with the row's own `distance` before the
 * shot is dropped from the map, in feet.
 *
 * THIS GUARD IS THE POINT. The frame above is documented in the schema, but
 * a coordinate convention is exactly the kind of thing that is right until
 * a pipeline change makes it wrong, and a shot map that is wrong is far
 * worse than a shot map that is absent — it looks authoritative. `distance`
 * is a SCALAR: it is the same number whatever frame the coordinates are in,
 * so `hypot(89 − x, y)` against the stored distance is an independent check
 * of the placement. 6 ft is roughly one stick length and comfortably wider
 * than the rounding in the stored columns; anything past it means the
 * coordinates and the distance are not describing the same shot, and the
 * dot does not get drawn.
 */
export const PLACEMENT_TOLERANCE_FT = 6;

/**
 * Below this share of a player's shots landing on the rink, the map is
 * reported as UNRELIABLE and the page renders the labelled fallback hero
 * instead. Half the dots missing is not a heatmap, it is a rumour.
 */
export const MIN_PLOTTABLE_SHARE = 0.5;

/** Fewest shots before the page will say a sentence about shot location. */
export const MIN_SHOTS_FOR_VERDICT = 20;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface RinkPoint {
  /** 0 → the SVG's left edge, 1 → its right edge. */
  x: number;
  /** 0 → the blue line (bottom of the frame), 1 → the goal line (top). */
  y: number;
}

/**
 * Feet on the model frame → the [0,1] space `RinkHeatmap` draws in.
 *
 * The primitive maps `x` across `cx = 4 + x·92` and `y` up the frame with
 * `cy = 50 − y·42`, where the goal line sits at cy = 7 and the blue line at
 * cy = 52 — so y = 1 is AT the net and y = 0 is at the blue line. Depth is
 * therefore `1 − (89 − x_ft) / 64`.
 *
 * The lateral sign is a rotation, not a preference: with the attacking net
 * at the top of the frame, +x points up, and +y — 90° counter-clockwise
 * from +x — points to the frame's LEFT. Hence `0.5 − y_ft/85`.
 *
 * Returns null when the row has no usable coordinates, or when the
 * placement disagrees with the row's own `distance` by more than
 * `PLACEMENT_TOLERANCE_FT`.
 */
export function projectShot(shot: Pick<DashboardShot, 'x' | 'y' | 'distance'>): RinkPoint | null {
  const xFt = shot.x;
  const yFt = shot.y;
  if (typeof xFt !== 'number' || typeof yFt !== 'number') return null;
  if (!Number.isFinite(xFt) || !Number.isFinite(yFt)) return null;

  // A coordinate outside the sheet is a bad row, not a shot from the parking
  // lot. 110 rather than 100 on x because a wrap-around from behind the net
  // is legitimately past the goal line.
  if (Math.abs(yFt) > HALF_WIDTH + 2 || xFt < -110 || xFt > 110) return null;

  const depthFt = GOAL_LINE_X - xFt;

  if (typeof shot.distance === 'number' && Number.isFinite(shot.distance)) {
    const implied = Math.hypot(depthFt, yFt);
    if (Math.abs(implied - shot.distance) > PLACEMENT_TOLERANCE_FT) return null;
  }

  return {
    x: clamp01(0.5 - yFt / (HALF_WIDTH * 2)),
    y: clamp01(1 - depthFt / ZONE_DEPTH),
  };
}

// ── Zones ────────────────────────────────────────────────────────────
//
// Boundaries are rink dimensions, not taste: the offensive faceoff dots sit
// 20 ft out from the goal line and 22 ft either side of centre; the circles
// are 15 ft in radius, so the top of a circle is 35 ft out; the half-boards
// begin around 28 ft off centre; the blue line is 64 ft out.
//
// SIX ZONES, NOT THE SPEC'S FIVE, and the extra one is a correctness fix
// rather than a flourish. The spec (§2.2) lists SLOT / LOW SLOT / HIGH SLOT /
// POINT / BOARDS. With only those five, every shot outside the |y| ≤ 15 slot
// lane lands in BOARDS — including the faceoff-circle shots at |y| ≈ 20,
// which are most of a power-play forward's volume. Measured in the harness on
// a forward profile, that made the page say "33% of his attempts come from
// the boards" about a player taking them from the circles. That is a claim
// about where a player stands that the coordinates do not support, so
// CIRCLES gets its own row. Deviation logged in the spec's change table.

export type ShotZoneKey =
  | 'LOW SLOT'
  | 'SLOT'
  | 'HIGH SLOT'
  | 'CIRCLES'
  | 'BOARDS'
  | 'POINT';

export const SHOT_ZONE_ORDER: ShotZoneKey[] = [
  'LOW SLOT',
  'SLOT',
  'HIGH SLOT',
  'CIRCLES',
  'BOARDS',
  'POINT',
];

/** Plain-language definition, rendered as the tile's own legend. */
export const SHOT_ZONE_DEFINITION: Record<ShotZoneKey, string> = {
  'LOW SLOT': 'inside 20 ft, between the dots',
  SLOT: '20–35 ft out, between the dots',
  'HIGH SLOT': '35–54 ft out, between the dots',
  CIRCLES: '15–28 ft off centre, inside the blue line',
  BOARDS: 'beyond 28 ft off centre',
  POINT: 'beyond 54 ft from the goal line',
};

export function shotZone(point: { x: number; y: number } | null, shot: Pick<DashboardShot, 'x' | 'y'>): ShotZoneKey | null {
  if (!point) return null;
  const xFt = shot.x;
  const yFt = shot.y;
  if (typeof xFt !== 'number' || typeof yFt !== 'number') return null;

  const depth = GOAL_LINE_X - xFt;
  const lateral = Math.abs(yFt);

  if (depth > 54) return 'POINT';
  if (lateral <= 11 && depth <= 20) return 'LOW SLOT';
  if (lateral <= 15 && depth <= 35) return 'SLOT';
  if (lateral <= 15) return 'HIGH SLOT';
  if (lateral <= 28) return 'CIRCLES';
  return 'BOARDS';
}

export interface ZoneSummary {
  zone: ShotZoneKey;
  attempts: number;
  goals: number;
  /** Our model's summed xG for the attempts in this zone. */
  xg: number;
  /** Share of the player's PLOTTED attempts, 0–100. */
  share: number;
  /** Our model's xG per attempt in this zone. Null when there are none. */
  xgPerShot: number | null;
}

export interface ShotSummary {
  /** Every shot the payload carried for this season/gameType. */
  total: number;
  /** How many of those could be placed on the rink and checked. */
  plotted: number;
  /** False when too few placed to draw an honest map. */
  reliable: boolean;
  goals: number;
  /** Our model's summed xG over the PLOTTED shots. */
  xg: number;
  rushShots: number;
  reboundShots: number;
  powerPlayShots: number;
  evenStrengthShots: number;
  zones: ZoneSummary[];
}

/** Everything the DATA zone reads off one season's shots, in a single pass. */
export function summariseShots(shots: readonly DashboardShot[]): ShotSummary {
  const counts = new Map<ShotZoneKey, { attempts: number; goals: number; xg: number }>();
  for (const z of SHOT_ZONE_ORDER) counts.set(z, { attempts: 0, goals: 0, xg: 0 });

  let plotted = 0;
  let goals = 0;
  let xg = 0;
  let rushShots = 0;
  let reboundShots = 0;
  let powerPlayShots = 0;
  let evenStrengthShots = 0;

  for (const s of shots) {
    const point = projectShot(s);
    const zone = shotZone(point, s);
    if (!zone) continue;
    plotted += 1;
    if (s.is_goal) goals += 1;
    if (typeof s.xg === 'number' && Number.isFinite(s.xg)) xg += s.xg;
    if (s.is_rush) rushShots += 1;
    if (s.is_rebound) reboundShots += 1;
    if (s.is_power_play) powerPlayShots += 1;
    if (s.strength_state === '5v5') evenStrengthShots += 1;

    const bucket = counts.get(zone)!;
    bucket.attempts += 1;
    if (s.is_goal) bucket.goals += 1;
    if (typeof s.xg === 'number' && Number.isFinite(s.xg)) bucket.xg += s.xg;
  }

  const zones: ZoneSummary[] = SHOT_ZONE_ORDER.map((zone) => {
    const b = counts.get(zone)!;
    return {
      zone,
      attempts: b.attempts,
      goals: b.goals,
      xg: b.xg,
      share: plotted > 0 ? (100 * b.attempts) / plotted : 0,
      xgPerShot: b.attempts > 0 ? b.xg / b.attempts : null,
    };
  });

  return {
    total: shots.length,
    plotted,
    // Zero shots is a legitimate, honest state (a call-up, a missed season)
    // and is NOT unreliable — there is simply nothing to draw. Unreliable
    // means we HAD shots and could not place enough of them.
    reliable: shots.length === 0 || plotted >= shots.length * MIN_PLOTTABLE_SHARE,
    goals,
    xg,
    rushShots,
    reboundShots,
    powerPlayShots,
    evenStrengthShots,
    zones,
  };
}

/**
 * `DashboardShot[]` → the primitive's `ShotEvent[]`, filtered by the active
 * segmented-control mode.
 *
 * Mode semantics, stated because the control's four labels are terse:
 *   5V5   `strength_state === '5v5'` — even strength, both goalies on.
 *   PP    the shot was taken on a power play.
 *   xG    every attempt, coloured by our model's xG.
 *   G−xG  goals only. Spec PWS-4 notes that a true differential colour
 *         encoding is the intended end state; this is the documented
 *         interim, unchanged from the Component 6 iteration.
 */
export function toRinkEvents(shots: readonly DashboardShot[], mode: RinkMode): ShotEvent[] {
  const out: ShotEvent[] = [];
  for (const s of shots) {
    if (mode === '5v5' && s.strength_state !== '5v5') continue;
    if (mode === 'pp' && !s.is_power_play) continue;
    if (mode === 'g-xg' && !s.is_goal) continue;

    const point = projectShot(s);
    if (!point) continue;

    out.push({
      id: `${s.game_id}-${s.event_id}`,
      x: point.x,
      y: point.y,
      xg_value: s.xg,
      is_goal: s.is_goal,
      mode: s.is_power_play ? 'pp' : s.is_shorthanded ? 'pk' : s.strength_state === '5v5' ? '5v5' : undefined,
    });
  }
  return out;
}

// ── The career arc ───────────────────────────────────────────────────

/** 2025 → "2025-26". The season year is the year the season STARTS. */
export function seasonLabel(season: number): string {
  const next = (season + 1) % 100;
  return `${season}-${String(next).padStart(2, '0')}`;
}

export interface CareerSeries {
  points: SparklinePoint[];
  /** The most recent season's value, already formatted. Null when empty. */
  endpoint: string | null;
  firstSeason: number | null;
  lastSeason: number | null;
}

/**
 * `player_xg_season` → a sparkline of our model's expected goals per season.
 *
 * xG rather than goals: goals are on every other fantasy site, and the
 * point of this tile is the thing only Citrus can draw — nine seasons of
 * OUR model's output for one shooter, scored from the shot events. Rows are
 * filtered to one game type so a 12-game playoff run cannot sit in the line
 * next to an 82-game season and read as a collapse.
 */
export function careerSeries(
  seasons: readonly DashboardSeasonRow[],
  gameType: string,
  select: (row: DashboardSeasonRow) => number = (r) => r.xg,
): CareerSeries {
  const rows = seasons
    .filter((s) => s.game_type === gameType)
    .slice()
    .sort((a, b) => a.season - b.season);

  if (rows.length === 0) {
    return { points: [], endpoint: null, firstSeason: null, lastSeason: null };
  }

  const points: SparklinePoint[] = rows.map((r) => ({
    x: r.season,
    y: Number(select(r).toFixed(2)),
    // The primitive prints `gameDate` verbatim in its tooltip, so the season
    // label goes there — there is no per-game date on a season row and
    // inventing one would be a fabricated axis.
    gameDate: seasonLabel(r.season),
  }));

  return {
    points,
    endpoint: points[points.length - 1].y.toFixed(2),
    firstSeason: rows[0].season,
    lastSeason: rows[rows.length - 1].season,
  };
}

/** The one `player_xg_season` row the page is currently describing. */
export function seasonRow(
  seasons: readonly DashboardSeasonRow[],
  season: number,
  gameType: string,
): DashboardSeasonRow | null {
  return seasons.find((s) => s.season === season && s.game_type === gameType) ?? null;
}

// ── Prose ────────────────────────────────────────────────────────────

/**
 * `1st` / `2nd` / `71st` / `13th`.
 *
 * `PercentileBullet` has its own private copy of this; the Wrapped chapter's
 * callout does not, and shipped "71TH PERCENTILE" until the harness caught
 * it. Exported here so the page has one to reach for.
 */
export function ordinal(n: number): string {
  const v = Math.abs(Math.round(n)) % 100;
  const suffix =
    v >= 11 && v <= 13
      ? 'th'
      : { 1: 'st', 2: 'nd', 3: 'rd' }[Math.abs(Math.round(n)) % 10] ?? 'th';
  return `${Math.round(n)}${suffix}`;
}

/** `+7.53` / `−5.12` — the minus is U+2212, which lines up in tabular nums. */
export function signed(v: number, digits = 2): string {
  const s = Math.abs(v).toFixed(digits);
  return v >= 0 ? `+${s}` : `−${s}`;
}

/**
 * The floating hero verdict, ASSEMBLED FROM MEASURED VALUES. Never
 * generated, never adjectival about anything the payload does not carry.
 *
 * Every clause below is a number the response contains: the busiest zone
 * and its share of placed attempts, our model's xG per attempt there, and
 * the season's goals-minus-expected. Under `MIN_SHOTS_FOR_VERDICT` placed
 * shots there is no sentence at all, because a shot-location claim off
 * fifteen attempts is noise wearing a verdict's clothes.
 *
 * VOICE (2026-09-02): no em dash, and the model is named in the sentence
 * rather than referred to as "our model". "Citrus xG v3" is what the copy
 * brief calls it and what Stormy is told to call it, so the two surfaces
 * name the same thing the same way. See
 * `src/__tests__/aiVoiceGuard.test.ts`, which fails the build on the dash.
 */
export function deriveShotVerdict(
  summary: ShotSummary,
  finishing: number | null,
): string | null {
  if (summary.plotted < MIN_SHOTS_FOR_VERDICT) return null;

  const busiest = summary.zones.reduce((best, z) => (z.attempts > best.attempts ? z : best), summary.zones[0]);
  if (!busiest || busiest.attempts === 0) return null;

  // STARTS WITH A WORD, NEVER A DIGIT. `VerdictTile`'s dropcap variant pulls
  // the first character out at 48px, so a sentence beginning "30% of his
  // attempts…" renders as a giant "3" beside the text "0% of his attempts…"
  // — a number the data does not support, printed in the largest type on the
  // tile. Caught in the harness at 393; the page also guards the dropcap on
  // the first character, but the sentence should not need the guard.
  const zonePhrase = `He takes ${Math.round(busiest.share)}% of his attempts from the ${busiest.zone.toLowerCase()}`;
  const qualityPhrase =
    busiest.xgPerShot != null
      ? `, worth ${busiest.xgPerShot.toFixed(3)} expected goals apiece`
      : '';

  if (finishing == null) return `${zonePhrase}${qualityPhrase}.`;

  const finishPhrase =
    finishing >= 0.5
      ? `he is ${finishing.toFixed(1)} goals ahead of what that shot profile expects`
      : finishing <= -0.5
        ? `he is ${Math.abs(finishing).toFixed(1)} goals behind what that shot profile expects`
        : 'he is finishing level with what that shot profile expects';

  return `${zonePhrase}${qualityPhrase}, and ${finishPhrase}.`;
}

/**
 * The goalie's floating verdict. Same rule: every clause is a stored number.
 * Citrus GSAx is our model's expected goals against minus the goals he
 * actually allowed, over primary (non-rebound) shots only, which is what
 * `goalie_gsax_primary` holds and why the sentence says so.
 */
export function deriveGoalieVerdict(gsax: {
  shots_faced: number;
  xga: number;
  ga: number;
  raw_gsax: number;
  regressed_gsax: number;
} | null): string | null {
  if (!gsax || gsax.shots_faced <= 0) return null;
  const magnitude = Math.abs(gsax.raw_gsax).toFixed(1);
  const verdict =
    gsax.raw_gsax >= 0
      ? `${magnitude} goals better than expectation`
      : `${magnitude} goals worse than expectation`;
  return `On ${gsax.shots_faced.toLocaleString()} primary shots the expected goals against were ${gsax.xga.toFixed(1)}; he allowed ${gsax.ga}. That is ${verdict}, ${signed(gsax.regressed_gsax, 1)} once regressed for workload.`;
}

/**
 * WHAT THE DRAFT ROOM IS ALLOWED TO SAY WHILE A MANAGER IS ON THE CLOCK.
 *
 * A pure module — no React — for the reason `phoneRowScale.ts`,
 * `roster/positionChip.ts` and `player/playerAdvancedMetrics.ts` all give: a
 * file that exports both a component and plain values breaks react-refresh,
 * and arithmetic a manager acts on under a thirty-second clock belongs
 * somewhere a test can reach without a DOM.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS — measured on `harness/draft.html` at 393x852, 2026-09-02,
 * with the caller on the clock at round 2 pick 24:
 *
 *   * The on-clock bar was 120px of screen carrying a wrapped label, a
 *     second copy of the header's countdown, and the sentence "Select a
 *     player from the pool, or click Draft on any row." clipped after nine
 *     characters. Not one number about the player, the pick or the roster.
 *   * The pool row's dominant number was `732.8 FPTS` — the player's SEASON
 *     ACTUAL fantasy points. `PlayerPool` accepts a `projectedFptsMap` prop
 *     and `DraftRoomV2` never passed one, so the projection columns read
 *     `-` on desktop and the phone row fell back to last season's total. A
 *     draft is a forward-looking decision and the room was showing history.
 *   * Nothing anywhere said how many startable players were left at a
 *     position, which is the question a manager is actually answering when
 *     he decides between the best forward available and the last starting
 *     goalie.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE HONESTY RULES THIS MODULE KEEPS
 *
 * 1. Every number here is either read straight off `/api/players/
 *    dashboard-index` or is arithmetic on values from it. Nothing is
 *    invented, and a value that cannot be computed comes back `null` so the
 *    UI renders nothing rather than a placeholder.
 * 2. The projection is CITRUS'S MODEL, not a measurement, and the surfaces
 *    that print it say so. This module makes no claim about its accuracy;
 *    there is no benchmark in this repo that could back one.
 * 3. Scarcity is defined below in one paragraph of plain arithmetic, and the
 *    definition is conservative wherever it could be flattering.
 */
import { ScoringCalculator, type ScoringSettings } from '@citrus/shared';
import {
  normalizeSavePctValue,
  projectionFor,
  projectionSettings,
  type DraftProjection,
} from '@citrus/shared/leagueProjection';
import type { DashboardIndexEntry } from '@/hooks/usePlayerDashboardIndex';
import {
  buildMetricScale,
  placeOnScale,
  playerCohort,
  type MetricScale,
  type PlayerCohort,
} from '@/utils/playerPercentiles';
import { fmtSigned1 } from '@/components/player/playerAdvancedMetrics';

// ── The projection ──────────────────────────────────────────────────
//
// The arithmetic moved to `@citrus/shared/leagueProjection` on 2026-09-11:
// the API server renders the player writeup's projection sentence and has
// to arrive at the same number this room prints. Re-exported here so the
// draft surfaces keep their import.

export type { DraftProjection } from '@citrus/shared/leagueProjection';
export { projectedGoalsAgainst, projectionFor } from '@citrus/shared/leagueProjection';

/**
 * The starting positions a fantasy roster can name. UTIL, BENCH and IR are
 * deliberately absent — see `startersLeft` for what that costs and why it is
 * the safe direction to be wrong in.
 *
 * `F` (2026-09-10): an F/D/G league caps forwards as one group, so its
 * settings carry `F` and no `C`/`LW`/`RW`. Before today the room read only
 * the five individual keys, found no forward cap at all in such a league, and
 * the scarcity strip, the autodraft guard and Stormy's need line all went
 * quiet on forwards -- the position group that decides most drafts. A strip
 * row only renders for a position with slots, so an individual league never
 * shows F and a forward league never shows C/LW/RW.
 */
export const DRAFT_POSITIONS = ['C', 'LW', 'RW', 'F', 'D', 'G'] as const;
export type DraftPosition = (typeof DRAFT_POSITIONS)[number];

/** True when the league caps forwards as a group: `F` present, `C/LW/RW` absent. */
export function capsGroupForwards(caps: Record<string, number> | null | undefined): boolean {
  if (!caps) return false;
  return 'F' in caps && !('C' in caps) && !('LW' in caps) && !('RW' in caps);
}

/** The cap key a player counts against: `C/LW/RW` fold onto `F` in a forward league. */
export function capKeyFor(position: string, caps: Record<string, number> | null | undefined): string {
  const u = position.trim().toUpperCase();
  if (capsGroupForwards(caps) && (u === 'C' || u === 'LW' || u === 'RW')) return 'F';
  return u;
}

/** Fold a by-position count map onto the cap vocabulary the league actually uses. */
export function foldForwards<T extends string>(
  byPosition: Partial<Record<T | DraftPosition, number>>,
  caps: Record<string, number> | null | undefined,
): Partial<Record<DraftPosition, number>> {
  if (!capsGroupForwards(caps)) return byPosition as Partial<Record<DraftPosition, number>>;
  const out: Partial<Record<DraftPosition, number>> = {};
  for (const [pos, n] of Object.entries(byPosition) as [string, number | undefined][]) {
    if (n === undefined) continue;
    const key = capKeyFor(pos, caps) as DraftPosition;
    out[key] = (out[key] ?? 0) + n;
  }
  return out;
}

/** `L` → `LW`, `Centre` → `C`, `F` → `F`, anything unrecognised → `''`. */
export function normalizeDraftPosition(raw: string | null | undefined): DraftPosition | '' {
  const u = (raw ?? '').trim().toUpperCase();
  if (u === 'F' || u === 'FORWARD') return 'F';
  if (u === 'C' || u === 'CENTRE' || u === 'CENTER') return 'C';
  if (u === 'LW' || u === 'L' || u === 'LEFT' || u === 'LEFTWING') return 'LW';
  if (u === 'RW' || u === 'R' || u === 'RIGHT' || u === 'RIGHTWING') return 'RW';
  if (u === 'D' || u === 'DEFENCE' || u === 'DEFENSE' || u === 'DEFENCEMAN' || u === 'DEFENSEMAN') {
    return 'D';
  }
  if (u === 'G' || u === 'GOALIE' || u === 'GOALTENDER') return 'G';
  return '';
}

/**
 * Every projection the payload supports, keyed by the STRING player id the
 * draft pool uses (`Player.id`), so `PlayerPool`'s existing
 * `projectedFptsMap` prop can be fed without a second lookup shape.
 *
 * Players with no projection row are absent from the map rather than present
 * with a zero: `PlayerPool` renders `-` for a miss and `0.0` for a zero, and
 * those are different claims.
 */
export function buildDraftProjectionMap(
  entries: readonly DashboardIndexEntry[],
  settings: ScoringSettings | null | undefined,
): Map<string, DraftProjection> {
  const normalized = projectionSettings(settings);
  const scorer = new ScoringCalculator(normalized);
  const out = new Map<string, DraftProjection>();
  for (const e of entries) {
    const p = projectionFor(e, scorer, normalized);
    if (p) out.set(String(e.id), p);
  }
  return out;
}

/** Shared board/autopick order: available forecasts first, then actual-season rank. */
export function rankDraftCandidates<T extends { id: string }>(
  players: readonly T[], projections: ReadonlyMap<string, DraftProjection>, actualPoints: (player: T) => number,
): T[] {
  return players.map(player => ({ player, forecast: projections.get(player.id)?.total,
    actual: actualPoints(player) })).sort((a, b) => {
    const ap = a.forecast != null && Number.isFinite(a.forecast);
    const bp = b.forecast != null && Number.isFinite(b.forecast);
    if (ap !== bp) return ap ? -1 : 1;
    return ap && bp ? b.forecast! - a.forecast! : b.actual - a.actual;
  }).map(row => row.player);
}

// ── Positional scarcity ─────────────────────────────────────────────

/** What the bar says about one position. */
export interface PositionScarcity {
  position: DraftPosition;
  /** Starter-caliber players still on the board. See `startersLeft`. */
  startersLeft: number;
  /** Starting slots at this position the manager has not filled yet. */
  openSlots: number;
  /**
   * True when the run is on: fewer starters remain than there are picks
   * before this manager is back on the clock, so waiting costs him the slot.
   */
  urgent: boolean;
}

/**
 * STARTERS LEFT, DEFINED.
 *
 * A league of `teamCount` teams starting `slots` players at a position will
 * absorb `teamCount x slots` of them before anyone is starting a backup. Of
 * that population, `draftedAtPosition` are already gone. What remains —
 * capped by what is actually still on the board — is how many players are
 * left that somebody in this league will start.
 *
 *     startersLeft = clamp(teamCount x slots - draftedAtPosition, 0, availableAtPosition)
 *
 * WHAT THIS DELIBERATELY DOES NOT COUNT: UTIL and bench slots. A UTIL slot
 * is filled by any skater, so counting it would mean guessing how a league
 * splits it across C / LW / RW / D — and every split is a claim about other
 * managers' intentions that we cannot support. Leaving it out makes
 * `startersLeft` a LOWER bound on real demand, which means the number can
 * understate how many players are left, never overstate it. Understating is
 * the safe direction: a manager who reads "3 starting centres left" and
 * takes one has bought a player somebody would have started; the opposite
 * error talks him out of a pick he needed.
 *
 * It is also position-primary: a dual-eligible C/LW counts once, at his
 * primary position, because that is the only position the draft pool sorts
 * and filters him by.
 */
export function startersLeft(input: {
  teamCount: number;
  slots: number;
  draftedAtPosition: number;
  availableAtPosition: number;
}): number {
  const { teamCount, slots, draftedAtPosition, availableAtPosition } = input;
  if (!Number.isFinite(teamCount) || !Number.isFinite(slots) || teamCount <= 0 || slots <= 0) {
    return 0;
  }
  const demand = teamCount * slots - Math.max(0, draftedAtPosition);
  return Math.max(0, Math.min(demand, Math.max(0, availableAtPosition)));
}

/**
 * The scarcity strip, ordered the way a manager should read it: the
 * positions he still has to fill, most urgent first.
 *
 * `picksUntilNextTurn` is what turns a count into a decision. Three starting
 * goalies left is comfortable when you pick again in four; it is the whole
 * ballgame when you pick again in twenty-one. Pass null (unknown turn order,
 * or the draft is not running) and nothing is ever marked urgent — the strip
 * then reports counts and makes no claim about timing.
 *
 * Positions the manager has already filled are dropped: a full crease is not
 * a decision, and the phone has 393px.
 */
export function scarcityStrip(input: {
  teamCount: number;
  startingSlots: Partial<Record<DraftPosition, number>>;
  availableByPosition: Partial<Record<DraftPosition, number>>;
  draftedByPosition: Partial<Record<DraftPosition, number>>;
  myFilledByPosition: Partial<Record<DraftPosition, number>>;
  picksUntilNextTurn: number | null;
}): PositionScarcity[] {
  const { teamCount, picksUntilNextTurn } = input;
  // A forward league names one F cap; the pool and the picks still arrive as
  // C/LW/RW. Fold those onto F here so every caller counts the same way.
  const caps = input.startingSlots as Record<string, number>;
  const startingSlots = input.startingSlots;
  const availableByPosition = foldForwards(input.availableByPosition, caps);
  const draftedByPosition = foldForwards(input.draftedByPosition, caps);
  const myFilledByPosition = foldForwards(input.myFilledByPosition, caps);

  const rows: PositionScarcity[] = [];
  for (const position of DRAFT_POSITIONS) {
    const slots = startingSlots[position] ?? 0;
    if (slots <= 0) continue;
    const openSlots = Math.max(0, slots - (myFilledByPosition[position] ?? 0));
    if (openSlots === 0) continue;
    const left = startersLeft({
      teamCount,
      slots,
      draftedAtPosition: draftedByPosition[position] ?? 0,
      availableAtPosition: availableByPosition[position] ?? 0,
    });
    rows.push({
      position,
      startersLeft: left,
      openSlots,
      urgent:
        picksUntilNextTurn !== null &&
        Number.isFinite(picksUntilNextTurn) &&
        left <= picksUntilNextTurn,
    });
  }
  // Urgent first, then scarcest, then the canonical position order so the
  // strip does not reshuffle itself between two equal states.
  const order = new Map(DRAFT_POSITIONS.map((p, i) => [p, i]));
  return rows.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    if (a.startersLeft !== b.startersLeft) return a.startersLeft - b.startersLeft;
    return (order.get(a.position) ?? 0) - (order.get(b.position) ?? 0);
  });
}

/**
 * How many picks happen between now and this manager's next turn.
 *
 * Read off the draft-order matrix rather than computed from a snake formula:
 * the matrix is what the engine actually uses, it already covers linear and
 * any custom order, and a formula would be a second source of truth for turn
 * order. Returns null when the matrix is missing or this team has no later
 * pick, and the strip then makes no urgency claim.
 */
export function picksUntilNextTurn(
  matrix: readonly { pickNumber: number; teamId: string }[] | null | undefined,
  myTeamId: string | null,
  currentPickNumber: number | null,
): number | null {
  if (!matrix || !myTeamId || currentPickNumber === null || !Number.isFinite(currentPickNumber)) {
    return null;
  }
  let next: number | null = null;
  for (const slot of matrix) {
    if (slot.teamId !== myTeamId) continue;
    if (slot.pickNumber <= currentPickNumber) continue;
    if (next === null || slot.pickNumber < next) next = slot.pickNumber;
  }
  return next === null ? null : next - currentPickNumber;
}

// ── The one advanced number that changes a pick ─────────────────────

/**
 * A cohort-relative read on a player, in the two fields a bar can print.
 *
 * `label` names the metric and the comparison set — "xG/60, 88th of
 * forwards" — because a percentile without its cohort is not a fact. See
 * `utils/playerPercentiles.ts` for why forwards, defencemen and goalies are
 * never pooled.
 */
export interface QualitySignal {
  metric: string;
  /**
   * The same metric in the width a 393px list row can pay for: `xG`, `GAR`,
   * `SV%`. Measured on the harness at 393x852 — the row's second line holds a
   * position chip, a team code and this, and `xG/60 92nd` (62px) pushed the
   * line to 136px inside a 133px column, so the percentile truncated to
   * "xG…" on every row. The full metric name stays on the row's `title` and
   * on every surface with room for it.
   */
  shortMetric: string;
  /** 0-100 within the player's cohort. */
  percentile: number;
  cohortNoun: string;
  cohortSize: number;
  /** This player's own games played are below the distribution threshold. */
  lowSample: boolean;
  /** The raw value, already formatted to the precision its source supports. */
  value: string;
}

const COHORT_NOUN: Record<PlayerCohort, string> = {
  F: 'forwards',
  D: 'defencemen',
  G: 'goalies',
};

/** The scales a room needs, built once per pool rather than per row. */
export interface QualityScales {
  xgPer60: Record<PlayerCohort, MetricScale>;
  garPer60: Record<PlayerCohort, MetricScale>;
  /** Goals saved above expected, regressed, goalies only. */
  gsax: MetricScale;
  savePct: MetricScale;
}

/**
 * Build every scale the quality signal can need, in one pass per cohort.
 *
 * Eight passes over 2k rows per RENDER would be the naive shape; the card
 * already learned this lesson (`playerAdvancedMetrics`), so the scales are
 * built once from the payload and handed to every consumer.
 */
export function buildQualityScales(players: readonly DashboardIndexEntry[]): QualityScales {
  const cohorts: PlayerCohort[] = ['F', 'D', 'G'];
  const xgPer60 = {} as Record<PlayerCohort, MetricScale>;
  const garPer60 = {} as Record<PlayerCohort, MetricScale>;
  for (const c of cohorts) {
    xgPer60[c] = buildMetricScale(players, c, (p) => p.xg_per_60, 'higher');
    garPer60[c] = buildMetricScale(players, c, (p) => p.gar_per_60, 'higher');
  }
  return {
    xgPer60,
    garPer60,
    gsax: buildMetricScale(players, 'G', (p) => p.gsax_regressed, 'higher'),
    savePct: buildMetricScale(players, 'G', (p) => normalizeSavePctValue(p.save_pct), 'higher'),
  };
}

/**
 * ONE number, chosen because it is the one that changes a pick.
 *
 * For a skater that is xG/60: shot quality independent of whether the pucks
 * went in, off the model that scored 1,026,149 shots from 2017 to 2025. GAR/60
 * is the fallback when the talent table has no xG row for him, because total
 * impact is the next-best single read.
 *
 * A goalie gets GSAx: goals saved above expected off the same shot model,
 * the one goalie number that is ours. `gsax_regressed` has been on the index
 * payload since the 2026-09-03 server pass joined `goalie_gsax_primary`
 * (the first cut of this module noted the join as missing). It is the
 * REGRESSED value, for the reason `playerAdvancedMetrics.ts` gives: every
 * other GSAx on a Citrus surface prints that one, and two numbers wearing
 * one label is how surfaces start disagreeing. The value is formatted by the
 * same `fmtSigned1` the advanced card uses. Save rate is the fallback for a
 * goalie the GSAx table does not hold.
 *
 * Returns null when nothing qualifies, and the caller prints nothing. A row
 * with no signal is a row with no signal; it is not a row with a zero.
 */
export function qualitySignalFor(
  entry: DashboardIndexEntry | null | undefined,
  scales: QualityScales,
): QualitySignal | null {
  if (!entry) return null;
  const cohort = playerCohort(entry);
  const noun = COHORT_NOUN[cohort];

  if (cohort === 'G') {
    const gsax = entry.gsax_regressed;
    if (typeof gsax === 'number' && Number.isFinite(gsax)) {
      const placed = placeOnScale(scales.gsax, gsax, entry.gp);
      if (placed.percentile !== null) {
        return {
          metric: 'GSAx',
          shortMetric: 'GSAx',
          percentile: placed.percentile,
          cohortNoun: noun,
          cohortSize: placed.cohortSize,
          lowSample: placed.lowSample,
          value: fmtSigned1(gsax),
        };
      }
    }

    const rate = normalizeSavePctValue(entry.save_pct);
    if (rate === null) return null;
    const placed = placeOnScale(scales.savePct, rate, entry.gp);
    if (placed.percentile === null) return null;
    return {
      metric: 'SV%',
      shortMetric: 'SV%',
      percentile: placed.percentile,
      cohortNoun: noun,
      cohortSize: placed.cohortSize,
      lowSample: placed.lowSample,
      value: rate.toFixed(3).replace(/^0/, ''),
    };
  }

  const xg = entry.xg_per_60;
  if (typeof xg === 'number' && Number.isFinite(xg)) {
    const placed = placeOnScale(scales.xgPer60[cohort], xg, entry.gp);
    if (placed.percentile !== null) {
      return {
        metric: 'xG/60',
        shortMetric: 'xG',
        percentile: placed.percentile,
        cohortNoun: noun,
        cohortSize: placed.cohortSize,
        lowSample: placed.lowSample,
        value: (Math.round(xg * 100) / 100).toFixed(2),
      };
    }
  }

  const gar = entry.gar_per_60;
  if (typeof gar === 'number' && Number.isFinite(gar)) {
    const placed = placeOnScale(scales.garPer60[cohort], gar, entry.gp);
    if (placed.percentile !== null) {
      return {
        metric: 'GAR/60',
        shortMetric: 'GAR',
        percentile: placed.percentile,
        cohortNoun: noun,
        cohortSize: placed.cohortSize,
        lowSample: placed.lowSample,
        value: (Math.round(gar * 100) / 100).toFixed(2),
      };
    }
  }

  return null;
}

/** 1st / 2nd / 3rd / 11th. Same rule the advanced card uses. */
export function ordinalPercentile(n: number): string {
  const r = Math.round(n);
  const v = Math.abs(r) % 100;
  const ones = Math.abs(r) % 10;
  const suffix = v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][ones] ?? 'th');
  return `${r}${suffix}`;
}

/**
 * The quality signal as one line of text, cohort included.
 *
 * "xG/60 .92 · 88th of forwards", or with the caveat appended when this
 * player's own sample is too thin to have helped set the scale. The caveat
 * is not optional decoration: a 4-game call-up placed against 600 forwards
 * looks authoritative and is not.
 */
export function qualitySignalLine(
  signal: QualitySignal | null,
  options: { includeValue?: boolean } = {},
): string | null {
  if (!signal) return null;
  const includeValue = options.includeValue ?? true;
  // `includeValue: false` drops the raw number and keeps the placement. The
  // on-clock bar measured 391px of line inside a 353px bar with the value in;
  // the cohort is the half that cannot be dropped, because a percentile
  // without its comparison set is not a fact. The raw value keeps its place
  // in the bar's `title` and on every surface that has room for it.
  const head = includeValue ? `${signal.metric} ${signal.value} · ` : `${signal.metric} `;
  const base = `${head}${ordinalPercentile(signal.percentile)} of ${signal.cohortNoun}`;
  return signal.lowSample ? `${base} · thin sample` : base;
}

/**
 * THE SERVER'S HALF OF THE WRITEUP (2026-09-11).
 *
 * `index.ts` next door writes the prose. This file assembles what it writes
 * the prose FROM, out of rows the API server already reads, so a player
 * card's words can change with a server deploy instead of an App Store
 * round trip.
 *
 * PURE ON PURPOSE. Not one line here touches Supabase, Hono or a clock it
 * was not handed. `PlayerWriteupService` does the reading and calls in
 * here; every branch below is reachable from a plain object in a test,
 * which is what makes the golden-equality suite possible at all.
 *
 * WHAT THE CLIENT USED TO DO, AND WHERE IT NOW HAPPENS
 *
 *   age                  player_directory.birthdate         `ageOn`
 *   goalsBySeason        player_xg_season, regular only     below
 *   career               player_directory.career            passed through
 *   xg/gar percentile    the dashboard index cohort         below
 *   cohortNoun/Size      the same cohort                    below
 *   projFp/projGp        player_ros_projections + league    `projectionFor`
 *   posRank              the same, ranked within position    below
 *   projectionLabel      season framing                     below
 *
 * ONE DELIBERATE BEHAVIOUR CHANGE. The browser computed percentiles against
 * whatever slice of the index it happened to have loaded; the server
 * computes them against the full qualified universe, because it has it.
 * The server's answer is the correct one and some writeups read differently
 * because of it. That is an improvement, and it is recorded here so a
 * changed sentence is not later chased as a bug.
 */
import { getProjectionsSeason, getSeasonStartDate } from '../constants/season';
import { ScoringCalculator } from '../utils/scoring';
import type { DashboardIndexEntry, XgHistoryPoint } from '../types/playerDashboard';
import {
  COHORT_NOUN,
  percentileOnScale,
  playerCohort,
  qualifiedCohort,
  scaleFrom,
} from '../playerPercentiles';
import { projectionFor, projectionSettings } from '../leagueProjection';
import {
  generatePlayerWriteup,
  type CareerSummary,
  type PlayerWriteup,
  type WriteupExtras,
  type WriteupPlayer,
} from './index';

/**
 * Age on a given day from an ISO birthdate. Lifted out of
 * `apps/web/src/components/player/vitals.ts`, which now imports it, so the
 * bio strip and the writeup can never disagree about how old a man is.
 *
 * The 70 ceiling is a sanity bound, not a business rule: a directory row
 * with a garbled birthdate reads as no age rather than as a 120-year-old
 * winger.
 */
export function ageOn(birthdate: string, today: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthdate);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getFullYear() - y;
  const beforeBirthday = today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 70 ? age : null;
}

/** Total seconds over games played, as the "21:34" the engine parses. */
function toiPerGame(totalSeconds: number | null | undefined, gamesPlayed: number | null | undefined): string | undefined {
  // MISSING IS NOT ZERO. A row without ice time used to read "0:00" and the
  // writeup took it as a real zero ("0 minutes a night", on Ovechkin).
  if (!totalSeconds || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return undefined;
  if (!gamesPlayed || !Number.isFinite(gamesPlayed) || gamesPlayed <= 0) return undefined;
  const avg = totalSeconds / gamesPlayed;
  const mins = Math.floor(avg / 60);
  const secs = Math.floor(avg % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/** 2026 -> "2026-27". */
function seasonLabel(season: number): string {
  return `${season}-${String((season + 1) % 100).padStart(2, '0')}`;
}

/**
 * One index row as the engine's player.
 *
 * `save_pct` goes through UNCHANGED. Every one of the 98 goalie rows in
 * production for 2025 carries it as a fraction (0.714 to 1.000, checked
 * 2026-09-11), which is the shape `normalizeSavePct` passes straight
 * through, so normalising here would be a second opinion on a number that
 * does not need one.
 *
 * `status` derives from `roster_status` the same way `PlayerService` does
 * for the browser, so the two sides agree on who is unavailable. That
 * column is NULL on all 940 talent rows in production today, which means
 * neither side prints an availability line for anyone; when the pipeline
 * starts filling it, both start printing at the same moment.
 */
export function writeupPlayerFromIndex(entry: DashboardIndexEntry): WriteupPlayer {
  const rosterStatus = entry.roster_status;
  return {
    id: entry.id,
    name: entry.name,
    position: entry.position,
    ...(entry.actuals_season != null ? { statsSeason: entry.actuals_season } : {}),
    status: rosterStatus === 'IR' || rosterStatus === 'LTIR' ? 'IR' : null,
    stats: {
      gamesPlayed: entry.gp,
      goals: entry.goals,
      assists: entry.assists,
      points: entry.points,
      plusMinus: entry.plus_minus,
      shots: entry.sog,
      blockedShots: entry.blocks,
      hits: entry.hits,
      powerPlayPoints: entry.ppp,
      toi: toiPerGame(entry.toi_seconds, entry.gp),
      xGoals: entry.x_goals,
      wins: entry.wins,
      losses: entry.losses,
      gaa: entry.gaa,
      savePct: entry.save_pct,
      shutouts: entry.shutouts,
      goalsSavedAboveExpected: entry.gsax_regressed ?? undefined,
    },
  };
}

/** Everything the assembly needs that is not the engine's own arithmetic. */
export interface WriteupSources {
  /** The player's own row out of the dashboard index. */
  entry: DashboardIndexEntry;
  /** The whole index. The cohort is selected from it; do not pre-filter. */
  index: readonly DashboardIndexEntry[];
  /** `player_xg_season`, merged per season. Both game types; regular is used. */
  xgSeasons?: readonly XgHistoryPoint[] | null;
  /** `player_directory.career`, the NHL landing document. */
  career?: CareerSummary | null;
  /** `player_directory.birthdate`, ISO. */
  birthdate?: string | null;
  /**
   * The league's own scoring weights, or null when the caller supplied no
   * league. NULL MEANS NO PROJECTION SENTENCE, never league-neutral
   * scoring: there are 16 distinct scoring shapes across the 68 leagues in
   * production, and a wrong number is worse than a missing one.
   */
  scoring?: unknown | null;
  /** Injected so a test is not at the mercy of the day it runs on. */
  now?: Date;
}

/**
 * The cohort-relative reads, against the FULL qualified universe.
 *
 * xG/60 and GAR/60 only, and nothing else off the advanced card: the
 * writeup quotes exactly those two and names the cohort it quotes them
 * against. Goalies have neither column in this payload, so both come back
 * null and the engine's comparison sentence never fires for one, which is
 * the same thing the card does.
 */
export function cohortReads(
  entry: DashboardIndexEntry,
  index: readonly DashboardIndexEntry[],
): Pick<WriteupExtras, 'xgPercentile' | 'garPercentile' | 'cohortNoun' | 'cohortSize'> {
  const cohort = playerCohort(entry);
  const members = qualifiedCohort(index, cohort);
  return {
    xgPercentile: percentileOnScale(scaleFrom(members, (m) => m.xg_per_60, 'higher'), entry.xg_per_60),
    garPercentile: percentileOnScale(scaleFrom(members, (m) => m.gar_per_60, 'higher'), entry.gar_per_60),
    cohortNoun: COHORT_NOUN[cohort],
    cohortSize: members.length,
  };
}

/**
 * Where this player ranks at his position, under this league's scoring.
 *
 * Position-primary and league-scored, exactly as the modal computes it: a
 * dual-eligible C/LW is ranked once, among centres, because that is the
 * position the pool sorts him by. Null without a league, because the rank
 * is a claim about a scoring system and there isn't one.
 */
export function positionRank(
  entry: DashboardIndexEntry,
  index: readonly DashboardIndexEntry[],
  scoring: unknown | null | undefined,
): string | null {
  if (scoring == null) return null;
  const settings = projectionSettings(scoring);
  const scorer = new ScoringCalculator(settings);
  const mine = projectionFor(entry, scorer, settings)?.total;
  if (mine == null || !Number.isFinite(mine)) return null;
  let ahead = 0;
  for (const p of index) {
    if (p.position !== entry.position) continue;
    const theirs = projectionFor(p, scorer, settings)?.total;
    if (theirs != null && Number.isFinite(theirs) && theirs > mine) ahead += 1;
  }
  return `${entry.position}${ahead + 1}`;
}

/**
 * How the projection is framed: a season before the opener, the rest of it
 * after. The same two phrasings `projectionFraming` gives the card, so the
 * sentence under the bar matches the bar.
 */
export function projectionLabelFor(now: Date, season = getProjectionsSeason(now)): string {
  const start = getSeasonStartDate(season);
  const beforeOpener = start ? now < new Date(`${start}T00:00:00`) : false;
  return beforeOpener ? `for ${seasonLabel(season)}` : `for the rest of ${seasonLabel(season)}`;
}

/** Assemble the extras the engine hangs its extra sentences on. */
export function writeupExtrasFromSources(src: WriteupSources): WriteupExtras {
  const now = src.now ?? new Date();
  const scoring = src.scoring ?? null;
  const projectionSeason = src.entry.projection_season ?? getProjectionsSeason(now);

  const goalsBySeason = (src.xgSeasons ?? [])
    .filter((p) => p.game_type === 'regular' && Number.isFinite(p.goals))
    .map((p) => ({ season: p.season, goals: p.goals }))
    .sort((a, b) => a.season - b.season);

  let projFp: number | null = null;
  let projGp: number | null = null;
  if (scoring != null) {
    const settings = projectionSettings(scoring);
    const projection = projectionFor(src.entry, new ScoringCalculator(settings), settings);
    if (projection) {
      projFp = projection.total;
      projGp = projection.gamesRemaining;
    }
  }

  return {
    ...(src.entry.actuals_season != null || src.entry.projection_season != null ? { projectionSeason } : {}),
    age: src.birthdate ? ageOn(src.birthdate, now) : null,
    goalsBySeason,
    ...cohortReads(src.entry, src.index),
    projFp,
    projGp,
    posRank: projFp == null ? null : positionRank(src.entry, src.index, scoring),
    projectionLabel: projectionLabelFor(now, projectionSeason),
    career: src.career ?? null,
  };
}

/** The finished object the endpoint puts on the wire. */
export function buildWriteupFromSources(src: WriteupSources): PlayerWriteup {
  return generatePlayerWriteup(writeupPlayerFromIndex(src.entry), writeupExtrasFromSources(src));
}

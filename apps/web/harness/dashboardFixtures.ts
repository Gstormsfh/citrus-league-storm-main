/**
 * `/api/players/:playerId/dashboard` fixtures for the player-dashboard
 * harness — Component 6.5.
 *
 * ── WHAT IS REAL HERE AND WHAT IS NOT ──────────────────────────────────
 *
 * REAL, straight off `harness/players.ts` (read out of the production
 * `players` table on 2026-09-02): names, teams, sweater numbers, NHL player
 * ids, headshot URLs, and the 2025-26 counting lines — goals, assists,
 * points, shots, wins, GAA, save percentage.
 *
 * NOT REAL, and it cannot be: every SHOT COORDINATE, every per-shot xG,
 * every `player_xg_season` row and the GSAx line. The harness has no
 * database and `/api/players/:playerId/dashboard` is precisely the thing
 * being stood in for. They are generated from a SEEDED generator so a
 * screenshot is reproducible, they are placed in realistic clusters so the
 * layout can be measured, and they are internally consistent — `distance`
 * is computed FROM the coordinates, `finishing` is `goals − xg` — so the
 * page cannot contradict itself while a reviewer is looking at it.
 *
 * The page says so on itself: `harness/dashboard.tsx` renders a disclaimer
 * strip under the mounted page. **Read the LAYOUT off this harness, never a
 * number.**
 *
 * ── AND ONE THING THE FIXTURE IS DELIBERATELY TESTING ──────────────────
 *
 * `playerDashboardData.projectShot` refuses to place a shot whose stored
 * `distance` disagrees with `hypot(89 − x, y)` by more than 6 ft, because a
 * shot map that is silently wrong is worse than one that is absent. These
 * fixtures compute `distance` from the coordinates, so a rendered dot is
 * also evidence that the guard admits well-formed rows. The `?case=skewed`
 * entry breaks that relationship on purpose and must produce the labelled
 * fallback hero, not a wrong map.
 */
import type {
  DashboardSeasonRow,
  DashboardShot,
  PlayerDashboardPayload,
} from '../src/hooks/usePlayerDashboard';
import type { DashboardIndexEntry } from '../src/hooks/usePlayerDashboardIndex';
import { HARNESS_PLAYERS, harnessHeadshotUrl, harnessPlayer, type HarnessPlayer } from './players';

// ── Deterministic noise ──────────────────────────────────────────────
// mulberry32: 32 bits of state, no dependency, and the same sequence on
// every machine. `Math.random()` in a fixture makes every screenshot a
// different screenshot, which makes visual review impossible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller, so the clusters look like shot clusters and not like a grid. */
function gaussian(rand: () => number, mean: number, sd: number): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const GOAL_LINE_X = 89;

interface Cluster {
  /** Share of the season's attempts that come from here. */
  weight: number;
  /** Mean position in FEET on the model frame: goal line at x = 89. */
  x: number;
  y: number;
  sdX: number;
  sdY: number;
  powerPlay?: boolean;
  rush?: number;
  rebound?: number;
}

/**
 * A forward's shot profile: heavy in the slot, circles either side, a thin
 * tail from the point. Weights are the shape of a real shooter's season, not
 * a measurement of any particular one.
 */
const FORWARD_CLUSTERS: Cluster[] = [
  { weight: 0.20, x: 76, y: 0, sdX: 3.5, sdY: 4.5, rush: 0.25, rebound: 0.3 },
  { weight: 0.24, x: 65, y: 0, sdX: 5, sdY: 6.5, rush: 0.3, rebound: 0.15 },
  { weight: 0.16, x: 50, y: 0, sdX: 5, sdY: 7.5, rush: 0.35 },
  { weight: 0.12, x: 67, y: 20, sdX: 4.5, sdY: 4.5, powerPlay: true },
  { weight: 0.12, x: 67, y: -20, sdX: 4.5, sdY: 4.5, powerPlay: true },
  { weight: 0.08, x: 34, y: 0, sdX: 4, sdY: 14 },
  { weight: 0.08, x: 72, y: 32, sdX: 7, sdY: 5 },
];

/** A defenceman shoots from the line; the slot is somebody else's office. */
const DEFENCE_CLUSTERS: Cluster[] = [
  { weight: 0.42, x: 31, y: 12, sdX: 3, sdY: 10 },
  { weight: 0.26, x: 31, y: -12, sdX: 3, sdY: 10, powerPlay: true },
  { weight: 0.16, x: 48, y: 0, sdX: 6, sdY: 10 },
  { weight: 0.10, x: 64, y: 18, sdX: 5, sdY: 6 },
  { weight: 0.06, x: 72, y: 2, sdX: 4, sdY: 5, rebound: 0.4 },
];

function pickCluster(clusters: Cluster[], r: number): Cluster {
  let acc = 0;
  for (const c of clusters) {
    acc += c.weight;
    if (r <= acc) return c;
  }
  return clusters[clusters.length - 1];
}

/**
 * A distance-driven xG curve. NOT the Citrus model — a monotone stand-in so
 * the rink's colour buckets (high / medium / low) all get exercised and the
 * slot reads hotter than the point, which is the only property the LAYOUT
 * depends on.
 */
function fixtureXg(distanceFt: number, rush: boolean, rebound: boolean): number {
  // Coefficient tuned so the mean lands near 0.095 xG per attempt, which is
  // the same neighbourhood as the derived `x_goals` on the harness index
  // (shots × 0.083). The two are deliberately CLOSE BUT NOT EQUAL, because
  // production carries expected goals in two pipelines that also differ — and
  // the page has a line that explains the gap which ought to be visible in a
  // review screenshot rather than only in the source.
  const base = 0.30 * Math.exp(-distanceFt / 30);
  const bumped = base * (rush ? 1.35 : 1) * (rebound ? 1.6 : 1);
  return Math.min(0.62, Math.max(0.004, Number(bumped.toFixed(4))));
}

function isoDate(dayOffset: number): string {
  // A fixed anchor, not `new Date()` — the season is over in this fixture
  // and a moving date makes every screenshot different.
  const start = Date.UTC(2025, 9, 8); // 2025-10-08, opening week
  return new Date(start + dayOffset * 86400000).toISOString().slice(0, 10);
}

export interface ShotFixtureOptions {
  /** Exactly this many attempts. Use the player's REAL season shot total. */
  attempts: number;
  /**
   * Exactly this many of them are goals — the player's REAL season goal
   * total. They are chosen as the highest-xG attempts, deterministically, so
   * the map's goal cluster sits where a goal cluster belongs AND the count on
   * the map equals the count on the card at the top of the page. A fixture
   * whose own numbers disagree teaches a reviewer to stop trusting the page.
   */
  goals: number;
  seed: number;
  defence?: boolean;
  /**
   * Break the coordinate ↔ distance relationship, to exercise the guard in
   * `projectShot` and the labelled fallback the page renders when a map
   * cannot be verified.
   */
  skewDistances?: boolean;
}

export function buildShots(opts: ShotFixtureOptions): DashboardShot[] {
  const rand = mulberry32(opts.seed);
  const clusters = opts.defence ? DEFENCE_CLUSTERS : FORWARD_CLUSTERS;
  const out: DashboardShot[] = [];

  for (let i = 0; i < opts.attempts; i++) {
    const cluster = pickCluster(clusters, rand());
    const x = gaussian(rand, cluster.x, cluster.sdX);
    const y = gaussian(rand, cluster.y, cluster.sdY);
    const depth = GOAL_LINE_X - x;
    const distance = Math.hypot(depth, y);
    const angle = (Math.atan2(Math.abs(y), Math.max(depth, 0.1)) * 180) / Math.PI;

    const rush = rand() < (cluster.rush ?? 0.08);
    const rebound = rand() < (cluster.rebound ?? 0.06);
    const xg = fixtureXg(distance, rush, rebound);
    const powerPlay = cluster.powerPlay === true && rand() < 0.75;

    out.push({
      game_id: 2025020000 + Math.floor(i / 3),
      event_id: 100 + (i % 900),
      game_date: isoDate(Math.floor(i / 3) * 2),
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      distance: Number((opts.skewDistances ? distance + 28 : distance).toFixed(2)),
      angle: Number(angle.toFixed(2)),
      xg,
      is_goal: false,
      shot_type: ['wrist', 'snap', 'slap', 'backhand', 'tip-in'][Math.floor(rand() * 5)],
      event_type: rand() < 0.55 ? 'shot-on-goal' : 'missed-shot',
      is_rush: rush,
      is_rebound: rebound,
      is_power_play: powerPlay,
      is_shorthanded: false,
      is_empty_net: false,
      strength_state: powerPlay ? '5v4' : '5v5',
    });
  }

  // Exactly `goals` of them go in, and they are the best chances — which is
  // both how scoring works and the only way the map's goal count can equal
  // the real season total the identity strip is showing.
  const byQuality = out
    .map((s, i) => ({ i, xg: s.xg ?? 0 }))
    .sort((a, b) => b.xg - a.xg)
    .slice(0, Math.max(0, Math.min(opts.goals, out.length)));
  for (const { i } of byQuality) {
    out[i].is_goal = true;
    out[i].event_type = 'goal';
  }
  return out;
}

/** The `player_xg_season` aggregate for a generated shot list. */
export function aggregateShots(shots: DashboardShot[]): {
  shots: number;
  goals: number;
  xg: number;
} {
  let goals = 0;
  let xg = 0;
  for (const s of shots) {
    if (s.is_goal) goals += 1;
    xg += s.xg ?? 0;
  }
  return { shots: shots.length, goals, xg: Number(xg.toFixed(2)) };
}

/**
 * Nine seasons of `player_xg_season`, ending on the player's REAL 2025-26
 * goal total so the current-season row agrees with the identity strip and
 * the condensed card above it. `finishing` is computed as `goals − xg`,
 * never asserted independently, so nothing on the page can disagree.
 */
export function buildSeasons(
  p: HarnessPlayer,
  seed: number,
  /**
   * The 2025-26 row, taken from the SHOT LIST the same case generated, so the
   * career-arc tile, the shot map and the zone breakdown are three views of
   * one set of events rather than three unrelated guesses.
   */
  current?: { shots: number; goals: number; xg: number },
): DashboardSeasonRow[] {
  const rand = mulberry32(seed);
  const rows: DashboardSeasonRow[] = [];
  const realGoals = p.goals ?? 0;
  const realShots = p.shots ?? 0;

  for (let season = 2017; season <= 2025; season++) {
    const ramp = 0.55 + 0.05 * (season - 2017);
    const isCurrent = season === 2025;
    const shots = isCurrent
      ? (current?.shots ?? realShots)
      : Math.round(realShots * ramp * (0.85 + rand() * 0.3));
    const goals = isCurrent
      ? (current?.goals ?? realGoals)
      : Math.round(realGoals * ramp * (0.8 + rand() * 0.45));
    const xg =
      isCurrent && current
        ? current.xg
        : Number((shots * (0.082 + rand() * 0.012)).toFixed(2));
    const sog = Math.round(shots * 0.58);
    rows.push({
      season,
      game_type: 'regular',
      shots,
      sog,
      goals,
      xg,
      finishing: Number((goals - xg).toFixed(2)),
      shots_ev: Math.round(shots * 0.72),
      shots_pp: Math.round(shots * 0.24),
      shots_pk: shots - Math.round(shots * 0.72) - Math.round(shots * 0.24),
      goals_ev: Math.round(goals * 0.68),
      goals_pp: Math.round(goals * 0.28),
      goals_sh: Math.max(0, goals - Math.round(goals * 0.68) - Math.round(goals * 0.28)),
      xg_ev: Number((xg * 0.7).toFixed(2)),
      xg_pp: Number((xg * 0.26).toFixed(2)),
      xg_pk: Number((xg * 0.04).toFixed(2)),
      goals_en: season % 3 === 0 ? 1 : 0,
      xg_en: Number((xg * 0.02).toFixed(2)),
      avg_dist: Number((24 + rand() * 8).toFixed(1)),
      avg_xg_per_shot: shots > 0 ? Number((xg / shots).toFixed(4)) : null,
      rebounds_shot: Math.round(shots * 0.08),
      rush_shots: Math.round(shots * 0.17),
    });
  }
  return rows;
}

const AS_OF = '2026-09-02T06:12:00.000Z';

function identityFor(p: HarnessPlayer) {
  return {
    player_id: Number(p.nhlId),
    name: p.name,
    team: p.team,
    position: p.position,
    jersey: Number(p.jersey),
    headshot_url: harnessHeadshotUrl(p.team, p.nhlId),
    is_goalie: p.position === 'G',
  };
}

function talentFor(p: HarnessPlayer, seed: number) {
  const rand = mulberry32(seed);
  if (p.position === 'G') {
    return {
      xg_per_60: null,
      xg_rating: null,
      vopa_score: Number((1.4 + rand()).toFixed(3)),
      avg_toi_per_game: Number((58 + rand() * 2).toFixed(2)),
      positional_replacement_level: 0.41,
      positional_std_dev: 0.22,
    };
  }
  return {
    xg_per_60: Number((0.7 + rand() * 0.9).toFixed(2)),
    xg_rating: 'Elite',
    vopa_score: Number((1.8 + rand() * 1.6).toFixed(3)),
    avg_toi_per_game: Number((17 + rand() * 5).toFixed(2)),
    positional_replacement_level: 0.41,
    positional_std_dev: 0.22,
  };
}

/** Every case the harness serves, keyed by the case name in `?case=`. */
export type DashboardCase = 'skater' | 'defence' | 'goalie' | 'empty' | 'noshots' | 'skewed';

interface CaseSpec {
  player: HarnessPlayer;
  build: (p: HarnessPlayer) => PlayerDashboardPayload;
}

function basePayload(p: HarnessPlayer): PlayerDashboardPayload {
  return {
    player_id: Number(p.nhlId),
    season: 2025,
    game_type: 'regular',
    player: identityFor(p),
    shots: [],
    shots_available: true,
    shots_truncated: false,
    shots_cap: 1200,
    seasons: [],
    gsax: null,
    talent: talentFor(p, Number(p.nhlId)),
    as_of: AS_OF,
  };
}

const CASES: Record<DashboardCase, CaseSpec> = {
  // A forward with a full season on the board. The signature composition.
  skater: {
    player: harnessPlayer('Connor McDavid'),
    build: (p) => {
      const shots = buildShots({ attempts: p.shots ?? 0, goals: p.goals ?? 0, seed: 97 });
      return { ...basePayload(p), shots, seasons: buildSeasons(p, 97, aggregateShots(shots)) };
    },
  },
  // A defenceman, so the zone breakdown is dominated by the point and the
  // Shot Breakdown tile has to read correctly when the slot row is thin.
  defence: {
    player: harnessPlayer('Cale Makar'),
    build: (p) => {
      const shots = buildShots({
        attempts: p.shots ?? 0,
        goals: p.goals ?? 0,
        seed: 8,
        defence: true,
      });
      return { ...basePayload(p), shots, seasons: buildSeasons(p, 8, aggregateShots(shots)) };
    },
  },
  // A goalie: no shot map of his own attempts, GSAx hero instead, and no
  // `player_xg_season` rows at all — which is also the empty career-arc tile.
  goalie: {
    player: harnessPlayer('Carter Hart'),
    build: (p) => ({
      ...basePayload(p),
      gsax: {
        season: 2025,
        shots_faced: 1204,
        xga: 96.4,
        ga: 89,
        raw_gsax: 7.4,
        regressed_gsax: 4.9,
        league_sv_pct: 0.9033,
      },
    }),
  },
  // A real player with nothing on record for this season: the honest empty
  // state. No shots, no seasons, no talent row, and NO `as_of` — so the
  // freshness badge must not render a claim it cannot support.
  empty: {
    player: harnessPlayer('Cutter Gauthier'),
    build: (p) => ({ ...basePayload(p), talent: null, as_of: null }),
  },
  // The shot read failed (no service-role client, or the table refused).
  // Distinct from "no shots" and the page must say which one it is.
  noshots: {
    player: harnessPlayer('Nathan MacKinnon'),
    build: (p) => ({
      ...basePayload(p),
      shots_available: false,
      seasons: buildSeasons(p, 29),
    }),
  },
  // Coordinates that disagree with their own stored distances. The guard in
  // `projectShot` must drop them and the page must fall back rather than
  // draw a map it cannot stand behind.
  skewed: {
    player: harnessPlayer('Kirill Kaprizov'),
    build: (p) => {
      const shots = buildShots({
        attempts: p.shots ?? 0,
        goals: p.goals ?? 0,
        seed: 97,
        skewDistances: true,
      });
      return { ...basePayload(p), shots, seasons: buildSeasons(p, 97, aggregateShots(shots)) };
    },
  },
};

export const DASHBOARD_CASES = Object.keys(CASES) as DashboardCase[];

export function caseIdFor(name: DashboardCase): number {
  return Number(CASES[name].player.nhlId);
}

export function playerDashboardFixture(playerId: number): PlayerDashboardPayload | null {
  for (const name of DASHBOARD_CASES) {
    const spec = CASES[name];
    if (Number(spec.player.nhlId) === playerId) return spec.build(spec.player);
  }
  return null;
}

/**
 * A `/api/players/dashboard-index` slice keyed on the REAL NHL ids, so the
 * cohort the dashboard ranks against, the condensed card at the top of it,
 * and the identity strip all resolve to the same 60 players.
 *
 * The advanced columns are derived arithmetic, exactly as
 * `harness/advanced.tsx` documents for the same reason.
 */
export const DASHBOARD_PLAYER_INDEX: DashboardIndexEntry[] = HARNESS_PLAYERS.map((p, i) => {
  const isGoalie = p.position === 'G';
  const isD = p.position === 'D';
  const gp = isGoalie ? (p.wins ?? 0) + (p.losses ?? 0) + (p.otLosses ?? 0) : 24 + (i % 9);
  const shots = p.shots ?? 0;
  /**
   * Expected goals per attempt, split by position.
   *
   * A flat 0.083 for everyone — what the other harness fixtures use — made a
   * defenceman's card read 5.50 expected against the dashboard tile's 1.92,
   * because the tile sums a shot list that is 67% point shots and the card
   * multiplied a constant. The page has a line explaining that the two
   * pipelines differ; it should not have to explain a threefold gap that only
   * exists because the fixture ignores where the shots came from.
   */
  const xgPerShot = isD ? 0.045 : 0.095;
  const xGoals = isGoalie ? 0 : Math.round(shots * xgPerShot * 10) / 10;
  const sixties = gp > 0 ? (gp * (isD ? 21 : 18)) / 60 : 0;
  const ppg = gp > 0 ? (p.points ?? 0) / gp : 0;
  const garTotal = isGoalie ? null : Math.round(ppg * 0.55 * 100) / 100;
  /**
   * Each GAR component gets its OWN deterministic wobble.
   *
   * Measured in the harness first: with every component a fixed multiple of
   * one total, every player's ranking on EV offence, EV defence and PP
   * offence is identical by construction, so `PercentileRingCluster` drew
   * three rings all reading 95% and looked broken. The wobble is seeded on
   * the player id and the component index, so the three rings differ, every
   * screenshot is reproducible, and no reviewer mistakes a fixture artefact
   * for a rendering bug.
   */
  const wobble = (k: number) => {
    const t = Math.sin(Number(p.nhlId) * 0.0001 + k * 2.399) * 0.5;
    return 1 + t;
  };
  const share = (f: number, k = 0) =>
    garTotal == null ? null : Math.round(garTotal * f * wobble(k) * 100) / 100;

  return {
    id: Number(p.nhlId),
    name: p.name,
    team: p.team,
    position: p.position,
    jersey: Number(p.jersey),
    headshot_url: harnessHeadshotUrl(p.team, p.nhlId),
    is_goalie: isGoalie,
    roster_status: null,
    gp,
    goals: p.goals ?? 0,
    assists: p.assists ?? 0,
    points: p.points ?? 0,
    sog: shots,
    hits: 0,
    blocks: 0,
    ppp: 0,
    plus_minus: p.plusMinus ?? 0,
    x_goals: xGoals,
    wins: p.wins ?? 0,
    saves: isGoalie ? 600 + i * 7 : 0,
    save_pct: p.savePct ?? 0,
    gaa: p.gaa ?? 0,
    shutouts: isGoalie ? i % 4 : 0,
    xg_per_60: isGoalie || sixties === 0 ? null : Math.round((xGoals / sixties) * 100) / 100,
    xg_rating: null,
    gar_per_60: garTotal,
    gar_evo: isD ? share(0.25, 1) : share(0.6, 1),
    gar_evd: isD ? share(0.5, 2) : share(0.12, 2),
    gar_ppo: share(0.2, 3),
    gar_ppd: share(0.03, 4),
    gar_pen: share(0.05, 5),
    proj_gp: isGoalie ? 34 : 58,
    proj_fantasy_points: Math.round(ppg * (isGoalie ? 34 : 58) * 4.2 * 10) / 10,
    proj_fantasy_ppg: Math.round(ppg * 4.2 * 100) / 100,
    proj_goals: Math.round((p.goals ?? 0) * 2.4),
    proj_assists: Math.round((p.assists ?? 0) * 2.4),
    proj_sog: Math.round(shots * 2.4),
    proj_ppp: Math.round((p.points ?? 0) * 0.3),
    proj_wins: isGoalie ? Math.round((p.wins ?? 0) * 1.6) : null,
    proj_saves: isGoalie ? 780 : null,
    proj_shutouts: isGoalie ? 2 : null,
  };
});

import { SupabaseClient } from '@supabase/supabase-js';
import {
  getCurrentSeason,
  getProjectionsSeason,
  logger,
  type DashboardIndexEntry,
  type PlayerXgHistoryPayload,
  type XgHistoryPoint,
} from '@citrus/shared';

/**
 * The index row shape moved to `packages/shared/src/types/playerDashboard.ts`
 * on 2026-09-03 so the web hook can import it instead of hand-mirroring it.
 * Re-exported under the name this file has always exported, so
 * `DraftKitService` and the route keep their import.
 */
export type { DashboardIndexEntry, PlayerXgHistoryPayload, XgHistoryPoint };

/**
 * PlayerDashboardService — read-model for the league-wide Players
 * section (browse index + per-player advanced-metrics dashboard).
 *
 * Deliberately SEPARATE from PlayerService.getAllPlayers():
 *   - getAllPlayers feeds the draft pool / free agents and is cached
 *     with a narrow NormalizedPlayer shape. Bolting GAR + projections
 *     onto it would grow a hot draft-path payload for a browse page.
 *   - This service joins six tables (directory, season stats, GAR
 *     components, talent metrics, goalie GSAx, ROS projections) into a
 *     shape the dashboard UI consumes directly.
 *
 * Join key is player_id everywhere; season-scoped tables are filtered
 * to getCurrentSeason() (2025 = the 2025-26 season until the 2026-27
 * start date). No FKs exist between these tables by design — the
 * directory is the curated fantasy-relevant set; stat/metric tables
 * are pipeline outputs. In-memory Map join, same pattern the autopick
 * worker uses.
 */

interface DirectoryRow {
  player_id: number;
  full_name: string;
  position_code: string;
  team_abbrev: string;
  jersey_number: string | null;
  headshot_url: string | null;
  eligible_positions: string[] | null;
}

interface StatsRow {
  player_id: number;
  games_played: number;
  nhl_goals: number;
  nhl_assists: number;
  nhl_points: number;
  nhl_shots_on_goal: number;
  nhl_hits: number;
  nhl_blocks: number;
  nhl_pim: number;
  nhl_ppp: number;
  nhl_shp: number;
  nhl_plus_minus: number;
  nhl_toi_seconds: number;
  x_goals: number;
  goalie_gp: number;
  nhl_wins: number;
  nhl_losses: number;
  nhl_ot_losses: number;
  nhl_saves: number;
  nhl_save_pct: number;
  nhl_gaa: number;
  nhl_shutouts: number;
  nhl_goals_against: number;
  updated_at: string | null;
}

interface GarRow {
  player_id: number;
  evo_gar_per_60: number | null;
  evd_gar_per_60: number | null;
  ppo_gar_per_60: number | null;
  ppd_gar_per_60: number | null;
  penalty_gar_per_60: number | null;
  total_gar_per_60: number | null;
  /** `numeric` in Postgres; coerced through `num()` before it reaches the wire. */
  toi_total_minutes: number | string | null;
  updated_at: string | null;
}

interface TalentRow {
  player_id: number;
  xg_per_60: number | null;
  xg_rating: string | null;
  roster_status: string | null;
  /** Both `numeric`; both NULL on every 2025 production row as of 2026-09-03. */
  vopa_score: number | string | null;
  avg_toi_per_game: number | string | null;
  updated_at: string | null;
}

interface RosRow {
  player_id: number;
  games_remaining: number | null;
  total_projected_points: number | null;
  avg_points_per_game: number | null;
  projected_goals: number | null;
  projected_assists: number | null;
  projected_sog: number | null;
  projected_ppp: number | null;
  projected_hits: number | null;
  projected_blocks: number | null;
  projected_wins_ros: number | null;
  projected_saves_ros: number | null;
  projected_shutouts_ros: number | null;
  updated_at: string | null;
}

/**
 * `goalie_gsax_primary`, as the INDEX reads it. `goalie_id` is that table's
 * primary key (migration 20250114000001) and the same NHL id as
 * `player_directory.player_id`; `season` was added later and is nullable.
 * The `numeric` columns arrive as strings on some paths and numbers on
 * others, so every one goes through `num()`.
 */
interface IndexGsaxRow {
  goalie_id: number;
  season: number | null;
  total_shots_faced: number | null;
  total_xga: number | string | null;
  total_ga: number | null;
  raw_gsax: number | string | null;
  regressed_gsax: number | string | null;
  updated_at: string | null;
}

// `updated_at` rides along on every season-scoped table so the index can
// carry a real `as_of` per player (see the field's note in the shared type).
const INDEX_STATS_COLS =
  'player_id, games_played, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_shp, nhl_plus_minus, nhl_toi_seconds, x_goals, goalie_gp, nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_save_pct, nhl_gaa, nhl_shutouts, nhl_goals_against, updated_at';
const GAR_COLS =
  'player_id, evo_gar_per_60, evd_gar_per_60, ppo_gar_per_60, ppd_gar_per_60, penalty_gar_per_60, total_gar_per_60, toi_total_minutes, updated_at';
const TALENT_COLS = 'player_id, xg_per_60, xg_rating, roster_status, vopa_score, avg_toi_per_game, updated_at';
const ROS_COLS =
  'player_id, games_remaining, total_projected_points, avg_points_per_game, projected_goals, projected_assists, projected_sog, projected_ppp, projected_hits, projected_blocks, projected_wins_ros, projected_saves_ros, projected_shutouts_ros, updated_at';
const INDEX_GSAX_COLS =
  'goalie_id, season, total_shots_faced, total_xga, total_ga, raw_gsax, regressed_gsax, updated_at';

// 2-minute in-process cache, same TTL philosophy as PlayerService:
// short enough to surface nightly-pipeline refreshes, long enough to
// absorb a browse session's re-fetches.
let indexCache: { season: number; data: DashboardIndexEntry[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000;

/**
 * STAMPEDE GUARD (2026-09-02 scale audit).
 *
 * `getDashboardIndex` is the most expensive read in the app: six paged
 * table fan-outs plus a five-Map merge over every player in the
 * directory. Behind a plain check-then-fetch cache, the two-minute
 * expiry is a synchronised miss — every request in flight at that
 * instant does all six reads and the whole merge, concurrently.
 *
 * One shared promise per season collapses that back to one load. Callers
 * that arrive while a load is running await the same promise; nobody sees
 * a different answer than they would have.
 */
let indexInFlight: { season: number; promise: Promise<{ players: DashboardIndexEntry[]; error: Error | null }> } | null = null;

/**
 * PostgREST silently clamps an unbounded `.select()` to the project's
 * `max-rows` setting and returns a 200 with a truncated body — no error,
 * no warning. This project has been bitten by exactly that on exactly
 * these tables: see the field note in
 * apps/web/src/hooks/usePreloadedPlayers.ts, where an unpaged
 * player_directory read came back ~1000 rows in physical-row order and
 * MacKinnon and McDavid were simply absent from the window.
 *
 * player_directory is ~1.9k rows in prod and ~2.0k in staging, so an
 * unpaged read here would have shipped a Players page showing roughly
 * half the league with missing stars looking like they don't exist.
 * Page explicitly instead.
 *
 * `.order('player_id')` is REQUIRED, not cosmetic: Postgres gives no
 * stable row order across separate LIMIT/OFFSET queries, so paging
 * without an explicit sort can duplicate and skip rows between windows.
 */
const PAGE_SIZE = 1000;
/** Guard against a pathological loop if a table ever returns full pages forever. */
const MAX_PAGES = 25;

interface PagedRead {
  table: string;
  columns: string;
  /** Equality filters, applied in order before the sort. */
  filters: Array<[column: string, value: string | number]>;
  /**
   * Sort columns, applied in order. Pass a key that is UNIQUE per row —
   * a primary key or a column with a unique index. Anything less and two
   * adjacent windows can overlap or skip, which is the failure this whole
   * helper exists to prevent.
   */
  orderBy: string[];
  /**
   * Hard ceiling on returned rows. Reached ⇒ `truncated: true` and the
   * caller must say so on the wire; a silently-clipped list is the same
   * lie as a silently-clamped one.
   */
  maxRows?: number;
}

async function pagedSelect<T>(
  supabase: SupabaseClient,
  read: PagedRead,
): Promise<{ data: T[]; error: { message: string } | null; truncated: boolean }> {
  const out: T[] = [];
  const cap = read.maxRows ?? Infinity;

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    let query = supabase.from(read.table).select(read.columns);
    for (const [column, value] of read.filters) query = query.eq(column, value);
    for (const column of read.orderBy) query = query.order(column, { ascending: true });

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) return { data: [], error, truncated: false };

    const rows = (data ?? []) as T[];
    out.push(...rows);

    if (out.length >= cap) {
      return { data: out.slice(0, cap), error: null, truncated: out.length > cap || rows.length === PAGE_SIZE };
    }
    // A short page means we reached the end. An exactly-full page is
    // ambiguous, so we go round again and accept one wasted empty read.
    if (rows.length < PAGE_SIZE) return { data: out, error: null, truncated: false };
  }
  return {
    data: out,
    error: { message: `${read.table}: exceeded ${MAX_PAGES} pages (${MAX_PAGES * PAGE_SIZE} rows) while paging` },
    truncated: false,
  };
}

/**
 * The index's read shape: one season-scoped table, whole thing, ordered by
 * `player_id` (which IS unique per row in each of these tables, one row per
 * player per season).
 */
async function selectAllPaged<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  season: number,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const { data, error } = await pagedSelect<T>(supabase, {
    table,
    columns,
    filters: [['season', season]],
    orderBy: ['player_id'],
  });
  return { data, error };
}

/** Test hook — clears the module-level cache between tests. */
export function clearDashboardIndexCache(): void {
  indexCache = null;
  indexInFlight = null;
}

// ═════════════════════════════════════════════════════════════════════
// COMPONENT 6.5 — the per-player dashboard read model.
//
// `/api/players/:playerId/dashboard` feeds the page the design spec calls
// the Spatial Hero (apps/web/docs/PLAYER_DASHBOARD_DESIGN_SPEC.md §1–§2).
// Four reads, one response: the player's own shots for the requested
// season, his whole `player_xg_season` career arc, GSAx if he is a goalie,
// and his talent-metric row.
//
// ─────────────────────────────────────────────────────────────────────
// WHY THE SHOTS READ TAKES A DIFFERENT CLIENT
//
// `nhl_shots` is deny-all to end-user roles ON PURPOSE. The table's own
// COMMENT in supabase/schema/production_snapshot_20260813.sql says it:
//
//   "RLS is enabled with NO policy, so it is deny-all to end-user roles by
//    design, and the SELECT grant has been revoked so an attempt errors
//    instead of silently returning []. Reach it through SECURITY DEFINER
//    functions ... or service_role."
//
// and the grants agree — `GRANT ALL ON TABLE public.nhl_shots TO
// service_role` with nothing for `authenticated` or `anon`. So the
// RLS-scoped per-request client this service is normally constructed with
// CANNOT read it. It would fail loudly rather than quietly, which is the
// good version of that outcome, but it is still a dead shot map.
//
// The route therefore hands this service a SECOND, service-role client,
// used for exactly one table. That escalation is deliberate and narrow:
//
//   * the route is behind `authMiddleware`, so there is a verified user;
//   * the rows returned are one player's NHL play-by-play shot events —
//     public facts about a public game, not another user's data;
//   * the query is pinned to `shooter_id = :playerId` and one season, so
//     the elevated client cannot be steered at anything else;
//   * every other table on this endpoint stays on the caller's own client
//     and keeps its RLS.
//
// The other three tables need no escalation and get none:
//   player_xg_season       — `read player_xg_season` FOR SELECT TO authenticated
//   goalie_gsax_primary    — "Public can view goalie primary shots GSAx"
//   player_talent_metrics  — "Allow authenticated users to read talent metrics"
//
// ─────────────────────────────────────────────────────────────────────
// AND WHY A SHOT-READ FAILURE IS NOT AN ENDPOINT FAILURE
//
// If the elevated client is unavailable (no SUPABASE_SERVICE_ROLE_KEY on a
// preview deploy) or the read errors, the career arc, the GSAx line and
// the talent row are all still true and still worth rendering. So the shot
// read is non-fatal: `shots: []` with `shots_available: false`, and the UI
// renders an explicit "shot map unavailable" state instead of an empty
// rink implying the player never shot the puck.

/** First season `nhl_shots` / `player_xg_season` carry (audited 2026-09-02). */
export const MIN_DASHBOARD_SEASON = 2017;

/**
 * Ceiling on shots returned for one player-season.
 *
 * A shooter's season is a few hundred rows — Connor McDavid's 2025 regular
 * season is 425 — so this never bites in practice. It exists because an
 * unbounded per-player read is exactly the shape that bit this codebase
 * before (see the PostgREST clamp note above), and because the wire shape
 * must be able to SAY it was clipped rather than quietly shipping a shot
 * map that under-counts a player's volume.
 */
export const SHOT_CAP = 1200;

export type DashboardGameType = 'regular' | 'playoff';

/**
 * One shot, as the rink hero consumes it.
 *
 * COORDINATES ARE IN FEET, on the model's own adjusted frame: every shot
 * mirrored to a single attacking end, goal line at `x = 89`, `y = 0` at
 * centre ice and ±42.5 at the boards. That frame is not an assumption —
 * the `nhl_shot_features` view in the same schema computes
 * `(x_adj > 89) AS f_behind_net` and `abs(y_adj) AS f_yabs`, which pins
 * both the origin and the units. `x_adj`/`y_adj` are preferred and
 * `x_norm`/`y_norm` are the fallback; `distance`/`angle` ride along so the
 * client can CHECK a placement instead of trusting it.
 *
 * `xg` is `nhl_shots.xg_sql` — OUR model's expected-goals value for this
 * shot. It is modelled, not measured, and every surface that prints it
 * has to say so.
 */
export interface DashboardShot {
  game_id: number;
  event_id: number;
  game_date: string | null;
  x: number | null;
  y: number | null;
  distance: number | null;
  angle: number | null;
  xg: number | null;
  is_goal: boolean;
  shot_type: string | null;
  event_type: string;
  is_rush: boolean;
  is_rebound: boolean;
  is_power_play: boolean;
  is_shorthanded: boolean;
  is_empty_net: boolean;
  strength_state: string | null;
}

/** One row of `player_xg_season` — the career arc, one season per row. */
export interface DashboardSeasonRow {
  season: number;
  game_type: string;
  shots: number;
  sog: number;
  goals: number;
  xg: number;
  finishing: number;
  shots_ev: number;
  shots_pp: number;
  shots_pk: number;
  goals_ev: number;
  goals_pp: number;
  goals_sh: number;
  xg_ev: number;
  xg_pp: number;
  xg_pk: number;
  goals_en: number;
  xg_en: number;
  avg_dist: number | null;
  avg_xg_per_shot: number | null;
  rebounds_shot: number;
  rush_shots: number;
}

/** `goalie_gsax_primary` — primary shots only, rebounds excluded. */
export interface DashboardGsax {
  season: number | null;
  shots_faced: number;
  xga: number;
  ga: number;
  raw_gsax: number;
  regressed_gsax: number;
  league_sv_pct: number | null;
}

/** `player_talent_metrics` — the per-60 / VOPA layer. */
export interface DashboardTalent {
  xg_per_60: number | null;
  xg_rating: string | null;
  vopa_score: number | null;
  avg_toi_per_game: number | null;
  positional_replacement_level: number | null;
  positional_std_dev: number | null;
}

/** Identity, so a deep link renders a name even when the browse index 401s. */
export interface DashboardIdentity {
  player_id: number;
  name: string;
  team: string;
  position: string;
  jersey: number | null;
  headshot_url: string | null;
  is_goalie: boolean;
}

export interface PlayerDashboardPayload {
  player_id: number;
  season: number;
  game_type: DashboardGameType;
  player: DashboardIdentity | null;
  shots: DashboardShot[];
  /** False when the shot read could not run or failed — NOT the same as zero shots. */
  shots_available: boolean;
  /** True when SHOT_CAP clipped the list. The UI must caveat the map when set. */
  shots_truncated: boolean;
  shots_cap: number;
  seasons: DashboardSeasonRow[];
  gsax: DashboardGsax | null;
  talent: DashboardTalent | null;
  /**
   * The newest real timestamp behind anything in this payload, or null.
   *
   * Composed from `player_xg_season.updated_at`,
   * `player_talent_metrics.updated_at`, `goalie_gsax_primary.updated_at`
   * and the newest `nhl_shots.created_at` actually read. `nhl_shots` has
   * no `updated_at` — its rows are append-only ingests, so `created_at`
   * IS its freshness. Null when nothing carried a stamp, and null must
   * HIDE `StaleDataBadge` rather than let it print "Update timestamp
   * unavailable", which is itself a claim we cannot support.
   */
  as_of: string | null;
}

const SHOT_COLS =
  'game_id, event_id, game_date, x_norm, y_norm, x_adj, y_adj, distance, angle, distance_adj, angle_adj, xg_sql, is_goal, shot_type, event_type, is_rush, is_rebound, is_power_play, is_shorthanded, is_empty_net, strength_state, created_at';
const XG_SEASON_COLS =
  'season, game_type, player_id, shots, sog, goals, xg, finishing, shots_ev, shots_pp, shots_pk, goals_ev, goals_pp, goals_sh, xg_ev, xg_pp, xg_pk, goals_en, xg_en, avg_dist, avg_xg_per_shot, rebounds_shot, rush_shots, updated_at';
const GSAX_COLS =
  'goalie_id, season, total_shots_faced, total_xga, total_ga, raw_gsax, regressed_gsax, league_sv_pct, updated_at';
const TALENT_DETAIL_COLS =
  'player_id, xg_per_60, xg_rating, vopa_score, avg_toi_per_game, positional_replacement_level, positional_std_dev, updated_at';
const IDENTITY_COLS =
  'player_id, full_name, position_code, team_abbrev, jersey_number, headshot_url';

interface RawShotRow {
  game_id: number;
  event_id: number;
  game_date: string | null;
  x_norm: number | string | null;
  y_norm: number | string | null;
  x_adj: number | null;
  y_adj: number | null;
  distance: number | string | null;
  angle: number | string | null;
  distance_adj: number | null;
  angle_adj: number | null;
  xg_sql: number | null;
  is_goal: boolean;
  shot_type: string | null;
  event_type: string;
  is_rush: boolean | null;
  is_rebound: boolean | null;
  is_power_play: boolean | null;
  is_shorthanded: boolean | null;
  is_empty_net: boolean | null;
  strength_state: string | null;
  created_at: string | null;
}

/**
 * Per-player cache, same 2-minute TTL as the browse index and for the same
 * reason. Bounded, unlike the index's single slot: a crawler walking every
 * player id must not be able to grow the process heap without limit. Oldest
 * key evicted first, which in a browse session is also the least likely to
 * be asked for again.
 */
const PLAYER_CACHE_MAX_ENTRIES = 200;
const playerCache = new Map<string, { data: PlayerDashboardPayload; timestamp: number }>();

/** Test hook — clears the per-player cache. Sibling of clearDashboardIndexCache(). */
export function clearPlayerDashboardCache(): void {
  playerCache.clear();
}

/**
 * Insert into a bounded Map. Insertion order is Map iteration order, so the
 * first key is the oldest; evict before inserting so the map never exceeds
 * `max`. Shared by the per-player caches below.
 */
function putBounded<V>(map: Map<string, V>, key: string, value: V, max: number): void {
  if (!map.has(key) && map.size >= max) {
    const oldest = map.keys().next();
    if (!oldest.done) map.delete(oldest.value);
  }
  map.set(key, value);
}

// ═════════════════════════════════════════════════════════════════════
// XG HISTORY (2026-09-03): the career arc on its own, for the condensed
// card's sparkline.
//
// `getPlayerDashboard` already reads every `player_xg_season` row a player
// has, but it reads his shots too (up to SHOT_CAP rows, on the service-role
// client). The condensed card opens inside PlayerStatsModal on ten host
// surfaces, one of them a live draft room; paying for a shot map to draw a
// nine-point line is the wrong trade. This is the same table read on the
// same client with the shot read left out, and the rows MERGED per season:
//
//   player_xg_season's key is (season, game_type, player_id, team_id). A
//   player traded mid-season has one row per team, and on 2026-09-03
//   production held 687 such multi-row player-seasons (up to four rows).
//   The dashboard payload ships those rows as-is because it also carries
//   per-row averages (`avg_dist`, `avg_xg_per_shot`) that cannot be summed;
//   this payload carries only the additive columns, so it can merge.

const XG_HISTORY_COLS = 'season, game_type, player_id, team_id, shots, sog, goals, xg, updated_at';

/** A `player_xg_season` row as PostgREST hands it back. */
export interface RawXgHistoryRow {
  season: number;
  game_type: string;
  player_id: number;
  team_id: number | null;
  shots: number | null;
  sog: number | null;
  goals: number | null;
  xg: number | string | null;
  updated_at: string | null;
}

const xgHistoryCache = new Map<string, { data: PlayerXgHistoryPayload; timestamp: number }>();

/** Test hook: clears the xg-history cache. Sibling of clearPlayerDashboardCache(). */
export function clearPlayerXgHistoryCache(): void {
  xgHistoryCache.clear();
}

/**
 * Raw rows → one point per (season, game_type), team rows summed.
 *
 * Exported and pure so the trade-merge is pinned by a test that needs no
 * client. Rows whose `game_type` is neither `regular` nor `playoff` are
 * dropped rather than guessed at; a third value would be a new table
 * contract, not a client-side default.
 */
export function mergeXgHistory(rows: readonly RawXgHistoryRow[]): XgHistoryPoint[] {
  const merged = new Map<string, XgHistoryPoint>();
  for (const r of rows) {
    const season = Number(r.season);
    if (!Number.isFinite(season)) continue;
    if (r.game_type !== 'regular' && r.game_type !== 'playoff') continue;
    const key = `${season}:${r.game_type}`;
    const point: XgHistoryPoint = merged.get(key) ?? {
      season,
      game_type: r.game_type,
      shots: 0,
      sog: 0,
      goals: 0,
      xg: 0,
      finishing: 0,
      teams: 0,
    };
    point.shots += Number(r.shots ?? 0);
    point.sog += Number(r.sog ?? 0);
    point.goals += Number(r.goals ?? 0);
    point.xg += num(r.xg) ?? 0;
    point.teams += 1;
    merged.set(key, point);
  }
  const points = Array.from(merged.values());
  for (const p of points) {
    // Two decimals: `xg` is a sum of per-shot model outputs and the
    // dashboard prints it to two, so the two surfaces cannot disagree.
    p.xg = Math.round(p.xg * 100) / 100;
    p.finishing = Math.round((p.goals - p.xg) * 100) / 100;
  }
  points.sort((a, b) =>
    a.season !== b.season
      ? a.season - b.season
      : (a.game_type === 'regular' ? 0 : 1) - (b.game_type === 'regular' ? 0 : 1),
  );
  return points;
}

export interface PlayerDashboardRequest {
  playerId: number;
  season: number;
  gameType: DashboardGameType;
}

/**
 * The validator's result. Deliberately NOT a `{ ok: true } | { ok: false }`
 * discriminated union: this workspace compiles with `strictNullChecks:
 * false` (server/tsconfig.json), and without strict null checks TypeScript
 * will not narrow a union on a boolean discriminant — `if (!parsed.ok)`
 * leaves `parsed` as the whole union and `parsed.message` is a compile
 * error. A nullable `value` needs no narrowing to read correctly.
 */
export interface PlayerDashboardRequestParse {
  /** The validated request, or null when the input was rejected. */
  value: PlayerDashboardRequest | null;
  /** Why it was rejected. Null on success. Safe to return to the caller. */
  message: string | null;
}

/**
 * Validate the three request inputs BEFORE they reach a query.
 *
 * Exported so the route and its tests share one rule set rather than two
 * that drift. Every rejection names the offending input; nothing
 * unvalidated is ever handed to a filter.
 */
export function parsePlayerDashboardRequest(
  playerIdRaw: string | undefined,
  seasonRaw: string | undefined,
  gameTypeRaw: string | undefined,
  currentSeason: number = getCurrentSeason(),
): PlayerDashboardRequestParse {
  // NHL player ids are 7-digit integers. The SHAPE is checked before the
  // value, because `parseInt` alone happily turns "8478402 or 1=1" into
  // 8478402 and "1e9" into 1 — a validator that accepts a prefix is not
  // a validator.
  if (!playerIdRaw || !/^\d{1,9}$/.test(playerIdRaw)) {
    return { value: null, message: 'playerId must be a positive integer NHL player id' };
  }
  const playerId = Number(playerIdRaw);
  if (!Number.isSafeInteger(playerId) || playerId <= 0) {
    return { value: null, message: 'playerId must be a positive integer NHL player id' };
  }

  // `currentSeason` is the ceiling rather than a constant: the shot table
  // cannot hold a season that has not been played, and an unbounded season
  // param is a free full-table probe.
  const maxSeason = Math.max(currentSeason, MIN_DASHBOARD_SEASON);
  let season = maxSeason;
  if (seasonRaw !== undefined && seasonRaw !== '') {
    if (!/^\d{4}$/.test(seasonRaw)) {
      return { value: null, message: 'season must be a four-digit year' };
    }
    season = Number(seasonRaw);
    if (season < MIN_DASHBOARD_SEASON || season > maxSeason) {
      return {
        value: null,
        message: `season must be between ${MIN_DASHBOARD_SEASON} and ${maxSeason}`,
      };
    }
  }

  let gameType: DashboardGameType = 'regular';
  if (gameTypeRaw !== undefined && gameTypeRaw !== '') {
    if (gameTypeRaw !== 'regular' && gameTypeRaw !== 'playoff') {
      return { value: null, message: "gameType must be 'regular' or 'playoff'" };
    }
    gameType = gameTypeRaw;
  }

  return { value: { playerId, season, gameType }, message: null };
}

/** The newest of a set of timestamps, or null when none are usable. */
function newestTimestamp(candidates: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const c of candidates) {
    if (!c) continue;
    const ms = Date.parse(c);
    if (!Number.isFinite(ms) || ms <= bestMs) continue;
    bestMs = ms;
    best = c;
  }
  return best;
}

/**
 * PostgREST hands `numeric` columns back as STRINGS (arbitrary precision
 * does not survive JSON numbers), while `double precision` arrives as a
 * number. `nhl_shots` mixes the two — `distance` is numeric, `distance_adj`
 * is double — so every value crossing this boundary is coerced once, here,
 * rather than being `.toFixed()`-ed on a string somewhere in the UI.
 */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export class PlayerDashboardService {
  /**
   * @param supabase   The caller's RLS-scoped client. Everything reads
   *                   through this by default.
   * @param elevated   A service-role client, used for `nhl_shots` and
   *                   NOTHING else — see the Component 6.5 note above for
   *                   why that table needs one and why the escalation is
   *                   safe. Omitted ⇒ the shot map is reported as
   *                   unavailable rather than attempted on a client that
   *                   is guaranteed to be refused.
   */
  constructor(
    private supabase: SupabaseClient,
    private elevated?: SupabaseClient,
  ) {}

  /**
   * The full browse index: every directory player for the season with
   * stats/GAR/talent/projection columns merged. Team/position/search
   * filtering happens in the route (the payload is bounded by the
   * curated directory, ~1–2k rows, and cached).
   */
  async getDashboardIndex(): Promise<{ players: DashboardIndexEntry[]; error: Error | null }> {
    const season = getCurrentSeason();

    if (indexCache && indexCache.season === season && Date.now() - indexCache.timestamp < CACHE_TTL_MS) {
      return { players: indexCache.data, error: null };
    }

    // A load for this season is already running — join it. See the
    // `indexInFlight` note above.
    if (indexInFlight && indexInFlight.season === season) return indexInFlight.promise;

    const promise = this.loadDashboardIndex(season);
    indexInFlight = { season, promise };
    try {
      return await promise;
    } finally {
      if (indexInFlight?.promise === promise) indexInFlight = null;
    }
  }

  /** The uncached six-table fan-out and merge behind `getDashboardIndex`. */
  private async loadDashboardIndex(
    season: number,
  ): Promise<{ players: DashboardIndexEntry[]; error: Error | null }> {
    // Parallel fan-out. These tables have no FKs between them, so this is
    // 6 independent index-only scans, not an N+1. Each one is PAGED (see
    // selectAllPaged) because an unbounded select would be silently
    // truncated by PostgREST's max-rows clamp.
    const [dirRes, statsRes, garRes, talentRes, rosRes, gsaxRes] = await Promise.all([
      selectAllPaged<DirectoryRow>(
        this.supabase,
        'player_directory',
        'player_id, full_name, position_code, team_abbrev, jersey_number, headshot_url, eligible_positions',
        season,
      ),
      selectAllPaged<StatsRow>(this.supabase, 'player_season_stats', INDEX_STATS_COLS, season),
      selectAllPaged<GarRow>(this.supabase, 'player_gar_components', GAR_COLS, season),
      selectAllPaged<TalentRow>(this.supabase, 'player_talent_metrics', TALENT_COLS, season),
      // Projections are keyed to the season they DESCRIBE — in the
      // offseason that's the upcoming season, not `season` (which still
      // points at last season's actuals). Joining on `season` here read
      // zero rows all summer → "Proj FP —" for every player.
      selectAllPaged<RosRow>(this.supabase, 'player_ros_projections', ROS_COLS, getProjectionsSeason()),
      // GOALIE GSAx (2026-09-03). Keyed on `goalie_id`, the table's primary
      // key, so the paged sort is unique per row. Season-filtered like the
      // other five: the table can only hold one season per goalie, and on
      // the day the season number flips a 2025 row next to 2026 actuals
      // would be a cross-season number wearing a current-season label.
      // Read on the caller's client; the table's policy is public read.
      pagedSelect<IndexGsaxRow>(this.supabase, {
        table: 'goalie_gsax_primary',
        columns: INDEX_GSAX_COLS,
        filters: [['season', season]],
        orderBy: ['goalie_id'],
      }),
    ]);

    const firstError = dirRes.error || statsRes.error || garRes.error || talentRes.error || rosRes.error;
    if (firstError) {
      return { players: [], error: new Error(firstError.message) };
    }

    // The GSAx read is an enrichment for ~100 goalies, not the spine of a
    // 2k-row index; a policy change on that one table must not 500 the
    // whole Players page. Logged, and every goalie gets null GSAx, which the
    // card renders as an absent row rather than a zero.
    if (gsaxRes.error) {
      logger.error('[PlayerDashboardService] goalie_gsax_primary read failed; GSAx omitted from index:', gsaxRes.error.message);
    }

    const statsBy = new Map<number, StatsRow>();
    for (const s of (statsRes.data ?? []) as StatsRow[]) statsBy.set(s.player_id, s);
    const garBy = new Map<number, GarRow>();
    for (const g of (garRes.data ?? []) as GarRow[]) garBy.set(g.player_id, g);
    const talentBy = new Map<number, TalentRow>();
    for (const t of (talentRes.data ?? []) as TalentRow[]) talentBy.set(t.player_id, t);
    const rosBy = new Map<number, RosRow>();
    for (const r of (rosRes.data ?? []) as RosRow[]) rosBy.set(r.player_id, r);
    const gsaxBy = new Map<number, IndexGsaxRow>();
    if (!gsaxRes.error) {
      for (const x of (gsaxRes.data ?? []) as IndexGsaxRow[]) gsaxBy.set(x.goalie_id, x);
    }

    const players: DashboardIndexEntry[] = ((dirRes.data ?? []) as DirectoryRow[]).map((d) => {
      const s = statsBy.get(d.player_id);
      const g = garBy.get(d.player_id);
      const t = talentBy.get(d.player_id);
      const r = rosBy.get(d.player_id);
      const x = gsaxBy.get(d.player_id);
      const isGoalie = d.position_code === 'G';
      return {
        id: d.player_id,
        name: d.full_name,
        team: d.team_abbrev,
        position: d.position_code,
        jersey: d.jersey_number ? parseInt(d.jersey_number, 10) : null,
        headshot_url: d.headshot_url,
        is_goalie: isGoalie,
        roster_status: t?.roster_status ?? null,
        gp: (isGoalie ? s?.goalie_gp : s?.games_played) ?? 0,
        goals: s?.nhl_goals ?? 0,
        assists: s?.nhl_assists ?? 0,
        points: (s?.nhl_goals ?? 0) + (s?.nhl_assists ?? 0),
        sog: s?.nhl_shots_on_goal ?? 0,
        hits: s?.nhl_hits ?? 0,
        blocks: s?.nhl_blocks ?? 0,
        ppp: s?.nhl_ppp ?? 0,
        plus_minus: s?.nhl_plus_minus ?? 0,
        x_goals: s?.x_goals ?? 0,
        // Selected since the index shipped, dropped here until 2026-09-05.
        pim: s?.nhl_pim ?? 0,
        shp: s?.nhl_shp ?? 0,
        toi_seconds: s?.nhl_toi_seconds ?? 0,
        wins: s?.nhl_wins ?? 0,
        losses: s?.nhl_losses ?? 0,
        ot_losses: s?.nhl_ot_losses ?? 0,
        saves: s?.nhl_saves ?? 0,
        save_pct: s?.nhl_save_pct ?? 0,
        gaa: s?.nhl_gaa ?? 0,
        shutouts: s?.nhl_shutouts ?? 0,
        goals_against: s?.nhl_goals_against ?? 0,
        xg_per_60: t?.xg_per_60 ?? null,
        xg_rating: t?.xg_rating ?? null,
        gar_per_60: g?.total_gar_per_60 ?? null,
        gar_evo: g?.evo_gar_per_60 ?? null,
        gar_evd: g?.evd_gar_per_60 ?? null,
        gar_ppo: g?.ppo_gar_per_60 ?? null,
        gar_ppd: g?.ppd_gar_per_60 ?? null,
        gar_pen: g?.penalty_gar_per_60 ?? null,
        // The three columns this service used to SELECT-and-drop (or never
        // read). `num()` because all three are `numeric`.
        toi_total_minutes: num(g?.toi_total_minutes),
        avg_toi_per_game: num(t?.avg_toi_per_game),
        vopa_score: num(t?.vopa_score),
        gsax_raw: num(x?.raw_gsax),
        gsax_regressed: num(x?.regressed_gsax),
        gsax_shots_faced: num(x?.total_shots_faced),
        gsax_xga: num(x?.total_xga),
        gsax_ga: num(x?.total_ga),
        proj_gp: r?.games_remaining ?? null,
        proj_fantasy_points: r?.total_projected_points ?? null,
        proj_fantasy_ppg: r?.avg_points_per_game ?? null,
        proj_goals: r?.projected_goals ?? null,
        proj_assists: r?.projected_assists ?? null,
        proj_sog: r?.projected_sog ?? null,
        proj_ppp: r?.projected_ppp ?? null,
        proj_blocks: r?.projected_blocks ?? null,
        proj_hits: r?.projected_hits ?? null,
        proj_wins: r?.projected_wins_ros ?? null,
        proj_saves: r?.projected_saves_ros ?? null,
        proj_shutouts: r?.projected_shutouts_ros ?? null,
        // Freshness from the stamps on THIS player's rows, nothing
        // synthesised: null when none of them carried one, and null hides
        // the badge client-side. Same rule as `getPlayerDashboard`'s as_of.
        as_of: newestTimestamp([s?.updated_at, g?.updated_at, t?.updated_at, r?.updated_at, x?.updated_at]),
      } as DashboardIndexEntry;
    });

    indexCache = { season, data: players, timestamp: Date.now() };
    return { players, error: null };
  }

  /**
   * COMPONENT 6.5 — everything one player's dashboard needs, in one call.
   *
   * Five reads, fanned out in parallel because none depends on another:
   *
   *   nhl_shots              the requested season's shots (elevated client)
   *   player_xg_season       EVERY season on record — the career arc, and
   *                          the thing Sleeper structurally cannot show
   *   goalie_gsax_primary    for the requested season, goalies only
   *   player_talent_metrics  the per-60 / VOPA layer, current season
   *   player_directory       identity, so a shared link renders a name
   *
   * Only the first is season-and-game-type scoped by the request. The
   * career arc deliberately reads ALL seasons AND both game types, because
   * a chart of nine seasons is the point; the client picks what to plot.
   */
  async getPlayerDashboard(
    request: PlayerDashboardRequest,
  ): Promise<{ payload: PlayerDashboardPayload | null; error: Error | null }> {
    const { playerId, season, gameType } = request;
    const key = `${playerId}:${season}:${gameType}`;

    const cached = playerCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { payload: cached.data, error: null };
    }

    const currentSeason = getCurrentSeason();
    const shotsClient = this.elevated ?? null;

    const [shotsRes, seasonsRes, gsaxRes, talentRes, identityRes] = await Promise.all([
      // PAGED like everything else in this file, and ordered by the actual
      // primary key — `nhl_shots_pkey (game_id, event_id)`. Ordering by
      // `game_date` alone would be a non-unique sort across LIMIT/OFFSET
      // windows, which is the duplicate-and-skip failure the header note
      // above describes.
      shotsClient
        ? pagedSelect<RawShotRow>(shotsClient, {
            table: 'nhl_shots',
            columns: SHOT_COLS,
            filters: [
              ['shooter_id', playerId],
              ['season', season],
              ['game_type', gameType],
            ],
            orderBy: ['game_id', 'event_id'],
            maxRows: SHOT_CAP,
          })
        : Promise.resolve({
            data: [] as RawShotRow[],
            error: { message: 'no service-role client supplied for nhl_shots' },
            truncated: false,
          }),
      pagedSelect<Record<string, unknown>>(this.supabase, {
        table: 'player_xg_season',
        columns: XG_SEASON_COLS,
        filters: [['player_id', playerId]],
        // (season, game_type, player_id) is this table's key; with player_id
        // pinned, (season, game_type) is unique per row.
        orderBy: ['season', 'game_type'],
      }),
      pagedSelect<Record<string, unknown>>(this.supabase, {
        table: 'goalie_gsax_primary',
        columns: GSAX_COLS,
        filters: [
          ['goalie_id', playerId],
          ['season', season],
        ],
        orderBy: ['goalie_id'],
      }),
      pagedSelect<Record<string, unknown>>(this.supabase, {
        table: 'player_talent_metrics',
        columns: TALENT_DETAIL_COLS,
        // Talent metrics are only maintained for the current season; asking
        // for a 2019 row returns nothing rather than a stale row wearing a
        // 2019 label.
        filters: [
          ['player_id', playerId],
          ['season', currentSeason],
        ],
        orderBy: ['player_id'],
      }),
      pagedSelect<Record<string, unknown>>(this.supabase, {
        table: 'player_directory',
        columns: IDENTITY_COLS,
        filters: [
          ['player_id', playerId],
          ['season', currentSeason],
        ],
        orderBy: ['player_id'],
      }),
    ]);

    // The career arc is the spine of this payload — if it fails, the
    // response would be a page of blanks, so that one IS fatal. The rest
    // degrade individually.
    if (seasonsRes.error) {
      return { payload: null, error: new Error(seasonsRes.error.message) };
    }

    if (shotsRes.error && shotsClient) {
      // Logged with the player id, not returned: a Postgres error string is
      // for us, and the client only needs to know the map is unavailable.
      logger.error(
        `[PlayerDashboardService] nhl_shots read failed for player ${playerId} (${season}/${gameType}):`,
        shotsRes.error.message,
      );
    }

    const rawShots = shotsRes.error ? [] : shotsRes.data;
    const shots: DashboardShot[] = rawShots.map((s) => ({
      game_id: s.game_id,
      event_id: s.event_id,
      game_date: s.game_date,
      // x_adj/y_adj are the model's mirrored frame and are what the feature
      // view reasons about; x_norm/y_norm are the fallback when the adjusted
      // pair is missing. Both are feet on the same frame.
      x: num(s.x_adj) ?? num(s.x_norm),
      y: num(s.y_adj) ?? num(s.y_norm),
      distance: num(s.distance_adj) ?? num(s.distance),
      angle: num(s.angle_adj) ?? num(s.angle),
      xg: num(s.xg_sql),
      is_goal: Boolean(s.is_goal),
      shot_type: s.shot_type,
      event_type: s.event_type,
      is_rush: Boolean(s.is_rush),
      is_rebound: Boolean(s.is_rebound),
      is_power_play: Boolean(s.is_power_play),
      is_shorthanded: Boolean(s.is_shorthanded),
      is_empty_net: Boolean(s.is_empty_net),
      strength_state: s.strength_state,
    }));

    const seasons: DashboardSeasonRow[] = (seasonsRes.data ?? []).map((r) => ({
      season: Number(r.season),
      game_type: String(r.game_type),
      shots: Number(r.shots ?? 0),
      sog: Number(r.sog ?? 0),
      goals: Number(r.goals ?? 0),
      xg: Number(r.xg ?? 0),
      finishing: Number(r.finishing ?? 0),
      shots_ev: Number(r.shots_ev ?? 0),
      shots_pp: Number(r.shots_pp ?? 0),
      shots_pk: Number(r.shots_pk ?? 0),
      goals_ev: Number(r.goals_ev ?? 0),
      goals_pp: Number(r.goals_pp ?? 0),
      goals_sh: Number(r.goals_sh ?? 0),
      xg_ev: Number(r.xg_ev ?? 0),
      xg_pp: Number(r.xg_pp ?? 0),
      xg_pk: Number(r.xg_pk ?? 0),
      goals_en: Number(r.goals_en ?? 0),
      xg_en: Number(r.xg_en ?? 0),
      avg_dist: num(r.avg_dist),
      avg_xg_per_shot: num(r.avg_xg_per_shot),
      rebounds_shot: Number(r.rebounds_shot ?? 0),
      rush_shots: Number(r.rush_shots ?? 0),
    }));

    const gsaxRow = gsaxRes.error ? undefined : gsaxRes.data[0];
    const gsax: DashboardGsax | null = gsaxRow
      ? {
          season: num(gsaxRow.season),
          shots_faced: Number(gsaxRow.total_shots_faced ?? 0),
          xga: num(gsaxRow.total_xga) ?? 0,
          ga: Number(gsaxRow.total_ga ?? 0),
          raw_gsax: num(gsaxRow.raw_gsax) ?? 0,
          regressed_gsax: num(gsaxRow.regressed_gsax) ?? 0,
          league_sv_pct: num(gsaxRow.league_sv_pct),
        }
      : null;

    const talentRow = talentRes.error ? undefined : talentRes.data[0];
    const talent: DashboardTalent | null = talentRow
      ? {
          xg_per_60: num(talentRow.xg_per_60),
          xg_rating: (talentRow.xg_rating as string | null) ?? null,
          vopa_score: num(talentRow.vopa_score),
          avg_toi_per_game: num(talentRow.avg_toi_per_game),
          positional_replacement_level: num(talentRow.positional_replacement_level),
          positional_std_dev: num(talentRow.positional_std_dev),
        }
      : null;

    const identityRow = identityRes.error ? undefined : identityRes.data[0];
    const player: DashboardIdentity | null = identityRow
      ? {
          player_id: Number(identityRow.player_id),
          name: String(identityRow.full_name),
          team: String(identityRow.team_abbrev ?? ''),
          position: String(identityRow.position_code ?? ''),
          jersey: identityRow.jersey_number ? parseInt(String(identityRow.jersey_number), 10) : null,
          headshot_url: (identityRow.headshot_url as string | null) ?? null,
          is_goalie: identityRow.position_code === 'G',
        }
      : null;

    // Freshness from timestamps we ACTUALLY READ. Nothing synthesised: if
    // every source is missing its stamp the answer is null, and the UI
    // hides the badge instead of asserting an age it cannot know.
    const newestShotCreatedAt = rawShots.reduce<string | null>(
      (acc, s) => newestTimestamp([acc, s.created_at]),
      null,
    );
    const as_of = newestTimestamp([
      newestShotCreatedAt,
      ...(seasonsRes.data ?? []).map((r) => r.updated_at as string | null),
      (gsaxRow?.updated_at as string | undefined) ?? null,
      (talentRow?.updated_at as string | undefined) ?? null,
    ]);

    const payload: PlayerDashboardPayload = {
      player_id: playerId,
      season,
      game_type: gameType,
      player,
      shots,
      shots_available: !shotsRes.error,
      shots_truncated: shotsRes.truncated,
      shots_cap: SHOT_CAP,
      seasons,
      gsax,
      talent,
      as_of,
    };

    putBounded(playerCache, key, { data: payload, timestamp: Date.now() }, PLAYER_CACHE_MAX_ENTRIES);

    return { payload, error: null };
  }

  /**
   * XG HISTORY: every `player_xg_season` season on record for one player,
   * merged per (season, game_type). See the block comment above
   * `mergeXgHistory`. One paged read on the caller's RLS-scoped client
   * (`read player_xg_season` FOR SELECT TO authenticated); no elevation.
   */
  async getXgHistory(
    playerId: number,
  ): Promise<{ payload: PlayerXgHistoryPayload | null; error: Error | null }> {
    const key = String(playerId);
    const cached = xgHistoryCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { payload: cached.data, error: null };
    }

    const res = await pagedSelect<RawXgHistoryRow>(this.supabase, {
      table: 'player_xg_season',
      columns: XG_HISTORY_COLS,
      filters: [['player_id', playerId]],
      // The full primary key with player_id pinned, so the paged sort is
      // unique per row even for a traded player's second team row.
      orderBy: ['season', 'game_type', 'team_id'],
    });
    if (res.error) {
      return { payload: null, error: new Error(res.error.message) };
    }

    const rows = res.data ?? [];
    const payload: PlayerXgHistoryPayload = {
      player_id: playerId,
      points: mergeXgHistory(rows),
      as_of: newestTimestamp(rows.map((r) => r.updated_at)),
    };

    putBounded(xgHistoryCache, key, { data: payload, timestamp: Date.now() }, PLAYER_CACHE_MAX_ENTRIES);
    return { payload, error: null };
  }
}

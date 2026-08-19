import { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentSeason } from '@citrus/shared';

/**
 * PlayerDashboardService — read-model for the league-wide Players
 * section (browse index + per-player advanced-metrics dashboard).
 *
 * Deliberately SEPARATE from PlayerService.getAllPlayers():
 *   - getAllPlayers feeds the draft pool / free agents and is cached
 *     with a narrow NormalizedPlayer shape. Bolting GAR + projections
 *     onto it would grow a hot draft-path payload for a browse page.
 *   - This service joins five tables (directory, season stats, GAR
 *     components, talent metrics, ROS projections) into a shape the
 *     dashboard UI consumes directly.
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
  nhl_plus_minus: number;
  nhl_toi_seconds: number;
  x_goals: number;
  goalie_gp: number;
  nhl_wins: number;
  nhl_saves: number;
  nhl_save_pct: number;
  nhl_gaa: number;
  nhl_shutouts: number;
  nhl_goals_against: number;
}

interface GarRow {
  player_id: number;
  evo_gar_per_60: number | null;
  evd_gar_per_60: number | null;
  ppo_gar_per_60: number | null;
  ppd_gar_per_60: number | null;
  penalty_gar_per_60: number | null;
  total_gar_per_60: number | null;
  toi_total_minutes: number | null;
}

interface TalentRow {
  player_id: number;
  xg_per_60: number | null;
  xg_rating: string | null;
  roster_status: string | null;
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
}

const INDEX_STATS_COLS =
  'player_id, games_played, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_plus_minus, nhl_toi_seconds, x_goals, goalie_gp, nhl_wins, nhl_saves, nhl_save_pct, nhl_gaa, nhl_shutouts, nhl_goals_against';
const GAR_COLS =
  'player_id, evo_gar_per_60, evd_gar_per_60, ppo_gar_per_60, ppd_gar_per_60, penalty_gar_per_60, total_gar_per_60, toi_total_minutes';
const TALENT_COLS = 'player_id, xg_per_60, xg_rating, roster_status';
const ROS_COLS =
  'player_id, games_remaining, total_projected_points, avg_points_per_game, projected_goals, projected_assists, projected_sog, projected_ppp, projected_hits, projected_blocks, projected_wins_ros, projected_saves_ros, projected_shutouts_ros';

export interface DashboardIndexEntry {
  id: number;
  name: string;
  team: string;
  position: string;
  jersey: number | null;
  headshot_url: string | null;
  is_goalie: boolean;
  roster_status: string | null;
  // season actuals
  gp: number;
  goals: number;
  assists: number;
  points: number;
  sog: number;
  hits: number;
  blocks: number;
  ppp: number;
  plus_minus: number;
  x_goals: number;
  // goalie actuals
  wins: number;
  saves: number;
  save_pct: number;
  gaa: number;
  shutouts: number;
  // advanced
  xg_per_60: number | null;
  xg_rating: string | null;
  gar_per_60: number | null;
  gar_evo: number | null;
  gar_evd: number | null;
  gar_ppo: number | null;
  gar_ppd: number | null;
  gar_pen: number | null;
  // rolled-forward projection
  proj_gp: number | null;
  proj_fantasy_points: number | null;
  proj_fantasy_ppg: number | null;
  proj_goals: number | null;
  proj_assists: number | null;
  proj_sog: number | null;
  proj_ppp: number | null;
  proj_wins: number | null;
  proj_saves: number | null;
  proj_shutouts: number | null;
}

// 2-minute in-process cache, same TTL philosophy as PlayerService:
// short enough to surface nightly-pipeline refreshes, long enough to
// absorb a browse session's re-fetches.
let indexCache: { season: number; data: DashboardIndexEntry[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000;

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

async function selectAllPaged<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  season: number,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('season', season)
      .order('player_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return { data: [], error };

    const rows = (data ?? []) as T[];
    out.push(...rows);
    // A short page means we reached the end. An exactly-full page is
    // ambiguous, so we go round again and accept one wasted empty read.
    if (rows.length < PAGE_SIZE) return { data: out, error: null };
  }
  return {
    data: out,
    error: { message: `${table}: exceeded ${MAX_PAGES} pages (${MAX_PAGES * PAGE_SIZE} rows) while paging` },
  };
}

/** Test hook — clears the module-level cache between tests. */
export function clearDashboardIndexCache(): void {
  indexCache = null;
}

export class PlayerDashboardService {
  constructor(private supabase: SupabaseClient) {}

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

    // Parallel fan-out — these tables have no FKs between them, so
    // this is 5 independent index-only scans, not an N+1. Each one is
    // PAGED (see selectAllPaged) because an unbounded select would be
    // silently truncated by PostgREST's max-rows clamp.
    const [dirRes, statsRes, garRes, talentRes, rosRes] = await Promise.all([
      selectAllPaged<DirectoryRow>(
        this.supabase,
        'player_directory',
        'player_id, full_name, position_code, team_abbrev, jersey_number, headshot_url, eligible_positions',
        season,
      ),
      selectAllPaged<StatsRow>(this.supabase, 'player_season_stats', INDEX_STATS_COLS, season),
      selectAllPaged<GarRow>(this.supabase, 'player_gar_components', GAR_COLS, season),
      selectAllPaged<TalentRow>(this.supabase, 'player_talent_metrics', TALENT_COLS, season),
      selectAllPaged<RosRow>(this.supabase, 'player_ros_projections', ROS_COLS, season),
    ]);

    const firstError = dirRes.error || statsRes.error || garRes.error || talentRes.error || rosRes.error;
    if (firstError) {
      return { players: [], error: new Error(firstError.message) };
    }

    const statsBy = new Map<number, StatsRow>();
    for (const s of (statsRes.data ?? []) as StatsRow[]) statsBy.set(s.player_id, s);
    const garBy = new Map<number, GarRow>();
    for (const g of (garRes.data ?? []) as GarRow[]) garBy.set(g.player_id, g);
    const talentBy = new Map<number, TalentRow>();
    for (const t of (talentRes.data ?? []) as TalentRow[]) talentBy.set(t.player_id, t);
    const rosBy = new Map<number, RosRow>();
    for (const r of (rosRes.data ?? []) as RosRow[]) rosBy.set(r.player_id, r);

    const players: DashboardIndexEntry[] = ((dirRes.data ?? []) as DirectoryRow[]).map((d) => {
      const s = statsBy.get(d.player_id);
      const g = garBy.get(d.player_id);
      const t = talentBy.get(d.player_id);
      const r = rosBy.get(d.player_id);
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
        wins: s?.nhl_wins ?? 0,
        saves: s?.nhl_saves ?? 0,
        save_pct: s?.nhl_save_pct ?? 0,
        gaa: s?.nhl_gaa ?? 0,
        shutouts: s?.nhl_shutouts ?? 0,
        xg_per_60: t?.xg_per_60 ?? null,
        xg_rating: t?.xg_rating ?? null,
        gar_per_60: g?.total_gar_per_60 ?? null,
        gar_evo: g?.evo_gar_per_60 ?? null,
        gar_evd: g?.evd_gar_per_60 ?? null,
        gar_ppo: g?.ppo_gar_per_60 ?? null,
        gar_ppd: g?.ppd_gar_per_60 ?? null,
        gar_pen: g?.penalty_gar_per_60 ?? null,
        proj_gp: r?.games_remaining ?? null,
        proj_fantasy_points: r?.total_projected_points ?? null,
        proj_fantasy_ppg: r?.avg_points_per_game ?? null,
        proj_goals: r?.projected_goals ?? null,
        proj_assists: r?.projected_assists ?? null,
        proj_sog: r?.projected_sog ?? null,
        proj_ppp: r?.projected_ppp ?? null,
        proj_wins: r?.projected_wins_ros ?? null,
        proj_saves: r?.projected_saves_ros ?? null,
        proj_shutouts: r?.projected_shutouts_ros ?? null,
      } as DashboardIndexEntry;
    });

    indexCache = { season, data: players, timestamp: Date.now() };
    return { players, error: null };
  }
}

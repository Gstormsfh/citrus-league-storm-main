import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS, getCurrentSeason, parseEligiblePositions, type EligiblePositionsRaw } from '@citrus/shared';
import { readAllPaged } from '../lib/pagedRead';

/**
 * PlayerService — Server-side player data with dependency-injected Supabase client.
 *
 * Extracted from apps/web/src/services/PlayerService.ts.
 * Caching moved to server-level (more effective than browser caching).
 */

interface PlayerDirectoryRow {
  player_id: number;
  full_name: string;
  position_code: string;
  team_abbrev: string;
  jersey_number: string | null;
  headshot_url: string | null;
  // `player_directory.eligible_positions` is a comma-separated TEXT cell
  // ("C,LW"), not an array. Typing it string[] here made `.length` read a
  // character count and the client's Array.isArray guard drop it, so a
  // dual-eligible player never reached the roster as one. Parsed below.
  eligible_positions: EligiblePositionsRaw;
}

interface PlayerStatsRow {
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
  goalie_gp: number;
  nhl_wins: number;
  nhl_losses: number;
  nhl_ot_losses: number;
  nhl_saves: number;
  nhl_save_pct: number;
  nhl_gaa: number;
  nhl_shutouts: number;
  nhl_shots_faced: number;
  nhl_goals_against: number;
  x_goals: number;
  updated_at: string | null;
}

interface TalentMetricsRow {
  player_id: number;
  xg_per_60: number | null;
  xg_rating: string | null;
  roster_status: string | null;
  is_ir_eligible: boolean | null;
}

// Row shape for `goalie_gsax_primary` — see
// supabase/migrations/20250114000001_create_goalie_gsax_primary_table.sql.
// Key column is `goalie_id`, not `player_id`; the GSAx value we consume
// is the Bayesian-regressed one. The public NormalizedPlayer.gsax field
// is projected from `regressed_gsax` so the HTTP wire contract is
// unchanged for API clients.
interface GoalieGsaxRow {
  goalie_id: number;
  regressed_gsax: number | null;
}

interface NormalizedPlayer {
  id: number;
  full_name: string;
  position: string;
  team: string;
  jersey_number: number | null;
  headshot_url: string | null;
  is_goalie: boolean;
  status: string;
  roster_status: string | null;
  is_ir_eligible: boolean;
  eligible_positions: string[];
  games_played: number;
  goals: number;
  assists: number;
  points: number;
  shots: number;
  hits: number;
  blocks: number;
  pim: number;
  ppp: number;
  shp: number;
  plus_minus: number;
  icetime_seconds: number;
  x_goals: number;
  goalie_gp: number;
  wins: number;
  losses: number;
  ot_losses: number;
  saves: number;
  shots_faced: number;
  goals_against: number;
  save_pct: number;
  gaa: number;
  shutouts: number;
  gsax?: number | null;
  xg_per_60?: number | null;
  xg_rating?: string | null;
  stats_updated_at?: string | null;
}

// 2-minute cache for player data (short TTL to surface pipeline updates quickly)
let playersCache: { data: NormalizedPlayer[]; timestamp: number } | null = null;
const CACHE_TTL = 2 * 60 * 1000;

/**
 * STAMPEDE GUARD (2026-09-02 scale audit).
 *
 * `playersCache` is a plain read-through cache: check, miss, fetch. That
 * shape is fine at one request at a time and pathological under load. The
 * moment the TTL lapses, EVERY concurrent request misses, and every one of
 * them issues the same four paged table reads and repeats the same merge.
 * At the draft-pool/free-agents request rate the miss is not a single
 * refetch, it is a thundering herd against PostgREST once every two
 * minutes, forever.
 *
 * The fix is one shared promise. The first miss starts the load and parks
 * the promise here; every caller that arrives while it is outstanding
 * awaits the SAME promise instead of starting its own. Requests collapse
 * from N reads to 1 with no change to what any caller receives.
 *
 * Shared across PlayerService instances on purpose — `playersCache` is
 * already module-scoped and already shared across users, so single-flight
 * introduces no data sharing that the cache did not already have. These
 * are public reference tables (directory, season stats, talent metrics,
 * GSAx), not per-user rows.
 */
let playersInFlight: Promise<{ players: NormalizedPlayer[]; error: unknown }> | null = null;

function buildPlayer(p: PlayerDirectoryRow, stat: Partial<PlayerStatsRow>, talent?: Partial<TalentMetricsRow>, goalieGsax?: GoalieGsaxRow): NormalizedPlayer {
  const rosterStatus = talent?.roster_status ?? null;
  const isGoalie = p.position_code === 'G';

  // GAMES PLAYED MEANS "GAMES THIS PLAYER APPEARED IN".
  //
  // player_season_stats carries two counters and they are not
  // interchangeable. `games_played` is games DRESSED; for a goalie that
  // includes every night he backed up. `goalie_gp` is games PLAYED.
  // Verified against production, season 2025, 102 goalies: games_played
  // averages 51.2 while goalie_gp averages 27.1. Vasilevskiy reads 75
  // dressed against 58 played.
  //
  // Every consumer of this field either prints it as "GP" or divides by it
  // to get a per-game rate, so the skater column made a starting goalie's
  // TOI/game render ~26:00 instead of ~59:00, and his fantasy
  // points-per-game come out roughly 30% low.
  //
  // Three call sites had already patched this locally — MatchupService,
  // TradeAnalyzer and DropPlayerForAddDialog — with three slightly
  // different expressions, which is exactly why the same goalie showed a
  // different stat line depending on which screen opened his card. Three
  // independent local fixes for one defect is the signal that the defect
  // belongs upstream. Resolving it here, where the payload is built, is
  // what makes every screen agree.
  //
  // goalie_gp stays on the payload unchanged for callers that want it
  // explicitly. goalie_gp = 0 on a goalie is not missing data: all four
  // such rows in season 2025 also carry zero saves, zero TOI and zero
  // decisions. Those players genuinely never played, and "no appearances"
  // is the honest card.
  const gamesPlayed = isGoalie ? (stat.goalie_gp || 0) : (stat.games_played || 0);

  return {
    id: p.player_id,
    full_name: p.full_name,
    position: p.position_code,
    team: p.team_abbrev,
    jersey_number: p.jersey_number ? parseInt(p.jersey_number, 10) : null,
    headshot_url: p.headshot_url,
    is_goalie: isGoalie,
    status: rosterStatus === 'IR' || rosterStatus === 'LTIR' ? 'injured' : 'active',
    roster_status: rosterStatus,
    is_ir_eligible: talent?.is_ir_eligible || false,
    eligible_positions: parseEligiblePositions(p.eligible_positions, p.position_code),
    games_played: gamesPlayed,
    goals: stat.nhl_goals || 0,
    assists: stat.nhl_assists || 0,
    points: (stat.nhl_goals || 0) + (stat.nhl_assists || 0),
    shots: stat.nhl_shots_on_goal || 0,
    hits: stat.nhl_hits || 0,
    blocks: stat.nhl_blocks || 0,
    pim: stat.nhl_pim || 0,
    ppp: stat.nhl_ppp || 0,
    shp: stat.nhl_shp || 0,
    plus_minus: stat.nhl_plus_minus || 0,
    icetime_seconds: stat.nhl_toi_seconds || 0,
    x_goals: stat.x_goals || 0,
    goalie_gp: stat.goalie_gp || 0,
    wins: stat.nhl_wins || 0,
    losses: stat.nhl_losses || 0,
    ot_losses: stat.nhl_ot_losses || 0,
    saves: stat.nhl_saves || 0,
    shots_faced: stat.nhl_shots_faced || 0,
    goals_against: stat.nhl_goals_against || 0,
    save_pct: stat.nhl_save_pct || 0,
    gaa: stat.nhl_gaa || 0,
    shutouts: stat.nhl_shutouts || 0,
    gsax: goalieGsax?.regressed_gsax ?? null,
    xg_per_60: talent?.xg_per_60 || null,
    xg_rating: talent?.xg_rating || null,
    stats_updated_at: stat.updated_at || null,
  };
}

export class PlayerService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /** Get all players with stats, talent metrics, and goalie GSAx */
  async getAllPlayers(): Promise<{ players: NormalizedPlayer[]; error: unknown }> {
    // Check cache
    if (playersCache && Date.now() - playersCache.timestamp < CACHE_TTL) {
      return { players: playersCache.data, error: null };
    }

    // A load is already running — join it rather than starting a second.
    // See the `playersInFlight` note above.
    if (playersInFlight) return playersInFlight;

    playersInFlight = this.loadAllPlayers();
    try {
      return await playersInFlight;
    } finally {
      playersInFlight = null;
    }
  }

  /** The uncached read+merge behind `getAllPlayers`. */
  private async loadAllPlayers(): Promise<{ players: NormalizedPlayer[]; error: unknown }> {
    // PAGED READS (2026-09-02 scale audit).
    //
    // These four reads used to be a single `.range(0, 4999)` each with no
    // `.order()`. `.range()` is not an escape hatch: PostgREST clamps the
    // ranged response server-side at `db-max-rows` (1,000 on this
    // project), returns HTTP 200, and says nothing. `player_directory`
    // carries ~1.9k rows for a season, so this method — which feeds the
    // DRAFT POOL and FREE AGENTS — was handing callers roughly half the
    // league, in physical-row order, with no error to notice.
    //
    // That is byte-for-byte the defect that put a fringe player at the
    // top of the draft board in `docs/ARCHITECT_INBOX.md`, fixed in
    // `usePreloadedPlayers.ts` and again twice in `autopickStrategy.ts`,
    // and missed here. `readAllPaged` carries the write-up.
    //
    // Sort keys are unique per row in every case: (season, player_id) is
    // one row per player per season in the three season-scoped tables,
    // and `goalie_gsax_primary.goalie_id` is that table's PRIMARY KEY
    // (migration 20250114000001).
    const season = getCurrentSeason();

    const { data: directory, error: dirError } = await readAllPaged<PlayerDirectoryRow>(
      this.supabase,
      {
        table: 'player_directory',
        columns: COLUMNS.PLAYER_DIRECTORY,
        filters: [['season', season]],
        orderBy: ['player_id'],
      },
    );

    if (dirError) {
      return { players: playersCache?.data || [], error: dirError };
    }

    // The other three are independent of each other and of the directory
    // (no FKs between them; the merge below is an in-memory Map join), so
    // they fan out rather than queueing.
    //
    // This is not gold-plating, it is paying for the paging above. Four
    // clamped reads used to be four sequential round trips; correct paging
    // makes it nine at today's row counts (3 + 2 + 3 + 1). Fanning the
    // three non-directory reads out puts the cold path back to roughly
    // where it was, and the directory read stays first on its own so its
    // error still short-circuits before anything else is spent.
    const [statsRes, talentRes, gsaxRes] = await Promise.all([
      readAllPaged<PlayerStatsRow>(this.supabase, {
        table: 'player_season_stats',
        columns: COLUMNS.PLAYER_STATS,
        filters: [['season', season]],
        orderBy: ['player_id'],
      }),
      readAllPaged<TalentMetricsRow>(this.supabase, {
        table: 'player_talent_metrics',
        columns: COLUMNS.PLAYER_TALENT_METRICS,
        filters: [['season', season]],
        orderBy: ['player_id'],
      }),
      readAllPaged<GoalieGsaxRow>(this.supabase, {
        table: 'goalie_gsax_primary',
        columns: COLUMNS.GOALIE_GSAX,
        orderBy: ['goalie_id'],
      }),
    ]);
    const stats = statsRes.data;
    const talents = talentRes.data;
    const gsax = gsaxRes.data;

    const statsMap = new Map(((stats || []) as unknown as PlayerStatsRow[]).map((s) => [s.player_id, s]));
    const talentMap = new Map(((talents || []) as unknown as TalentMetricsRow[]).map((t) => [t.player_id, t]));
    // goalie_gsax_primary is keyed on `goalie_id`, which is the same NHL
    // player id as `player_directory.player_id` — the column name just
    // differs. Keep the Map keyed on the numeric id so downstream lookup
    // by `p.player_id` still works.
    const gsaxMap = new Map(((gsax || []) as unknown as GoalieGsaxRow[]).map((g) => [g.goalie_id, g]));

    const players = ((directory || []) as unknown as PlayerDirectoryRow[]).map((p) => {
      const stat = statsMap.get(p.player_id) || {};
      const talent = talentMap.get(p.player_id) || {};
      const goalieGsax = gsaxMap.get(p.player_id);
      return buildPlayer(p, stat, talent, goalieGsax);
    });

    // Sort by points descending
    players.sort((a, b) => (b.points || 0) - (a.points || 0));

    // Update cache
    playersCache = { data: players, timestamp: Date.now() };

    return { players, error: null };
  }

  /** Get players by IDs */
  async getPlayersByIds(playerIds: (string | number)[]) {
    if (!playerIds.length) return { players: [] as NormalizedPlayer[], error: null };

    const numericIds = playerIds.map((id) => parseInt(String(id), 10)).filter((id) => !isNaN(id));

    // SEASON FILTER (2026-08-23 final audit): these reads had NO season
    // filter while getAllPlayers() filters all of them to
    // getCurrentSeason(). player_directory and player_season_stats are
    // per-SEASON indexes, so the unfiltered .in() returned one row per
    // season per player and the Map collapse below kept an arbitrary
    // one — the Free Agents player card showed a different stat line
    // (another season's) than the pool row for the same player.
    const { data: directory, error } = await this.supabase
      .from('player_directory')
      .select(COLUMNS.PLAYER_DIRECTORY)
      .eq('season', getCurrentSeason())
      .in('player_id', numericIds);

    if (error) {
      return { players: [] as NormalizedPlayer[], error };
    }

    const dirIds = ((directory || []) as unknown as PlayerDirectoryRow[]).map((p) => p.player_id);

    const [{ data: stats }, { data: talents }, { data: gsax }] = await Promise.all([
      this.supabase
        .from('player_season_stats')
        .select(COLUMNS.PLAYER_STATS)
        .eq('season', getCurrentSeason())
        .in('player_id', dirIds),
      this.supabase
        .from('player_talent_metrics')
        .select(COLUMNS.PLAYER_TALENT_METRICS)
        .eq('season', getCurrentSeason())
        .in('player_id', dirIds),
      this.supabase
        .from('goalie_gsax_primary')
        .select(COLUMNS.GOALIE_GSAX)
        .in('goalie_id', dirIds),
    ]);

    const statsMap = new Map(((stats || []) as unknown as PlayerStatsRow[]).map((s) => [s.player_id, s]));
    const talentMap = new Map(((talents || []) as unknown as TalentMetricsRow[]).map((t) => [t.player_id, t]));
    // goalie_gsax_primary is keyed on `goalie_id` (same numeric NHL id).
    const gsaxMap = new Map(((gsax || []) as unknown as GoalieGsaxRow[]).map((g) => [g.goalie_id, g]));

    const players = ((directory || []) as unknown as PlayerDirectoryRow[]).map((p) => {
      const stat = statsMap.get(p.player_id) || {};
      const talent = talentMap.get(p.player_id) || {};
      const goalieGsax = gsaxMap.get(p.player_id);
      return buildPlayer(p, stat, talent, goalieGsax);
    });

    return { players, error: null };
  }

  /** Search players by name */
  async searchPlayers(query: string) {
    const { players } = await this.getAllPlayers();
    const q = query.toLowerCase();
    return {
      players: players.filter((p) => p.full_name?.toLowerCase().includes(q)),
      error: null,
    };
  }

  /** Get a single player by ID */
  async getPlayer(playerId: string | number) {
    const { data, error } = await this.supabase
      .from('player_directory')
      .select(COLUMNS.PLAYER_DIRECTORY)
      // SEASON FILTER (2026-08-24 sweep): without it the per-season index
      // returns one row per season and .single() THROWS on any player
      // with more than one season row.
      .eq('season', getCurrentSeason())
      .eq('player_id', parseInt(String(playerId), 10))
      .single();

    return { player: data, error };
  }

  /** Get player season stats */
  async getPlayerStats(playerId: string | number, season?: number) {
    let query = this.supabase
      .from('player_season_stats')
      .select(COLUMNS.PLAYER_STATS)
      .eq('player_id', parseInt(String(playerId), 10));

    if (season) {
      query = query.eq('season', season);
    }

    const { data, error } = await query;
    return { stats: data || [], error };
  }

  /** Get player projections — returns all projections from startDate onward */
  async getPlayerProjections(playerId: string | number, startDate?: string) {
    let query = this.supabase
      .from('player_projected_stats')
      .select(COLUMNS.PLAYER_PROJECTED_STATS)
      .eq('player_id', parseInt(String(playerId), 10))
      .order('projection_date', { ascending: true });

    if (startDate) {
      query = query.gte('projection_date', startDate);
    }

    const { data, error } = await query;

    return { projections: data || [], error };
  }

  /** Get trending players (platform-wide add/drop activity) */
  async getTrendingPlayers(daysBack = 7, limitCount = 50) {
    const { data, error } = await this.supabase.rpc('get_trending_players', {
      days_back: daysBack,
      limit_count: limitCount,
    });

    if (error) {
      return { trending: new Map<number, { addCount: number; netAdds: number }>(), error };
    }

    const trending = new Map<number, { addCount: number; netAdds: number }>();
    for (const row of data || []) {
      trending.set(row.player_id, {
        addCount: row.add_count || 0,
        netAdds: row.net_adds || 0,
      });
    }

    return { trending, error: null };
  }

  /** Get roster assignment count for a team */
  async getRosterAssignmentCount(teamId: string, leagueId: string) {
    const { count, error } = await this.supabase
      .from('roster_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .eq('league_id', leagueId);

    return { count, error: error?.message || null };
  }

  static clearCache() {
    playersCache = null;
    playersInFlight = null;
  }
}

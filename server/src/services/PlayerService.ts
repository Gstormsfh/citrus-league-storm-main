import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS } from '@citrus/shared';

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
  current_team_abbrev: string;
  sweater_number: number | null;
  headshot_url: string | null;
  roster_status: string | null;
  eligible_positions: string[] | null;
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
  goalie_gp: number;
  nhl_wins: number;
  nhl_losses: number;
  nhl_saves: number;
  nhl_save_pct: number;
  nhl_gaa: number;
  nhl_shutouts: number;
}

interface TalentMetricsRow {
  player_id: number;
  xg_per_60: number | null;
  xg_rating: string | null;
}

interface GoalieGsaxRow {
  player_id: number;
  gsax: number | null;
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
  goalie_gp: number;
  wins: number;
  losses: number;
  saves: number;
  save_pct: number;
  gaa: number;
  shutouts: number;
  gsax?: number | null;
  xg_per_60?: number | null;
  xg_rating?: string | null;
}

// 5-minute cache for player data
let playersCache: { data: NormalizedPlayer[]; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

function buildPlayer(p: PlayerDirectoryRow, stat: Partial<PlayerStatsRow>, talent?: Partial<TalentMetricsRow>, goalieGsax?: GoalieGsaxRow): NormalizedPlayer {
  return {
    id: p.player_id,
    full_name: p.full_name,
    position: p.position_code,
    team: p.current_team_abbrev,
    jersey_number: p.sweater_number,
    headshot_url: p.headshot_url,
    is_goalie: p.position_code === 'G',
    status: p.roster_status === 'IR' || p.roster_status === 'LTIR' ? 'injured' : 'active',
    eligible_positions: p.eligible_positions || [p.position_code],
    games_played: stat.games_played || 0,
    goals: stat.nhl_goals || 0,
    assists: stat.nhl_assists || 0,
    points: stat.nhl_points || 0,
    shots: stat.nhl_shots_on_goal || 0,
    hits: stat.nhl_hits || 0,
    blocks: stat.nhl_blocks || 0,
    pim: stat.nhl_pim || 0,
    ppp: stat.nhl_ppp || 0,
    shp: stat.nhl_shp || 0,
    plus_minus: stat.nhl_plus_minus || 0,
    goalie_gp: stat.goalie_gp || 0,
    wins: stat.nhl_wins || 0,
    losses: stat.nhl_losses || 0,
    saves: stat.nhl_saves || 0,
    save_pct: stat.nhl_save_pct || 0,
    gaa: stat.nhl_gaa || 0,
    shutouts: stat.nhl_shutouts || 0,
    gsax: goalieGsax?.gsax || null,
    xg_per_60: talent?.xg_per_60 || null,
    xg_rating: talent?.xg_rating || null,
  };
}

export class PlayerService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /** Get all players with stats, talent metrics, and goalie GSAx */
  async getAllPlayers() {
    // Check cache
    if (playersCache && Date.now() - playersCache.timestamp < CACHE_TTL) {
      return { players: playersCache.data, error: null };
    }

    // Fetch player directory
    const { data: directory, error: dirError } = await this.supabase
      .from('player_directory')
      .select(COLUMNS.PLAYER_DIRECTORY)
      .range(0, 4999);

    if (dirError) {
      return { players: playersCache?.data || [], error: dirError };
    }

    // Fetch season stats
    const { data: stats } = await this.supabase
      .from('player_season_stats')
      .select(COLUMNS.PLAYER_STATS)
      .range(0, 4999);

    // Fetch talent metrics
    const { data: talents } = await this.supabase
      .from('player_talent_metrics')
      .select(COLUMNS.PLAYER_TALENT_METRICS)
      .range(0, 4999);

    // Fetch goalie GSAx
    const { data: gsax } = await this.supabase
      .from('goalie_gsax_primary')
      .select(COLUMNS.GOALIE_GSAX);

    const statsMap = new Map(((stats || []) as unknown as PlayerStatsRow[]).map((s) => [s.player_id, s]));
    const talentMap = new Map(((talents || []) as unknown as TalentMetricsRow[]).map((t) => [t.player_id, t]));
    const gsaxMap = new Map(((gsax || []) as unknown as GoalieGsaxRow[]).map((g) => [g.player_id, g]));

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

    const { data: directory, error } = await this.supabase
      .from('player_directory')
      .select(COLUMNS.PLAYER_DIRECTORY)
      .in('player_id', numericIds);

    if (error) {
      return { players: [] as NormalizedPlayer[], error };
    }

    const dirIds = ((directory || []) as unknown as PlayerDirectoryRow[]).map((p) => p.player_id);

    const { data: stats } = await this.supabase
      .from('player_season_stats')
      .select(COLUMNS.PLAYER_STATS)
      .in('player_id', dirIds);

    const statsMap = new Map(((stats || []) as unknown as PlayerStatsRow[]).map((s) => [s.player_id, s]));

    const players = ((directory || []) as unknown as PlayerDirectoryRow[]).map((p) => {
      const stat = statsMap.get(p.player_id) || {};
      return buildPlayer(p, stat);
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
  }
}

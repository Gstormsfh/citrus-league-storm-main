import { getHeadshotUrl } from "@/utils/seasonConstants";
import { logger } from '@/utils/logger';
import { playerApi } from '@/api/players';
import { apiClient } from '@/api/client';

/**
 * PlayerService - SINGLE SOURCE OF TRUTH
 *
 * ALL player data is fetched via the API server (3-tier architecture).
 * Server queries pipeline tables: player_directory, player_season_stats,
 * player_talent_metrics, goalie_gsax_primary.
 */

/**
 * Normalize a raw position code to our standard format.
 */
function normalizePosition(p: string): string {
  const u = (p || '').toUpperCase().trim();
  if (u === 'L' || u === 'LEFT' || u === 'LEFTWING') return 'LW';
  if (u === 'R' || u === 'RIGHT' || u === 'RIGHTWING') return 'RW';
  if (u === 'CENTRE' || u === 'CENTER') return 'C';
  if (u === 'DEFENCE' || u === 'DEFENSE') return 'D';
  if (u === 'GOALIE' || u === 'GOALTENDER') return 'G';
  return u;
}

export interface Player {
  id: string; // Using string ID to be consistent with app usage, but will store NHL ID
  full_name: string;
  position: string; // Primary position (C, LW, RW, D, G)
  eligible_positions: string[]; // All positions this player qualifies for (max 2). Industry standard dual-eligibility.
  team: string;
  jersey_number: string | null;
  status: string | null;
  roster_status?: string; // Official NHL roster status: ACT, IR, LTIR, etc.
  is_ir_eligible?: boolean; // True if player is on IR or LTIR and can be placed in IR slot
  headshot_url: string | null;
  last_updated: string | null;
  games_played: number;

  // Stats (from 'all' situation)
  goals: number;
  assists: number;
  points: number;
  plus_minus: number;
  shots: number;
  hits: number;
  blocks: number;
  pim?: number;
  ppp?: number;
  shp?: number;
  icetime_seconds?: number;

  // Advanced stats (new)
  xGoals: number;

  // Goalie specific
  wins: number | null;
  losses: number | null;
  ot_losses: number | null;
  saves: number | null;
  shutouts?: number | null;
  shots_faced?: number | null;
  goals_against?: number | null;
  goals_against_average: number | null;
  save_percentage: number | null;
  highDangerSavePct: number;
  goalsSavedAboveExpected: number;
  goalie_gp?: number; // Goalie games played (separate from skater games_played)

  // Waiver status (populated for league free-agent lists)
  is_on_waivers?: boolean;
  waiver_clears_at?: string | null;
}

/** Shape returned by the API server's NormalizedPlayer */
interface ServerPlayer {
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

/** Map server NormalizedPlayer to frontend Player interface */
function mapServerPlayer(sp: ServerPlayer): Player {
  const isGoalie = sp.is_goalie || sp.position === 'G';
  // Normalize eligible_positions (server may return raw position codes)
  const eligiblePositions = Array.isArray(sp.eligible_positions)
    ? sp.eligible_positions.map(p => normalizePosition(p)).filter(Boolean)
    : [normalizePosition(sp.position)];

  return {
    id: String(sp.id),
    full_name: sp.full_name,
    position: normalizePosition(sp.position) || '',
    eligible_positions: eligiblePositions,
    team: sp.team || '',
    jersey_number: sp.jersey_number != null ? String(sp.jersey_number) : null,
    status: sp.status,
    roster_status: sp.roster_status || undefined,
    is_ir_eligible: sp.is_ir_eligible || false,
    headshot_url: sp.headshot_url || getHeadshotUrl(sp.team, sp.id),
    last_updated: sp.stats_updated_at || null,
    games_played: sp.games_played || 0,
    goals: sp.goals || 0,
    assists: sp.assists || 0,
    points: sp.points || 0,
    plus_minus: sp.plus_minus || 0,
    shots: sp.shots || 0,
    hits: sp.hits || 0,
    blocks: sp.blocks || 0,
    pim: sp.pim || 0,
    ppp: sp.ppp || 0,
    shp: sp.shp || 0,
    icetime_seconds: sp.icetime_seconds || 0,
    xGoals: sp.x_goals || 0,
    wins: isGoalie ? (sp.wins || 0) : null,
    losses: isGoalie ? (sp.losses || 0) : null,
    ot_losses: isGoalie ? (sp.ot_losses || 0) : null,
    saves: isGoalie ? (sp.saves || 0) : null,
    shutouts: isGoalie ? (sp.shutouts || 0) : null,
    shots_faced: isGoalie ? (sp.shots_faced || 0) : null,
    goals_against: isGoalie ? (sp.goals_against || 0) : null,
    goals_against_average: isGoalie ? (sp.gaa ?? null) : null,
    save_percentage: isGoalie ? (sp.save_pct ?? null) : null,
    highDangerSavePct: 0,
    goalsSavedAboveExpected: isGoalie ? (sp.gsax ?? 0) : 0,
    goalie_gp: isGoalie ? (sp.goalie_gp || 0) : undefined,
  };
}

// In-memory cache for player data
interface CacheEntry {
  data: Player[];
  timestamp: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
let playersCache: CacheEntry | null = null;

// EGRESS OPTIMIZATION: Per-player cache for getPlayersByIds()
const playerByIdCache = new Map<string, { data: Player; timestamp: number }>();

export const PlayerService = {
  /**
   * Clear the player cache (call this when player data is updated)
   */
  clearCache(): void {
    playersCache = null;
    playerByIdCache.clear();
    playerApi.clearCache();
  },

  /**
   * Get all players via API server (3-tier architecture)
   * Results are cached for 5 minutes to improve performance.
   */
  async getAllPlayers(): Promise<Player[]> {
    const now = Date.now();
    if (playersCache && (now - playersCache.timestamp) < CACHE_TTL) {
      return playersCache.data;
    }

    try {
      const response = await playerApi.searchPlayers();
      const serverPlayers = (response.data || []) as ServerPlayer[];
      const players = serverPlayers.map(mapServerPlayer);
      const sortedPlayers = players.sort((a, b) => (b.points || 0) - (a.points || 0));

      playersCache = { data: sortedPlayers, timestamp: Date.now() };
      return sortedPlayers;
    } catch (error) {
      logger.error("[PlayerService] Error fetching players from API:", error);
      return [];
    }
  },

  /**
   * Get players by position
   */
  async getPlayersByPosition(position: string) {
    const all = await this.getAllPlayers();
    return all.filter(p => p.position === position);
  },

  /**
   * Search players by name
   */
  async searchPlayers(query: string) {
    const all = await this.getAllPlayers();
    const lowerQuery = query.toLowerCase();
    return all.filter(p => p.full_name.toLowerCase().includes(lowerQuery));
  },

  /**
   * Get players by their IDs via API server
   * EGRESS OPTIMIZATION: Uses per-player cache to avoid redundant fetches
   */
  async getPlayersByIds(playerIds: string[]): Promise<Player[]> {
    if (playerIds.length === 0) return [];

    const now = Date.now();
    const cachedPlayers: Player[] = [];
    const uncachedIds: string[] = [];

    for (const id of playerIds) {
      const cached = playerByIdCache.get(id);
      if (cached && (now - cached.timestamp) < CACHE_TTL) {
        cachedPlayers.push(cached.data);
      } else {
        uncachedIds.push(id);
      }
    }

    if (uncachedIds.length === 0) {
      return cachedPlayers;
    }

    try {
      const response = await playerApi.getPlayersByIds(uncachedIds);
      const serverPlayers = (response.data || []) as ServerPlayer[];
      const players = serverPlayers.map(mapServerPlayer);

      // Cache newly fetched players
      const cacheTimestamp = Date.now();
      for (const player of players) {
        playerByIdCache.set(player.id, { data: player, timestamp: cacheTimestamp });
      }

      const allPlayers = [...cachedPlayers, ...players];
      return allPlayers.sort((a, b) => (b.points || 0) - (a.points || 0));
    } catch (error) {
      logger.error('[PlayerService] Error fetching players by IDs:', error);
      return cachedPlayers.length > 0 ? cachedPlayers : [];
    }
  },

  /**
   * Get platform-wide trending player data (adds/drops over recent days).
   */
  async getTrendingPlayers(daysBack = 7, limitCount = 50): Promise<Map<number, { addCount: number; netAdds: number }>> {
    const trendingMap = new Map<number, { addCount: number; netAdds: number }>();
    try {
      const response = await playerApi.getTrendingPlayers(daysBack, limitCount);
      const rows = response.data;
      if (!rows || !Array.isArray(rows)) return trendingMap;
      for (const row of rows) {
        trendingMap.set(Number(row.playerId ?? row.player_id), {
          addCount: Number(row.addCount ?? row.add_count ?? 0),
          netAdds: Number(row.netAdds ?? row.net_adds ?? 0),
        });
      }
    } catch (err) {
      logger.error('[PlayerService] getTrendingPlayers error:', err);
    }
    return trendingMap;
  },

  /**
   * Record a player transaction (add/drop) for platform-wide trending analytics.
   */
  async recordPlayerTransaction(params: {
    playerId: number;
    leagueId: string;
    teamId: string;
    transactionType: 'add' | 'drop';
    source: string;
    playerName: string;
    playerTeam: string;
    playerPosition: string;
  }): Promise<void> {
    try {
      await playerApi.recordPlayerTransaction(params);
    } catch (err) {
      logger.error('[PlayerService] recordPlayerTransaction error:', err);
    }
  },

  /**
   * Count roster assignments for a given team+league.
   */
  async getRosterAssignmentCount(teamId: string, leagueId: string): Promise<{ count: number | null; error: string | null }> {
    try {
      const response = await apiClient.get(`/api/rosters/league/${leagueId}/team/${teamId}/player-ids`);
      const playerIds = response.data;
      const count = Array.isArray(playerIds) ? playerIds.length : null;
      return { count, error: null };
    } catch (err) {
      logger.error('[PlayerService] getRosterAssignmentCount error:', err);
      return { count: null, error: String(err) };
    }
  },
};

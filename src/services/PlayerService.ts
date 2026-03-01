import { supabase } from "@/integrations/supabase/client";
import { CURRENT_SEASON, getHeadshotUrl } from "@/utils/seasonConstants";
import { logger } from '@/utils/logger';

/**
 * Supabase client reference for pipeline tables not yet in the generated Database type.
 * Tables: player_directory, player_season_stats, player_talent_metrics, goalie_gsax_primary, goalie_gsax.
 * Once types.ts is regenerated to include these tables, this cast can be removed and
 * `supabase` used directly.
 */
interface PipelineQueryResult<T = unknown> {
  data: T | null;
  error: { message: string; code?: string } | null;
  count?: number | null;
}
interface PipelineQueryBuilder<T = unknown> {
  eq: (col: string, val: string | number) => PipelineQueryBuilder<T>;
  neq: (col: string, val: string | number) => PipelineQueryBuilder<T>;
  in: (col: string, vals: (string | number)[]) => PipelineQueryBuilder<T>;
  is: (col: string, val: null) => PipelineQueryBuilder<T>;
  gte: (col: string, val: string | number) => PipelineQueryBuilder<T>;
  lte: (col: string, val: string | number) => PipelineQueryBuilder<T>;
  gt: (col: string, val: string | number) => PipelineQueryBuilder<T>;
  order: (col: string, opts?: { ascending?: boolean }) => PipelineQueryBuilder<T>;
  limit: (count: number) => PipelineQueryBuilder<T>;
  single: () => Promise<PipelineQueryResult<T>>;
  maybeSingle: () => Promise<PipelineQueryResult<T>>;
  then: Promise<PipelineQueryResult<T[]>>['then'];
  [Symbol.toStringTag]: string;
}
interface PipelineDb {
  from: (table: string) => {
    select: (columns: string, opts?: { count?: string; head?: boolean }) => PipelineQueryBuilder;
    insert: (data: Record<string, unknown> | Record<string, unknown>[]) => PipelineQueryBuilder;
    upsert: (data: Record<string, unknown> | Record<string, unknown>[]) => PipelineQueryBuilder;
  };
  rpc: (fn: string, params?: Record<string, unknown>) => Promise<PipelineQueryResult>;
}
const pipelineDb = supabase as unknown as PipelineDb;

/**
 * PlayerService - SINGLE SOURCE OF TRUTH
 *
 * ALL player identity + stats are sourced from our own pipeline tables:
 * - public.player_directory (names/teams/positions)
 * - public.player_season_stats (season rollup)
 *
 * No reliance on staging tables.
 */

/**
 * Derive eligible positions for a player (max 2).
 * Industry standard: primary position + secondary if the player commonly plays both.
 * Currently derived from player_season_stats.position_code vs player_directory.position_code differences,
 * and common NHL position adjacencies (e.g., many Cs also play LW/RW).
 * In future, this will use game-level position data (10+ GP at secondary position = eligibility).
 */
function deriveEligiblePositions(primaryPos: string, statsPos: string | null): string[] {
  const normalize = (p: string): string => {
    const u = (p || '').toUpperCase();
    if (u === 'L' || u === 'LEFT' || u === 'LEFTWING') return 'LW';
    if (u === 'R' || u === 'RIGHT' || u === 'RIGHTWING') return 'RW';
    if (u === 'CENTRE' || u === 'CENTER') return 'C';
    if (u === 'DEFENCE' || u === 'DEFENSE') return 'D';
    if (u === 'GOALIE' || u === 'GOALTENDER') return 'G';
    return u;
  };

  const primary = normalize(primaryPos);
  if (!primary) return [];

  const positions = [primary];

  // If stats table has a different position than directory, the player is dual-eligible
  if (statsPos) {
    const secondary = normalize(statsPos);
    if (secondary && secondary !== primary && positions.length < 2) {
      positions.push(secondary);
    }
  }

  return positions;
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
}

type PlayerDirectoryRow = {
  season: number;
  player_id: number;
  full_name: string;
  team_abbrev: string | null;
  position_code: string | null;
  is_goalie: boolean;
  jersey_number: string | null;
  headshot_url: string | null;
};

type PlayerSeasonStatsRow = {
  season: number;
  player_id: number;
  team_abbrev: string | null;
  position_code: string | null;
  is_goalie: boolean;
  games_played: number;
  icetime_seconds: number; // Our calculated TOI (for GAR/internal use)
  nhl_toi_seconds?: number; // NHL.com official TOI (for display)
  plus_minus: number; // Our calculated plus/minus (for internal use)
  nhl_plus_minus?: number; // NHL.com official plus/minus (for display)
  // PBP-calculated stats (for internal model use)
  goals: number;
  primary_assists: number;
  secondary_assists: number;
  points: number;
  shots_on_goal: number;
  hits: number;
  blocks: number;
  pim: number;
  ppp: number;
  shp: number;
  // NHL.com official stats (for display and fantasy scoring)
  nhl_goals?: number;
  nhl_assists?: number;
  nhl_points?: number;
  nhl_shots_on_goal?: number;
  nhl_hits?: number;
  nhl_blocks?: number;
  nhl_pim?: number;
  nhl_ppp?: number;
  nhl_shp?: number;
  // Advanced metrics (from PBP - for internal use)
  x_goals: number;
  x_assists: number;
  // Goalie stats (PBP-calculated for internal use)
  goalie_gp: number;
  wins: number;
  saves: number;
  shots_faced: number;
  goals_against: number;
  shutouts: number;
  save_pct: number | null;
  // Goalie stats (NHL.com official for display)
  nhl_wins?: number;
  nhl_losses?: number;
  nhl_ot_losses?: number;
  nhl_saves?: number;
  nhl_shots_faced?: number;
  nhl_goals_against?: number;
  nhl_shutouts?: number;
  nhl_save_pct?: number | null;
  nhl_gaa?: number;
};

/** Shape of a row from the goalie GSAx tables (goalie_gsax_primary, goalie_gsax). */
interface GoalieGsaxRow {
  goalie_id: number;
  regressed_gsax: number | null;
}

// In-memory cache for player data
interface CacheEntry {
  data: Player[];
  timestamp: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
let playersCache: CacheEntry | null = null;

// EGRESS OPTIMIZATION: Per-player cache for getPlayersByIds()
// This prevents redundant fetches when same players are requested multiple times
const playerByIdCache = new Map<string, { data: Player; timestamp: number }>();

export const PlayerService = {
  /**
   * Clear the player cache (call this when player data is updated)
   */
  clearCache(): void {
    playersCache = null;
    playerByIdCache.clear();
  },

  /**
   * Get all players from our pipeline tables (SINGLE SOURCE OF TRUTH)
   * Returns players from player_directory joined with player_season_stats.
   * Results are cached for 5 minutes to improve performance.
   */
  async getAllPlayers(): Promise<Player[]> {
    // Check cache first
    const now = Date.now();
    if (playersCache && (now - playersCache.timestamp) < CACHE_TTL) {
      return playersCache.data;
    }

    try {
      const DEFAULT_SEASON = CURRENT_SEASON;
      // CRITICAL: Supabase defaults to returning max 1000 rows per query.
      // NHL has ~900+ players per season. Without .range(), some players silently drop off,
      // causing drafted players to be missing from rosters.
      // Use .range(0, 4999) to ensure ALL players are returned (max 5000).
      const [{ data: dirRowsRaw, error: dirErr }, { data: statRowsRaw, error: statErr }, { data: talentRowsRaw, error: talentErr }] = await Promise.all([
        pipelineDb
          .from("player_directory")
          .select("season, player_id, full_name, team_abbrev, position_code, is_goalie, jersey_number, headshot_url")
          .eq("season", DEFAULT_SEASON)
          .range(0, 4999),
        pipelineDb
          .from("player_season_stats")
          .select("season, player_id, team_abbrev, position_code, is_goalie, games_played, icetime_seconds, nhl_toi_seconds, goals, primary_assists, secondary_assists, points, shots_on_goal, hits, blocks, pim, ppp, shp, plus_minus, nhl_plus_minus, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_shp, x_goals, x_assists, goalie_gp, wins, saves, shots_faced, goals_against, shutouts, save_pct, nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_shots_faced, nhl_goals_against, nhl_shutouts, nhl_save_pct, nhl_gaa")
          .eq("season", DEFAULT_SEASON)
          .range(0, 4999),
        pipelineDb
          .from("player_talent_metrics")
          .select("player_id, season, roster_status, is_ir_eligible")
          .eq("season", DEFAULT_SEASON)
          .range(0, 4999),
      ]);

      if (dirErr) throw dirErr;
      if (statErr) throw statErr;

      const dirRows = (dirRowsRaw || []) as PlayerDirectoryRow[];
      const statRows = (statRowsRaw || []) as PlayerSeasonStatsRow[];

      const statsByPlayerId = new Map<number, PlayerSeasonStatsRow>();
      statRows.forEach((r) => {
        if (r?.player_id != null) {
          const pid = Number(r.player_id);
          // Validate season matches (defensive check)
          if (r.season !== DEFAULT_SEASON) {
            logger.warn(`[PlayerService] WARNING: Stats row for player ${pid} has season ${r.season}, expected ${DEFAULT_SEASON}`);
          }
          statsByPlayerId.set(pid, r);
        }
      });
      
      // Validate directory rows have correct season
      const wrongSeasonDir = dirRows.filter(d => d.season !== DEFAULT_SEASON);

      // Fetch GSAx for goalies (only for players that have stats)
      const goalieIds = dirRows
        .filter((d: PlayerDirectoryRow) => d.is_goalie && statsByPlayerId.has(Number(d.player_id)))
        .map((d: PlayerDirectoryRow) => Number(d.player_id));
      const gsaxMap = new Map<number, number>();
      
      if (goalieIds.length > 0) {
        try {
          // Try goalie_gsax_primary first (preferred)
          const { data: gsaxData } = await pipelineDb
            .from("goalie_gsax_primary")
            .select("goalie_id, regressed_gsax")
            .in("goalie_id", goalieIds);
          
          if (gsaxData) {
            gsaxData.forEach((g: GoalieGsaxRow) => {
              if (g.goalie_id && g.regressed_gsax != null) {
                gsaxMap.set(Number(g.goalie_id), Number(g.regressed_gsax));
              }
            });
          }
          
          // Fill in missing goalies from goalie_gsax (fallback)
          const missingGoalieIds = goalieIds.filter(id => !gsaxMap.has(id));
          if (missingGoalieIds.length > 0) {
            const { data: gsaxFallbackData } = await pipelineDb
              .from("goalie_gsax")
              .select("goalie_id, regressed_gsax")
              .in("goalie_id", missingGoalieIds);
            
            if (gsaxFallbackData) {
              gsaxFallbackData.forEach((g: GoalieGsaxRow) => {
                if (g.goalie_id && g.regressed_gsax != null && !gsaxMap.has(Number(g.goalie_id))) {
                  gsaxMap.set(Number(g.goalie_id), Number(g.regressed_gsax));
                }
              });
            }
          }
        } catch (gsaxError) {
          logger.warn('[PlayerService] Error fetching GSAx data:', gsaxError);
          // Continue without GSAx - not critical
        }
      }

      // Build talent metrics lookup for roster_status and IR eligibility
      const talentRows = (talentRowsRaw || []) as Array<{ player_id: number; season: number; roster_status: string | null; is_ir_eligible: boolean | null }>;
      const talentByPlayerId = new Map<number, { roster_status: string | null; is_ir_eligible: boolean | null }>();
      talentRows.forEach(t => {
        if (t?.player_id != null) {
          talentByPlayerId.set(Number(t.player_id), { roster_status: t.roster_status, is_ir_eligible: t.is_ir_eligible });
        }
      });

      // Include ALL players from directory, even those without stats records.
      // Players without stats get zero stats but still appear on rosters (critical for newly
      // traded/injured players like McDavid who may have no season stats yet).
      const players: Player[] = dirRows
        .filter((d) => d.player_id != null)
        .map((d) => {
        const pid = Number(d.player_id);
        const sRaw = statsByPlayerId.get(pid) || null;

        // Validate season matches (only if stats record exists)
        if (sRaw && sRaw.season !== DEFAULT_SEASON) {
          logger.warn(`[PlayerService] WARNING: Stats for player ${d.full_name} (ID: ${pid}) has season ${sRaw.season}, expected ${DEFAULT_SEASON}`);
        }
        
        // If player hasn't played (games_played === 0), treat stats as null to show zeros
        const gamesPlayed = Number(sRaw?.games_played ?? 0);
        const hasPlayed = gamesPlayed > 0;
        
        // ALWAYS use NHL.com official stats exclusively (no PBP fallback)
        // This ensures we display only NHL.com data, not PBP-calculated data
        const s = hasPlayed ? sRaw : null;
        
        const assists = Number(s?.primary_assists ?? 0) + Number(s?.secondary_assists ?? 0);

        const team = d.team_abbrev || s?.team_abbrev || "";
        const pos = d.position_code || s?.position_code || (d.is_goalie ? "G" : "");
        const headshot =
          d.headshot_url ||
          getHeadshotUrl(team, pid);

        // ALWAYS use NHL.com official stats (no fallback to PBP)
        const calculatedGoals = Number(s?.nhl_goals ?? 0);
        const calculatedAssists = Number(s?.nhl_assists ?? 0);

        // ALWAYS calculate points from goals + assists to ensure consistency
        const calculatedPoints = calculatedGoals + calculatedAssists;

        // Use real roster_status from player_talent_metrics (IR, LTIR, etc.)
        const talent = talentByPlayerId.get(pid);
        const rosterStatus = talent?.roster_status || null;
        const irEligible = talent?.is_ir_eligible || false;
        // Map NHL roster_status to fantasy-relevant status
        // IR/LTIR -> 'injured', active/null -> 'active'
        const derivedStatus = rosterStatus === 'IR' || rosterStatus === 'LTIR'
          ? 'injured'
          : 'active';

        // Derive dual-position eligibility from directory vs stats position differences
        const eligiblePositions = deriveEligiblePositions(pos, sRaw?.position_code || null);

        return {
          id: String(pid),
          full_name: d.full_name,
          position: pos || "",
          eligible_positions: eligiblePositions,
          team: team || "",
          jersey_number: d.jersey_number ?? null,
          status: derivedStatus,
          roster_status: rosterStatus || undefined,
          is_ir_eligible: irEligible,
          headshot_url: headshot,
          last_updated: new Date().toISOString(),
          games_played: gamesPlayed,

          // EXCLUSIVELY use NHL.com official stats (no PBP fallback)
          // If NHL stats are missing/0, show 0 (don't fall back to PBP)
          goals: calculatedGoals,
          assists: calculatedAssists,
          points: calculatedPoints,
          plus_minus: Number(s?.nhl_plus_minus ?? 0),
          shots: Number(s?.nhl_shots_on_goal ?? 0),
          hits: Number(s?.nhl_hits ?? 0),
          blocks: Number(s?.nhl_blocks ?? 0),
          pim: Number(s?.nhl_pim ?? 0),
          ppp: Number(s?.nhl_ppp ?? 0),
          shp: Number(s?.nhl_shp ?? 0),
          // Use NHL.com TOI exclusively (no PBP fallback)
          icetime_seconds: Number(s?.nhl_toi_seconds ?? 0),

          xGoals: Number(s?.x_goals ?? 0),

          // Goalie stats: EXCLUSIVELY use NHL.com official stats (no PBP fallback)
          wins: d.is_goalie ? Number(s?.nhl_wins ?? 0) : null,
          losses: d.is_goalie ? Number(s?.nhl_losses ?? 0) : null,
          ot_losses: d.is_goalie ? Number(s?.nhl_ot_losses ?? 0) : null,
          saves: d.is_goalie ? Number(s?.nhl_saves ?? 0) : null,
          shutouts: d.is_goalie ? Number(s?.nhl_shutouts ?? 0) : null,
          shots_faced: d.is_goalie ? Number(s?.nhl_shots_faced ?? 0) : null,
          goals_against: d.is_goalie ? Number(s?.nhl_goals_against ?? 0) : null,
          goals_against_average: d.is_goalie
            ? (s?.nhl_gaa ?? null)
            : null,
          save_percentage: d.is_goalie ? (s?.nhl_save_pct ?? null) : null,
          highDangerSavePct: 0,
          goalsSavedAboveExpected: d.is_goalie ? (gsaxMap.get(pid) ?? 0) : 0,
          goalie_gp: d.is_goalie ? Number(s?.goalie_gp ?? 0) : undefined,
        };
      });

      const sortedPlayers = players.sort((a, b) => (b.points || 0) - (a.points || 0));

      // Log sample of players to verify data
      if (sortedPlayers.length > 0) {
        // Players loaded successfully
      }

      playersCache = {
        data: sortedPlayers,
        timestamp: Date.now(),
      };

      return sortedPlayers;
    } catch (error) {
      logger.error("Error fetching players from pipeline tables (player_directory/player_season_stats):", error);
      return [];
    }
  },

  /**
   * Get players by position - all data from staging files
   */
  async getPlayersByPosition(position: string) {
    const all = await this.getAllPlayers();
    return all.filter(p => p.position === position);
  },

  /**
   * Search players by name - all data from staging files
   */
  async searchPlayers(query: string) {
    const all = await this.getAllPlayers();
    const lowerQuery = query.toLowerCase();
    return all.filter(p => p.full_name.toLowerCase().includes(lowerQuery));
  },

  /**
   * Get players by their IDs - optimized to only load specific players
   * EGRESS OPTIMIZATION: Uses per-player cache to avoid redundant fetches
   */
  async getPlayersByIds(playerIds: string[]): Promise<Player[]> {
    if (playerIds.length === 0) return [];
    
    const now = Date.now();
    const cachedPlayers: Player[] = [];
    const uncachedIds: string[] = [];
    
    // Check which players are already cached
    for (const id of playerIds) {
      const cached = playerByIdCache.get(id);
      if (cached && (now - cached.timestamp) < CACHE_TTL) {
        cachedPlayers.push(cached.data);
      } else {
        uncachedIds.push(id);
      }
    }
    
    // If all players are cached, return immediately
    if (uncachedIds.length === 0) {
      return cachedPlayers;
    }
    
    try {
      const DEFAULT_SEASON = CURRENT_SEASON;
      // EGRESS OPTIMIZATION: Only fetch uncached player IDs
      const intIds = uncachedIds.map((id) => Number(id)).filter((n) => !Number.isNaN(n));

      // Get goalie IDs for GSAx lookup
      const [{ data: dirRowsRaw, error: dirErr }, { data: statRowsRaw, error: statErr }, { data: talentRowsRaw, error: talentErr }] = await Promise.all([
        pipelineDb
          .from("player_directory")
          .select("season, player_id, full_name, team_abbrev, position_code, is_goalie, jersey_number, headshot_url")
          .eq("season", DEFAULT_SEASON)
          .in("player_id", intIds),
        pipelineDb
          .from("player_season_stats")
          .select("season, player_id, team_abbrev, position_code, is_goalie, games_played, icetime_seconds, nhl_toi_seconds, goals, primary_assists, secondary_assists, points, shots_on_goal, hits, blocks, pim, ppp, shp, plus_minus, nhl_plus_minus, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_shp, x_goals, x_assists, goalie_gp, wins, saves, shots_faced, goals_against, shutouts, save_pct, nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_shots_faced, nhl_goals_against, nhl_shutouts, nhl_save_pct, nhl_gaa")
          .eq("season", DEFAULT_SEASON)
          .in("player_id", intIds),
        pipelineDb
          .from("player_talent_metrics")
          .select("player_id, season, roster_status, is_ir_eligible")
          .eq("season", DEFAULT_SEASON)
          .in("player_id", intIds),
      ]);
      
      // Fetch GSAx for goalies
      const goalieIds = (dirRowsRaw || []).filter((d: PlayerDirectoryRow) => d.is_goalie).map((d: PlayerDirectoryRow) => Number(d.player_id));
      const gsaxMap = new Map<number, number>();
      
      if (goalieIds.length > 0) {
        try {
          // Try goalie_gsax_primary first (preferred)
          const { data: gsaxData } = await pipelineDb
            .from("goalie_gsax_primary")
            .select("goalie_id, regressed_gsax")
            .in("goalie_id", goalieIds);
          
          if (gsaxData) {
            gsaxData.forEach((g: GoalieGsaxRow) => {
              if (g.goalie_id && g.regressed_gsax != null) {
                gsaxMap.set(Number(g.goalie_id), Number(g.regressed_gsax));
              }
            });
          }
          
          // Fill in missing goalies from goalie_gsax (fallback)
          const missingGoalieIds = goalieIds.filter(id => !gsaxMap.has(id));
          if (missingGoalieIds.length > 0) {
            const { data: gsaxFallbackData } = await pipelineDb
              .from("goalie_gsax")
              .select("goalie_id, regressed_gsax")
              .in("goalie_id", missingGoalieIds);
            
            if (gsaxFallbackData) {
              gsaxFallbackData.forEach((g: GoalieGsaxRow) => {
                if (g.goalie_id && g.regressed_gsax != null && !gsaxMap.has(Number(g.goalie_id))) {
                  gsaxMap.set(Number(g.goalie_id), Number(g.regressed_gsax));
                }
              });
            }
          }
        } catch (gsaxError) {
          logger.warn('[PlayerService] Error fetching GSAx data:', gsaxError);
          // Continue without GSAx - not critical
        }
      }

      if (dirErr) throw dirErr;
      if (statErr) throw statErr;

      const dirRows = (dirRowsRaw || []) as PlayerDirectoryRow[];
      const statRows = (statRowsRaw || []) as PlayerSeasonStatsRow[];


      const statsByPlayerId = new Map<number, PlayerSeasonStatsRow>();
      statRows.forEach((r) => {
        if (r?.player_id != null) {
          const pid = Number(r.player_id);
          // Validate season matches (defensive check)
          if (r.season !== DEFAULT_SEASON) {
            logger.warn(`[PlayerService] WARNING: Stats row for player ${pid} has season ${r.season}, expected ${DEFAULT_SEASON}`);
          }
          statsByPlayerId.set(pid, r);
        }
      });

      // Build talent metrics lookup for getPlayersByIds (same as getAllPlayers)
      const talentRows2 = (talentRowsRaw || []) as Array<{ player_id: number; season: number; roster_status: string | null; is_ir_eligible: boolean | null }>;
      const talentByPlayerId2 = new Map<number, { roster_status: string | null; is_ir_eligible: boolean | null }>();
      talentRows2.forEach(t => {
        if (t?.player_id != null) {
          talentByPlayerId2.set(Number(t.player_id), { roster_status: t.roster_status, is_ir_eligible: t.is_ir_eligible });
        }
      });

      // Include all players from directory (matching getAllPlayers behavior).
      // Players without stats get zero stats but remain visible on rosters.
      const players: Player[] = dirRows
        .filter((d) => d.player_id != null)
        .map((d) => {
        const pid = Number(d.player_id);
        const sRaw = statsByPlayerId.get(pid) || null;

        // Validate season matches (only if stats record exists)
        if (sRaw && sRaw.season !== DEFAULT_SEASON) {
          logger.warn(`[PlayerService] WARNING: Stats for player ${d.full_name} (ID: ${pid}) has season ${sRaw.season}, expected ${DEFAULT_SEASON}`);
        }
        
        // If player hasn't played (games_played === 0), treat stats as null to show zeros
        const gamesPlayed = Number(sRaw?.games_played ?? 0);
        const hasPlayed = gamesPlayed > 0;
        
        // ALWAYS use NHL.com official stats exclusively (no PBP fallback)
        // This ensures we display only NHL.com data, not PBP-calculated data
        const s = hasPlayed ? sRaw : null;
        
        const assists = Number(s?.primary_assists ?? 0) + Number(s?.secondary_assists ?? 0);
        const team = d.team_abbrev || s?.team_abbrev || "";
        const pos = d.position_code || s?.position_code || (d.is_goalie ? "G" : "");
        const headshot =
          d.headshot_url ||
          getHeadshotUrl(team, pid);

        // ALWAYS use NHL.com official stats (no fallback to PBP)
        const calculatedGoals = Number(s?.nhl_goals ?? 0);
        const calculatedAssists = Number(s?.nhl_assists ?? 0);

        // ALWAYS calculate points from goals + assists to ensure consistency
        const calculatedPoints = calculatedGoals + calculatedAssists;

        const eligiblePositions = deriveEligiblePositions(pos, sRaw?.position_code || null);

        // Use real roster_status from player_talent_metrics (same as getAllPlayers)
        const talent2 = talentByPlayerId2.get(pid);
        const rosterStatus2 = talent2?.roster_status || null;
        const irEligible2 = talent2?.is_ir_eligible || false;
        const derivedStatus2 = rosterStatus2 === 'IR' || rosterStatus2 === 'LTIR'
          ? 'injured'
          : 'active';

        return {
          id: String(pid),
          full_name: d.full_name,
          position: pos || "",
          eligible_positions: eligiblePositions,
          team: team || "",
          jersey_number: d.jersey_number ?? null,
          status: derivedStatus2,
          roster_status: rosterStatus2 || undefined,
          is_ir_eligible: irEligible2,
          headshot_url: headshot,
          last_updated: new Date().toISOString(),
          games_played: gamesPlayed,

          // EXCLUSIVELY use NHL.com official stats (no PBP fallback)
          // If NHL stats are missing/0, show 0 (don't fall back to PBP)
          goals: calculatedGoals,
          assists: calculatedAssists,
          points: calculatedPoints,
          plus_minus: Number(s?.nhl_plus_minus ?? 0),
          shots: Number(s?.nhl_shots_on_goal ?? 0),
          hits: Number(s?.nhl_hits ?? 0),
          blocks: Number(s?.nhl_blocks ?? 0),
          pim: Number(s?.nhl_pim ?? 0),
          ppp: Number(s?.nhl_ppp ?? 0),
          shp: Number(s?.nhl_shp ?? 0),
          // Use NHL.com TOI exclusively (no PBP fallback)
          icetime_seconds: Number(s?.nhl_toi_seconds ?? 0),

          xGoals: Number(s?.x_goals ?? 0),

          // Goalie stats: EXCLUSIVELY use NHL.com official stats (no PBP fallback)
          wins: d.is_goalie ? Number(s?.nhl_wins ?? 0) : null,
          losses: d.is_goalie ? Number(s?.nhl_losses ?? 0) : null,
          ot_losses: d.is_goalie ? Number(s?.nhl_ot_losses ?? 0) : null,
          saves: d.is_goalie ? Number(s?.nhl_saves ?? 0) : null,
          shutouts: d.is_goalie ? Number(s?.nhl_shutouts ?? 0) : null,
          shots_faced: d.is_goalie ? Number(s?.nhl_shots_faced ?? 0) : null,
          goals_against: d.is_goalie ? Number(s?.nhl_goals_against ?? 0) : null,
          goals_against_average: d.is_goalie
            ? (s?.nhl_gaa ?? null)
            : null,
          save_percentage: d.is_goalie ? (s?.nhl_save_pct ?? null) : null,
          highDangerSavePct: 0,
          goalsSavedAboveExpected: d.is_goalie ? (gsaxMap.get(pid) ?? 0) : 0,
          goalie_gp: d.is_goalie ? Number(s?.goalie_gp ?? 0) : undefined,
        };
      });

      // EGRESS OPTIMIZATION: Cache newly fetched players for future requests
      const cacheTimestamp = Date.now();
      for (const player of players) {
        playerByIdCache.set(player.id, { data: player, timestamp: cacheTimestamp });
      }
      
      // Combine cached players with newly fetched players
      const allPlayers = [...cachedPlayers, ...players];
      return allPlayers.sort((a, b) => (b.points || 0) - (a.points || 0));
    } catch (error) {
      logger.error('[PlayerService] Error fetching players by IDs:', error);
      // DO NOT fallback to getAllPlayers - it causes 504 timeouts
      // Return cached players if we have any, otherwise empty array
      return cachedPlayers.length > 0 ? cachedPlayers : [];
    }
  },

  /**
   * Get platform-wide trending player data (adds/drops over recent days).
   */
  async getTrendingPlayers(daysBack = 7, limitCount = 50): Promise<Map<number, { addCount: number; netAdds: number }>> {
    const trendingMap = new Map<number, { addCount: number; netAdds: number }>();
    try {
      const { data, error } = await supabase.rpc('get_trending_players', {
        days_back: daysBack,
        limit_count: limitCount,
      });
      if (error || !data || !Array.isArray(data)) return trendingMap;
      for (const row of data) {
        trendingMap.set(Number(row.player_id), {
          addCount: Number(row.add_count ?? 0),
          netAdds: Number(row.net_adds ?? 0),
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
      await supabase.rpc('record_player_transaction', {
        p_player_id: params.playerId,
        p_league_id: params.leagueId,
        p_team_id: params.teamId,
        p_transaction_type: params.transactionType,
        p_source: params.source,
        p_player_name: params.playerName,
        p_player_team: params.playerTeam,
        p_player_position: params.playerPosition,
      });
    } catch (err) {
      logger.error('[PlayerService] recordPlayerTransaction error:', err);
    }
  },

  /**
   * Count roster assignments for a given team+league.
   * Used as fallback when no lineup data exists.
   */
  async getRosterAssignmentCount(teamId: string, leagueId: string): Promise<{ count: number | null; error: string | null }> {
    try {
      const { count, error } = await (supabase as unknown as PipelineDb)
        .from('roster_assignments')
        .select('id', { count: 'exact', head: true } as Record<string, unknown>)
        .eq('team_id', teamId)
        .eq('league_id', leagueId) as unknown as { count: number | null; error: { message: string } | null };
      return { count, error: error?.message || null };
    } catch (err) {
      logger.error('[PlayerService] getRosterAssignmentCount error:', err);
      return { count: null, error: String(err) };
    }
  },
};

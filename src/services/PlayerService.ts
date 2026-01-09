import { supabase } from "@/integrations/supabase/client";

/**
 * PlayerService - SINGLE SOURCE OF TRUTH
 *
 * ALL player identity + stats are sourced from our own pipeline tables:
 * - public.player_directory (names/teams/positions)
 * - public.player_season_stats (season rollup)
 *
 * No reliance on staging tables.
 */
export interface Player {
  id: string; // Using string ID to be consistent with app usage, but will store NHL ID
  full_name: string;
  position: string;
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
      const cacheAge = Math.round((now - playersCache.timestamp) / 1000);
      console.log(`[PlayerService] getAllPlayers(): Returning CACHED data (age: ${cacheAge} seconds)`);
      return playersCache.data;
    }
    console.log(`[PlayerService] getAllPlayers(): Cache expired or missing, fetching fresh data`);

    try {
      const DEFAULT_SEASON = 2025;
      const [{ data: dirRowsRaw, error: dirErr }, { data: statRowsRaw, error: statErr }, { data: talentRowsRaw, error: talentErr }] = await Promise.all([
        (supabase as any)
          .from("player_directory")
          .select("season, player_id, full_name, team_abbrev, position_code, is_goalie, jersey_number, headshot_url")
          .eq("season", DEFAULT_SEASON),
        (supabase as any)
          .from("player_season_stats")
          .select("season, player_id, team_abbrev, position_code, is_goalie, games_played, icetime_seconds, nhl_toi_seconds, goals, primary_assists, secondary_assists, points, shots_on_goal, hits, blocks, pim, ppp, shp, plus_minus, nhl_plus_minus, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_shp, x_goals, x_assists, goalie_gp, wins, saves, shots_faced, goals_against, shutouts, save_pct, nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_shots_faced, nhl_goals_against, nhl_shutouts, nhl_save_pct, nhl_gaa")
          .eq("season", DEFAULT_SEASON),
        (supabase as any)
          .from("player_talent_metrics")
          .select("player_id, season, roster_status, is_ir_eligible")
          .eq("season", DEFAULT_SEASON),
      ]);

      if (dirErr) throw dirErr;
      if (statErr) throw statErr;

      const dirRows = (dirRowsRaw || []) as PlayerDirectoryRow[];
      const statRows = (statRowsRaw || []) as PlayerSeasonStatsRow[];

      console.log(`[PlayerService] getAllPlayers(): Fetched ${dirRows.length} directory rows, ${statRows.length} stats rows for season ${DEFAULT_SEASON}`);

      const statsByPlayerId = new Map<number, PlayerSeasonStatsRow>();
      statRows.forEach((r) => {
        if (r?.player_id != null) {
          const pid = Number(r.player_id);
          // Validate season matches (defensive check)
          if (r.season !== DEFAULT_SEASON) {
            console.warn(`[PlayerService] WARNING: Stats row for player ${pid} has season ${r.season}, expected ${DEFAULT_SEASON}`);
          }
          statsByPlayerId.set(pid, r);
        }
      });
      
      // Validate directory rows have correct season
      const wrongSeasonDir = dirRows.filter(d => d.season !== DEFAULT_SEASON);
      if (wrongSeasonDir.length > 0) {
        console.warn(`[PlayerService] WARNING: ${wrongSeasonDir.length} directory rows have wrong season (not ${DEFAULT_SEASON})`);
      }

      // Fetch GSAx for goalies (only for players that have stats)
      const goalieIds = dirRows
        .filter((d: PlayerDirectoryRow) => d.is_goalie && statsByPlayerId.has(Number(d.player_id)))
        .map((d: PlayerDirectoryRow) => Number(d.player_id));
      const gsaxMap = new Map<number, number>();
      
      if (goalieIds.length > 0) {
        try {
          // Try goalie_gsax_primary first (preferred)
          const { data: gsaxData } = await (supabase as any)
            .from("goalie_gsax_primary")
            .select("goalie_id, regressed_gsax")
            .in("goalie_id", goalieIds);
          
          if (gsaxData) {
            gsaxData.forEach((g: any) => {
              if (g.goalie_id && g.regressed_gsax != null) {
                gsaxMap.set(Number(g.goalie_id), Number(g.regressed_gsax));
              }
            });
          }
          
          // Fill in missing goalies from goalie_gsax (fallback)
          const missingGoalieIds = goalieIds.filter(id => !gsaxMap.has(id));
          if (missingGoalieIds.length > 0) {
            const { data: gsaxFallbackData } = await (supabase as any)
              .from("goalie_gsax")
              .select("goalie_id, regressed_gsax")
              .in("goalie_id", missingGoalieIds);
            
            if (gsaxFallbackData) {
              gsaxFallbackData.forEach((g: any) => {
                if (g.goalie_id && g.regressed_gsax != null && !gsaxMap.has(Number(g.goalie_id))) {
                  gsaxMap.set(Number(g.goalie_id), Number(g.regressed_gsax));
                }
              });
            }
          }
        } catch (gsaxError) {
          console.warn('[PlayerService] Error fetching GSAx data:', gsaxError);
          // Continue without GSAx - not critical
        }
      }

      // CRITICAL: Only include players that have matching stats records
      // This ensures we only show players with actual season data, matching what getPlayersByIds() would return
      // This prevents showing players from wrong seasons or players without stats
      const players: Player[] = dirRows
        .filter((d) => {
          const pid = Number(d.player_id);
          const hasStats = statsByPlayerId.has(pid);
          if (!hasStats) {
            console.warn(`[PlayerService] getAllPlayers(): Skipping player ${d.full_name} (ID: ${pid}) - no stats record found in player_season_stats for season ${DEFAULT_SEASON}`);
          }
          return hasStats; // Only include players with matching stats
        })
        .map((d) => {
        const pid = Number(d.player_id);
        const sRaw = statsByPlayerId.get(pid);
        if (!sRaw) {
          // This shouldn't happen due to filter above, but defensive check
          throw new Error(`No stats found for player ${pid} despite filter`);
        }
        
        // Validate season matches
        if (sRaw.season !== DEFAULT_SEASON) {
          console.warn(`[PlayerService] WARNING: Stats for player ${d.full_name} (ID: ${pid}) has season ${sRaw.season}, expected ${DEFAULT_SEASON}`);
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
          (team && pid ? `https://assets.nhle.com/mugs/nhl/20242025/${team}/${pid}.png` : null);

        // ALWAYS use NHL.com official stats (no fallback to PBP)
        const calculatedGoals = Number(s?.nhl_goals ?? 0);
        const calculatedAssists = Number(s?.nhl_assists ?? 0);
        
        // ALWAYS calculate points from goals + assists to ensure consistency
        const calculatedPoints = calculatedGoals + calculatedAssists;

        return {
          id: String(pid),
          full_name: d.full_name,
          position: pos || "",
          team: team || "",
          jersey_number: d.jersey_number ?? null,
          status: "active",
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
        const sample = sortedPlayers.slice(0, 3);
        console.log(`[PlayerService] getAllPlayers(): Sample players:`, 
          sample.map(p => `${p.full_name} (${p.id}): ${p.goals}G ${p.assists}A ${p.points}P (GP: ${p.games_played})`).join(', '));
      }

      playersCache = {
        data: sortedPlayers,
        timestamp: Date.now(),
      };
      
      console.log(`[PlayerService] getAllPlayers(): Fetched ${sortedPlayers.length} players (filtered to only those with stats), cached for ${CACHE_TTL / 1000} seconds`);

      return sortedPlayers;
    } catch (error) {
      console.error("Error fetching players from pipeline tables (player_directory/player_season_stats):", error);
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
      console.log(`[PlayerService] getPlayersByIds(): All ${playerIds.length} players from CACHE`);
      return cachedPlayers;
    }
    
    console.log(`[PlayerService] getPlayersByIds(): ${cachedPlayers.length} from cache, fetching ${uncachedIds.length} from DB`);
    
    try {
      const DEFAULT_SEASON = 2025;
      // EGRESS OPTIMIZATION: Only fetch uncached player IDs
      const intIds = uncachedIds.map((id) => Number(id)).filter((n) => !Number.isNaN(n));

      // Get goalie IDs for GSAx lookup
      const [{ data: dirRowsRaw, error: dirErr }, { data: statRowsRaw, error: statErr }, { data: talentRowsRaw, error: talentErr }] = await Promise.all([
        (supabase as any)
          .from("player_directory")
          .select("season, player_id, full_name, team_abbrev, position_code, is_goalie, jersey_number, headshot_url")
          .eq("season", DEFAULT_SEASON)
          .in("player_id", intIds),
        (supabase as any)
          .from("player_season_stats")
          .select("season, player_id, team_abbrev, position_code, is_goalie, games_played, icetime_seconds, nhl_toi_seconds, goals, primary_assists, secondary_assists, points, shots_on_goal, hits, blocks, pim, ppp, shp, plus_minus, nhl_plus_minus, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_shp, x_goals, x_assists, goalie_gp, wins, saves, shots_faced, goals_against, shutouts, save_pct, nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_shots_faced, nhl_goals_against, nhl_shutouts, nhl_save_pct, nhl_gaa")
          .eq("season", DEFAULT_SEASON)
          .in("player_id", intIds),
        (supabase as any)
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
          const { data: gsaxData } = await (supabase as any)
            .from("goalie_gsax_primary")
            .select("goalie_id, regressed_gsax")
            .in("goalie_id", goalieIds);
          
          if (gsaxData) {
            gsaxData.forEach((g: any) => {
              if (g.goalie_id && g.regressed_gsax != null) {
                gsaxMap.set(Number(g.goalie_id), Number(g.regressed_gsax));
              }
            });
          }
          
          // Fill in missing goalies from goalie_gsax (fallback)
          const missingGoalieIds = goalieIds.filter(id => !gsaxMap.has(id));
          if (missingGoalieIds.length > 0) {
            const { data: gsaxFallbackData } = await (supabase as any)
              .from("goalie_gsax")
              .select("goalie_id, regressed_gsax")
              .in("goalie_id", missingGoalieIds);
            
            if (gsaxFallbackData) {
              gsaxFallbackData.forEach((g: any) => {
                if (g.goalie_id && g.regressed_gsax != null && !gsaxMap.has(Number(g.goalie_id))) {
                  gsaxMap.set(Number(g.goalie_id), Number(g.regressed_gsax));
                }
              });
            }
          }
        } catch (gsaxError) {
          console.warn('[PlayerService] Error fetching GSAx data:', gsaxError);
          // Continue without GSAx - not critical
        }
      }

      if (dirErr) throw dirErr;
      if (statErr) throw statErr;

      const dirRows = (dirRowsRaw || []) as PlayerDirectoryRow[];
      const statRows = (statRowsRaw || []) as PlayerSeasonStatsRow[];

      console.log(`[PlayerService] getPlayersByIds(): Fetched ${dirRows.length} directory rows, ${statRows.length} stats rows for ${intIds.length} requested player IDs`);

      const statsByPlayerId = new Map<number, PlayerSeasonStatsRow>();
      statRows.forEach((r) => {
        if (r?.player_id != null) {
          const pid = Number(r.player_id);
          // Validate season matches (defensive check)
          if (r.season !== DEFAULT_SEASON) {
            console.warn(`[PlayerService] WARNING: Stats row for player ${pid} has season ${r.season}, expected ${DEFAULT_SEASON}`);
          }
          statsByPlayerId.set(pid, r);
        }
      });

      // CRITICAL: Only include players that have matching stats records
      // This ensures consistency with getAllPlayers() - both methods now filter to players with stats
      const players: Player[] = dirRows
        .filter((d) => {
          const pid = Number(d.player_id);
          const hasStats = statsByPlayerId.has(pid);
          if (!hasStats) {
            console.warn(`[PlayerService] getPlayersByIds(): Skipping player ${d.full_name} (ID: ${pid}) - no stats record found`);
          }
          return hasStats; // Only include players with matching stats
        })
        .map((d) => {
        const pid = Number(d.player_id);
        const sRaw = statsByPlayerId.get(pid);
        if (!sRaw) {
          // This shouldn't happen due to filter above, but defensive check
          throw new Error(`No stats found for player ${pid} despite filter`);
        }
        
        // Validate season matches
        if (sRaw.season !== DEFAULT_SEASON) {
          console.warn(`[PlayerService] WARNING: Stats for player ${d.full_name} (ID: ${pid}) has season ${sRaw.season}, expected ${DEFAULT_SEASON}`);
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
          (team && pid ? `https://assets.nhle.com/mugs/nhl/20242025/${team}/${pid}.png` : null);

        // ALWAYS use NHL.com official stats (no fallback to PBP)
        const calculatedGoals = Number(s?.nhl_goals ?? 0);
        const calculatedAssists = Number(s?.nhl_assists ?? 0);
        
        // ALWAYS calculate points from goals + assists to ensure consistency
        const calculatedPoints = calculatedGoals + calculatedAssists;

        return {
          id: String(pid),
          full_name: d.full_name,
          position: pos || "",
          team: team || "",
          jersey_number: d.jersey_number ?? null,
          status: "active",
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
      console.error('[PlayerService] Error fetching players by IDs:', error);
      // DO NOT fallback to getAllPlayers - it causes 504 timeouts
      // Return cached players if we have any, otherwise empty array
      return cachedPlayers.length > 0 ? cachedPlayers : [];
    }
  }
};

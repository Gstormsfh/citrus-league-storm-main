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

export const PlayerService = {
  /**
   * Clear the player cache (call this when player data is updated)
   */
  clearCache(): void {
    playersCache = null;
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
      const DEFAULT_SEASON = 2025;
      const [{ data: dirRowsRaw, error: dirErr }, { data: statRowsRaw, error: statErr }] = await Promise.all([
        (supabase as any)
          .from("player_directory")
          .select("season, player_id, full_name, team_abbrev, position_code, is_goalie, jersey_number, headshot_url")
          .eq("season", DEFAULT_SEASON),
        (supabase as any)
          .from("player_season_stats")
          .select("season, player_id, team_abbrev, position_code, is_goalie, games_played, icetime_seconds, nhl_toi_seconds, goals, primary_assists, secondary_assists, points, shots_on_goal, hits, blocks, pim, ppp, shp, plus_minus, nhl_plus_minus, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_shp, x_goals, x_assists, goalie_gp, wins, saves, shots_faced, goals_against, shutouts, save_pct, nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_shots_faced, nhl_goals_against, nhl_shutouts, nhl_save_pct, nhl_gaa")
          .eq("season", DEFAULT_SEASON),
      ]);

      if (dirErr) throw dirErr;
      if (statErr) throw statErr;

      const dirRows = (dirRowsRaw || []) as PlayerDirectoryRow[];
      const statRows = (statRowsRaw || []) as PlayerSeasonStatsRow[];

      const statsByPlayerId = new Map<number, PlayerSeasonStatsRow>();
      statRows.forEach((r) => {
        if (r?.player_id != null) statsByPlayerId.set(Number(r.player_id), r);
      });

      // Fetch GSAx for goalies
      const goalieIds = dirRows.filter((d: PlayerDirectoryRow) => d.is_goalie).map((d: PlayerDirectoryRow) => Number(d.player_id));
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

      const players: Player[] = dirRows.map((d) => {
        const pid = Number(d.player_id);
        const s = statsByPlayerId.get(pid);
        const assists = Number(s?.primary_assists ?? 0) + Number(s?.secondary_assists ?? 0);

        const team = d.team_abbrev || s?.team_abbrev || "";
        const pos = d.position_code || s?.position_code || (d.is_goalie ? "G" : "");
        const headshot =
          d.headshot_url ||
          (team && pid ? `https://assets.nhle.com/mugs/nhl/20242025/${team}/${pid}.png` : null);

        return {
          id: String(pid),
          full_name: d.full_name,
          position: pos || "",
          team: team || "",
          jersey_number: d.jersey_number ?? null,
          status: "active",
          headshot_url: headshot,
          last_updated: new Date().toISOString(),
          games_played: Number(s?.games_played ?? 0),

          // Use NHL.com official stats for display, fallback to PBP-calculated for backwards compatibility
          goals: Number(s?.nhl_goals ?? s?.goals ?? 0),
          assists: Number(s?.nhl_assists ?? assists ?? 0),
          points: Number(s?.nhl_points ?? s?.points ?? 0),
          plus_minus: Number(s?.nhl_plus_minus ?? s?.plus_minus ?? 0),
          shots: Number(s?.nhl_shots_on_goal ?? s?.shots_on_goal ?? 0),
          hits: Number(s?.nhl_hits ?? s?.hits ?? 0),
          blocks: Number(s?.nhl_blocks ?? s?.blocks ?? 0),
          pim: Number(s?.nhl_pim ?? s?.pim ?? 0),
          ppp: Number(s?.nhl_ppp ?? s?.ppp ?? 0),
          shp: Number(s?.nhl_shp ?? s?.shp ?? 0),
          // Use NHL.com TOI for display, fallback to our calculated TOI
          icetime_seconds: Number(s?.nhl_toi_seconds ?? s?.icetime_seconds ?? 0),

          xGoals: Number(s?.x_goals ?? 0),

          // Goalie stats: Use NHL.com official stats for display, fallback to PBP-calculated
          wins: d.is_goalie ? Number(s?.nhl_wins ?? s?.wins ?? 0) : null,
          losses: d.is_goalie ? Number(s?.nhl_losses ?? null) : null,
          ot_losses: d.is_goalie ? Number(s?.nhl_ot_losses ?? null) : null,
          saves: d.is_goalie ? Number(s?.nhl_saves ?? s?.saves ?? 0) : null,
          shutouts: d.is_goalie ? Number(s?.nhl_shutouts ?? s?.shutouts ?? 0) : null,
          shots_faced: d.is_goalie ? Number(s?.nhl_shots_faced ?? s?.shots_faced ?? 0) : null,
          goals_against: d.is_goalie ? Number(s?.nhl_goals_against ?? s?.goals_against ?? 0) : null,
          goals_against_average: d.is_goalie 
            ? (s?.nhl_gaa ?? (s?.goals_against && s?.goalie_gp && s.goalie_gp > 0
                ? (s.goals_against / s.goalie_gp) : null))
            : null,
          save_percentage: d.is_goalie ? (s?.nhl_save_pct ?? s?.save_pct ?? null) : null,
          highDangerSavePct: 0,
          goalsSavedAboveExpected: d.is_goalie ? (gsaxMap.get(pid) ?? 0) : 0,
          goalie_gp: d.is_goalie ? Number(s?.goalie_gp ?? 0) : undefined,
        };
      });

      const sortedPlayers = players.sort((a, b) => (b.points || 0) - (a.points || 0));

      playersCache = {
        data: sortedPlayers,
        timestamp: Date.now(),
      };

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
   * This is more efficient than loading all players and filtering
   */
  async getPlayersByIds(playerIds: string[]): Promise<Player[]> {
    if (playerIds.length === 0) return [];
    
    try {
      const DEFAULT_SEASON = 2025;
      const intIds = playerIds.map((id) => Number(id)).filter((n) => !Number.isNaN(n));

      // Get goalie IDs for GSAx lookup
      const [{ data: dirRowsRaw, error: dirErr }, { data: statRowsRaw, error: statErr }] = await Promise.all([
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

      const statsByPlayerId = new Map<number, PlayerSeasonStatsRow>();
      statRows.forEach((r) => {
        if (r?.player_id != null) statsByPlayerId.set(Number(r.player_id), r);
      });

      const players: Player[] = dirRows.map((d) => {
        const pid = Number(d.player_id);
        const s = statsByPlayerId.get(pid);
        const assists = Number(s?.primary_assists ?? 0) + Number(s?.secondary_assists ?? 0);
        const team = d.team_abbrev || s?.team_abbrev || "";
        const pos = d.position_code || s?.position_code || (d.is_goalie ? "G" : "");
        const headshot =
          d.headshot_url ||
          (team && pid ? `https://assets.nhle.com/mugs/nhl/20242025/${team}/${pid}.png` : null);

        return {
          id: String(pid),
          full_name: d.full_name,
          position: pos || "",
          team: team || "",
          jersey_number: d.jersey_number ?? null,
          status: "active",
          headshot_url: headshot,
          last_updated: new Date().toISOString(),
          games_played: Number(s?.games_played ?? 0),

          // Use NHL.com official stats for display, fallback to PBP-calculated for backwards compatibility
          goals: Number(s?.nhl_goals ?? s?.goals ?? 0),
          assists: Number(s?.nhl_assists ?? assists ?? 0),
          points: Number(s?.nhl_points ?? s?.points ?? 0),
          plus_minus: Number(s?.nhl_plus_minus ?? s?.plus_minus ?? 0),
          shots: Number(s?.nhl_shots_on_goal ?? s?.shots_on_goal ?? 0),
          hits: Number(s?.nhl_hits ?? s?.hits ?? 0),
          blocks: Number(s?.nhl_blocks ?? s?.blocks ?? 0),
          pim: Number(s?.nhl_pim ?? s?.pim ?? 0),
          ppp: Number(s?.nhl_ppp ?? s?.ppp ?? 0),
          shp: Number(s?.nhl_shp ?? s?.shp ?? 0),
          // Use NHL.com TOI for display, fallback to our calculated TOI
          icetime_seconds: Number(s?.nhl_toi_seconds ?? s?.icetime_seconds ?? 0),

          xGoals: Number(s?.x_goals ?? 0),

          // Goalie stats: Use NHL.com official stats for display, fallback to PBP-calculated
          wins: d.is_goalie ? Number(s?.nhl_wins ?? s?.wins ?? 0) : null,
          losses: d.is_goalie ? Number(s?.nhl_losses ?? null) : null,
          ot_losses: d.is_goalie ? Number(s?.nhl_ot_losses ?? null) : null,
          saves: d.is_goalie ? Number(s?.nhl_saves ?? s?.saves ?? 0) : null,
          shutouts: d.is_goalie ? Number(s?.nhl_shutouts ?? s?.shutouts ?? 0) : null,
          shots_faced: d.is_goalie ? Number(s?.nhl_shots_faced ?? s?.shots_faced ?? 0) : null,
          goals_against: d.is_goalie ? Number(s?.nhl_goals_against ?? s?.goals_against ?? 0) : null,
          goals_against_average: d.is_goalie 
            ? (s?.nhl_gaa ?? (s?.goals_against && s?.goalie_gp && s.goalie_gp > 0
                ? (s.goals_against / s.goalie_gp) : null))
            : null,
          save_percentage: d.is_goalie ? (s?.nhl_save_pct ?? s?.save_pct ?? null) : null,
          highDangerSavePct: 0,
          goalsSavedAboveExpected: d.is_goalie ? (gsaxMap.get(pid) ?? 0) : 0,
          goalie_gp: d.is_goalie ? Number(s?.goalie_gp ?? 0) : undefined,
        };
      });

      return players.sort((a, b) => (b.points || 0) - (a.points || 0));
    } catch (error) {
      console.error('[PlayerService] Error fetching players by IDs:', error);
      // DO NOT fallback to getAllPlayers - it causes 504 timeouts
      // Return empty array and let caller handle the error
      return [];
    }
  }
};

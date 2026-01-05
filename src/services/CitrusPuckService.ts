// src/services/CitrusPuckService.ts

import { supabase } from "@/integrations/supabase/client";
import { CitrusPuckPlayerData, AggregatedPlayerData, Situation } from "@/types/citruspuck";

type PlayerSeasonStatsRow = {
  season: number;
  player_id: number;
  team_abbrev: string | null;
  position_code: string | null;
  is_goalie: boolean;
  games_played: number;
  icetime_seconds: number; // Our calculated TOI (for GAR)
  nhl_toi_seconds?: number; // NHL.com official TOI (for display) - optional until migration runs
  plus_minus: number; // Our calculated plus/minus (for internal use)
  nhl_plus_minus?: number; // NHL.com official plus/minus (for display) - optional until migration runs
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

type PlayerDirectoryRow = {
  season: number;
  player_id: number;
  full_name: string;
  team_abbrev: string | null;
  position_code: string | null;
  is_goalie: boolean;
};

/**
 * Map player_season_stats row to CitrusPuckPlayerData format
 * Missing fields are set to 0 (we provide minimal subset to unblock UI)
 */
function mapStatsToCitrusPuck(
  stats: PlayerSeasonStatsRow,
  directory: PlayerDirectoryRow | null,
  situation: Situation = 'all'
): CitrusPuckPlayerData {
  const name = directory?.full_name || '';
  const team = stats.team_abbrev || directory?.team_abbrev || '';
  const position = stats.position_code || directory?.position_code || '';
  
  // If player hasn't played (games_played === 0), return all zeros
  const gamesPlayed = stats.games_played || 0;
  const hasPlayed = gamesPlayed > 0;
  
  // ALWAYS use NHL.com official stats exclusively (no PBP fallback)
  // This ensures we display only NHL.com data, not PBP-calculated data
  
  // Base CitrusPuckPlayerData with all fields defaulted to 0
  const citrusData: CitrusPuckPlayerData = {
    playerId: stats.player_id,
    season: stats.season,
    situation,
    name,
    team,
    position,
    
    // Basic stats (from player_season_stats)
    games_played: gamesPlayed,
    // EXCLUSIVELY use NHL.com TOI (no PBP fallback)
    // If player hasn't played, TOI should be 0
    icetime: hasPlayed ? (stats.nhl_toi_seconds || 0) : 0,
    shifts: 0, // Not available in season stats
    gameScore: 0, // Not available
    
    // Advanced percentages (not available - set to 0)
    onIce_xGoalsPercentage: 0,
    offIce_xGoalsPercentage: 0,
    onIce_corsiPercentage: 0,
    offIce_corsiPercentage: 0,
    onIce_fenwickPercentage: 0,
    offIce_fenwickPercentage: 0,
    iceTimeRank: 0,
    
    // Individual For (I_F) stats - map from player_season_stats
    // Use NHL.com official stats for display, fallback to PBP-calculated for backwards compatibility
    // If player hasn't played, all stats should be 0
    // If NHL stats look stale (unreasonable PPG), use PBP stats instead
    I_F_xOnGoal: 0,
    I_F_xGoals: hasPlayed ? (Number(stats.x_goals) || 0) : 0,
    I_F_xRebounds: 0,
    I_F_xFreeze: 0,
    I_F_xPlayStopped: 0,
    I_F_xPlayContinuedInZone: 0,
    I_F_xPlayContinuedOutsideZone: 0,
    I_F_flurryAdjustedxGoals: 0,
    I_F_scoreVenueAdjustedxGoals: 0,
    I_F_flurryScoreVenueAdjustedxGoals: 0,
    // For assists, calculate from primary + secondary, but use NHL if available
    I_F_primaryAssists: hasPlayed ? (stats.primary_assists || 0) : 0,
    I_F_secondaryAssists: hasPlayed ? (stats.secondary_assists || 0) : 0,
    // EXCLUSIVELY use NHL.com shots on goal (no PBP fallback)
    I_F_shotsOnGoal: hasPlayed ? Number(stats.nhl_shots_on_goal ?? 0) : 0,
    I_F_missedShots: 0,
    I_F_blockedShotAttempts: 0,
    I_F_shotAttempts: 0,
    I_F_points: hasPlayed ? (useNhlStats ? Number(stats.nhl_points ?? stats.points ?? 0) : Number(stats.points ?? 0)) : 0,
    I_F_goals: hasPlayed ? (useNhlStats ? Number(stats.nhl_goals ?? stats.goals ?? 0) : Number(stats.goals ?? 0)) : 0,
    I_F_rebounds: 0,
    I_F_reboundGoals: 0,
    I_F_freeze: 0,
    I_F_playStopped: 0,
    I_F_playContinuedInZone: 0,
    I_F_playContinuedOutsideZone: 0,
    // Goalie saves: Use NHL stats with PBP fallback
    I_F_savedShotsOnGoal: hasPlayed && stats.is_goalie ? (useNhlStats ? Number(stats.nhl_saves ?? stats.saves ?? 0) : Number(stats.saves ?? 0)) : 0,
    I_F_savedUnblockedShotAttempts: hasPlayed && stats.is_goalie ? (useNhlStats ? Number(stats.nhl_saves ?? stats.saves ?? 0) : Number(stats.saves ?? 0)) : 0,
    penalties: 0,
    I_F_penalityMinutes: hasPlayed ? (useNhlStats ? Number(stats.nhl_pim ?? stats.pim ?? 0) : Number(stats.pim ?? 0)) : 0,
    I_F_faceOffsWon: 0,
    I_F_hits: hasPlayed ? (useNhlStats ? Number(stats.nhl_hits ?? stats.hits ?? 0) : Number(stats.hits ?? 0)) : 0,
    I_F_takeaways: 0,
    I_F_giveaways: 0,
    I_F_lowDangerShots: 0,
    I_F_mediumDangerShots: 0,
    I_F_highDangerShots: 0,
    I_F_lowDangerxGoals: 0,
    I_F_mediumDangerxGoals: 0,
    I_F_highDangerxGoals: 0,
    I_F_lowDangerGoals: 0,
    I_F_mediumDangerGoals: 0,
    I_F_highDangerGoals: 0,
    I_F_scoreAdjustedShotsAttempts: 0,
    I_F_unblockedShotAttempts: 0,
    I_F_scoreAdjustedUnblockedShotAttempts: 0,
    I_F_dZoneGiveaways: 0,
    I_F_xGoalsFromxReboundsOfShots: 0,
    I_F_xGoalsFromActualReboundsOfShots: 0,
    I_F_reboundxGoals: 0,
    I_F_xGoals_with_earned_rebounds: 0,
    I_F_xGoals_with_earned_rebounds_scoreAdjusted: 0,
    I_F_xGoals_with_earned_rebounds_scoreFlurryAdjusted: 0,
    I_F_shifts: 0,
    I_F_oZoneShiftStarts: 0,
    I_F_dZoneShiftStarts: 0,
    I_F_neutralZoneShiftStarts: 0,
    I_F_flyShiftStarts: 0,
    I_F_oZoneShiftEnds: 0,
    I_F_dZoneShiftEnds: 0,
    I_F_neutralZoneShiftEnds: 0,
    I_F_flyShiftEnds: 0,
    faceoffsWon: 0,
    faceoffsLost: 0,
    timeOnBench: 0,
    penalityMinutes: hasPlayed ? (useNhlStats ? Number(stats.nhl_pim ?? stats.pim ?? 0) : Number(stats.pim ?? 0)) : 0,
    penalityMinutesDrawn: 0,
    penaltiesDrawn: 0,
    shotsBlockedByPlayer: hasPlayed ? (useNhlStats ? Number(stats.nhl_blocks ?? stats.blocks ?? 0) : Number(stats.blocks ?? 0)) : 0,
    
    // On-Ice For stats (not available - set to 0)
    OnIce_F_xOnGoal: 0,
    OnIce_F_xGoals: 0,
    OnIce_F_flurryAdjustedxGoals: 0,
    OnIce_F_scoreVenueAdjustedxGoals: 0,
    OnIce_F_flurryScoreVenueAdjustedxGoals: 0,
    OnIce_F_shotsOnGoal: 0,
    OnIce_F_missedShots: 0,
    OnIce_F_blockedShotAttempts: 0,
    OnIce_F_shotAttempts: 0,
    OnIce_F_goals: 0,
    OnIce_F_rebounds: 0,
    OnIce_F_reboundGoals: 0,
    OnIce_F_lowDangerShots: 0,
    OnIce_F_mediumDangerShots: 0,
    OnIce_F_highDangerShots: 0,
    OnIce_F_lowDangerxGoals: 0,
    OnIce_F_mediumDangerxGoals: 0,
    OnIce_F_highDangerxGoals: 0,
    OnIce_F_lowDangerGoals: 0,
    OnIce_F_mediumDangerGoals: 0,
    OnIce_F_highDangerGoals: 0,
    OnIce_F_scoreAdjustedShotsAttempts: 0,
    OnIce_F_unblockedShotAttempts: 0,
    OnIce_F_scoreAdjustedUnblockedShotAttempts: 0,
    OnIce_F_xGoalsFromxReboundsOfShots: 0,
    OnIce_F_xGoalsFromActualReboundsOfShots: 0,
    OnIce_F_reboundxGoals: 0,
    OnIce_F_xGoals_with_earned_rebounds: 0,
    OnIce_F_xGoals_with_earned_rebounds_scoreAdjusted: 0,
    OnIce_F_xGoals_with_earned_rebounds_scoreFlurryAdjusted: 0,
    
    // On-Ice Against stats (not available - set to 0)
    OnIce_A_xOnGoal: 0,
    OnIce_A_xGoals: 0,
    OnIce_A_flurryAdjustedxGoals: 0,
    OnIce_A_scoreVenueAdjustedxGoals: 0,
    OnIce_A_flurryScoreVenueAdjustedxGoals: 0,
    OnIce_A_shotsOnGoal: 0,
    OnIce_A_missedShots: 0,
    OnIce_A_blockedShotAttempts: 0,
    OnIce_A_shotAttempts: 0,
    OnIce_A_goals: 0,
    OnIce_A_rebounds: 0,
    OnIce_A_reboundGoals: 0,
    OnIce_A_lowDangerShots: 0,
    OnIce_A_mediumDangerShots: 0,
    OnIce_A_highDangerShots: 0,
    OnIce_A_lowDangerxGoals: 0,
    OnIce_A_mediumDangerxGoals: 0,
    OnIce_A_highDangerxGoals: 0,
    OnIce_A_lowDangerGoals: 0,
    OnIce_A_mediumDangerGoals: 0,
    OnIce_A_highDangerGoals: 0,
    OnIce_A_scoreAdjustedShotsAttempts: 0,
    OnIce_A_unblockedShotAttempts: 0,
    OnIce_A_scoreAdjustedUnblockedShotAttempts: 0,
    OnIce_A_xGoalsFromxReboundsOfShots: 0,
    OnIce_A_xGoalsFromActualReboundsOfShots: 0,
    OnIce_A_reboundxGoals: 0,
    OnIce_A_xGoals_with_earned_rebounds: 0,
    OnIce_A_xGoals_with_earned_rebounds_scoreAdjusted: 0,
    OnIce_A_xGoals_with_earned_rebounds_scoreFlurryAdjusted: 0,
    
    // Off-Ice stats (not available - set to 0)
    OffIce_F_xGoals: 0,
    OffIce_A_xGoals: 0,
    OffIce_F_shotAttempts: 0,
    OffIce_A_shotAttempts: 0,
    
    // Shift-based stats (not available - set to 0)
    xGoalsForAfterShifts: 0,
    xGoalsAgainstAfterShifts: 0,
    corsiForAfterShifts: 0,
    corsiAgainstAfterShifts: 0,
    fenwickForAfterShifts: 0,
    fenwickAgainstAfterShifts: 0,
  };
  
  return citrusData;
}

export const CitrusPuckService = {
  /**
   * Get analytics for all players for a specific season
   * Now uses player_season_stats + player_directory instead of staging tables
   */
  async getAllAnalytics(season: number): Promise<Map<number, AggregatedPlayerData>> {
      // Fetch stats and directory data
      // Select all columns including NHL stats for proper mapping
      const [statsResponse, directoryResponse] = await Promise.all([
          (supabase as any)
            .from("player_season_stats")
            .select("season, player_id, team_abbrev, position_code, is_goalie, games_played, icetime_seconds, nhl_toi_seconds, goals, primary_assists, secondary_assists, points, shots_on_goal, hits, blocks, pim, ppp, shp, plus_minus, nhl_plus_minus, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_shp, x_goals, x_assists, goalie_gp, wins, saves, shots_faced, goals_against, shutouts, save_pct, nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_shots_faced, nhl_goals_against, nhl_shutouts, nhl_save_pct, nhl_gaa")
            .eq("season", season),
          (supabase as any)
            .from("player_directory")
            .select("season, player_id, full_name, team_abbrev, position_code, is_goalie")
            .eq("season", season)
      ]);

      if (statsResponse.error) {
        console.error(`Error fetching player_season_stats for ${season}:`, statsResponse.error);
        return new Map();
      }
      if (directoryResponse.error) {
        console.error(`Error fetching player_directory for ${season}:`, directoryResponse.error);
        return new Map();
      }

      const statsRows = (statsResponse.data || []) as PlayerSeasonStatsRow[];
      const directoryRows = (directoryResponse.data || []) as PlayerDirectoryRow[];

      // Create directory lookup map
      const directoryMap = new Map<number, PlayerDirectoryRow>();
      directoryRows.forEach(d => {
        directoryMap.set(d.player_id, d);
      });

      const map = new Map<number, AggregatedPlayerData>();

      // Process each player's stats
      statsRows.forEach(stats => {
        const directory = directoryMap.get(stats.player_id) || null;
        const allSituation = mapStatsToCitrusPuck(stats, directory, 'all');
        
        const agg: AggregatedPlayerData = {
          playerId: stats.player_id,
          name: directory?.full_name || '',
          team: stats.team_abbrev || directory?.team_abbrev || '',
          position: stats.position_code || directory?.position_code || '',
          season: season,
          allSituation
        };
        
        map.set(stats.player_id, agg);
      });

      return map;
  },

  /**
   * Get all analytics data for a player in a specific season
   * Now uses player_season_stats (only 'all' situation available)
   */
  async getPlayerAnalytics(
    playerId: number, 
    season: number,
    position?: string // 'G' for goalie, others for skater
  ): Promise<CitrusPuckPlayerData[]> {
    // Fetch stats and directory
    // Select all columns including NHL stats for proper mapping
    const [statsResponse, directoryResponse] = await Promise.all([
      (supabase as any)
        .from("player_season_stats")
        .select("season, player_id, team_abbrev, position_code, is_goalie, games_played, icetime_seconds, nhl_toi_seconds, goals, primary_assists, secondary_assists, points, shots_on_goal, hits, blocks, pim, ppp, shp, plus_minus, nhl_plus_minus, nhl_goals, nhl_assists, nhl_points, nhl_shots_on_goal, nhl_hits, nhl_blocks, nhl_pim, nhl_ppp, nhl_shp, x_goals, x_assists, goalie_gp, wins, saves, shots_faced, goals_against, shutouts, save_pct, nhl_wins, nhl_losses, nhl_ot_losses, nhl_saves, nhl_shots_faced, nhl_goals_against, nhl_shutouts, nhl_save_pct, nhl_gaa")
        .eq("season", season)
        .eq("player_id", playerId)
        .single(),
      (supabase as any)
        .from("player_directory")
        .select("season, player_id, full_name, team_abbrev, position_code, is_goalie")
        .eq("season", season)
        .eq("player_id", playerId)
        .single()
    ]);
    
    if (statsResponse.error) {
      console.error(`Error fetching player_season_stats for player ${playerId}:`, statsResponse.error);
      return [];
    }
    
    const stats = statsResponse.data as PlayerSeasonStatsRow | null;
    const directory = directoryResponse.data as PlayerDirectoryRow | null;
    
    if (!stats) {
      return [];
    }
    
    // Return only 'all' situation (player_season_stats is season rollup, no situation breakdown)
    const allSituation = mapStatsToCitrusPuck(stats, directory, 'all');
    return [allSituation];
  },

  /**
   * Get aggregated data for a player (all situations combined)
   * Now uses player_season_stats (only 'all' situation available)
   */
  async getAggregatedPlayerData(
    playerId: number,
    season: number,
    position?: string
  ): Promise<AggregatedPlayerData | null> {
    const allData = await this.getPlayerAnalytics(playerId, season, position);
    
    if (!allData || allData.length === 0) return null;
    
    const allSituation = allData.find(d => d.situation === 'all');
    
    if (!allSituation) return null;
    
    // Note: player_season_stats only has 'all' situation, so situation-specific data is not available
    return {
      playerId,
      name: allSituation.name || '',
      team: allSituation.team || '',
      position: allSituation.position || '',
      season,
      allSituation,
      // situation5on5, situation5on4, situation4on5 not available from season rollup
    };
  },

  /**
   * Calculate projections based on 2024 vs 2025 data
   */
  async calculateProjections(playerId: number, position?: string): Promise<{
    currentWeek: CitrusPuckPlayerData;
    restOfSeason: CitrusPuckPlayerData;
  }> {
    const [data2024, data2025] = await Promise.all([
      this.getAggregatedPlayerData(playerId, 2024, position),
      this.getAggregatedPlayerData(playerId, 2025, position)
    ]);
    
    // Fallback logic: if no 2025 data, use 2024 data as baseline (maybe injured/not played yet)
    // Or return empty/zeros.
    if (!data2025) {
      if (data2024) {
           // Fallback to 2024 data if 2025 is missing (e.g. start of season or injured)
           // Project based on 2024 pace
           const currentWeek = this.projectCurrentWeek(data2024);
           const restOfSeason = this.projectRestOfSeason(null, data2024); // Treat 2024 as current for fallback
           return { currentWeek, restOfSeason };
      }
      // Return zero stats
      return { 
          currentWeek: {} as CitrusPuckPlayerData, 
          restOfSeason: {} as CitrusPuckPlayerData 
      };
    }
    
    const currentWeek = this.projectCurrentWeek(data2025);
    const restOfSeason = this.projectRestOfSeason(data2024, data2025);
    
    return { currentWeek, restOfSeason };
  },

  /**
   * Helper to get table name (DEPRECATED - kept for backward compatibility)
   * Now uses player_season_stats instead of staging tables
   */
  getTableName(season: number, type: 'skater' | 'goalie'): string {
    // DEPRECATED: This method is no longer used
    // All data now comes from player_season_stats + player_directory
    console.warn('getTableName() is deprecated - using player_season_stats instead');
    return `player_season_stats`;
  },

  /**
   * Project current week stats
   */
  projectCurrentWeek(data: AggregatedPlayerData): CitrusPuckPlayerData {
    if (!data || !data.allSituation) {
      return {} as CitrusPuckPlayerData;
    }
    const all = data.allSituation;
    const gamesPlayed = all.games_played || 1; // Avoid divide by zero
    const gamesPerWeek = 3.5; // Average games per week
    
    // Scale stats to one week
    const scaleFactor = gamesPerWeek / gamesPlayed;
    
    return this.scaleStats(all, scaleFactor);
  },

  /**
   * Project rest of season based on 2024 vs 2025 comparison
   */
  projectRestOfSeason(
    data2024: AggregatedPlayerData | null,
    data2025: AggregatedPlayerData
  ): CitrusPuckPlayerData {
    if (!data2025 || !data2025.allSituation) {
      return {} as CitrusPuckPlayerData;
    }
    const all2025 = data2025.allSituation;
    const gamesPlayed = all2025.games_played || 0;
    const gamesInSeason = 82;
    const gamesRemaining = Math.max(0, gamesInSeason - gamesPlayed);
    
    // If no 2024 data, or if 2025 games played is 0 (injured/not started),
    // we need a baseline. 
    if (gamesPlayed === 0 && data2024 && data2024.allSituation) {
        // Player hasn't played this year, project based on last year's pace for remaining games
        const all2024 = data2024.allSituation;
        const gp2024 = all2024.games_played || 1;
        const scaleFactor = gamesRemaining / gp2024;
        return this.scaleStats(all2024, scaleFactor);
    }

    const scaleFactor = gamesPlayed > 0 ? (gamesRemaining / gamesPlayed) : 0;
    return this.scaleStats(all2025, scaleFactor);
  },

  scaleStats(data: CitrusPuckPlayerData, factor: number): CitrusPuckPlayerData {
      const scaled = { ...data };
      
      // List of fields to scale (summable stats)
      const scalableFields: (keyof CitrusPuckPlayerData)[] = [
          'games_played', 'icetime', 'shifts', 
          'I_F_goals', 'I_F_primaryAssists', 'I_F_secondaryAssists', 'I_F_points',
          'I_F_shotsOnGoal', 'I_F_missedShots', 'I_F_blockedShotAttempts', 'I_F_shotAttempts',
          'I_F_hits', 'I_F_takeaways', 'I_F_giveaways',
          'I_F_xGoals', 'I_F_xRebounds', 'I_F_xOnGoal',
          'penalties', 'I_F_penalityMinutes', 'faceoffsWon', 'faceoffsLost',
          // Goalie stats if applicable
          'I_F_savedShotsOnGoal', 'I_F_savedUnblockedShotAttempts'
      ];

      scalableFields.forEach(field => {
          if (typeof scaled[field] === 'number') {
              (scaled[field] as number) *= factor;
          }
      });
      
      return scaled;
  }
};

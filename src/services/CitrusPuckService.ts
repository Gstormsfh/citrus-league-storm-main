// src/services/CitrusPuckService.ts

import { supabase } from "@/integrations/supabase/client";
import { CitrusPuckPlayerData, AggregatedPlayerData, Situation } from "@/types/citruspuck";

export const CitrusPuckService = {
  /**
   * Get analytics for all players for a specific season
   * Useful for bulk loading the roster
   */
  async getAllAnalytics(season: number): Promise<Map<number, AggregatedPlayerData>> {
      // Fetch both skaters and goalies
      const [skaters, goalies] = await Promise.all([
          supabase.from(this.getTableName(season, 'skater')).select('*').eq('situation', 'all'),
          supabase.from(this.getTableName(season, 'goalie')).select('*').eq('situation', 'all')
      ]);

      if (skaters.error) console.error(`Error fetching skaters for ${season}:`, skaters.error);
      if (goalies.error) console.error(`Error fetching goalies for ${season}:`, goalies.error);

      const map = new Map<number, AggregatedPlayerData>();

      const processData = (data: any[], type: 'skater' | 'goalie') => {
          if (!data) return;
          data.forEach(d => {
              // Create a simplified aggregated object (only 'all' situation for now for bulk load efficiency)
              const agg: AggregatedPlayerData = {
                  playerId: d.playerId,
                  name: d.name,
                  team: d.team,
                  position: d.position,
                  season: season,
                  allSituation: d as CitrusPuckPlayerData
              };
              map.set(d.playerId, agg);
          });
      };

      processData(skaters.data || [], 'skater');
      processData(goalies.data || [], 'goalie');

      return map;
  },

  /**
   * Get all analytics data for a player in a specific season
   */
  async getPlayerAnalytics(
    playerId: number, 
    season: number,
    position?: string // 'G' for goalie, others for skater
  ): Promise<CitrusPuckPlayerData[]> {
    // Determine table type based on position if provided, otherwise try both or assume skater
    const isGoalie = position === 'G' || position === 'Goalie';
    const tableName = this.getTableName(season, isGoalie ? 'goalie' : 'skater');
    
    // console.log(`Fetching analytics for player ${playerId} from ${tableName}`);

    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .eq('playerId', playerId)
      .eq('season', season);
    
    if (error) {
        console.error(`Error fetching analytics from ${tableName}:`, error);
        return [];
    }
    
    return data as unknown as CitrusPuckPlayerData[];
  },

  /**
   * Get aggregated data for a player (all situations combined)
   */
  async getAggregatedPlayerData(
    playerId: number,
    season: number,
    position?: string
  ): Promise<AggregatedPlayerData | null> {
    const allData = await this.getPlayerAnalytics(playerId, season, position);
    
    if (!allData || allData.length === 0) return null;
    
    const allSituation = allData.find(d => d.situation === 'all');
    const situation5on5 = allData.find(d => d.situation === '5on5');
    const situation5on4 = allData.find(d => d.situation === '5on4');
    const situation4on5 = allData.find(d => d.situation === '4on5');
    
    if (!allSituation) return null;
    
    return {
      playerId,
      name: allSituation.name || '',
      team: allSituation.team || '',
      position: allSituation.position || '',
      season,
      allSituation,
      situation5on5,
      situation5on4,
      situation4on5
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
   * Helper to get table name
   */
  getTableName(season: number, type: 'skater' | 'goalie'): string {
    // Using staging tables as verified from user screenshot
    return `staging_${season}_${type}s`;
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

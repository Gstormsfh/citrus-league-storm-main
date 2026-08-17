// src/services/CitrusPuckService.ts

import { CitrusPuckPlayerData, AggregatedPlayerData, Situation } from "@/types/citruspuck";
import { CURRENT_SEASON, getCurrentSeason, getSeasonGameCount } from "@/utils/seasonConstants";
import { logger } from '@/utils/logger';
import { playerApi } from '@/api/players';

/**
 * Shape of the server's NormalizedPlayer response.
 * Used to map API data → CitrusPuckPlayerData format.
 */
interface ServerPlayer {
  id: number;
  full_name: string;
  position: string;
  team: string;
  is_goalie: boolean;
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
}

/**
 * Map a NormalizedPlayer from the API to CitrusPuckPlayerData format.
 * Most advanced on-ice/off-ice fields are not available from season rollup and default to 0.
 */
function mapServerPlayerToCitrusPuck(
  p: ServerPlayer,
  season: number,
  situation: Situation = 'all'
): CitrusPuckPlayerData {
  const gamesPlayed = p.games_played || 0;
  const hasPlayed = gamesPlayed > 0;
  const isGoalie = p.is_goalie || p.position === 'G';

  // Approximate primary/secondary assist split (60/40 is typical NHL ratio)
  const totalAssists = hasPlayed ? (p.assists || 0) : 0;
  const primaryAssists = Math.round(totalAssists * 0.6);
  const secondaryAssists = totalAssists - primaryAssists;

  return {
    playerId: p.id,
    season,
    situation,
    name: p.full_name || '',
    team: p.team || '',
    position: p.position || '',

    // Basic stats
    games_played: gamesPlayed,
    icetime: hasPlayed ? (p.icetime_seconds || 0) : 0,
    shifts: 0,
    gameScore: 0,

    // Advanced percentages (not available from season rollup)
    onIce_xGoalsPercentage: 0,
    offIce_xGoalsPercentage: 0,
    onIce_corsiPercentage: 0,
    offIce_corsiPercentage: 0,
    onIce_fenwickPercentage: 0,
    offIce_fenwickPercentage: 0,
    iceTimeRank: 0,

    // Individual For (I_F) stats
    I_F_xOnGoal: 0,
    I_F_xGoals: hasPlayed ? (p.x_goals || 0) : 0,
    I_F_xRebounds: 0,
    I_F_xFreeze: 0,
    I_F_xPlayStopped: 0,
    I_F_xPlayContinuedInZone: 0,
    I_F_xPlayContinuedOutsideZone: 0,
    I_F_flurryAdjustedxGoals: 0,
    I_F_scoreVenueAdjustedxGoals: 0,
    I_F_flurryScoreVenueAdjustedxGoals: 0,
    I_F_primaryAssists: primaryAssists,
    I_F_secondaryAssists: secondaryAssists,
    I_F_shotsOnGoal: hasPlayed ? (p.shots || 0) : 0,
    I_F_missedShots: 0,
    I_F_blockedShotAttempts: 0,
    I_F_shotAttempts: 0,
    I_F_points: hasPlayed ? (p.points || 0) : 0,
    I_F_goals: hasPlayed ? (p.goals || 0) : 0,
    I_F_rebounds: 0,
    I_F_reboundGoals: 0,
    I_F_freeze: 0,
    I_F_playStopped: 0,
    I_F_playContinuedInZone: 0,
    I_F_playContinuedOutsideZone: 0,
    I_F_savedShotsOnGoal: hasPlayed && isGoalie ? (p.saves || 0) : 0,
    I_F_savedUnblockedShotAttempts: hasPlayed && isGoalie ? (p.saves || 0) : 0,
    penalties: 0,
    I_F_penalityMinutes: hasPlayed ? (p.pim || 0) : 0,
    I_F_faceOffsWon: 0,
    I_F_hits: hasPlayed ? (p.hits || 0) : 0,
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
    penalityMinutes: hasPlayed ? (p.pim || 0) : 0,
    penalityMinutesDrawn: 0,
    penaltiesDrawn: 0,
    shotsBlockedByPlayer: hasPlayed ? (p.blocks || 0) : 0,

    // On-Ice For stats (not available)
    OnIce_F_xOnGoal: 0, OnIce_F_xGoals: 0, OnIce_F_flurryAdjustedxGoals: 0,
    OnIce_F_scoreVenueAdjustedxGoals: 0, OnIce_F_flurryScoreVenueAdjustedxGoals: 0,
    OnIce_F_shotsOnGoal: 0, OnIce_F_missedShots: 0, OnIce_F_blockedShotAttempts: 0,
    OnIce_F_shotAttempts: 0, OnIce_F_goals: 0, OnIce_F_rebounds: 0, OnIce_F_reboundGoals: 0,
    OnIce_F_lowDangerShots: 0, OnIce_F_mediumDangerShots: 0, OnIce_F_highDangerShots: 0,
    OnIce_F_lowDangerxGoals: 0, OnIce_F_mediumDangerxGoals: 0, OnIce_F_highDangerxGoals: 0,
    OnIce_F_lowDangerGoals: 0, OnIce_F_mediumDangerGoals: 0, OnIce_F_highDangerGoals: 0,
    OnIce_F_scoreAdjustedShotsAttempts: 0, OnIce_F_unblockedShotAttempts: 0,
    OnIce_F_scoreAdjustedUnblockedShotAttempts: 0, OnIce_F_xGoalsFromxReboundsOfShots: 0,
    OnIce_F_xGoalsFromActualReboundsOfShots: 0, OnIce_F_reboundxGoals: 0,
    OnIce_F_xGoals_with_earned_rebounds: 0, OnIce_F_xGoals_with_earned_rebounds_scoreAdjusted: 0,
    OnIce_F_xGoals_with_earned_rebounds_scoreFlurryAdjusted: 0,

    // On-Ice Against stats (not available)
    OnIce_A_xOnGoal: 0, OnIce_A_xGoals: 0, OnIce_A_flurryAdjustedxGoals: 0,
    OnIce_A_scoreVenueAdjustedxGoals: 0, OnIce_A_flurryScoreVenueAdjustedxGoals: 0,
    OnIce_A_shotsOnGoal: 0, OnIce_A_missedShots: 0, OnIce_A_blockedShotAttempts: 0,
    OnIce_A_shotAttempts: 0, OnIce_A_goals: 0, OnIce_A_rebounds: 0, OnIce_A_reboundGoals: 0,
    OnIce_A_lowDangerShots: 0, OnIce_A_mediumDangerShots: 0, OnIce_A_highDangerShots: 0,
    OnIce_A_lowDangerxGoals: 0, OnIce_A_mediumDangerxGoals: 0, OnIce_A_highDangerxGoals: 0,
    OnIce_A_lowDangerGoals: 0, OnIce_A_mediumDangerGoals: 0, OnIce_A_highDangerGoals: 0,
    OnIce_A_scoreAdjustedShotsAttempts: 0, OnIce_A_unblockedShotAttempts: 0,
    OnIce_A_scoreAdjustedUnblockedShotAttempts: 0, OnIce_A_xGoalsFromxReboundsOfShots: 0,
    OnIce_A_xGoalsFromActualReboundsOfShots: 0, OnIce_A_reboundxGoals: 0,
    OnIce_A_xGoals_with_earned_rebounds: 0, OnIce_A_xGoals_with_earned_rebounds_scoreAdjusted: 0,
    OnIce_A_xGoals_with_earned_rebounds_scoreFlurryAdjusted: 0,

    // Off-Ice stats (not available)
    OffIce_F_xGoals: 0, OffIce_A_xGoals: 0,
    OffIce_F_shotAttempts: 0, OffIce_A_shotAttempts: 0,

    // Shift-based stats (not available)
    xGoalsForAfterShifts: 0, xGoalsAgainstAfterShifts: 0,
    corsiForAfterShifts: 0, corsiAgainstAfterShifts: 0,
    fenwickForAfterShifts: 0, fenwickAgainstAfterShifts: 0,
  };
}

export const CitrusPuckService = {
  /**
   * Get analytics for all players for a specific season.
   * Uses API server instead of direct Supabase calls.
   */
  async getAllAnalytics(season: number): Promise<Map<number, AggregatedPlayerData>> {
    try {
      const response = await playerApi.searchPlayers();
      const players = (response.data || []) as ServerPlayer[];

      const map = new Map<number, AggregatedPlayerData>();
      players.forEach(p => {
        const allSituation = mapServerPlayerToCitrusPuck(p, season, 'all');
        map.set(p.id, {
          playerId: p.id,
          name: p.full_name || '',
          team: p.team || '',
          position: p.position || '',
          season,
          allSituation,
        });
      });

      return map;
    } catch (error) {
      logger.error(`[CitrusPuckService] Error fetching analytics for season ${season}:`, error);
      return new Map();
    }
  },

  /**
   * Get all analytics data for a player in a specific season.
   * Uses API server instead of direct Supabase calls.
   */
  async getPlayerAnalytics(
    playerId: number,
    season: number,
    _position?: string
  ): Promise<CitrusPuckPlayerData[]> {
    try {
      const response = await playerApi.getPlayersByIds([String(playerId)]);
      const players = (response.data || []) as ServerPlayer[];
      const player = players.find(p => p.id === playerId);

      if (!player) return [];

      const allSituation = mapServerPlayerToCitrusPuck(player, season, 'all');
      return [allSituation];
    } catch (error) {
      logger.error(`[CitrusPuckService] Error fetching analytics for player ${playerId}:`, error);
      return [];
    }
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
    if (!allSituation) return null;

    return {
      playerId,
      name: allSituation.name || '',
      team: allSituation.team || '',
      position: allSituation.position || '',
      season,
      allSituation,
    };
  },

  /**
   * Calculate projections based on prior vs current season data
   */
  async calculateProjections(playerId: number, position?: string): Promise<{
    currentWeek: CitrusPuckPlayerData;
    restOfSeason: CitrusPuckPlayerData;
  }> {
    const [dataPrior, dataCurrent] = await Promise.all([
      this.getAggregatedPlayerData(playerId, CURRENT_SEASON - 1, position),
      this.getAggregatedPlayerData(playerId, CURRENT_SEASON, position)
    ]);

    if (!dataCurrent) {
      if (dataPrior) {
        const currentWeek = this.projectCurrentWeek(dataPrior);
        const restOfSeason = this.projectRestOfSeason(null, dataPrior);
        return { currentWeek, restOfSeason };
      }
      return {
        currentWeek: {} as CitrusPuckPlayerData,
        restOfSeason: {} as CitrusPuckPlayerData
      };
    }

    const currentWeek = this.projectCurrentWeek(dataCurrent);
    const restOfSeason = this.projectRestOfSeason(dataPrior, dataCurrent);
    return { currentWeek, restOfSeason };
  },

  /**
   * Project current week stats
   */
  projectCurrentWeek(data: AggregatedPlayerData): CitrusPuckPlayerData {
    if (!data || !data.allSituation) return {} as CitrusPuckPlayerData;
    const all = data.allSituation;
    const gamesPlayed = all.games_played || 1;
    const gamesPerWeek = 3.5;
    const scaleFactor = gamesPerWeek / gamesPlayed;
    return this.scaleStats(all, scaleFactor);
  },

  /**
   * Project rest of season based on prior vs current season comparison
   */
  projectRestOfSeason(
    dataPrior: AggregatedPlayerData | null,
    dataCurrent: AggregatedPlayerData
  ): CitrusPuckPlayerData {
    if (!dataCurrent || !dataCurrent.allSituation) return {} as CitrusPuckPlayerData;
    const allCurrent = dataCurrent.allSituation;
    const gamesPlayed = allCurrent.games_played || 0;
    // 2026-27 is an 84-game season. A literal here silently zeroes every
    // rest-of-season projection once a player passes it — in the final week.
    const gamesInSeason = getSeasonGameCount(getCurrentSeason());
    const gamesRemaining = Math.max(0, gamesInSeason - gamesPlayed);

    if (gamesPlayed === 0 && dataPrior && dataPrior.allSituation) {
      const allPrior = dataPrior.allSituation;
      const gpPrior = allPrior.games_played || 1;
      const scaleFactor = gamesRemaining / gpPrior;
      return this.scaleStats(allPrior, scaleFactor);
    }

    const scaleFactor = gamesPlayed > 0 ? (gamesRemaining / gamesPlayed) : 0;
    return this.scaleStats(allCurrent, scaleFactor);
  },

  scaleStats(data: CitrusPuckPlayerData, factor: number): CitrusPuckPlayerData {
    const scaled = { ...data };

    const scalableFields: (keyof CitrusPuckPlayerData)[] = [
      'games_played', 'icetime', 'shifts',
      'I_F_goals', 'I_F_primaryAssists', 'I_F_secondaryAssists', 'I_F_points',
      'I_F_shotsOnGoal', 'I_F_missedShots', 'I_F_blockedShotAttempts', 'I_F_shotAttempts',
      'I_F_hits', 'I_F_takeaways', 'I_F_giveaways',
      'I_F_xGoals', 'I_F_xRebounds', 'I_F_xOnGoal',
      'penalties', 'I_F_penalityMinutes', 'faceoffsWon', 'faceoffsLost',
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

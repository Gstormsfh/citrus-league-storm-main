// src/types/citruspuck.ts

export type Situation = '5on5' | '5on4' | '4on5' | 'Other' | 'all';

export interface CitrusPuckPlayerData {
  playerId: number; // NHL player ID
  season: number; // Starting year (2024, 2025)
  situation: Situation;
  name?: string;
  team?: string;
  position?: string;
  
  // Basic stats
  games_played: number;
  icetime: number; // seconds
  shifts: number;
  gameScore: number;
  
  // Advanced percentages
  onIce_xGoalsPercentage: number;
  offIce_xGoalsPercentage: number;
  onIce_corsiPercentage: number;
  offIce_corsiPercentage: number;
  onIce_fenwickPercentage: number;
  offIce_fenwickPercentage: number;
  iceTimeRank: number;
  
  // Individual For (I_F) stats
  I_F_xOnGoal: number;
  I_F_xGoals: number;
  I_F_xRebounds: number;
  I_F_xFreeze: number;
  I_F_xPlayStopped: number;
  I_F_xPlayContinuedInZone: number;
  I_F_xPlayContinuedOutsideZone: number;
  I_F_flurryAdjustedxGoals: number;
  I_F_scoreVenueAdjustedxGoals: number;
  I_F_flurryScoreVenueAdjustedxGoals: number;
  I_F_primaryAssists: number;
  I_F_secondaryAssists: number;
  I_F_shotsOnGoal: number;
  I_F_missedShots: number;
  I_F_blockedShotAttempts: number;
  I_F_shotAttempts: number;
  I_F_points: number;
  I_F_goals: number;
  I_F_rebounds: number;
  I_F_reboundGoals: number;
  I_F_freeze: number;
  I_F_playStopped: number;
  I_F_playContinuedInZone: number;
  I_F_playContinuedOutsideZone: number;
  I_F_savedShotsOnGoal: number;
  I_F_savedUnblockedShotAttempts: number;
  penalties: number;
  I_F_penalityMinutes: number;
  I_F_faceOffsWon: number;
  I_F_hits: number;
  I_F_takeaways: number;
  I_F_giveaways: number;
  I_F_lowDangerShots: number;
  I_F_mediumDangerShots: number;
  I_F_highDangerShots: number;
  I_F_lowDangerxGoals: number;
  I_F_mediumDangerxGoals: number;
  I_F_highDangerxGoals: number;
  I_F_lowDangerGoals: number;
  I_F_mediumDangerGoals: number;
  I_F_highDangerGoals: number;
  I_F_scoreAdjustedShotsAttempts: number;
  I_F_unblockedShotAttempts: number;
  I_F_scoreAdjustedUnblockedShotAttempts: number;
  I_F_dZoneGiveaways: number;
  I_F_xGoalsFromxReboundsOfShots: number;
  I_F_xGoalsFromActualReboundsOfShots: number;
  I_F_reboundxGoals: number;
  I_F_xGoals_with_earned_rebounds: number;
  I_F_xGoals_with_earned_rebounds_scoreAdjusted: number;
  I_F_xGoals_with_earned_rebounds_scoreFlurryAdjusted: number;
  I_F_shifts: number;
  I_F_oZoneShiftStarts: number;
  I_F_dZoneShiftStarts: number;
  I_F_neutralZoneShiftStarts: number;
  I_F_flyShiftStarts: number;
  I_F_oZoneShiftEnds: number;
  I_F_dZoneShiftEnds: number;
  I_F_neutralZoneShiftEnds: number;
  I_F_flyShiftEnds: number;
  faceoffsWon: number;
  faceoffsLost: number;
  timeOnBench: number;
  penalityMinutes: number;
  penalityMinutesDrawn: number;
  penaltiesDrawn: number;
  shotsBlockedByPlayer: number;
  
  // On-Ice For (OnIce_F) stats
  OnIce_F_xOnGoal: number;
  OnIce_F_xGoals: number;
  OnIce_F_flurryAdjustedxGoals: number;
  OnIce_F_scoreVenueAdjustedxGoals: number;
  OnIce_F_flurryScoreVenueAdjustedxGoals: number;
  OnIce_F_shotsOnGoal: number;
  OnIce_F_missedShots: number;
  OnIce_F_blockedShotAttempts: number;
  OnIce_F_shotAttempts: number;
  OnIce_F_goals: number;
  OnIce_F_rebounds: number;
  OnIce_F_reboundGoals: number;
  OnIce_F_lowDangerShots: number;
  OnIce_F_mediumDangerShots: number;
  OnIce_F_highDangerShots: number;
  OnIce_F_lowDangerxGoals: number;
  OnIce_F_mediumDangerxGoals: number;
  OnIce_F_highDangerxGoals: number;
  OnIce_F_lowDangerGoals: number;
  OnIce_F_mediumDangerGoals: number;
  OnIce_F_highDangerGoals: number;
  OnIce_F_scoreAdjustedShotsAttempts: number;
  OnIce_F_unblockedShotAttempts: number;
  OnIce_F_scoreAdjustedUnblockedShotAttempts: number;
  OnIce_F_xGoalsFromxReboundsOfShots: number;
  OnIce_F_xGoalsFromActualReboundsOfShots: number;
  OnIce_F_reboundxGoals: number;
  OnIce_F_xGoals_with_earned_rebounds: number;
  OnIce_F_xGoals_with_earned_rebounds_scoreAdjusted: number;
  OnIce_F_xGoals_with_earned_rebounds_scoreFlurryAdjusted: number;
  
  // On-Ice Against (OnIce_A) stats
  OnIce_A_xOnGoal: number;
  OnIce_A_xGoals: number;
  OnIce_A_flurryAdjustedxGoals: number;
  OnIce_A_scoreVenueAdjustedxGoals: number;
  OnIce_A_flurryScoreVenueAdjustedxGoals: number;
  OnIce_A_shotsOnGoal: number;
  OnIce_A_missedShots: number;
  OnIce_A_blockedShotAttempts: number;
  OnIce_A_shotAttempts: number;
  OnIce_A_goals: number;
  OnIce_A_rebounds: number;
  OnIce_A_reboundGoals: number;
  OnIce_A_lowDangerShots: number;
  OnIce_A_mediumDangerShots: number;
  OnIce_A_highDangerShots: number;
  OnIce_A_lowDangerxGoals: number;
  OnIce_A_mediumDangerxGoals: number;
  OnIce_A_highDangerxGoals: number;
  OnIce_A_lowDangerGoals: number;
  OnIce_A_mediumDangerGoals: number;
  OnIce_A_highDangerGoals: number;
  OnIce_A_scoreAdjustedShotsAttempts: number;
  OnIce_A_unblockedShotAttempts: number;
  OnIce_A_scoreAdjustedUnblockedShotAttempts: number;
  OnIce_A_xGoalsFromxReboundsOfShots: number;
  OnIce_A_xGoalsFromActualReboundsOfShots: number;
  OnIce_A_reboundxGoals: number;
  OnIce_A_xGoals_with_earned_rebounds: number;
  OnIce_A_xGoals_with_earned_rebounds_scoreAdjusted: number;
  OnIce_A_xGoals_with_earned_rebounds_scoreFlurryAdjusted: number;
  
  // Off-Ice stats
  OffIce_F_xGoals: number;
  OffIce_A_xGoals: number;
  OffIce_F_shotAttempts: number;
  OffIce_A_shotAttempts: number;
  
  // Shift-based stats
  xGoalsForAfterShifts: number;
  xGoalsAgainstAfterShifts: number;
  corsiForAfterShifts: number;
  corsiAgainstAfterShifts: number;
  fenwickForAfterShifts: number;
  fenwickAgainstAfterShifts: number;
}

// Aggregated player data across all situations
export interface AggregatedPlayerData {
  playerId: number;
  name: string;
  team: string;
  position: string;
  season: number;
  
  // Aggregate from 'all' situation
  allSituation: CitrusPuckPlayerData;
  
  // Situation-specific
  situation5on5?: CitrusPuckPlayerData;
  situation5on4?: CitrusPuckPlayerData;
  situation4on5?: CitrusPuckPlayerData;
  
  // Calculated projections
  projectedStats?: {
    currentWeek?: CitrusPuckPlayerData;
    restOfSeason?: CitrusPuckPlayerData;
  };
}


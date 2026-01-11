import { NHLGame } from "@/services/ScheduleService";

export type MatchupPlayerStatus = "In Game" | "Final" | null;

export interface StatBreakdown {
  [category: string]: {
    count: number;
    points: number;
    logic: string; // e.g., "2 goals * 3.0 points"
  };
}

export type MatchupPlayer = {
  id: number;
  name: string;
  position: string;
  team: string;
  points: number; // Keep for backward compatibility, but will use total_points from DB
  projectedPoints?: number;
  gamesRemaining: number;
  status: MatchupPlayerStatus;
  isStarter: boolean;
  // Skater stats (for skaters only)
  stats: {
    goals: number;
    assists: number;
    sog: number;
    blk: number;
    gamesPlayed?: number;
    xGoals?: number;
    powerPlayPoints?: number;
  };
  matchupStats?: {
    goals?: number;
    assists?: number;
    sog?: number;
    blocks?: number;
    ppp?: number;
    shp?: number;
    hits?: number;
    pim?: number;
    xGoals?: number;
    // Goalie stats
    wins?: number;
    saves?: number;
    shutouts?: number;
    goals_against?: number;
  };
  garPercentage?: number;
  isToday?: boolean;
  gameInfo?: {
    opponent: string;
    time?: string;
    score?: string;
    period?: string;
  };
  // NEW: Pre-calculated matchup fields from fantasy_matchup_lines
  total_points?: number; // From fantasy_matchup_lines.total_points
  games_played?: number; // From fantasy_matchup_lines.games_played
  games_remaining_total?: number; // From fantasy_matchup_lines.games_remaining_total
  games_remaining_active?: number; // From fantasy_matchup_lines.games_remaining_active
  has_live_game?: boolean; // From fantasy_matchup_lines.has_live_game
  live_game_locked?: boolean; // From fantasy_matchup_lines.live_game_locked
  stats_breakdown?: StatBreakdown; // Transformed from fantasy_matchup_lines.stats_breakdown JSONB
  games?: NHLGame[]; // Games for the matchup week (for GameLogosBar)
  // NEW: Daily projection from Citrus Projections 2.0 (skater)
  daily_projection?: {
    total_projected_points: number;
    projected_goals: number;
    projected_assists: number;
    projected_sog: number;
    projected_blocks: number;
    // NEW: All 8 stat categories
    projected_ppp?: number;      // Power Play Points
    projected_shp?: number;        // Shorthanded Points
    projected_hits?: number;       // Hits
    projected_pim?: number;        // Penalty Minutes
    projected_xg: number;
    base_ppg: number;
    shrinkage_weight: number;
    finishing_multiplier: number;
    opponent_adjustment: number;
    b2b_penalty: number;
    home_away_adjustment: number;
    confidence_score: number;
    calculation_method: string;
    is_goalie?: boolean; // Flag to distinguish goalie vs skater
  };
  // NEW: Goalie-specific fields
  isGoalie?: boolean;
  // NEW: Daily stats fields
  daily_total_points?: number; // Total fantasy points for a specific day
  daily_stats_breakdown?: StatBreakdown; // Breakdown of daily scoring (for tooltip hover)
  goalieStats?: {
    gamesPlayed: number; // GP
    wins: number;
    saves: number;
    shutouts: number; // SOs
    goalsAgainst: number;
    gaa: number; // GAA
    savePct: number; // SV%
    goalsSavedAboveExpected?: number; // GSAx
  };
  goalieMatchupStats?: {
    wins: number;
    saves: number;
    shutouts: number;
    goalsAgainst: number;
  };
  goalieProjection?: {
    total_projected_points: number;
    projected_wins: number;
    projected_saves: number;
    projected_shutouts: number;
    projected_goals_against: number;
    projected_gaa: number;
    projected_save_pct: number;
    projected_gp: number;
    starter_confirmed: boolean;
    confidence_score: number;
    calculation_method: string;
  };
  // IR Status fields from player_talent_metrics
  roster_status?: string; // Official NHL roster status: ACT, IR, LTIR, etc.
  is_ir_eligible?: boolean; // True if player is on IR or LTIR and can be placed in IR slot
  // Dropped player indicator
  wasDropped?: boolean; // True if player was dropped but points still count from when they were in the lineup
};

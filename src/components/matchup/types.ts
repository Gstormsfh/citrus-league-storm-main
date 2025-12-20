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
  stats: {
    goals: number;
    assists: number;
    sog: number;
    blk: number;
    gamesPlayed?: number;
    xGoals?: number;
  };
  matchupStats?: {
    goals: number;
    assists: number;
    sog: number;
    xGoals: number;
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
};

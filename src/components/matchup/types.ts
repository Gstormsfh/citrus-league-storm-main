
export type MatchupPlayerStatus = "In Game" | "Final" | null;

export type MatchupPlayer = {
  id: number;
  name: string;
  position: string;
  team: string;
  points: number;
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
  isToday?: boolean;
  gameInfo?: {
    opponent: string;
    time?: string;
    score?: string;
    period?: string;
  };
};

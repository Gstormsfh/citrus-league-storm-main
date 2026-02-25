/**
 * BestBallService — Auto-lineup optimization for Best Ball leagues.
 *
 * In Best Ball, managers draft players but never set lineups manually.
 * Each week/day, the system automatically selects the optimal lineup from
 * all rostered players based on actual points scored.
 *
 * Algorithm:
 *   1. Collect all rostered players for a team with their actual stats.
 *   2. Greedily assign the highest-scoring eligible player to each roster slot.
 *   3. The resulting "best possible lineup" becomes the team's score.
 */

import { supabase } from '@/integrations/supabase/client';
import { ScoringCalculator, extractScoringSettings } from '@/utils/scoringUtils';
import { DEFAULT_ROSTER_SLOTS, type RosterSlotConfig } from '@/types/leagueTypes';
import { CURRENT_SEASON } from '@/utils/seasonConstants';

// Mapping of roster slot codes to eligible player positions
const SLOT_ELIGIBLE_POSITIONS: Record<string, string[]> = {
  C: ['C', 'Centre'],
  LW: ['LW', 'Left Wing'],
  RW: ['RW', 'Right Wing'],
  D: ['D', 'Defence', 'Defense'],
  G: ['G', 'Goalie'],
  UTIL: ['C', 'Centre', 'LW', 'Left Wing', 'RW', 'Right Wing', 'D', 'Defence', 'Defense'],
};

interface PlayerScore {
  player_id: string;
  position: string;
  points: number;
  is_goalie: boolean;
}

export interface BestBallResult {
  team_id: string;
  optimized_starters: string[];   // player IDs in the optimal lineup
  optimized_points: number;       // total points from the optimized lineup
  bench_points: number;           // total points from bench (not counted)
  player_scores: Record<string, number>; // all player scores for transparency
}

export class BestBallService {
  /**
   * Calculate the best possible lineup for a team from a set of player scores.
   * Uses a greedy slot-filling algorithm: fill each required slot with the
   * highest-scoring eligible player that hasn't been assigned yet.
   *
   * @param playerScores - Array of { player_id, position, points, is_goalie }
   * @param rosterSlots  - Roster slot config (defaults to DEFAULT_ROSTER_SLOTS)
   * @returns Optimized lineup details
   */
  static optimizeLineup(
    playerScores: PlayerScore[],
    rosterSlots: RosterSlotConfig[] = DEFAULT_ROSTER_SLOTS
  ): { starters: string[]; totalPoints: number; benchPoints: number } {
    // Sort players by points descending — greedy approach
    const sorted = [...playerScores].sort((a, b) => b.points - a.points);
    const assigned = new Set<string>();
    const starters: string[] = [];
    let totalPoints = 0;

    // Expand roster slots: e.g., C x2 → [C, C]
    const expandedSlots: string[] = [];
    for (const slot of rosterSlots) {
      // Skip BN (bench) and IR slots — only fill active roster
      if (slot.slot === 'BN' || slot.slot === 'IR') continue;
      for (let i = 0; i < slot.count; i++) {
        expandedSlots.push(slot.slot);
      }
    }

    // For each slot, find the best unassigned eligible player
    // Process specific position slots first, UTIL last (greedy strategy)
    const specificSlots = expandedSlots.filter(s => s !== 'UTIL');
    const utilSlots = expandedSlots.filter(s => s === 'UTIL');
    const orderedSlots = [...specificSlots, ...utilSlots];

    for (const slotCode of orderedSlots) {
      const eligible = SLOT_ELIGIBLE_POSITIONS[slotCode];
      if (!eligible) continue;

      // Find the highest-scoring unassigned player eligible for this slot
      const best = sorted.find(
        p => !assigned.has(p.player_id) && eligible.some(pos => p.position === pos)
      );

      if (best) {
        assigned.add(best.player_id);
        starters.push(best.player_id);
        totalPoints += best.points;
      }
    }

    // Calculate bench points (everyone not starting)
    const benchPoints = sorted
      .filter(p => !assigned.has(p.player_id))
      .reduce((sum, p) => sum + p.points, 0);

    return { starters, totalPoints, benchPoints };
  }

  /**
   * Calculate the optimized Best Ball score for a team for a specific week.
   * Fetches the team's rostered players and their weekly stats, then runs
   * the optimizer.
   */
  static async calculateWeeklyBestBall(
    leagueId: string,
    teamId: string,
    weekNumber: number,
    scoringSettings?: any
  ): Promise<BestBallResult> {
    const scorer = new ScoringCalculator(scoringSettings);
    const emptyResult: BestBallResult = {
      team_id: teamId,
      optimized_starters: [],
      optimized_points: 0,
      bench_points: 0,
      player_scores: {},
    };

    try {
      // Get the team's rostered players
      // IR players are included but score 0 (ESPN/Yahoo standard for Best Ball)
      // This ensures they appear in player_scores for transparency but never
      // get optimized into the lineup since the greedy algorithm picks higher scorers.
      const { data: lineup } = await supabase
        .from('team_lineups')
        .select('starters, bench, ir')
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .maybeSingle();

      // Track IR players so we can force their score to 0
      const irPlayerIds = new Set<string>(
        ((lineup?.ir as string[]) || []).map(String)
      );

      const { data: assignments } = await supabase
        .from('roster_assignments')
        .select('player_id')
        .eq('league_id', leagueId)
        .eq('team_id', teamId);

      if (!assignments || assignments.length === 0) return emptyResult;

      // Include ALL rostered players (IR players will get 0 points below)
      const playerIds = assignments.map(a => a.player_id);

      if (playerIds.length === 0) return emptyResult;

      const season = CURRENT_SEASON;

      // Get player positions
      const { data: players } = await supabase
        .from('player_directory')
        .select('player_id, position_code')
        .eq('season', season)
        .in('player_id', playerIds.map(Number));

      const posMap = new Map<string, string>();
      (players ?? []).forEach((p: any) => posMap.set(String(p.player_id), p.position_code || 'UTIL'));

      // Get weekly stats for these players
      const { data: weeklyStats } = await supabase
        .from('player_weekly_stats')
        .select('player_id, goals, assists, shots_on_goal, blocks, hits, pim, ppp, shp, plus_minus, wins, saves, shutouts, goals_against')
        .eq('week_number', weekNumber)
        .in('player_id', playerIds.map(Number));

      if (!weeklyStats || weeklyStats.length === 0) return emptyResult;

      // Calculate fantasy points for each player
      // IR players score 0 — they're tracked but never optimized into the lineup
      const playerScores: PlayerScore[] = weeklyStats.map((s: any) => {
        const pos = posMap.get(String(s.player_id)) || 'UTIL';
        const isGoalie = pos === 'G' || pos === 'Goalie';
        const isOnIR = irPlayerIds.has(String(s.player_id));
        const points = isOnIR ? 0 : scorer.calculatePoints(s, isGoalie);
        return {
          player_id: String(s.player_id),
          position: pos,
          points,
          is_goalie: isGoalie,
        };
      });

      // Run optimizer
      const { starters, totalPoints, benchPoints } = this.optimizeLineup(playerScores);

      const allScores: Record<string, number> = {};
      playerScores.forEach(ps => { allScores[ps.player_id] = ps.points; });

      return {
        team_id: teamId,
        optimized_starters: starters,
        optimized_points: totalPoints,
        bench_points: benchPoints,
        player_scores: allScores,
      };
    } catch (err) {
      console.error('[BestBallService] calculateWeeklyBestBall error:', err);
      return emptyResult;
    }
  }

  /**
   * Calculate Best Ball scores for all teams in a league for a given week.
   */
  static async calculateLeagueWeekBestBall(
    leagueId: string,
    weekNumber: number,
    scoringSettings?: any
  ): Promise<BestBallResult[]> {
    try {
      // Get all teams in the league
      const { data: teams } = await supabase
        .from('teams')
        .select('id')
        .eq('league_id', leagueId);

      if (!teams || teams.length === 0) return [];

      const results = await Promise.all(
        teams.map(t => this.calculateWeeklyBestBall(leagueId, t.id, weekNumber, scoringSettings))
      );

      return results;
    } catch (err) {
      console.error('[BestBallService] calculateLeagueWeekBestBall error:', err);
      return [];
    }
  }

  /**
   * Calculate season-long Best Ball standings across all weeks.
   * Returns cumulative optimized points for each team.
   */
  static async calculateSeasonBestBall(
    leagueId: string,
    totalWeeks: number,
    scoringSettings?: any
  ): Promise<Record<string, { totalOptimizedPoints: number; weeklyBreakdown: Record<number, number> }>> {
    const result: Record<string, { totalOptimizedPoints: number; weeklyBreakdown: Record<number, number> }> = {};

    try {
      for (let week = 1; week <= totalWeeks; week++) {
        const weekResults = await this.calculateLeagueWeekBestBall(leagueId, week, scoringSettings);
        for (const wr of weekResults) {
          if (!result[wr.team_id]) {
            result[wr.team_id] = { totalOptimizedPoints: 0, weeklyBreakdown: {} };
          }
          result[wr.team_id].totalOptimizedPoints += wr.optimized_points;
          result[wr.team_id].weeklyBreakdown[week] = wr.optimized_points;
        }
      }
    } catch (err) {
      console.error('[BestBallService] calculateSeasonBestBall error:', err);
    }

    return result;
  }

  // ============================================================================
  // SERVER-SIDE OPTIMIZATION (via RPC)
  // ============================================================================
  // The optimize_best_ball_daily_rosters RPC runs on the server and uses
  // DYNAMIC scoring weights from leagues.scoring_settings (commissioner-configured).
  // It also reads roster slot config from leagues.settings.rosterSlots.
  // This runs automatically via pg_cron daily at 7 AM UTC (2 AM EST).
  // The methods below allow on-demand triggering from the frontend.
  // ============================================================================

  /**
   * Trigger server-side Best Ball optimization for a specific date.
   * Uses the optimize_best_ball_daily_rosters RPC which reads:
   *   - Scoring weights from leagues.scoring_settings (commissioner-configured)
   *   - Roster slot configuration from leagues.settings.rosterSlots (commissioner-configured)
   *
   * This ensures the optimizer always uses the latest league settings.
   */
  static async triggerServerOptimization(
    leagueId: string,
    date: string  // YYYY-MM-DD format
  ): Promise<{
    results: Array<{ teamId: string; playersOptimized: number; totalPoints: number }>;
    error?: string;
  }> {
    try {
      const { data, error } = await supabase.rpc('optimize_best_ball_daily_rosters', {
        p_league_id: leagueId,
        p_roster_date: date,
      });

      if (error) throw error;

      const results = (data || []).map((row: any) => ({
        teamId: row.team_id,
        playersOptimized: row.players_optimized,
        totalPoints: row.total_points,
      }));

      return { results };
    } catch (error: unknown) {
      console.error('[BestBallService] triggerServerOptimization error:', error);
      return { results: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Trigger server-side optimization for an entire week's date range.
   * Optimizes each day in the week sequentially.
   */
  static async triggerWeekOptimization(
    leagueId: string,
    weekStartDate: string,  // YYYY-MM-DD
    weekEndDate: string     // YYYY-MM-DD
  ): Promise<{ daysOptimized: number; error?: string }> {
    try {
      let daysOptimized = 0;
      const start = new Date(weekStartDate);
      const end = new Date(weekEndDate);

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const { error } = await this.triggerServerOptimization(leagueId, dateStr);
        if (!error) daysOptimized++;
      }

      return { daysOptimized };
    } catch (error: unknown) {
      console.error('[BestBallService] triggerWeekOptimization error:', error);
      return { daysOptimized: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

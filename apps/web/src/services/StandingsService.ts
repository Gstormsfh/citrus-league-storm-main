/**
 * StandingsService — Extracted from LeagueService.ts
 *
 * Contains all standings calculation methods:
 * - calculateTeamStandings (H2H Points)
 * - calculateSeasonPointsStandings (Roto, Total Points, PPG)
 * - calculateCategoryStandings (H2H Categories)
 * - calculateRotoStandingsFromDB (Rotisserie)
 */

import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/utils/logger";
import type { CategoryStats } from "@/utils/scoringUtils";
import { getTodayMST } from "@/utils/timezoneUtils";
import { CURRENT_SEASON } from "@/utils/seasonConstants";
import type { LeagueSettings } from "@/types/leagueTypes";
import type { Team } from "./LeagueService";

// Cache for team standings to prevent redundant calculations
// TTL: 60 seconds (refresh after 1 minute to get latest scores)
const standingsCache = new Map<string, {
  data: Record<string, {
    pointsFor: number;
    pointsAgainst: number;
    wins: number;
    losses: number;
    streak: string;
    last5: { wins: number; losses: number };
  }>;
  timestamp: number;
}>();

export const StandingsService = {
  /**
   * Calculate team standings stats from completed matchup results.
   *
   * Format-aware behavior:
   * - H2H Points / H2H Categories / Best Ball: Standard W/L from matchup scores
   * - Roto / Total Points / PPG: No matchups; standings based on cumulative points
   * - Pool formats: Not applicable (no player-based scoring)
   *
   * Points for/against come from actual matchup scores (team1_score, team2_score).
   * Wins/losses determined by higher score in each matchup.
   * Also calculates streak and last 5 games.
   */
  async calculateTeamStandings(
    leagueId: string,
    teams: Team[],
    draftPicks: Array<{ team_id: string; player_id: string }>,
    allPlayers: Array<{ id: string; points: number }>
  ): Promise<Record<string, {
    pointsFor: number;
    pointsAgainst: number;
    wins: number;
    losses: number;
    ties: number;
    streak: string;
    last5: { wins: number; losses: number; ties: number };
  }>> {
    // Check cache first (60 second TTL) - prevents redundant calculations
    const cacheKey = leagueId;
    const cached = standingsCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < 60000) {
      logger.debug('[StandingsService] Using CACHED team standings (age:', Math.round((now - cached.timestamp) / 1000), 'seconds)');
      return cached.data;
    }

    // Initialize all teams with 0 stats
    type TeamStatsWithHistory = {
      pointsFor: number;
      pointsAgainst: number;
      wins: number;
      losses: number;
      ties: number;
      streak: string;
      last5: { wins: number; losses: number; ties: number };
      matchupHistory: Array<{ week: number; result: 'win' | 'loss' | 'tie' }>; // Track matchup history for streak/last5
    };
    const teamStats: Record<string, TeamStatsWithHistory> = {};

    teams.forEach(team => {
      teamStats[team.id] = {
        pointsFor: 0,
        pointsAgainst: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        streak: '-',
        last5: { wins: 0, losses: 0, ties: 0 },
        matchupHistory: []
      };
    });

    try {
      // Query all completed matchups OR past matchups (week_end_date < CURRENT_DATE) for this league
      // This ensures Week 1 and Week 2 are both included even if Week 1 wasn't marked as completed
      // CRITICAL: Include past weeks regardless of status to ensure all historical data is included
      const todayStr = getTodayMST();

      // Use two separate queries and combine: completed matchups OR past matchups
      // This is more reliable than complex .or() syntax
      const [completedResult, pastResult] = await Promise.all([
        supabase
          .from('matchups')
          .select('team1_id, team2_id, team1_score, team2_score, week_number, status, week_end_date, id')
          .eq('league_id', leagueId)
          .eq('status', 'completed'),
        supabase
          .from('matchups')
          .select('team1_id, team2_id, team1_score, team2_score, week_number, status, week_end_date, id')
          .eq('league_id', leagueId)
          .lt('week_end_date', todayStr)
          .neq('status', 'completed') // Exclude already completed ones to avoid duplicates
      ]);

      if (completedResult.error) {
        logger.error('[StandingsService] Error fetching completed matchups:', completedResult.error);
      }
      if (pastResult.error) {
        logger.error('[StandingsService] Error fetching past matchups:', pastResult.error);
      }

      // Combine results and deduplicate by matchup ID
      const completedMatchups = completedResult.data || [];
      const pastMatchups = pastResult.data || [];
      const matchupMap = new Map();

      // Add completed matchups first
      completedMatchups.forEach(m => {
        if (m.id) matchupMap.set(m.id, m);
      });

      // Add past matchups (will overwrite if already in map, but that's fine - completed takes precedence)
      pastMatchups.forEach(m => {
        if (m.id && !matchupMap.has(m.id)) {
          matchupMap.set(m.id, m);
        }
      });

      // Convert to array and sort by week_number
      const matchups = Array.from(matchupMap.values()).sort((a, b) => a.week_number - b.week_number);
      const error = completedResult.error || pastResult.error;

      if (error) {
        logger.error('[StandingsService] Error fetching completed matchups:', error);
        return teamStats; // Return empty stats if query fails
      }

      if (!matchups || matchups.length === 0) {
        // No completed matchups yet - return empty stats
        return teamStats;
      }

      // Calculate stats from each matchup
      // CRITICAL: Only use scores from matchups table - these are matchup totals (sum of 7 daily scores)
      // NOT season totals or player totals
      // This logic applies to ALL weeks (Week 1, Week 2, etc.) - same calculation for all
      // All matchups returned are already past (week_end_date < CURRENT_DATE) or completed, so process all

      matchups.forEach(matchup => {
        // Parse scores - ensure we're getting matchup scores, not season totals
        const team1Score = parseFloat(String(matchup.team1_score)) || 0;
        const team2Score = matchup.team2_id ? (parseFloat(String(matchup.team2_score)) || 0) : 0;

        // Handle bye weeks (team2_id is null)
        if (!matchup.team2_id) {
          // Team1 gets a win and their points, no points against
          if (teamStats[matchup.team1_id]) {
            teamStats[matchup.team1_id].wins++;
            teamStats[matchup.team1_id].pointsFor += team1Score;
            teamStats[matchup.team1_id].matchupHistory.push({
              week: matchup.week_number,
              result: 'win'
            });
          }
        } else {
          // Both teams participated - calculate points and win/loss
          if (teamStats[matchup.team1_id]) {
            teamStats[matchup.team1_id].pointsFor += team1Score;
            teamStats[matchup.team1_id].pointsAgainst += team2Score;
          }

          if (teamStats[matchup.team2_id]) {
            teamStats[matchup.team2_id].pointsFor += team2Score;
            teamStats[matchup.team2_id].pointsAgainst += team1Score;
          }

          // Determine winner (higher score wins)
          const team1Won = team1Score > team2Score;
          const team2Won = team2Score > team1Score;
          const isTie = team1Score === team2Score;

          if (team1Won) {
            if (teamStats[matchup.team1_id]) {
              teamStats[matchup.team1_id].wins++;
              teamStats[matchup.team1_id].matchupHistory.push({
                week: matchup.week_number,
                result: 'win'
              });
            }
            if (teamStats[matchup.team2_id]) {
              teamStats[matchup.team2_id].losses++;
              teamStats[matchup.team2_id].matchupHistory.push({
                week: matchup.week_number,
                result: 'loss'
              });
            }
          } else if (team2Won) {
            if (teamStats[matchup.team2_id]) {
              teamStats[matchup.team2_id].wins++;
              teamStats[matchup.team2_id].matchupHistory.push({
                week: matchup.week_number,
                result: 'win'
              });
            }
            if (teamStats[matchup.team1_id]) {
              teamStats[matchup.team1_id].losses++;
              teamStats[matchup.team1_id].matchupHistory.push({
                week: matchup.week_number,
                result: 'loss'
              });
            }
          } else if (isTie) {
            // Tie game - both teams get a tie (industry standard: ties count as half a win)
            if (teamStats[matchup.team1_id]) {
              teamStats[matchup.team1_id].ties++;
              teamStats[matchup.team1_id].matchupHistory.push({
                week: matchup.week_number,
                result: 'tie'
              });
            }
            if (teamStats[matchup.team2_id]) {
              teamStats[matchup.team2_id].ties++;
              teamStats[matchup.team2_id].matchupHistory.push({
                week: matchup.week_number,
                result: 'tie'
              });
            }
          }
        }
      });

      // Calculate streak and last 5 for each team
      Object.keys(teamStats).forEach(teamId => {
        const stats = teamStats[teamId];
        const history = stats.matchupHistory;

        // Sort by week descending (most recent first)
        history.sort((a, b) => b.week - a.week);

        // Calculate streak (from most recent game backwards)
        if (history.length > 0) {
          const mostRecent = history[0];
          let streakCount = 1;

          for (let i = 1; i < history.length; i++) {
            if (history[i].result === mostRecent.result) {
              streakCount++;
            } else {
              break;
            }
          }

          const streakLabel = mostRecent.result === 'win' ? 'W' : mostRecent.result === 'loss' ? 'L' : 'T';
          stats.streak = `${streakLabel}${streakCount}`;
        }

        // Calculate last 5 games
        const last5Games = history.slice(0, 5);
        stats.last5 = {
          wins: last5Games.filter(g => g.result === 'win').length,
          losses: last5Games.filter(g => g.result === 'loss').length,
          ties: last5Games.filter(g => g.result === 'tie').length,
        };

        // Remove matchupHistory from final result (it was just for calculation)
        delete (stats as Partial<TeamStatsWithHistory>).matchupHistory;
      });
    } catch (error) {
      logger.error('[StandingsService] Exception calculating team standings:', error);
      // Return empty stats on error
    }

    // Remove matchupHistory from all teams before caching/returning
    Object.keys(teamStats).forEach(teamId => {
      delete (teamStats[teamId] as any).matchupHistory;
    });

    // Cache the result for 60 seconds
    standingsCache.set(cacheKey, { data: teamStats, timestamp: now });

    return teamStats;
  },

  /**
   * Calculate standings for non-matchup formats (Roto, Total Points, PPG).
   * Instead of querying matchups (which don't exist for these formats),
   * sums cumulative fantasy points from daily_scores or draft_picks + player stats.
   *
   * @returns Map of teamId -> { pointsFor, gamesPlayed }
   */
  async calculateSeasonPointsStandings(
    leagueId: string,
    teams: Team[],
    draftPicks: Array<{ team_id: string; player_id: string }>,
    allPlayers: Array<{ id: string; points: number }>
  ): Promise<Record<string, {
    pointsFor: number;
    pointsAgainst: number;
    wins: number;
    losses: number;
    ties: number;
    streak: string;
    last5: { wins: number; losses: number; ties: number };
    gamesPlayed: number;
  }>> {
    const result: Record<string, {
      pointsFor: number;
      pointsAgainst: number;
      wins: number;
      losses: number;
      ties: number;
      streak: string;
      last5: { wins: number; losses: number; ties: number };
      gamesPlayed: number;
    }> = {};

    // Initialize all teams
    teams.forEach(team => {
      result[team.id] = {
        pointsFor: 0,
        pointsAgainst: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        streak: '-',
        last5: { wins: 0, losses: 0, ties: 0 },
        gamesPlayed: 0,
      };
    });

    try {
      // Build a map of playerId -> total season points
      const playerPointsMap = new Map<string, number>();
      allPlayers.forEach(p => playerPointsMap.set(p.id, p.points || 0));

      // CRITICAL FIX: Use roster_assignments (source of truth) instead of draftPicks parameter.
      // draftPicks misses players acquired via waivers/trades, causing incorrect standings.
      const { data: rosterAssignments, error: rosterError } = await supabase
        .from('roster_assignments')
        .select('player_id, team_id')
        .eq('league_id', leagueId);

      const rosterData = rosterError ? draftPicks : (rosterAssignments || []).map((r: { player_id: string; team_id: string }) => ({
        team_id: r.team_id,
        player_id: String(r.player_id)
      }));

      // Sum points for each team based on their current roster
      rosterData.forEach((pick: { team_id: string; player_id: string }) => {
        if (result[pick.team_id]) {
          const pts = playerPointsMap.get(pick.player_id) || 0;
          result[pick.team_id].pointsFor += pts;
        }
      });

      // Try to get actual daily scores for more accurate game counts
      const { data: dailyScores } = await supabase
        .from('daily_scores')
        .select('team_id, score_date')
        .eq('league_id', leagueId);

      if (dailyScores && dailyScores.length > 0) {
        // Count unique game dates per team
        const teamGameDates = new Map<string, Set<string>>();
        dailyScores.forEach((ds: any) => {
          if (!teamGameDates.has(ds.team_id)) {
            teamGameDates.set(ds.team_id, new Set());
          }
          teamGameDates.get(ds.team_id)!.add(ds.score_date);
        });
        teamGameDates.forEach((dates, teamId) => {
          if (result[teamId]) {
            result[teamId].gamesPlayed = dates.size;
          }
        });
      } else {
        // Fallback: estimate games played from weeks elapsed
        const { data: matchupData } = await supabase
          .from('matchups')
          .select('week_number')
          .eq('league_id', leagueId)
          .lt('week_end_date', getTodayMST());

        if (matchupData && matchupData.length > 0) {
          const maxWeek = Math.max(...matchupData.map((m: any) => m.week_number));
          teams.forEach(team => {
            if (result[team.id]) {
              result[team.id].gamesPlayed = maxWeek;
            }
          });
        }
      }
    } catch (error) {
      logger.error('[StandingsService] Exception calculating season points standings:', error);
    }

    return result;
  },

  /**
   * Calculate H2H Categories standings from completed matchups.
   * Instead of comparing total points, each stat category is a separate W/L/T.
   * Returns the same structure as calculateTeamStandings so Standings page can
   * consume it uniformly, plus an extra categoryRecord per team.
   */
  async calculateCategoryStandings(
    leagueId: string,
    teams: Team[],
    categories: string[],
    categoryMeta: Record<string, { higherIsBetter: boolean }>
  ): Promise<Record<string, {
    pointsFor: number;
    pointsAgainst: number;
    wins: number;
    losses: number;
    ties: number;
    streak: string;
    last5: { wins: number; losses: number; ties: number };
    categoryRecord: Record<string, { wins: number; losses: number; ties: number }>;
  }>> {
    type CatStandingsEntry = {
      pointsFor: number;
      pointsAgainst: number;
      wins: number;
      losses: number;
      ties: number;
      streak: string;
      last5: { wins: number; losses: number; ties: number };
      categoryRecord: Record<string, { wins: number; losses: number; ties: number }>;
      matchupHistory: Array<{ week: number; result: 'win' | 'loss' | 'tie' }>;
    };

    const result: Record<string, CatStandingsEntry> = {};
    teams.forEach(t => {
      const catRec: Record<string, { wins: number; losses: number; ties: number }> = {};
      categories.forEach(c => { catRec[c] = { wins: 0, losses: 0, ties: 0 }; });
      result[t.id] = {
        pointsFor: 0, pointsAgainst: 0,
        wins: 0, losses: 0, ties: 0,
        streak: '-',
        last5: { wins: 0, losses: 0, ties: 0 },
        categoryRecord: catRec,
        matchupHistory: [],
      };
    });

    try {
      const todayStr = getTodayMST();

      // Fetch matchups via API
      const { matchupApi } = await import('@/api/matchups');
      const matchupsResult = await matchupApi.getLeagueMatchups(leagueId);
      const allMatchupData = (matchupsResult.data ?? []) as Array<{ id: string; team1_id: string; team2_id: string | null; team1_score: number | null; team2_score: number | null; week_number: number; status: string; week_end_date: string }>;

      type MatchupRow = { id: string; team1_id: string; team2_id: string | null; team1_score: number | null; team2_score: number | null; week_number: number; status: string; week_end_date: string };
      const matchupMap = new Map<string, MatchupRow>();
      allMatchupData.filter(m => m.status === 'completed' || m.week_end_date < todayStr).forEach(m => { if (m.id) matchupMap.set(m.id, m); });
      const matchups = Array.from(matchupMap.values()).sort((a, b) => a.week_number - b.week_number);

      // Import category comparison function from scoringUtils
      const { compareCategoryMatchup } = await import('@/utils/scoringUtils');

      // For each matchup, compute per-category W/L/T using roster-based stats.
      // Fetch all roster assignments and player stats for per-category comparisons.
      const { rosterApi } = await import('@/api/rosters');
      const assignmentsResult = await rosterApi.getLeagueRosters(leagueId);
      const allAssignments = (assignmentsResult.data ?? []) as Array<{ team_id: string; player_id: string }>;

      const playerIds = [...new Set((allAssignments || []).map(a => Number(a.player_id)))];

      // Build per-team season totals per category from player_directory stats
      const { data: playerStats } = playerIds.length > 0
        ? await supabase
            .from('player_directory')
            .select('player_id, goals, assists, points, plus_minus, shots_on_goal, hits, blocks, pim, power_play_points, short_handed_points, position_code, wins, saves, shutouts, goals_against, save_pct')
            .in('player_id', playerIds)
            .eq('season', CURRENT_SEASON)
        : { data: [] };

      // Map player stats by ID
      type PlayerStatRow = Record<string, number | string | null> & { player_id: number; position_code: string | null };
      const playerStatsMap = new Map<string, PlayerStatRow>();
      (playerStats || []).forEach((p) => playerStatsMap.set(String(p.player_id), p as PlayerStatRow));

      // Build per-team category totals
      const teamCategoryTotals: Record<string, Record<string, number>> = {};
      teams.forEach(t => {
        teamCategoryTotals[t.id] = {};
        categories.forEach(c => { teamCategoryTotals[t.id][c] = 0; });
      });

      // Map category IDs to player_directory column names
      const catColumnMap: Record<string, string> = {
        goals: 'goals', assists: 'assists', points: 'points',
        plus_minus: 'plus_minus', ppp: 'power_play_points', shp: 'short_handed_points',
        sog: 'shots_on_goal', hits: 'hits', blocks: 'blocks', pim: 'pim',
        wins: 'wins', saves: 'saves', shutouts: 'shutouts', gaa: 'goals_against',
        save_pct: 'save_pct',
      };

      // Fetch league settings for minGoalieGames
      const { data: leagueRow } = await supabase
        .from('leagues')
        .select('settings')
        .eq('id', leagueId)
        .single();
      const minGoalieGames = (leagueRow?.settings as LeagueSettings)?.minGoalieGames ?? 0;

      // Goalie stat categories (affected by minimum appearances)
      const goalieCategories = new Set(['wins', 'saves', 'shutouts', 'gaa', 'save_pct']);

      (allAssignments || []).forEach(a => {
        const stats = playerStatsMap.get(String(a.player_id));
        if (!stats || !teamCategoryTotals[a.team_id]) return;

        // Check if player is a goalie below minimum appearances
        const isGoalie = stats.position_code === 'G';
        const goalieGames = isGoalie ? (stats.wins ?? 0) + (stats.saves ? 1 : 0) : 0;
        const belowMinGoalieGames = isGoalie && minGoalieGames > 0 && goalieGames < minGoalieGames;

        categories.forEach(cat => {
          // Skip goalie stat categories if below minimum appearances (industry standard)
          if (belowMinGoalieGames && goalieCategories.has(cat)) return;

          const col = catColumnMap[cat] || cat;
          teamCategoryTotals[a.team_id][cat] += (stats[col] ?? 0);
        });
      });

      for (const matchup of matchups) {
        if (!matchup.team2_id) continue; // skip byes

        const t1 = matchup.team1_id;
        const t2 = matchup.team2_id;
        const s1 = parseFloat(String(matchup.team1_score)) || 0;
        const s2 = parseFloat(String(matchup.team2_score)) || 0;

        if (result[t1]) result[t1].pointsFor += s1;
        if (result[t1]) result[t1].pointsAgainst += s2;
        if (result[t2]) result[t2].pointsFor += s2;
        if (result[t2]) result[t2].pointsAgainst += s1;

        // Compare per-category stats using real data
        const t1Stats = teamCategoryTotals[t1] || {};
        const t2Stats = teamCategoryTotals[t2] || {};
        const catResult = compareCategoryMatchup(t1Stats, t2Stats, categories, categoryMeta);

        // Record per-category W/L/T for each team
        if (result[t1]) {
          result[t1].wins += catResult.team1Wins;
          result[t1].losses += catResult.team2Wins;
          result[t1].ties += catResult.ties;
          // Per-category detail
          categories.forEach(cat => {
            const detail = catResult.details[cat];
            if (detail === 'team1') result[t1].categoryRecord[cat].wins++;
            else if (detail === 'team2') result[t1].categoryRecord[cat].losses++;
            else result[t1].categoryRecord[cat].ties++;
          });
          const overallResult = catResult.team1Wins > catResult.team2Wins ? 'win' : catResult.team2Wins > catResult.team1Wins ? 'loss' : 'tie';
          result[t1].matchupHistory.push({ week: matchup.week_number, result: overallResult });
        }
        if (result[t2]) {
          result[t2].wins += catResult.team2Wins;
          result[t2].losses += catResult.team1Wins;
          result[t2].ties += catResult.ties;
          categories.forEach(cat => {
            const detail = catResult.details[cat];
            if (detail === 'team2') result[t2].categoryRecord[cat].wins++;
            else if (detail === 'team1') result[t2].categoryRecord[cat].losses++;
            else result[t2].categoryRecord[cat].ties++;
          });
          const overallResult = catResult.team2Wins > catResult.team1Wins ? 'win' : catResult.team1Wins > catResult.team2Wins ? 'loss' : 'tie';
          result[t2].matchupHistory.push({ week: matchup.week_number, result: overallResult });
        }
      }

      // Calculate streaks and last5
      Object.keys(result).forEach(teamId => {
        const stats = result[teamId];
        const history = stats.matchupHistory.sort((a, b) => b.week - a.week);

        if (history.length > 0) {
          const mostRecent = history[0];
          let streakCount = 1;
          for (let i = 1; i < history.length; i++) {
            if (history[i].result === mostRecent.result) streakCount++;
            else break;
          }
          const label = mostRecent.result === 'win' ? 'W' : mostRecent.result === 'loss' ? 'L' : 'T';
          stats.streak = `${label}${streakCount}`;
        }

        const last5Games = history.slice(0, 5);
        stats.last5 = {
          wins: last5Games.filter(g => g.result === 'win').length,
          losses: last5Games.filter(g => g.result === 'loss').length,
          ties: last5Games.filter(g => g.result === 'tie').length,
        };

      });
    } catch (err) {
      logger.error('[StandingsService] calculateCategoryStandings error:', err);
    }

    // Strip matchupHistory (internal-only) before returning
    const cleaned: Record<string, Omit<CatStandingsEntry, 'matchupHistory'>> = {};
    Object.entries(result).forEach(([teamId, { matchupHistory: _, ...rest }]) => {
      cleaned[teamId] = rest;
    });
    return cleaned;
  },

  /**
   * Calculate Rotisserie standings. Each team earns ranking points per
   * category across the entire season. Sum of ranks = roto score.
   * This wraps calculateRotoStandings from scoringUtils with real DB data.
   */
  async calculateRotoStandingsFromDB(
    leagueId: string,
    teams: Team[],
    draftPicks: Array<{ team_id: string; player_id: string }>,
    allPlayers: Array<{ id: string; points: number }>,
    categories: string[],
    categoryMeta: Record<string, { higherIsBetter: boolean }>
  ): Promise<Record<string, {
    pointsFor: number;
    pointsAgainst: number;
    wins: number;
    losses: number;
    ties: number;
    streak: string;
    last5: { wins: number; losses: number; ties: number };
    gamesPlayed: number;
    rotoPoints: number;
    categoryRanks: Record<string, number>;
  }>> {
    const result: Record<string, {
      pointsFor: number; pointsAgainst: number;
      wins: number; losses: number; ties: number;
      streak: string; last5: { wins: number; losses: number; ties: number };
      gamesPlayed: number;
      rotoPoints: number;
      categoryRanks: Record<string, number>;
    }> = {};

    teams.forEach(t => {
      result[t.id] = {
        pointsFor: 0, pointsAgainst: 0,
        wins: 0, losses: 0, ties: 0,
        streak: '-', last5: { wins: 0, losses: 0, ties: 0 },
        gamesPlayed: 0,
        rotoPoints: 0,
        categoryRanks: {},
      };
    });

    try {
      // Build player points map
      const playerPointsMap = new Map<string, number>();
      allPlayers.forEach(p => playerPointsMap.set(p.id, p.points || 0));

      // Sum total points per team (used as "pointsFor" display)
      draftPicks.forEach(pick => {
        if (result[pick.team_id]) {
          result[pick.team_id].pointsFor += playerPointsMap.get(pick.player_id) || 0;
        }
      });

      // Build per-team, per-category season totals from roster data
      const { calculateRotoStandings: calcRoto } = await import('@/utils/scoringUtils');

      // Fetch all roster assignments to build per-team category stats
      const { data: rotoAssignments } = await supabase
        .from('roster_assignments')
        .select('team_id, player_id')
        .eq('league_id', leagueId);

      const rotoPlayerIds = [...new Set((rotoAssignments || []).map(a => Number(a.player_id)))];

      // Map category IDs to player_directory column names
      const catColumnMap: Record<string, string> = {
        goals: 'goals', assists: 'assists', points: 'points',
        plus_minus: 'plus_minus', ppp: 'power_play_points', shp: 'short_handed_points',
        sog: 'shots_on_goal', hits: 'hits', blocks: 'blocks', pim: 'pim',
        wins: 'wins', saves: 'saves', shutouts: 'shutouts', gaa: 'goals_against',
        save_pct: 'save_pct',
      };

      const { data: rotoPlayerStats } = rotoPlayerIds.length > 0
        ? await supabase
            .from('player_directory')
            .select('player_id, goals, assists, points, plus_minus, shots_on_goal, hits, blocks, pim, power_play_points, short_handed_points, position_code, wins, saves, shutouts, goals_against, save_pct')
            .in('player_id', rotoPlayerIds)
            .eq('season', CURRENT_SEASON)
        : { data: [] };

      type RotoPlayerRow = Record<string, number | string | null> & { player_id: number; position_code: string | null };
      const rotoPlayerMap = new Map<string, RotoPlayerRow>();
      (rotoPlayerStats || []).forEach((p) => rotoPlayerMap.set(String(p.player_id), p as RotoPlayerRow));

      // Fetch league settings for minGoalieGames
      const { data: rotoLeagueRow } = await supabase
        .from('leagues')
        .select('settings')
        .eq('id', leagueId)
        .single();
      const rotoMinGoalieGames = (rotoLeagueRow?.settings as LeagueSettings)?.minGoalieGames ?? 0;

      // Goalie stat categories (affected by minimum appearances)
      const rotoGoalieCategories = new Set(['wins', 'saves', 'shutouts', 'gaa', 'save_pct']);

      // Build team category stats
      const teamStats: Record<string, Partial<Record<string, number>>> = {};
      teams.forEach(t => {
        teamStats[t.id] = {};
        categories.forEach(cat => { teamStats[t.id][cat] = 0; });
      });

      (rotoAssignments || []).forEach(a => {
        const stats = rotoPlayerMap.get(String(a.player_id));
        if (!stats || !teamStats[a.team_id]) return;

        // Check if goalie below minimum appearances (industry standard)
        const isGoalie = stats.position_code === 'G';
        const goalieGames = isGoalie ? (stats.wins ?? 0) + (stats.saves ? 1 : 0) : 0;
        const belowMinGoalie = isGoalie && rotoMinGoalieGames > 0 && goalieGames < rotoMinGoalieGames;

        categories.forEach(cat => {
          if (belowMinGoalie && rotoGoalieCategories.has(cat)) return;
          const col = catColumnMap[cat] || cat;
          teamStats[a.team_id][cat] = (teamStats[a.team_id][cat] || 0) + (Number(stats[col]) || 0);
        });
      });

      // Use all configured categories (not the broken empty slice)
      const roto = calcRoto(teamStats as Record<string, Partial<CategoryStats>>, categories, categoryMeta);

      // Merge roto results
      Object.entries(roto).forEach(([teamId, rotoResult]) => {
        if (result[teamId]) {
          result[teamId].rotoPoints = rotoResult.rotoPoints;
          result[teamId].categoryRanks = rotoResult.categoryRanks;
          // For Roto standings, pointsFor = rotoPoints for sorting
          result[teamId].pointsFor = rotoResult.rotoPoints;
        }
      });
    } catch (err) {
      logger.error('[StandingsService] calculateRotoStandingsFromDB error:', err);
    }

    return result;
  },
};

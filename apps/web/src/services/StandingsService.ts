/**
 * StandingsService — Extracted from LeagueService.ts
 *
 * Contains all standings calculation methods:
 * - calculateTeamStandings (H2H Points)
 * - calculateSeasonPointsStandings (Roto, Total Points, PPG)
 * - calculateCategoryStandings (H2H Categories)
 * - calculateRotoStandingsFromDB (Rotisserie)
 *
 * Uses API server (3-tier architecture) instead of direct Supabase calls.
 */

import { logger } from "@/utils/logger";
import type { CategoryStats } from "@/utils/scoringUtils";
import { getTodayMST } from "@/utils/timezoneUtils";
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
    ties: number;
    streak: string;
    last5: { wins: number; losses: number; ties: number };
  }>;
  timestamp: number;
}>();

export const StandingsService = {
  /**
   * Calculate team standings stats from completed matchup results.
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
    // Check cache first (60 second TTL)
    const cacheKey = leagueId;
    const cached = standingsCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < 60000) {
      return cached.data;
    }

    type TeamStatsWithHistory = {
      pointsFor: number;
      pointsAgainst: number;
      wins: number;
      losses: number;
      ties: number;
      streak: string;
      last5: { wins: number; losses: number; ties: number };
      matchupHistory: Array<{ week: number; result: 'win' | 'loss' | 'tie' }>;
    };
    const teamStats: Record<string, TeamStatsWithHistory> = {};

    teams.forEach(team => {
      teamStats[team.id] = {
        pointsFor: 0, pointsAgainst: 0,
        wins: 0, losses: 0, ties: 0,
        streak: '-',
        last5: { wins: 0, losses: 0, ties: 0 },
        matchupHistory: []
      };
    });

    try {
      const todayStr = getTodayMST();

      // Fetch all matchups via API
      const { matchupApi } = await import('@/api/matchups');
      const matchupsResult = await matchupApi.getLeagueMatchups(leagueId);
      const allMatchupData = (matchupsResult.data ?? []) as Array<{
        id: string; team1_id: string; team2_id: string | null;
        team1_score: number | null; team2_score: number | null;
        week_number: number; status: string; week_end_date: string;
      }>;

      // Filter to completed or past matchups, deduplicate
      const matchupMap = new Map<string, typeof allMatchupData[0]>();
      allMatchupData
        .filter(m => m.status === 'completed' || m.week_end_date < todayStr)
        .forEach(m => { if (m.id) matchupMap.set(m.id, m); });
      const matchups = Array.from(matchupMap.values()).sort((a, b) => a.week_number - b.week_number);

      if (!matchups || matchups.length === 0) {
        return teamStats;
      }

      matchups.forEach(matchup => {
        const team1Score = parseFloat(String(matchup.team1_score)) || 0;
        const team2Score = matchup.team2_id ? (parseFloat(String(matchup.team2_score)) || 0) : 0;

        if (!matchup.team2_id) {
          if (teamStats[matchup.team1_id]) {
            teamStats[matchup.team1_id].wins++;
            teamStats[matchup.team1_id].pointsFor += team1Score;
            teamStats[matchup.team1_id].matchupHistory.push({ week: matchup.week_number, result: 'win' });
          }
        } else {
          if (teamStats[matchup.team1_id]) {
            teamStats[matchup.team1_id].pointsFor += team1Score;
            teamStats[matchup.team1_id].pointsAgainst += team2Score;
          }
          if (teamStats[matchup.team2_id]) {
            teamStats[matchup.team2_id].pointsFor += team2Score;
            teamStats[matchup.team2_id].pointsAgainst += team1Score;
          }

          const team1Won = team1Score > team2Score;
          const team2Won = team2Score > team1Score;
          const isTie = team1Score === team2Score;

          if (team1Won) {
            if (teamStats[matchup.team1_id]) {
              teamStats[matchup.team1_id].wins++;
              teamStats[matchup.team1_id].matchupHistory.push({ week: matchup.week_number, result: 'win' });
            }
            if (teamStats[matchup.team2_id]) {
              teamStats[matchup.team2_id].losses++;
              teamStats[matchup.team2_id].matchupHistory.push({ week: matchup.week_number, result: 'loss' });
            }
          } else if (team2Won) {
            if (teamStats[matchup.team2_id]) {
              teamStats[matchup.team2_id].wins++;
              teamStats[matchup.team2_id].matchupHistory.push({ week: matchup.week_number, result: 'win' });
            }
            if (teamStats[matchup.team1_id]) {
              teamStats[matchup.team1_id].losses++;
              teamStats[matchup.team1_id].matchupHistory.push({ week: matchup.week_number, result: 'loss' });
            }
          } else if (isTie) {
            if (teamStats[matchup.team1_id]) {
              teamStats[matchup.team1_id].ties++;
              teamStats[matchup.team1_id].matchupHistory.push({ week: matchup.week_number, result: 'tie' });
            }
            if (teamStats[matchup.team2_id]) {
              teamStats[matchup.team2_id].ties++;
              teamStats[matchup.team2_id].matchupHistory.push({ week: matchup.week_number, result: 'tie' });
            }
          }
        }
      });

      // Calculate streak and last 5 for each team
      Object.keys(teamStats).forEach(teamId => {
        const stats = teamStats[teamId];
        const history = stats.matchupHistory;
        history.sort((a, b) => b.week - a.week);

        if (history.length > 0) {
          const mostRecent = history[0];
          let streakCount = 1;
          for (let i = 1; i < history.length; i++) {
            if (history[i].result === mostRecent.result) streakCount++;
            else break;
          }
          const streakLabel = mostRecent.result === 'win' ? 'W' : mostRecent.result === 'loss' ? 'L' : 'T';
          stats.streak = `${streakLabel}${streakCount}`;
        }

        const last5Games = history.slice(0, 5);
        stats.last5 = {
          wins: last5Games.filter(g => g.result === 'win').length,
          losses: last5Games.filter(g => g.result === 'loss').length,
          ties: last5Games.filter(g => g.result === 'tie').length,
        };

        delete (stats as Partial<TeamStatsWithHistory>).matchupHistory;
      });
    } catch (error) {
      logger.error('[StandingsService] Exception calculating team standings:', error);
    }

    Object.keys(teamStats).forEach(teamId => {
      delete (teamStats[teamId] as any).matchupHistory;
    });

    standingsCache.set(cacheKey, { data: teamStats, timestamp: now });
    return teamStats;
  },

  /**
   * Calculate standings for non-matchup formats (Roto, Total Points, PPG).
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
      pointsFor: number; pointsAgainst: number;
      wins: number; losses: number; ties: number;
      streak: string; last5: { wins: number; losses: number; ties: number };
      gamesPlayed: number;
    }> = {};

    teams.forEach(team => {
      result[team.id] = {
        pointsFor: 0, pointsAgainst: 0,
        wins: 0, losses: 0, ties: 0,
        streak: '-', last5: { wins: 0, losses: 0, ties: 0 },
        gamesPlayed: 0,
      };
    });

    try {
      const playerPointsMap = new Map<string, number>();
      allPlayers.forEach(p => playerPointsMap.set(p.id, p.points || 0));

      // Use roster API for current roster assignments
      const { rosterApi } = await import('@/api/rosters');
      const assignmentsResult = await rosterApi.getLeagueRosters(leagueId);
      const assignments = (assignmentsResult.data ?? []) as Array<{ team_id: string; player_id: string }>;

      const rosterData = assignments.length > 0
        ? assignments.map(r => ({ team_id: r.team_id, player_id: String(r.player_id) }))
        : draftPicks;

      rosterData.forEach((pick: { team_id: string; player_id: string }) => {
        if (result[pick.team_id]) {
          const pts = playerPointsMap.get(pick.player_id) || 0;
          result[pick.team_id].pointsFor += pts;
        }
      });

      // Estimate games played from past matchup weeks
      const { matchupApi } = await import('@/api/matchups');
      const matchupsResult = await matchupApi.getLeagueMatchups(leagueId);
      const allMatchupData = (matchupsResult.data ?? []) as Array<{ week_number: number; week_end_date: string }>;
      const pastMatchups = allMatchupData.filter(m => m.week_end_date < getTodayMST());

      if (pastMatchups.length > 0) {
        const maxWeek = Math.max(...pastMatchups.map(m => m.week_number));
        teams.forEach(team => {
          if (result[team.id]) {
            result[team.id].gamesPlayed = maxWeek;
          }
        });
      }
    } catch (error) {
      logger.error('[StandingsService] Exception calculating season points standings:', error);
    }

    return result;
  },

  /**
   * Calculate H2H Categories standings from completed matchups.
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
      pointsFor: number; pointsAgainst: number;
      wins: number; losses: number; ties: number;
      streak: string; last5: { wins: number; losses: number; ties: number };
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
        streak: '-', last5: { wins: 0, losses: 0, ties: 0 },
        categoryRecord: catRec,
        matchupHistory: [],
      };
    });

    try {
      const todayStr = getTodayMST();

      // Fetch matchups via API
      const { matchupApi } = await import('@/api/matchups');
      const matchupsResult = await matchupApi.getLeagueMatchups(leagueId);
      const allMatchupData = (matchupsResult.data ?? []) as Array<{
        id: string; team1_id: string; team2_id: string | null;
        team1_score: number | null; team2_score: number | null;
        week_number: number; status: string; week_end_date: string;
      }>;

      type MatchupRow = typeof allMatchupData[0];
      const matchupMap = new Map<string, MatchupRow>();
      allMatchupData.filter(m => m.status === 'completed' || m.week_end_date < todayStr).forEach(m => { if (m.id) matchupMap.set(m.id, m); });
      const matchups = Array.from(matchupMap.values()).sort((a, b) => a.week_number - b.week_number);

      const { compareCategoryMatchup } = await import('@/utils/scoringUtils');

      // Fetch roster assignments via API
      const { rosterApi } = await import('@/api/rosters');
      const assignmentsResult = await rosterApi.getLeagueRosters(leagueId);
      const allAssignments = (assignmentsResult.data ?? []) as Array<{ team_id: string; player_id: string }>;

      // Fetch player stats via PlayerService (API server)
      const playerIds = [...new Set(allAssignments.map(a => String(a.player_id)))];
      const { PlayerService } = await import('@/services/PlayerService');
      const players = playerIds.length > 0 ? await PlayerService.getPlayersByIds(playerIds) : [];

      // Build player stats map using NormalizedPlayer field names
      type PlayerStatEntry = Record<string, number | string | null> & { position: string };
      const playerStatsMap = new Map<string, PlayerStatEntry>();
      players.forEach(p => {
        playerStatsMap.set(p.id, {
          position: p.position,
          goals: p.goals || 0,
          assists: p.assists || 0,
          points: p.points || 0,
          plus_minus: p.plus_minus || 0,
          shots_on_goal: p.shots || 0,
          hits: p.hits || 0,
          blocks: p.blocks || 0,
          pim: p.pim || 0,
          power_play_points: p.ppp || 0,
          short_handed_points: p.shp || 0,
          wins: p.wins || 0,
          saves: p.saves || 0,
          shutouts: p.shutouts || 0,
          goals_against: p.goals_against || 0,
          save_pct: p.save_percentage,
        } as PlayerStatEntry);
      });

      // Build per-team category totals
      const teamCategoryTotals: Record<string, Record<string, number>> = {};
      teams.forEach(t => {
        teamCategoryTotals[t.id] = {};
        categories.forEach(c => { teamCategoryTotals[t.id][c] = 0; });
      });

      const catColumnMap: Record<string, string> = {
        goals: 'goals', assists: 'assists', points: 'points',
        plus_minus: 'plus_minus', ppp: 'power_play_points', shp: 'short_handed_points',
        sog: 'shots_on_goal', hits: 'hits', blocks: 'blocks', pim: 'pim',
        wins: 'wins', saves: 'saves', shutouts: 'shutouts', gaa: 'goals_against',
        save_pct: 'save_pct',
      };

      // Fetch league settings for minGoalieGames via API
      const { leagueApi } = await import('@/api/leagues');
      const leagueResult = await leagueApi.getLeague(leagueId);
      const leagueRow = leagueResult.data as { settings?: LeagueSettings } | null;
      const minGoalieGames = leagueRow?.settings?.minGoalieGames ?? 0;

      const goalieCategories = new Set(['wins', 'saves', 'shutouts', 'gaa', 'save_pct']);

      allAssignments.forEach(a => {
        const stats = playerStatsMap.get(String(a.player_id));
        if (!stats || !teamCategoryTotals[a.team_id]) return;

        const isGoalie = stats.position === 'G';
        const goalieGames = isGoalie ? Number(stats.wins ?? 0) + (stats.saves ? 1 : 0) : 0;
        const belowMinGoalieGames = isGoalie && minGoalieGames > 0 && goalieGames < minGoalieGames;

        categories.forEach(cat => {
          if (belowMinGoalieGames && goalieCategories.has(cat)) return;
          const col = catColumnMap[cat] || cat;
          teamCategoryTotals[a.team_id][cat] += Number(stats[col] ?? 0);
        });
      });

      for (const matchup of matchups) {
        if (!matchup.team2_id) continue;

        const t1 = matchup.team1_id;
        const t2 = matchup.team2_id;
        const s1 = parseFloat(String(matchup.team1_score)) || 0;
        const s2 = parseFloat(String(matchup.team2_score)) || 0;

        if (result[t1]) result[t1].pointsFor += s1;
        if (result[t1]) result[t1].pointsAgainst += s2;
        if (result[t2]) result[t2].pointsFor += s2;
        if (result[t2]) result[t2].pointsAgainst += s1;

        const t1Stats = teamCategoryTotals[t1] || {};
        const t2Stats = teamCategoryTotals[t2] || {};
        const catResult = compareCategoryMatchup(t1Stats, t2Stats, categories, categoryMeta);

        if (result[t1]) {
          result[t1].wins += catResult.team1Wins;
          result[t1].losses += catResult.team2Wins;
          result[t1].ties += catResult.ties;
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

    const cleaned: Record<string, Omit<CatStandingsEntry, 'matchupHistory'>> = {};
    Object.entries(result).forEach(([teamId, { matchupHistory: _, ...rest }]) => {
      cleaned[teamId] = rest;
    });
    return cleaned;
  },

  /**
   * Calculate Rotisserie standings.
   */
  async calculateRotoStandingsFromDB(
    leagueId: string,
    teams: Team[],
    draftPicks: Array<{ team_id: string; player_id: string }>,
    allPlayers: Array<{ id: string; points: number }>,
    categories: string[],
    categoryMeta: Record<string, { higherIsBetter: boolean }>
  ): Promise<Record<string, {
    pointsFor: number; pointsAgainst: number;
    wins: number; losses: number; ties: number;
    streak: string; last5: { wins: number; losses: number; ties: number };
    gamesPlayed: number;
    rotoPoints: number;
    categoryRanks: Record<string, number>;
  }>> {
    const result: Record<string, {
      pointsFor: number; pointsAgainst: number;
      wins: number; losses: number; ties: number;
      streak: string; last5: { wins: number; losses: number; ties: number };
      gamesPlayed: number; rotoPoints: number; categoryRanks: Record<string, number>;
    }> = {};

    teams.forEach(t => {
      result[t.id] = {
        pointsFor: 0, pointsAgainst: 0,
        wins: 0, losses: 0, ties: 0,
        streak: '-', last5: { wins: 0, losses: 0, ties: 0 },
        gamesPlayed: 0, rotoPoints: 0, categoryRanks: {},
      };
    });

    try {
      const playerPointsMap = new Map<string, number>();
      allPlayers.forEach(p => playerPointsMap.set(p.id, p.points || 0));

      draftPicks.forEach(pick => {
        if (result[pick.team_id]) {
          result[pick.team_id].pointsFor += playerPointsMap.get(pick.player_id) || 0;
        }
      });

      const { calculateRotoStandings: calcRoto } = await import('@/utils/scoringUtils');

      // Fetch roster assignments via API
      const { rosterApi } = await import('@/api/rosters');
      const assignmentsResult = await rosterApi.getLeagueRosters(leagueId);
      const rotoAssignments = (assignmentsResult.data ?? []) as Array<{ team_id: string; player_id: string }>;

      // Fetch player stats via PlayerService (API server)
      const rotoPlayerIds = [...new Set(rotoAssignments.map(a => String(a.player_id)))];
      const { PlayerService } = await import('@/services/PlayerService');
      const players = rotoPlayerIds.length > 0 ? await PlayerService.getPlayersByIds(rotoPlayerIds) : [];

      // Build player stats map
      type RotoPlayerEntry = Record<string, number | string | null> & { position: string };
      const rotoPlayerMap = new Map<string, RotoPlayerEntry>();
      players.forEach(p => {
        rotoPlayerMap.set(p.id, {
          position: p.position,
          goals: p.goals || 0,
          assists: p.assists || 0,
          points: p.points || 0,
          plus_minus: p.plus_minus || 0,
          shots_on_goal: p.shots || 0,
          hits: p.hits || 0,
          blocks: p.blocks || 0,
          pim: p.pim || 0,
          power_play_points: p.ppp || 0,
          short_handed_points: p.shp || 0,
          wins: p.wins || 0,
          saves: p.saves || 0,
          shutouts: p.shutouts || 0,
          goals_against: p.goals_against || 0,
          save_pct: p.save_percentage,
        } as RotoPlayerEntry);
      });

      // Fetch league settings for minGoalieGames via API
      const { leagueApi } = await import('@/api/leagues');
      const leagueResult = await leagueApi.getLeague(leagueId);
      const leagueRow = leagueResult.data as { settings?: LeagueSettings } | null;
      const rotoMinGoalieGames = leagueRow?.settings?.minGoalieGames ?? 0;

      const catColumnMap: Record<string, string> = {
        goals: 'goals', assists: 'assists', points: 'points',
        plus_minus: 'plus_minus', ppp: 'power_play_points', shp: 'short_handed_points',
        sog: 'shots_on_goal', hits: 'hits', blocks: 'blocks', pim: 'pim',
        wins: 'wins', saves: 'saves', shutouts: 'shutouts', gaa: 'goals_against',
        save_pct: 'save_pct',
      };

      const rotoGoalieCategories = new Set(['wins', 'saves', 'shutouts', 'gaa', 'save_pct']);

      const teamStats: Record<string, Partial<Record<string, number>>> = {};
      teams.forEach(t => {
        teamStats[t.id] = {};
        categories.forEach(cat => { teamStats[t.id][cat] = 0; });
      });

      rotoAssignments.forEach(a => {
        const stats = rotoPlayerMap.get(String(a.player_id));
        if (!stats || !teamStats[a.team_id]) return;

        const isGoalie = stats.position === 'G';
        const goalieGames = isGoalie ? Number(stats.wins ?? 0) + (stats.saves ? 1 : 0) : 0;
        const belowMinGoalie = isGoalie && rotoMinGoalieGames > 0 && goalieGames < rotoMinGoalieGames;

        categories.forEach(cat => {
          if (belowMinGoalie && rotoGoalieCategories.has(cat)) return;
          const col = catColumnMap[cat] || cat;
          teamStats[a.team_id][cat] = (teamStats[a.team_id][cat] || 0) + (Number(stats[col]) || 0);
        });
      });

      const roto = calcRoto(teamStats as Record<string, Partial<CategoryStats>>, categories, categoryMeta);

      Object.entries(roto).forEach(([teamId, rotoResult]) => {
        if (result[teamId]) {
          result[teamId].rotoPoints = rotoResult.rotoPoints;
          result[teamId].categoryRanks = rotoResult.categoryRanks;
          result[teamId].pointsFor = rotoResult.rotoPoints;
        }
      });
    } catch (err) {
      logger.error('[StandingsService] calculateRotoStandingsFromDB error:', err);
    }

    return result;
  },
};

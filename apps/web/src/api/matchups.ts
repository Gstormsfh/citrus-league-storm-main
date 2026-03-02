/**
 * Matchup API client — replaces direct Supabase calls for matchup operations.
 */

import { apiClient } from './client';

export const matchupApi = {
  /** Get all matchups for a league (optionally filtered by week) */
  getLeagueMatchups(leagueId: string, week?: number) {
    const qs = week ? `?week=${week}` : '';
    return apiClient.get(`/api/matchups/league/${leagueId}${qs}`);
  },

  /** Get user's matchup for a specific week */
  getUserMatchup(leagueId: string, week: number) {
    return apiClient.get(`/api/matchups/league/${leagueId}/user?week=${week}`);
  },

  /** Get matchup history between teams */
  getMatchupHistory(leagueId: string, team1Id: string, team2Id?: string) {
    const query = new URLSearchParams({ team1: team1Id });
    if (team2Id) query.set('team2', team2Id);
    return apiClient.get(`/api/matchups/league/${leagueId}/history?${query}`);
  },

  /** Get playoff bracket for a league */
  getPlayoffBracket(leagueId: string) {
    return apiClient.get(`/api/matchups/league/${leagueId}/playoffs`);
  },

  /** Get a specific matchup with player lines */
  getMatchup(matchupId: string) {
    return apiClient.get(`/api/matchups/${matchupId}`);
  },

  /** Get matchup scores/lines */
  getMatchupScores(matchupId: string) {
    return apiClient.get(`/api/matchups/${matchupId}/scores`);
  },

  /** Get daily matchup scores */
  getDailyScores(matchupId: string) {
    return apiClient.get(`/api/matchups/${matchupId}/daily-scores`);
  },

  /** Update matchup scores */
  updateScores(leagueId?: string) {
    return apiClient.post('/api/matchups/update-scores', leagueId ? { leagueId } : {});
  },
};

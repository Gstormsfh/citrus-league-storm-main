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

  /** Get a specific matchup with player lines */
  getMatchup(matchupId: string) {
    return apiClient.get(`/api/matchups/${matchupId}`);
  },

  /** Get matchup scores/lines */
  getMatchupScores(matchupId: string) {
    return apiClient.get(`/api/matchups/${matchupId}/scores`);
  },
};

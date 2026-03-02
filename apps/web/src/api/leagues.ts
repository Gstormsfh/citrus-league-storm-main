/**
 * League API client — replaces direct Supabase calls for league operations.
 */

import { apiClient } from './client';

export const leagueApi = {
  /** Get all leagues for the authenticated user */
  getUserLeagues() {
    return apiClient.get('/api/leagues');
  },

  /** Get a specific league by ID */
  getLeague(leagueId: string) {
    return apiClient.get(`/api/leagues/${leagueId}`);
  },

  /** Create a new league */
  createLeague(params: {
    name: string;
    settings?: Record<string, unknown>;
    scoring_settings?: Record<string, unknown>;
    roster_size?: number;
    draft_rounds?: number;
  }) {
    return apiClient.post('/api/leagues', params);
  },

  /** Update league settings (commissioner only) */
  updateSettings(leagueId: string, params: {
    settings?: Record<string, unknown>;
    scoring_settings?: Record<string, unknown>;
  }) {
    return apiClient.put(`/api/leagues/${leagueId}/settings`, params);
  },

  /** Get all teams in a league */
  getTeams(leagueId: string) {
    return apiClient.get(`/api/leagues/${leagueId}/teams`);
  },

  /** Get league standings */
  getStandings(leagueId: string) {
    return apiClient.get(`/api/leagues/${leagueId}/standings`);
  },
};

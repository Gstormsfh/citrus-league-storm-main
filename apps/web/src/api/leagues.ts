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
    waiver_settings?: Record<string, unknown>;
    roster_size?: number;
    draft_rounds?: number;
  }) {
    return apiClient.post('/api/leagues', params);
  },

  /** Join a league by invite code */
  joinLeague(params: { joinCode: string; teamName?: string }) {
    return apiClient.post('/api/leagues/join', params);
  },

  /** Update league settings (commissioner only) */
  updateSettings(leagueId: string, params: {
    settings?: Record<string, unknown>;
    scoring_settings?: Record<string, unknown>;
  }) {
    return apiClient.put(`/api/leagues/${leagueId}/settings`, params);
  },

  /** Update waiver settings (commissioner only) */
  updateWaiverSettings(leagueId: string, settings: Record<string, unknown>) {
    return apiClient.put(`/api/leagues/${leagueId}/waiver-settings`, settings);
  },

  /** Update scoring settings (commissioner only) */
  updateScoringSettings(leagueId: string, settings: Record<string, unknown>) {
    return apiClient.put(`/api/leagues/${leagueId}/scoring-settings`, settings);
  },

  /** Update draft settings (commissioner only) */
  updateDraftSettings(leagueId: string, settings: Record<string, unknown>) {
    return apiClient.put(`/api/leagues/${leagueId}/draft-settings`, settings);
  },

  /** Update roster slot settings (commissioner only) */
  updateRosterSlots(leagueId: string, rosterSlots: Record<string, unknown>) {
    return apiClient.put(`/api/leagues/${leagueId}/roster-slots`, { rosterSlots });
  },

  /** Get all teams in a league */
  getTeams(leagueId: string, withOwners?: boolean) {
    const qs = withOwners ? '?withOwners=true' : '';
    return apiClient.get(`/api/leagues/${leagueId}/teams${qs}`);
  },

  /** Get league standings */
  getStandings(leagueId: string) {
    return apiClient.get(`/api/leagues/${leagueId}/standings`);
  },

  /** Get user's team in a league */
  getMyTeam(leagueId: string) {
    return apiClient.get(`/api/leagues/${leagueId}/my-team`);
  },

  /** Delete a team (commissioner only) */
  deleteTeam(leagueId: string, teamId: string) {
    return apiClient.delete(`/api/leagues/${leagueId}/teams/${teamId}`);
  },

  /** Get transaction history for a league */
  getTransactions(leagueId: string) {
    return apiClient.get(`/api/leagues/${leagueId}/transactions`);
  },
};

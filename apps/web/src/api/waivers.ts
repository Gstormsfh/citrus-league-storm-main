/**
 * Waiver API client — replaces direct Supabase calls for waiver operations.
 */

import { apiClient } from './client';

export const waiverApi = {
  /** Get waiver claims for a league */
  getLeagueWaivers(leagueId: string, status?: string) {
    const qs = status ? `?status=${status}` : '';
    return apiClient.get(`/api/waivers/league/${leagueId}${qs}`);
  },

  /** Get team-specific waiver claims */
  getTeamWaivers(leagueId: string, teamId: string) {
    return apiClient.get(`/api/waivers/league/${leagueId}/team/${teamId}`);
  },

  /** Get waiver priority for a league */
  getWaiverPriority(leagueId: string) {
    return apiClient.get(`/api/waivers/league/${leagueId}/priority`);
  },

  /** Get FAAB budgets for all teams */
  getFAABBudgets(leagueId: string) {
    return apiClient.get(`/api/waivers/league/${leagueId}/faab`);
  },

  /** Get waiver settings for a league */
  getWaiverSettings(leagueId: string) {
    return apiClient.get(`/api/waivers/league/${leagueId}/settings`);
  },

  /** Submit a waiver claim */
  submitClaim(leagueId: string, params: {
    teamId: string | number;
    playerId: string;
    dropPlayerId?: string | null;
  }) {
    return apiClient.post(`/api/waivers/league/${leagueId}`, params);
  },

  /** Submit a FAAB bid */
  submitFAABBid(leagueId: string, params: {
    teamId: string | number;
    playerId: string;
    bidAmount: number;
    dropPlayerId?: string | null;
    isConditionalDrop?: boolean;
  }) {
    return apiClient.post(`/api/waivers/league/${leagueId}/faab-bid`, params);
  },

  /** Add free agent instantly */
  addFreeAgent(leagueId: string, params: {
    teamId: string | number;
    playerId: string;
    dropPlayerId?: string | null;
  }) {
    return apiClient.post(`/api/waivers/league/${leagueId}/add-free-agent`, params);
  },

  /** Drop a player from roster */
  dropPlayer(leagueId: string, params: {
    teamId: string | number;
    playerId: string;
  }) {
    return apiClient.post(`/api/waivers/league/${leagueId}/drop-player`, params);
  },

  /** Cancel a waiver claim */
  cancelClaim(claimId: string) {
    return apiClient.delete(`/api/waivers/${claimId}`);
  },

  /** Initialize waiver priority for a team */
  initializePriority(leagueId: string, teamId: string) {
    return apiClient.post(`/api/waivers/league/${leagueId}/initialize-priority`, { teamId });
  },
};

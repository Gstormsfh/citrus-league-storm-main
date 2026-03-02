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

  /** Submit a waiver claim */
  submitClaim(leagueId: string, params: {
    teamId: string;
    playerId: string;
    dropPlayerId?: string;
    bidAmount?: number;
    isConditionalDrop?: boolean;
  }) {
    return apiClient.post(`/api/waivers/league/${leagueId}`, params);
  },

  /** Cancel a waiver claim */
  cancelClaim(claimId: string) {
    return apiClient.delete(`/api/waivers/${claimId}`);
  },
};

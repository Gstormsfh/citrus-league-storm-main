/**
 * Draft API client — replaces direct Supabase calls for draft operations.
 */

import { apiClient } from './client';

export const draftApi = {
  /** Get draft state for a league */
  getDraftState(leagueId: string) {
    return apiClient.get(`/api/draft/league/${leagueId}`);
  },

  /** Make a draft pick */
  makePick(leagueId: string, params: {
    playerId: string;
    teamId: string;
    pickNumber?: number;
    roundNumber?: number;
    draftSessionId?: string;
  }) {
    return apiClient.post(`/api/draft/league/${leagueId}/pick`, params);
  },

  /** Start the draft (commissioner only) */
  startDraft(leagueId: string) {
    return apiClient.post(`/api/draft/league/${leagueId}/start`);
  },
};

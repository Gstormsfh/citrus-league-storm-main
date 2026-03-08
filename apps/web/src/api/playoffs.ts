/**
 * Playoff API client — replaces direct Supabase calls for playoff bracket operations.
 */
import { apiClient } from './client';

export const playoffApi = {
  getBracket(leagueId: string) {
    return apiClient.get(`/api/playoffs/league/${leagueId}/bracket`);
  },
  generateBracket(leagueId: string, options?: { consolationEnabled?: boolean; twoWeekMatchups?: boolean; reseedEachRound?: boolean; seedingMethod?: string }) {
    return apiClient.post(`/api/playoffs/league/${leagueId}/generate`, options || {});
  },
  advanceRound(bracketId: string) {
    return apiClient.post(`/api/playoffs/bracket/${bracketId}/advance`);
  },
  resetBracket(leagueId: string) {
    return apiClient.post(`/api/playoffs/league/${leagueId}/reset`);
  },
  getPlayoffPicture(leagueId: string) {
    return apiClient.get(`/api/playoffs/league/${leagueId}/picture`);
  },
};

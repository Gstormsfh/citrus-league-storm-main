/**
 * Trade API client — replaces direct Supabase calls for trade operations.
 */

import { apiClient } from './client';

export const tradeApi = {
  /** Get all trades for a league */
  getLeagueTrades(leagueId: string, status?: string) {
    const qs = status ? `?status=${status}` : '';
    return apiClient.get(`/api/trades/league/${leagueId}${qs}`);
  },

  /** Create a trade offer */
  createTradeOffer(leagueId: string, params: {
    fromTeamId: string;
    toTeamId: string;
    offeredPlayerIds: string[];
    requestedPlayerIds: string[];
    message?: string;
  }) {
    return apiClient.post(`/api/trades/league/${leagueId}`, params);
  },

  /** Respond to a trade offer (accept, reject, or counter) */
  respondToTrade(tradeId: string, action: 'accept' | 'reject' | 'counter') {
    return apiClient.put(`/api/trades/${tradeId}/respond`, { action });
  },
};

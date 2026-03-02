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

  /** Get trade review settings for a league */
  getReviewSettings(leagueId: string) {
    return apiClient.get(`/api/trades/league/${leagueId}/review-settings`);
  },

  /** Create a trade offer */
  createTradeOffer(leagueId: string, params: {
    fromTeamId: string | number;
    toTeamId: string | number;
    offeredPlayerIds: string[];
    requestedPlayerIds: string[];
    message?: string;
  }) {
    return apiClient.post(`/api/trades/league/${leagueId}`, params);
  },

  /** Accept a trade offer */
  acceptTrade(tradeId: string) {
    return apiClient.put(`/api/trades/${tradeId}/accept`);
  },

  /** Reject a trade offer */
  rejectTrade(tradeId: string) {
    return apiClient.put(`/api/trades/${tradeId}/reject`);
  },

  /** Cancel a trade offer */
  cancelTrade(tradeId: string) {
    return apiClient.put(`/api/trades/${tradeId}/cancel`);
  },

  /** Respond to a trade offer (legacy) */
  respondToTrade(tradeId: string, action: 'accept' | 'reject' | 'counter') {
    return apiClient.put(`/api/trades/${tradeId}/respond`, { action });
  },

  /** Submit a trade vote */
  submitVote(tradeId: string, params: {
    voterTeamId: string | number;
    vote: 'approve' | 'veto';
  }) {
    return apiClient.post(`/api/trades/${tradeId}/vote`, params);
  },

  /** Get trade votes */
  getVotes(tradeId: string) {
    return apiClient.get(`/api/trades/${tradeId}/votes`);
  },

  /** Commissioner approve/veto a trade */
  commissionerDecision(tradeId: string, params: {
    leagueId: string;
    decision: 'approve' | 'veto';
  }) {
    return apiClient.put(`/api/trades/${tradeId}/commissioner-decision`, params);
  },
};

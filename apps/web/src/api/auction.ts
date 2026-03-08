/**
 * Auction API client — replaces direct Supabase calls for auction draft operations.
 */
import { apiClient } from './client';

export const auctionApi = {
  getAuctionState(leagueId: string, sessionId: string) {
    return apiClient.get(`/api/auction/league/${leagueId}/state/${sessionId}`);
  },
  initializeAuction(leagueId: string, params: { sessionId: string; teamIds: string[]; budget?: number; minBid?: number }) {
    return apiClient.post(`/api/auction/league/${leagueId}/initialize`, params);
  },
  nominatePlayer(leagueId: string, params: { sessionId: string; teamId: string; playerId: string; playerName: string; openingBid?: number; timerSeconds?: number }) {
    return apiClient.post(`/api/auction/league/${leagueId}/nominate`, params);
  },
  placeBid(leagueId: string, params: { nominationId: string; teamId: string; bidAmount: number }) {
    return apiClient.post(`/api/auction/league/${leagueId}/bid`, params);
  },
  closeNomination(leagueId: string, params: { sessionId: string; nominationId: string }) {
    return apiClient.post(`/api/auction/league/${leagueId}/close-nomination`, params);
  },
  getAuctionBudgets(leagueId: string) {
    return apiClient.get(`/api/auction/league/${leagueId}/budgets`);
  },
  getBidHistory(nominationId: string) {
    return apiClient.get(`/api/auction/bids/${nominationId}`);
  },
};

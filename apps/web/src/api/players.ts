/**
 * Player API client — replaces direct Supabase calls for player operations.
 */

import { apiClient } from './client';

export const playerApi = {
  /** Search/list players */
  searchPlayers(params?: {
    search?: string;
    position?: string;
    team?: string;
    limit?: number;
  }) {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.position) query.set('position', params.position);
    if (params?.team) query.set('team', params.team);
    if (params?.limit) query.set('limit', params.limit.toString());
    const qs = query.toString();
    return apiClient.get(`/api/players${qs ? `?${qs}` : ''}`);
  },

  /** Get trending players */
  getTrendingPlayers(days?: number) {
    const qs = days ? `?days=${days}` : '';
    return apiClient.get(`/api/players/trending${qs}`);
  },

  /** Get players by IDs (batch) */
  getPlayersByIds(ids: string[]) {
    return apiClient.get(`/api/players/by-ids?ids=${ids.join(',')}`);
  },

  /** Get a single player */
  getPlayer(playerId: string) {
    return apiClient.get(`/api/players/${playerId}`);
  },

  /** Get player season stats */
  getPlayerStats(playerId: string, season?: number) {
    const qs = season ? `?season=${season}` : '';
    return apiClient.get(`/api/players/${playerId}/stats${qs}`);
  },

  /** Get player projections — pass startDate to get all from that date onward */
  getPlayerProjections(playerId: string, startDate?: string) {
    const qs = startDate ? `?startDate=${startDate}` : '';
    return apiClient.get(`/api/players/${playerId}/projections${qs}`);
  },
};

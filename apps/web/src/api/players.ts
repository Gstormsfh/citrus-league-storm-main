/**
 * Player API client — replaces direct Supabase calls for player operations.
 *
 * Includes request deduplication and TTL caching to prevent redundant API calls.
 */

import { apiClient } from './client';
import { createApiCache, CACHE_TTL } from './cache';

const c = createApiCache();

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
    const key = `players:search:${qs}`;
    return c.cached(key, () => apiClient.get(`/api/players${qs ? `?${qs}` : ''}`), CACHE_TTL.MEDIUM);
  },

  /** Get trending players */
  getTrendingPlayers(daysBack?: number, limitCount?: number) {
    const params = new URLSearchParams();
    if (daysBack) params.set('days', String(daysBack));
    if (limitCount) params.set('limit', String(limitCount));
    const qs = params.toString();
    return c.cached(
      `players:trending:${qs}`,
      () => apiClient.get(`/api/players/trending${qs ? `?${qs}` : ''}`),
      CACHE_TTL.LONG,
    );
  },

  /** Record a player transaction (add/drop) for trending analytics */
  recordPlayerTransaction(params: {
    playerId: number;
    leagueId: string;
    teamId: string;
    transactionType: 'add' | 'drop';
    source: string;
    playerName: string;
    playerTeam: string;
    playerPosition: string;
  }) {
    c.invalidate('players:trending');
    return apiClient.post('/api/players/transaction', params);
  },

  /** Get players by IDs (batch) */
  getPlayersByIds(ids: string[]) {
    const sorted = [...ids].sort();
    return c.cached(
      `players:by-ids:${sorted.join(',')}`,
      () => apiClient.get(`/api/players/by-ids?ids=${ids.join(',')}`),
      CACHE_TTL.LONG,
    );
  },

  /** Get rest-of-season projections (top unrostered) */
  getRosProjections(limit?: number) {
    const qs = limit ? `?limit=${limit}` : '';
    return c.cached(
      `players:ros-projections:${limit ?? 'default'}`,
      () => apiClient.get(`/api/players/ros-projections${qs}`),
      CACHE_TTL.LONG,
    );
  },

  /** Get a single player */
  getPlayer(playerId: string) {
    return c.cached(
      `players:${playerId}`,
      () => apiClient.get(`/api/players/${playerId}`),
      CACHE_TTL.LONG,
    );
  },

  /** Get player season stats */
  getPlayerStats(playerId: string, season?: number) {
    const qs = season ? `?season=${season}` : '';
    return c.cached(
      `players:${playerId}:stats:${season ?? 'current'}`,
      () => apiClient.get(`/api/players/${playerId}/stats${qs}`),
      CACHE_TTL.LONG,
    );
  },

  /** Get player projections */
  getPlayerProjections(playerId: string, startDate?: string) {
    const qs = startDate ? `?startDate=${startDate}` : '';
    return c.cached(
      `players:${playerId}:projections:${startDate ?? 'all'}`,
      () => apiClient.get(`/api/players/${playerId}/projections${qs}`),
      CACHE_TTL.MEDIUM,
    );
  },

  /** Clear all player caches */
  clearCache() {
    c.clearCache();
  },

  /** Invalidate caches matching a prefix */
  invalidate(prefix: string) {
    c.invalidate(prefix);
  },
};

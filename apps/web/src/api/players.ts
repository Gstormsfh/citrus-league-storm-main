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

  /**
   * GOALIE-PROJ SANITY (2026-09-01): one player's rest-of-season row —
   * start-aware games_remaining + total for the card's goalie headline.
   */
  getRosProjectionForPlayer(playerId: string | number) {
    return c.cached(
      `players:ros-projection:${playerId}`,
      () => apiClient.get(`/api/players/ros-projections?playerId=${playerId}`),
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

  /** Get batch player projections */
  getBatchProjections(ids: string[], options?: { startDate?: string; endDate?: string; season?: number }) {
    const params = new URLSearchParams();
    params.set('ids', ids.join(','));
    if (options?.startDate) params.set('startDate', options.startDate);
    if (options?.endDate) params.set('endDate', options.endDate);
    if (options?.season) params.set('season', String(options.season));
    return c.cached(
      `players:projections:batch:${params.toString()}`,
      () => apiClient.get(`/api/players/projections/batch?${params.toString()}`),
      CACHE_TTL.MEDIUM,
    );
  },

  /**
   * Rostered% / started% per player across every Citrus team with a roster
   * (2026-09-05). Cached long: the numbers move on a waiver run.
   */
  getOwnership() {
    return c.cached('players:ownership', () => apiClient.get('/api/players/ownership'), CACHE_TTL.LONG);
  },

  /** Get player directory entries */
  getDirectory(ids: string[], season?: number) {
    const params = new URLSearchParams();
    params.set('ids', ids.join(','));
    if (season) params.set('season', String(season));
    return c.cached(
      `players:directory:${params.toString()}`,
      () => apiClient.get(`/api/players/directory?${params.toString()}`),
      CACHE_TTL.LONG,
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

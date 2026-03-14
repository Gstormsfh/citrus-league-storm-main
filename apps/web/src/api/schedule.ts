/**
 * Schedule API client — replaces direct Supabase calls for schedule/game operations.
 *
 * Includes request deduplication and TTL caching to prevent redundant API calls.
 */

import { apiClient } from './client';
import { createApiCache, CACHE_TTL } from './cache';

const c = createApiCache();

export const scheduleApi = {
  /** Get NHL games (by date, date range, or team) */
  getGames(params?: { date?: string; startDate?: string; endDate?: string; team?: string }) {
    const query = new URLSearchParams();
    if (params?.date) query.set('date', params.date);
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    if (params?.team) query.set('team', params.team);
    const qs = query.toString();
    return c.cached(
      `schedule:games:${qs}`,
      () => apiClient.get(`/api/schedule/games${qs ? `?${qs}` : ''}`),
      CACHE_TTL.SHORT,
    );
  },

  /** Batch get games for multiple teams */
  getGamesForTeams(teams: string[], startDate?: string, endDate?: string) {
    const query = new URLSearchParams();
    const sorted = [...teams].sort();
    query.set('teams', sorted.join(','));
    if (startDate) query.set('startDate', startDate);
    if (endDate) query.set('endDate', endDate);
    const qs = query.toString();
    return c.cached(
      `schedule:teams:${qs}`,
      () => apiClient.get<Record<string, any[]>>(`/api/schedule/games/teams?${query.toString()}`),
      CACHE_TTL.SHORT,
    );
  },

  /** Get next game for a team */
  getNextGame(team: string) {
    return c.cached(
      `schedule:next:${team}`,
      () => apiClient.get(`/api/schedule/games/next?team=${team}`),
      CACHE_TTL.MEDIUM,
    );
  },

  /** Get fantasy week definitions */
  getFantasyWeeks() {
    return c.cached(
      'schedule:fantasy-weeks',
      () => apiClient.get('/api/schedule/fantasy-weeks'),
      CACHE_TTL.LONG,
    );
  },

  /** Clear all schedule caches */
  clearCache() {
    c.clearCache();
  },
};

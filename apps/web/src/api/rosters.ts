/**
 * Roster API client — replaces direct Supabase calls for roster operations.
 *
 * Includes request deduplication and TTL caching to prevent redundant API calls.
 */

import { apiClient } from './client';
import { createApiCache, CACHE_TTL } from './cache';

const c = createApiCache();

export const rosterApi = {
  /** Get roster for a specific team */
  getTeamRoster(leagueId: string, teamId: string) {
    return c.cached(
      `rosters:${leagueId}:${teamId}`,
      () => apiClient.get(`/api/rosters/league/${leagueId}/team/${teamId}`),
      CACHE_TTL.MEDIUM,
    );
  },

  /** Get roster player IDs for a team */
  getPlayerIds(leagueId: string, teamId: string) {
    return c.cached(
      `rosters:${leagueId}:${teamId}:ids`,
      () => apiClient.get(`/api/rosters/league/${leagueId}/team/${teamId}/player-ids`),
      CACHE_TTL.MEDIUM,
    );
  },

  /** Get all rosters in a league */
  getLeagueRosters(leagueId: string) {
    return c.cached(
      `rosters:${leagueId}:all`,
      () => apiClient.get(`/api/rosters/league/${leagueId}`),
      CACHE_TTL.MEDIUM,
    );
  },

  /** Update lineup for a team */
  updateLineup(leagueId: string, teamId: string, lineup: {
    starters?: string[];
    bench?: string[];
    ir?: string[];
    slot_assignments?: Record<string, unknown>;
  }) {
    // Invalidate roster caches for this team after lineup change
    c.invalidate(`rosters:${leagueId}:${teamId}`);
    return apiClient.put(`/api/rosters/league/${leagueId}/team/${teamId}/lineup`, lineup);
  },

  /** Get team lineup */
  getLineup(leagueId: string, teamId: string) {
    return c.cached(
      `rosters:${leagueId}:${teamId}:lineup`,
      () => apiClient.get(`/api/rosters/league/${leagueId}/team/${teamId}/lineup`),
      CACHE_TTL.MEDIUM,
    );
  },

  /** Clear all roster caches */
  clearCache() {
    c.clearCache();
  },

  /** Invalidate caches matching a prefix */
  invalidate(prefix: string) {
    c.invalidate(prefix);
  },
};

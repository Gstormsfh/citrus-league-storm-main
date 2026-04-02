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

  /** Save lineup with validation, roster protection, and daily snapshots */
  saveLineup(leagueId: string, teamId: string, lineup: {
    starters?: string[];
    bench?: string[];
    ir?: string[];
    slot_assignments?: Record<string, unknown>;
    target_date?: string;
    allow_player_removal?: boolean;
  }) {
    // Invalidate roster caches for this team after lineup change
    c.invalidate(`rosters:${leagueId}:${teamId}`);
    // Also invalidate daily roster cache (keyed by teamId, not leagueId)
    c.invalidate(`rosters:daily:${teamId}`);
    console.log('[ROSTER-DEBUG] rosterApi.saveLineup API call', { target_date: lineup.target_date, starters: lineup.starters?.length, bench: lineup.bench?.length });
    return apiClient.put(`/api/rosters/league/${leagueId}/team/${teamId}/lineup`, lineup);
  },

  /** Update lineup for a team (alias for saveLineup for backward compatibility) */
  updateLineup(leagueId: string, teamId: string, lineup: {
    starters?: string[];
    bench?: string[];
    ir?: string[];
    slot_assignments?: Record<string, unknown>;
  }) {
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

  /** Get daily roster entries for a team/matchup/date */
  getDailyRoster(teamId: string, matchupId: string, rosterDate: string) {
    console.log('[ROSTER-DEBUG] rosterApi.getDailyRoster', { rosterDate, teamId, matchupId, cacheKey: `rosters:daily:${teamId}:${matchupId}:${rosterDate}` });
    return c.cached(
      `rosters:daily:${teamId}:${matchupId}:${rosterDate}`,
      () => apiClient.get(`/api/rosters/daily-roster?team_id=${teamId}&matchup_id=${matchupId}&roster_date=${rosterDate}`),
      CACHE_TTL.SHORT,
    );
  },

  /** Check if roster can be updated for a date */
  canUpdateRoster(date: string, playerIds: number[]) {
    const idsParam = playerIds.join(',');
    return apiClient.get(`/api/rosters/can-update?date=${date}&player_ids=${idsParam}`);
  },

  /** Backfill missing daily rosters for a matchup */
  backfillDailyRosters(leagueId: string, teamId: string, matchupId: string) {
    return apiClient.post(`/api/rosters/league/${leagueId}/team/${teamId}/backfill`, { matchup_id: matchupId });
  },

  /** Backfill daily rosters for all matchups in a league */
  backfillAllMatchups(leagueId: string) {
    return apiClient.post(`/api/rosters/league/${leagueId}/backfill-all`, {});
  },

  /** Initialize lineup from roster assignments (server-side slot computation) */
  initializeLineup(leagueId: string, teamId: string) {
    c.invalidate(`rosters:${leagueId}:${teamId}`);
    return apiClient.post(`/api/rosters/league/${leagueId}/team/${teamId}/initialize`, {});
  },

  /** Get roster count for a team */
  getRosterCount(leagueId: string, teamId: string) {
    return c.cached(
      `rosters:${leagueId}:${teamId}:count`,
      () => apiClient.get(`/api/rosters/league/${leagueId}/team/${teamId}/roster-count`),
      CACHE_TTL.SHORT,
    );
  },

  /** Sync roster_assignments from draft_picks (commissioner action) */
  syncRosters(leagueId: string) {
    c.invalidate(`rosters:${leagueId}`);
    return apiClient.post(`/api/rosters/league/${leagueId}/sync`, {});
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

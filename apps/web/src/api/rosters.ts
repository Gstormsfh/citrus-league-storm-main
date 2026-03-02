/**
 * Roster API client — replaces direct Supabase calls for roster operations.
 */

import { apiClient } from './client';

export const rosterApi = {
  /** Get roster for a specific team */
  getTeamRoster(leagueId: string, teamId: string) {
    return apiClient.get(`/api/rosters/league/${leagueId}/team/${teamId}`);
  },

  /** Get all rosters in a league */
  getLeagueRosters(leagueId: string) {
    return apiClient.get(`/api/rosters/league/${leagueId}`);
  },

  /** Update lineup for a team */
  updateLineup(leagueId: string, teamId: string, lineup: {
    starters?: unknown;
    bench?: unknown;
    ir?: unknown;
    slot_assignments?: unknown;
  }) {
    return apiClient.put(`/api/rosters/league/${leagueId}/team/${teamId}/lineup`, lineup);
  },
};

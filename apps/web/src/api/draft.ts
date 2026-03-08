/**
 * Draft API client — replaces direct Supabase calls for draft operations.
 */

import { apiClient } from './client';

export const draftApi = {
  /** Get active draft session for a league */
  getActiveSession(leagueId: string) {
    return apiClient.get<{ sessionId: string }>(`/api/draft/league/${leagueId}/session`);
  },

  /** Get draft picks for a league */
  getDraftPicks(leagueId: string, sessionId?: string) {
    const qs = sessionId ? `?sessionId=${sessionId}` : '';
    return apiClient.get(`/api/draft/league/${leagueId}/picks${qs}`);
  },

  /** Get draft order for a specific round */
  getDraftOrder(leagueId: string, roundNumber: number, sessionId?: string) {
    const qs = sessionId ? `?sessionId=${sessionId}` : '';
    return apiClient.get(`/api/draft/league/${leagueId}/order/${roundNumber}${qs}`);
  },

  /** Hard delete all draft data for a league (commissioner only) */
  hardDeleteDraft(leagueId: string) {
    return apiClient.delete(`/api/draft/league/${leagueId}`);
  },

  /** Get full draft state (league, picks, order) */
  getDraftState(leagueId: string) {
    return apiClient.get(`/api/draft/league/${leagueId}`);
  },

  /** Make a draft pick */
  makePick(leagueId: string, params: {
    playerId: string;
    teamId: string | number;
    pickNumber?: number;
    roundNumber?: number;
    draftSessionId?: string;
    teamsCount?: number;
  }) {
    return apiClient.post(`/api/draft/league/${leagueId}/pick`, params);
  },

  /** Start the draft (commissioner only) */
  startDraft(leagueId: string) {
    return apiClient.post(`/api/draft/league/${leagueId}/start`);
  },

  /** Initialize draft order (commissioner only) */
  initializeOrder(leagueId: string, params: {
    teams: unknown[];
    totalRounds: number;
    customTeamOrder?: unknown;
    draftType?: string;
  }) {
    return apiClient.post(`/api/draft/league/${leagueId}/initialize-order`, params);
  },

  /** Reset draft (commissioner only) */
  resetDraft(leagueId: string) {
    return apiClient.post(`/api/draft/league/${leagueId}/reset`);
  },

  /** Undo last pick (commissioner only) */
  undoLastPick(leagueId: string) {
    return apiClient.post(`/api/draft/league/${leagueId}/undo`);
  },

  /** Autopick for a team */
  autopick(leagueId: string, params: {
    teamId: string | number;
    sessionId?: string;
    roundNumber?: number;
    pickNumber?: number;
  }) {
    return apiClient.post(`/api/draft/league/${leagueId}/autopick`, params);
  },

  /** Run full autopick draft (commissioner only) */
  fullAutopick(leagueId: string) {
    return apiClient.post(`/api/draft/league/${leagueId}/full-autopick`);
  },

  /** Get draft snapshot */
  getSnapshot(leagueId: string) {
    return apiClient.get(`/api/draft/league/${leagueId}/snapshot`);
  },

  /** Save draft snapshot */
  saveSnapshot(leagueId: string, params: {
    draftSessionId: string;
    snapshotData: unknown;
  }) {
    return apiClient.post(`/api/draft/league/${leagueId}/snapshot`, params);
  },

  /** Get autopick rankings */
  getRankings(leagueId: string, teamId?: string) {
    const qs = teamId ? `?teamId=${teamId}` : '';
    return apiClient.get(`/api/draft/league/${leagueId}/rankings${qs}`);
  },

  /** Save autopick rankings */
  saveRankings(leagueId: string, params: {
    teamId: string | number;
    rankings: unknown;
  }) {
    return apiClient.post(`/api/draft/league/${leagueId}/rankings`, params);
  },

  /** Delete ALL draft data across all leagues (admin only) */
  deleteAllDraftData() {
    return apiClient.delete('/api/draft/all');
  },
};

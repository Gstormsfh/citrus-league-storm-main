/**
 * League API client — replaces direct Supabase calls for league operations.
 *
 * Includes request deduplication and TTL caching to prevent redundant API calls
 * during React re-renders and StrictMode double-fires.
 */

import { apiClient } from './client';
import { createApiCache, CACHE_TTL } from './cache';

const c = createApiCache();

export const leagueApi = {
  /** Get all leagues for the authenticated user */
  getUserLeagues() {
    return c.cached('leagues:user', () => apiClient.get('/api/leagues'), CACHE_TTL.MEDIUM);
  },

  /** Get a specific league by ID */
  getLeague(leagueId: string) {
    return c.cached(`leagues:${leagueId}`, () => apiClient.get(`/api/leagues/${leagueId}`), CACHE_TTL.MEDIUM);
  },

  /** Create a new league */
  createLeague(params: {
    name: string;
    settings?: Record<string, unknown>;
    scoring_settings?: Record<string, unknown>;
    waiver_settings?: Record<string, unknown>;
    roster_size?: number;
    draft_rounds?: number;
  }) {
    c.invalidate('leagues:');
    return apiClient.post('/api/leagues', params);
  },

  /** Join a league by invite code */
  joinLeague(params: { joinCode: string; teamName?: string }) {
    c.invalidate('leagues:');
    return apiClient.post('/api/leagues/join', params);
  },

  /** Update league settings (commissioner only) */
  updateSettings(leagueId: string, params: {
    settings?: Record<string, unknown>;
    scoring_settings?: Record<string, unknown>;
  }) {
    c.invalidate(`leagues:${leagueId}`);
    return apiClient.put(`/api/leagues/${leagueId}/settings`, params);
  },

  /** Update waiver settings (commissioner only) */
  updateWaiverSettings(leagueId: string, settings: Record<string, unknown>) {
    c.invalidate(`leagues:${leagueId}`);
    return apiClient.put(`/api/leagues/${leagueId}/waiver-settings`, settings);
  },

  /** Update scoring settings (commissioner only) */
  updateScoringSettings(leagueId: string, settings: Record<string, unknown>) {
    c.invalidate(`leagues:${leagueId}`);
    return apiClient.put(`/api/leagues/${leagueId}/scoring-settings`, settings);
  },

  /** Update draft settings (commissioner only) */
  updateDraftSettings(leagueId: string, settings: Record<string, unknown>) {
    c.invalidate(`leagues:${leagueId}`);
    return apiClient.put(`/api/leagues/${leagueId}/draft-settings`, settings);
  },

  /** Update roster slot settings (commissioner only) */
  updateRosterSlots(leagueId: string, rosterSlots: Record<string, unknown>) {
    c.invalidate(`leagues:${leagueId}`);
    return apiClient.put(`/api/leagues/${leagueId}/roster-slots`, { rosterSlots });
  },

  /** Update keeper/dynasty settings (commissioner only) */
  updateKeeperSettings(leagueId: string, settings: {
    keeperEnabled: boolean;
    keeperCount: number;
    keeperPenalty: string;
    dynastyMode: boolean;
  }) {
    c.invalidate(`leagues:${leagueId}`);
    return apiClient.put(`/api/leagues/${leagueId}/keeper-settings`, settings);
  },

  /** Update category settings (commissioner only) */
  updateCategorySettings(leagueId: string, categories: string[]) {
    c.invalidate(`leagues:${leagueId}`);
    return apiClient.put(`/api/leagues/${leagueId}/category-settings`, { categories });
  },

  /** Get all teams in a league */
  getTeams(leagueId: string, withOwners?: boolean) {
    const qs = withOwners ? '?withOwners=true' : '';
    return c.cached(
      `leagues:${leagueId}:teams:${withOwners ? 'owners' : 'basic'}`,
      () => apiClient.get(`/api/leagues/${leagueId}/teams${qs}`),
      CACHE_TTL.MEDIUM,
    );
  },

  /** Get league standings */
  getStandings(leagueId: string) {
    return c.cached(
      `leagues:${leagueId}:standings`,
      () => apiClient.get(`/api/leagues/${leagueId}/standings`),
      CACHE_TTL.LONG,
    );
  },

  /** Get user's team in a league */
  getMyTeam(leagueId: string) {
    return c.cached(
      `leagues:${leagueId}:my-team`,
      () => apiClient.get(`/api/leagues/${leagueId}/my-team`),
      CACHE_TTL.MEDIUM,
    );
  },

  /** Delete a team (commissioner only) */
  deleteTeam(leagueId: string, teamId: string) {
    c.invalidate(`leagues:${leagueId}`);
    return apiClient.delete(`/api/leagues/${leagueId}/teams/${teamId}`);
  },

  /** Get transaction history for a league */
  getTransactions(leagueId: string) {
    return c.cached(
      `leagues:${leagueId}:transactions`,
      () => apiClient.get(`/api/leagues/${leagueId}/transactions`),
      CACHE_TTL.MEDIUM,
    );
  },

  /** Clear all caches (call on logout or league switch) */
  clearCache() {
    c.clearCache();
  },

  /** Invalidate caches matching a prefix */
  invalidate(prefix: string) {
    c.invalidate(prefix);
  },
};

/**
 * League API client — replaces direct Supabase calls for league operations.
 *
 * Includes request deduplication and TTL caching to prevent redundant API calls
 * during React re-renders and StrictMode double-fires.
 */

import { apiClient } from './client';
import { createApiCache, CACHE_TTL } from './cache';
// Type-only: erased at compile time, so this does not create a runtime import
// cycle with LeagueService (which imports leagueApi). Typing the wire contract
// here rather than casting at each call site means every consumer downstream
// gets it for free -- these endpoints previously resolved to ApiResponse<unknown>,
// so every read of .data.league / .data.id was a compile error in the services.
import type { League, Team } from '@/services/LeagueService';

const c = createApiCache();

export const leagueApi = {
  /** Projected vs actual for one team. Returns RAW totals; the calibration
   *  that turns them into "% of expectation" lives in utils/teamAnalytics.ts. */
  getTeamAnalytics(leagueId: string, teamId: string, season?: number) {
    const qs = season ? `?season=${season}` : '';
    return apiClient.get(`/api/leagues/${leagueId}/teams/${teamId}/analytics${qs}`);
  },

  /** Get all leagues for the authenticated user */
  getUserLeagues() {
    return c.cached('leagues:user', () => apiClient.get<League[]>('/api/leagues'), CACHE_TTL.MEDIUM);
  },

  /** Get a specific league by ID */
  getLeague(leagueId: string) {
    return c.cached(`leagues:${leagueId}`, () => apiClient.get<League>(`/api/leagues/${leagueId}`), CACHE_TTL.MEDIUM);
  },

  /** Get fantasy season-complete state for a league */
  getSeasonState(leagueId: string) {
    return c.cached(
      `leagues:${leagueId}:season-state`,
      () => apiClient.get<{ complete: boolean; reason?: string }>(`/api/leagues/${leagueId}/season-state`),
      CACHE_TTL.MEDIUM,
    );
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

  /** Join a league by invite code.
   *
   * CRITICAL: retries:0 because this endpoint is NOT idempotent at the
   * RPC layer — a retried POST that actually succeeded would return
   * 'already a member' and confuse users. Mobile SMS invite flow used
   * to trigger this: slow network → client timeout → silent retry →
   * 'already a member' error shown even though join succeeded. */
  joinLeague(params: { joinCode: string; teamName?: string }) {
    c.invalidate('leagues:');
    return apiClient.post<{ league: League; team: Team }>('/api/leagues/join', params, { retries: 0 });
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

  /**
   * Read the scoring catalog with this league's effective multipliers.
   *
   * This is the data-driven replacement for the twelve categories that were
   * hardcoded in calculate_daily_matchup_scores. Returns every stat in
   * stat_catalog with the multiplier actually in force for this league.
   */
  getScoringRules(leagueId: string) {
    return apiClient.get(`/api/leagues/${leagueId}/scoring-rules`);
  },

  /** Set scoring weights (commissioner only) */
  updateScoringRules(
    leagueId: string,
    rules: Array<{ stat_key: string; multiplier: number }>,
  ) {
    c.invalidate(`leagues:${leagueId}`);
    return apiClient.put(`/api/leagues/${leagueId}/scoring-rules`, { rules });
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

  /**
   * Get all teams in a league.
   *
   * Transcribed from `server/src/routes/leagues.ts:288`, which has two exits:
   * `ok(c, teams)` at :298 when `withOwners=true` (getLeagueTeamsWithOwners
   * adds `owner_name`), and `ok(c, await service.attachOwnerAvatars(teams))`
   * at :303 otherwise. BOTH carry the OWNER's `avatar_url` — null for AI
   * teams and owners with no picture — so only `owner_name` is genuinely
   * branch-dependent; both are optional here because one type covers both
   * exits. Untyped, `.data` was `unknown`, which is what forced the `as
   * Team[]` casts in LeagueService/DraftService and broke `snapshotTeams.map`.
   */
  getTeams(leagueId: string, withOwners?: boolean) {
    const qs = withOwners ? '?withOwners=true' : '';
    return c.cached(
      `leagues:${leagueId}:teams:${withOwners ? 'owners' : 'basic'}`,
      () => apiClient.get<Array<Team & { owner_name?: string; avatar_url?: string | null }>>(`/api/leagues/${leagueId}/teams${qs}`),
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

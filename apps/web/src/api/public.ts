/**
 * Public API client — typed wrappers for unauthenticated /api/public/ endpoints.
 *
 * These endpoints serve the demo/guest experience: read-only access to a shared
 * demo league so visitors can explore the platform without signing up.
 *
 * All keys are prefixed with `public:` to isolate from authenticated caches.
 */

import { apiClient } from './client';
import { createApiCache, CACHE_TTL } from './cache';

const c = createApiCache();

export const publicApi = {
  // ── Leagues ──────────────────────────────────────────────────────────────

  /** Get a league by ID (no auth required) */
  getLeague(leagueId: string) {
    return c.cached(
      `public:leagues:${leagueId}`,
      () => apiClient.get(`/api/public/leagues/${leagueId}`),
      CACHE_TTL.LONG,
    );
  },

  /** Get all teams in a league (no auth required) */
  getTeams(leagueId: string) {
    return c.cached(
      `public:leagues:${leagueId}:teams`,
      () => apiClient.get(`/api/public/leagues/${leagueId}/teams`),
      CACHE_TTL.LONG,
    );
  },

  /** Get player IDs for a specific team (no auth required) */
  getPlayerIds(leagueId: string, teamId: string) {
    return c.cached(
      `public:leagues:${leagueId}:teams:${teamId}:player-ids`,
      () => apiClient.get(`/api/public/leagues/${leagueId}/teams/${teamId}/player-ids`),
      CACHE_TTL.LONG,
    );
  },

  // ── Matchups ─────────────────────────────────────────────────────────────

  /** Get matchups for a league, optionally filtered by week (no auth required) */
  getLeagueMatchups(leagueId: string, week?: number) {
    const qs = week != null ? `?week=${week}` : '';
    const key = `public:matchups:league:${leagueId}:w${week ?? 'all'}`;
    return c.cached(
      key,
      () => apiClient.get(`/api/public/matchups/league/${leagueId}${qs}`),
      CACHE_TTL.MEDIUM,
    );
  },

  /** Get daily scores for a matchup (no auth required) */
  getDailyScores(matchupId: string) {
    return c.cached(
      `public:matchups:daily-scores:${matchupId}`,
      () => apiClient.get(`/api/public/matchups/${matchupId}/daily-scores`),
      CACHE_TTL.SHORT,
    );
  },

  /** Get matchup stats for players in a date range (no auth required) */
  getMatchupStats(playerIds: number[], startDate: string, endDate: string) {
    return apiClient.post('/api/public/matchups/matchup-stats', { playerIds, startDate, endDate });
  },

  // ── Waitlist ─────────────────────────────────────────────────────────────

  /** Submit a waitlist signup (no auth required, not cached) */
  joinWaitlist(email: string, source: string) {
    return apiClient.post('/api/public/waitlist', { email, source });
  },

  // ── Cache management ────────────────────────────────────────────────────

  /** Clear all public caches */
  clearCache() {
    c.clearCache();
  },

  /** Invalidate public cache entries matching a prefix */
  invalidate(prefix: string) {
    c.invalidate(prefix);
  },
};

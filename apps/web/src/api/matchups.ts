/**
 * Matchup API client — replaces direct Supabase calls for matchup operations.
 *
 * Includes request deduplication and short-lived caching to prevent redundant
 * API calls during React re-renders and StrictMode double-fires.
 */

import { apiClient } from './client';

// ---------------------------------------------------------------------------
// Request dedup / cache infrastructure
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<any>>();
const inflight = new Map<string, Promise<any>>();

const CACHE_TTL = {
  SHORT: 10_000,   // 10s — live stats, active day data
  MEDIUM: 30_000,  // 30s — weekly scores, roster snapshots
  LONG: 120_000,   // 2min — matchup metadata, standings
} as const;

/**
 * Dedup + cache wrapper.  Identical concurrent calls share one network request;
 * subsequent calls within TTL return the cached result instantly.
 */
async function cached<T>(key: string, fetcher: () => Promise<T>, ttl: number): Promise<T> {
  // 1) Cache hit?
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.data as T;
  }

  // 2) In-flight dedup
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  // 3) Fresh fetch
  const promise = fetcher()
    .then((result) => {
      cache.set(key, { data: result, expiresAt: Date.now() + ttl });
      inflight.delete(key);
      return result;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const matchupApi = {
  // ── League-scoped matchup queries ──────────────────────────────────────

  /** Get all matchups for a league (optionally filtered by week) */
  getLeagueMatchups(leagueId: string, week?: number) {
    const qs = week ? `?week=${week}` : '';
    const key = `matchups:league:${leagueId}:w${week ?? 'all'}`;
    return cached(key, () => apiClient.get(`/api/matchups/league/${leagueId}${qs}`), CACHE_TTL.MEDIUM);
  },

  /** Get user's matchup for a specific week */
  getUserMatchup(leagueId: string, week: number) {
    const key = `matchups:user:${leagueId}:w${week}`;
    return cached(key, () => apiClient.get(`/api/matchups/league/${leagueId}/user?week=${week}`), CACHE_TTL.MEDIUM);
  },

  /** Get matchup history between teams */
  getMatchupHistory(leagueId: string, team1Id: string, team2Id?: string) {
    const query = new URLSearchParams({ team1: team1Id });
    if (team2Id) query.set('team2', team2Id);
    return apiClient.get(`/api/matchups/league/${leagueId}/history?${query}`);
  },

  /** Get playoff bracket for a league */
  getPlayoffBracket(leagueId: string) {
    const key = `matchups:playoffs:${leagueId}`;
    return cached(key, () => apiClient.get(`/api/matchups/league/${leagueId}/playoffs`), CACHE_TTL.LONG);
  },

  // ── Single matchup queries ─────────────────────────────────────────────

  /** Get a specific matchup with player lines */
  getMatchup(matchupId: string) {
    const key = `matchups:single:${matchupId}`;
    return cached(key, () => apiClient.get(`/api/matchups/${matchupId}`), CACHE_TTL.MEDIUM);
  },

  /** Get matchup scores/lines */
  getMatchupScores(matchupId: string) {
    const key = `matchups:scores:${matchupId}`;
    return cached(key, () => apiClient.get(`/api/matchups/${matchupId}/scores`), CACHE_TTL.MEDIUM);
  },

  /** Get daily matchup scores (team1 / team2 daily point arrays) */
  getDailyScores(matchupId: string) {
    const key = `matchups:daily-scores:${matchupId}`;
    return cached(key, () => apiClient.get(`/api/matchups/${matchupId}/daily-scores`), CACHE_TTL.SHORT);
  },

  // ── Daily game stats ───────────────────────────────────────────────────

  /** Get daily game stats for a batch of players on a specific date */
  getDailyGameStats(playerIds: number[], date: string) {
    // Sort IDs to normalize the cache key regardless of input order
    const sorted = [...playerIds].sort((a, b) => a - b);
    const key = `matchups:daily-stats:${date}:${sorted.join(',')}`;
    return cached(
      key,
      () => apiClient.post('/api/matchups/daily-game-stats', { playerIds: sorted, date }),
      CACHE_TTL.SHORT,
    );
  },

  // ── Weekly matchup stats ───────────────────────────────────────────────

  /** Get weekly matchup stats for players (summed over date range) */
  getMatchupStats(playerIds: number[], startDate: string, endDate: string) {
    const sorted = [...playerIds].sort((a, b) => a - b);
    const key = `matchups:week-stats:${startDate}:${endDate}:${sorted.join(',')}`;
    return cached(
      key,
      () => apiClient.post('/api/matchups/matchup-stats', { playerIds: sorted, startDate, endDate }),
      CACHE_TTL.MEDIUM,
    );
  },

  // ── Daily projections ──────────────────────────────────────────────────

  /** Get daily projections for a batch of players on a given date */
  getDailyProjections(playerIds: number[], date: string) {
    const sorted = [...playerIds].sort((a, b) => a - b);
    const key = `matchups:proj:${date}:${sorted.join(',')}`;
    return cached(
      key,
      () => apiClient.post('/api/matchups/projections/daily', { playerIds: sorted, date }),
      CACHE_TTL.MEDIUM,
    );
  },

  // ── Frozen roster (fantasy_daily_rosters) ──────────────────────────────

  /** Get frozen roster for a single team/matchup/date */
  getFrozenRoster(matchupId: string, teamId: string, date: string) {
    const key = `matchups:frozen:${matchupId}:${teamId}:${date}`;
    return cached(
      key,
      () => apiClient.get(`/api/matchups/${matchupId}/frozen-roster?teamId=${teamId}&date=${date}`),
      CACHE_TTL.MEDIUM,
    );
  },

  /** Batch: get all frozen roster entries for a matchup across multiple dates */
  getFrozenRosterBatch(matchupId: string, dates: string[]) {
    const key = `matchups:frozen-batch:${matchupId}:${dates.sort().join(',')}`;
    return cached(
      key,
      () => apiClient.post(`/api/matchups/${matchupId}/frozen-roster-batch`, { dates }),
      CACHE_TTL.MEDIUM,
    );
  },

  // ── Daily lineup (get_daily_lineup RPC — full player data) ─────────────

  /** Get full daily lineup with player data (for display) */
  getDailyLineup(matchupId: string, teamId: string, date: string) {
    const key = `matchups:lineup:${matchupId}:${teamId}:${date}`;
    return cached(
      key,
      () => apiClient.get(`/api/matchups/${matchupId}/daily-lineup?teamId=${teamId}&date=${date}`),
      CACHE_TTL.MEDIUM,
    );
  },

  // ── Roster initialization ──────────────────────────────────────────────

  /**
   * Ensure both teams in a matchup have team_lineups + fantasy_daily_rosters.
   * Must be called BEFORE loading any roster data to handle AI teams.
   * Uses admin client server-side to bypass RLS for teams with no owner.
   */
  ensureRosters(matchupId: string) {
    // NOT cached — must always run to ensure data exists
    return apiClient.post(`/api/matchups/${matchupId}/ensure-rosters`);
  },

  // ── Score updates & maintenance ────────────────────────────────────────

  /** Update matchup scores */
  updateScores(leagueId?: string) {
    return apiClient.post('/api/matchups/update-scores', leagueId ? { leagueId } : {});
  },

  /** Auto-complete matchups */
  autoComplete() {
    return apiClient.post('/api/matchups/auto-complete');
  },

  /** Lock completed roster days */
  lockCompletedDays() {
    return apiClient.post('/api/matchups/lock-completed-days');
  },

  /** Get matchup score job status */
  getJobStatus() {
    return apiClient.get('/api/matchups/job-status');
  },

  // ── Standings / format-specific ────────────────────────────────────────

  /** Calculate H2H category matchup results */
  getH2HCategoryResults(params: {
    leagueId: string; matchupId: string;
    team1Id: string; team2Id: string;
    weekStart: string; weekEnd: string;
    categories: string[];
  }) {
    return apiClient.post('/api/matchups/h2h-category-results', params);
  },

  /** Calculate Roto standings */
  getRotoStandings(leagueId: string, categories: string[], throughWeek?: number) {
    const key = `matchups:roto:${leagueId}:w${throughWeek ?? 'all'}`;
    return cached(
      key,
      () => apiClient.post('/api/matchups/roto-standings', { leagueId, categories, throughWeek }),
      CACHE_TTL.LONG,
    );
  },

  /** Calculate PPG standings */
  getPPGStandings(leagueId: string, throughWeek?: number) {
    const key = `matchups:ppg:${leagueId}:w${throughWeek ?? 'all'}`;
    return cached(
      key,
      () => apiClient.post('/api/matchups/ppg-standings', { leagueId, throughWeek }),
      CACHE_TTL.LONG,
    );
  },

  // ── Cache management ───────────────────────────────────────────────────

  /** Clear all matchup caches (call on league switch, etc.) */
  clearCache() {
    cache.clear();
    inflight.clear();
  },

  /** Invalidate cache entries matching a prefix */
  invalidate(prefix: string) {
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) cache.delete(key);
    }
  },
};

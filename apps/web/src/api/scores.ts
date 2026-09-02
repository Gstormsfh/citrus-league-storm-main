/**
 * Scores API client — the day's scoreboard and one game's detail.
 *
 * Cached at CACHE_TTL.SHORT (10s), matching the 15s Cache-Control the server
 * sets. A scores screen is the one surface where a stale read is immediately
 * visible to the person looking at it, so nothing here is held longer than a
 * shift change.
 *
 * Unlike the older clients in this folder these two UNWRAP the `{ data }`
 * envelope before returning. The screen consumes them through React Query,
 * and `useQuery<ScoresDayResponse>` reads far better than a chain of
 * `response.data?.data?.games`. An envelope with no `data` is a broken
 * response, so it throws rather than resolving to undefined and rendering an
 * empty scoreboard that looks like a quiet night.
 */

import type { ScoresDayResponse, ScoresGameDetailResponse } from '@citrus/shared';
import { apiClient } from './client';
import { createApiCache, CACHE_TTL } from './cache';

const c = createApiCache();

export interface ScoresQuery {
  /** YYYY-MM-DD in Mountain Time. Omitted means today, decided server-side. */
  date?: string;
  /** Optional. Attaches roster context; the server verifies membership. */
  leagueId?: string | null;
}

function queryString({ date, leagueId }: ScoresQuery): string {
  const q = new URLSearchParams();
  if (date) q.set('date', date);
  if (leagueId) q.set('leagueId', leagueId);
  const s = q.toString();
  return s ? `?${s}` : '';
}

function unwrap<T>(response: { data?: T; error?: string }, what: string): T {
  if (response.error) throw new Error(response.error);
  if (response.data === undefined || response.data === null) {
    throw new Error(`${what} came back without a body`);
  }
  return response.data;
}

export const scoresApi = {
  /** One day of games with the Citrus panel attached to each. */
  async getDay(params: ScoresQuery = {}): Promise<ScoresDayResponse> {
    const qs = queryString(params);
    return c.cached(
      `scores:day:${qs}`,
      async () => unwrap(await apiClient.get<ScoresDayResponse>(`/api/scores${qs}`), 'Scores'),
      CACHE_TTL.SHORT,
    );
  },

  /** One game, with every projected player in it rather than the row's top few. */
  async getGame(
    gameId: number,
    params: Omit<ScoresQuery, 'date'> = {},
  ): Promise<ScoresGameDetailResponse> {
    const qs = queryString(params);
    return c.cached(
      `scores:game:${gameId}:${qs}`,
      async () =>
        unwrap(
          await apiClient.get<ScoresGameDetailResponse>(`/api/scores/game/${gameId}${qs}`),
          'Game detail',
        ),
      CACHE_TTL.SHORT,
    );
  },

  /** Drop every cached day and game. Used by the manual refresh affordance. */
  clearCache() {
    c.clearCache();
  },
};

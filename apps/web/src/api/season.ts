/**
 * Season API client — "is there hockey right now".
 *
 * Cached at CACHE_TTL.LONG. The answer changes at most once a day and is the
 * same for every user, which is the opposite of the scores client next door.
 * `useSeasonStatus` layers a much longer React Query staleTime on top; this
 * TTL only dedupes the burst of calls that happens when four components
 * mount at once on first paint.
 */

import type { ScheduleFacts, SeasonStatus } from '@citrus/shared';
import { apiClient } from './client';
import { createApiCache, CACHE_TTL } from './cache';

const c = createApiCache();

export interface SeasonStatusResponse {
  facts: ScheduleFacts;
  status: SeasonStatus;
}

export const seasonApi = {
  /**
   * The schedule facts and the derived status.
   *
   * Throws on a broken envelope rather than resolving to undefined: the
   * caller turns a throw into the `unknown` phase, which renders the app's
   * normal self. Resolving to undefined would look the same as "offseason"
   * to a careless consumer, and that is the one mistake worth designing out.
   */
  async getStatus(date?: string): Promise<SeasonStatusResponse> {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    return c.cached(
      `season:status:${qs}`,
      async () => {
        const response = await apiClient.get<SeasonStatusResponse>(`/api/season/status${qs}`);
        if (response.error) throw new Error(response.error);
        if (!response.data) throw new Error('Season status came back without a body');
        return response.data;
      },
      CACHE_TTL.LONG,
    );
  },

  clearCache() {
    c.clearCache();
  },
};

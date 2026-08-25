/**
 * DemoMatchupCacheService — Fetches the pre-built demo matchup payload
 * from the API server.
 *
 * Chunk 11g.9 (2026-08-24): repointed off the `demo-matchup-cache`
 * Supabase Edge Function and onto `GET /api/demo/matchup`, which is
 * the same payload builder running in-process on the API server. The
 * server-side cache is warm and shared (Cloud Run min-instances=1)
 * rather than per-edge-isolate, so the hit rate is strictly better
 * than the function it replaces.
 *
 * Response is the standard API envelope `{ data: <payload> }`, so this
 * unwraps `.data` — the Edge Function returned the payload bare.
 */

import { API_BASE_URL } from '@/api/client';
const DEMO_MATCHUP_PATH = '/api/demo/matchup';

export interface DemoMatchupPayload {
  league: any;
  matchup: any;
  allWeekMatchups: any[];
  team1: any;
  team2: any | null;
  team1Lineup: { starters: string[]; bench: string[]; ir: string[]; slot_assignments: Record<string, string> } | null;
  team2Lineup: { starters: string[]; bench: string[]; ir: string[]; slot_assignments: Record<string, string> } | null;
  players: any[];
  playerStats: any[];
  team1DailyScores: any[];
  team2DailyScores: any[];
  availableWeeks: number[];
  week: number;
  cachedAt: string;
}

// Client-side cache so navigating back to the page doesn't re-fetch
let clientCache: { week: number; data: DemoMatchupPayload; fetchedAt: number } | null = null;
const CLIENT_CACHE_TTL_MS = 60_000; // 1 minute (edge has its own 5-min cache)

export const DemoMatchupCacheService = {
  /**
   * Fetch the demo matchup payload for a given week.
   * Returns cached data if available and fresh.
   */
  async getPayload(week?: number): Promise<DemoMatchupPayload> {
    // Check client cache
    if (
      clientCache &&
      (week === undefined || clientCache.week === week) &&
      Date.now() - clientCache.fetchedAt < CLIENT_CACHE_TTL_MS
    ) {
      return clientCache.data;
    }

    const params = week !== undefined ? `?week=${week}` : '';
    const url = `${API_BASE_URL}${DEMO_MATCHUP_PATH}${params}`;

    // Deliberately a bare fetch, not apiClient: this is the guest path
    // and must never attach or refresh an auth session.
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Demo payload fetch failed (${response.status}): ${body}`);
    }

    const envelope = await response.json();
    const data: DemoMatchupPayload = envelope?.data ?? envelope;

    // Update client cache
    clientCache = { week: data.week, data, fetchedAt: Date.now() };

    return data;
  },

  /** Clear the client-side cache (e.g. on week change). */
  clearCache() {
    clientCache = null;
  },
};

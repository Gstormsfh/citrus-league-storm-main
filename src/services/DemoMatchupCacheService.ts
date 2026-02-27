/**
 * DemoMatchupCacheService — Fetches the pre-built demo matchup payload
 * from the demo-matchup-cache Edge Function.
 *
 * Replaces ~16 individual Supabase queries with a single GET request
 * that returns everything the guest Matchup page needs, served from
 * an in-memory edge cache (5-min TTL).
 *
 * Scalability: handles 10,000+ concurrent guests without hitting DB.
 */

const EDGE_FN_PATH = '/functions/v1/demo-matchup-cache';

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

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const params = week !== undefined ? `?week=${week}` : '';
    const url = `${supabaseUrl}${EDGE_FN_PATH}${params}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': anonKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Demo cache fetch failed (${response.status}): ${body}`);
    }

    const data: DemoMatchupPayload = await response.json();

    // Update client cache
    clientCache = { week: data.week, data, fetchedAt: Date.now() };

    return data;
  },

  /** Clear the client-side cache (e.g. on week change). */
  clearCache() {
    clientCache = null;
  },
};

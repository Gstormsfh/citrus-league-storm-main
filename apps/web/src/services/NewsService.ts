/**
 * NewsService — NHL news, fetched through our own API server.
 *
 * WHAT CHANGED (2026-08-25) AND WHY
 * ---------------------------------
 * This file used to `fetch()` forge-dapi.d3.nhle.com and site.api.espn.com
 * directly from the browser. It was the only place in the whole client that
 * called a third party directly — players, schedule, matchups and rosters all
 * go through the API server — and that is precisely why News was broken:
 *
 *   • CORS. Those hosts make no promise to send Access-Control-Allow-Origin to
 *     our origin. The upstreams are healthy (checked 2026-08-25: the NHL feed
 *     returned 25 stories with same-day timestamps), so a browser seeing
 *     nothing was being blocked, not served an empty feed.
 *   • iOS. Under Capacitor the page origin is capacitor://localhost, which is
 *     even less likely to survive a cross-origin fetch — so the TestFlight
 *     build was the worst case for this design, not the best.
 *   • No shared cache. Every visitor hit the upstreams themselves.
 *
 * The fetching now happens in server/src/routes/news.ts, where there is no
 * CORS, one cache serves everybody, and an upstream shape change breaks
 * somewhere we can hotfix without shipping a new binary.
 *
 * THE FALLBACK IS GONE, DELIBERATELY
 * ----------------------------------
 * The old `getFallbackArticles()` returned six invented stories — "Trade
 * Deadline Tracker", "Top Waiver Wire Pickups This Week" — attributed to
 * NHL.com and ESPN, stamped with rolling "1 hour ago" style timestamps and
 * linked to generic section pages. Neither newsroom wrote them, the timestamps
 * described nothing real, and in August a trade-deadline headline is plainly
 * false. Because the live fetches were CORS-blocked, this fabricated set was
 * what users actually saw — the "news is broken" report was really "news is
 * showing six fake articles bylined to real news organisations."
 *
 * Presenting invented reporting under a real outlet's name is not a graceful
 * degradation, so there is no article-shaped fallback here at all. An empty
 * list is returned and the page renders an honest empty state.
 */

import { apiClient } from '@/api/client';
import { logger } from '@/utils/logger';

export interface NewsArticle {
  id: string;
  title: string;
  description: string;
  url: string;
  imageUrl: string;
  source: string;
  category: 'top' | 'fantasy' | 'trade' | 'injury' | 'recap' | 'olympics';
  publishedAt: string;
}

// Short client-side cache on top of the server's own 10-minute cache — this
// one only exists to stop tab-switching from re-requesting.
let cachedArticles: NewsArticle[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Fetch NHL headlines. Returns [] when there is genuinely nothing to show —
 * callers must render an empty state rather than assume a non-empty list.
 */
export async function getNewsArticles(): Promise<NewsArticle[]> {
  if (cachedArticles && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedArticles;
  }

  try {
    const response = await apiClient.get<{ articles: NewsArticle[] }>('/api/news');
    const articles = response.data?.articles ?? [];

    // Only cache a non-empty result, so a transient upstream failure doesn't
    // pin the page empty for the full TTL.
    if (articles.length > 0) {
      cachedArticles = articles;
      cacheTimestamp = Date.now();
    }
    return articles;
  } catch (error) {
    logger.error('[NewsService] Failed to load news:', error);
    return [];
  }
}

export const NEWS_CATEGORIES = [
  { key: 'all', label: 'All News' },
  { key: 'top', label: 'Top Stories' },
  { key: 'fantasy', label: 'Fantasy' },
  { key: 'trade', label: 'Trades' },
  { key: 'injury', label: 'Injuries' },
  { key: 'recap', label: 'Recaps' },
  { key: 'olympics', label: 'Olympics' },
] as const;

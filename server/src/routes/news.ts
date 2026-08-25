import { Hono } from 'hono';
import type { Env } from '../app';
import { ok, fail } from '../lib/responses';
import { AppError } from '../lib/errors';
import { getSupabaseAdmin } from '../lib/supabase';
import { logger } from '@citrus/shared';

/**
 * News routes — server-side proxy for third-party NHL news feeds.
 *
 * WHY THIS EXISTS (2026-08-25)
 * ----------------------------
 * NewsService.ts in the web app was the ONLY place in the entire client that
 * fetched a third-party URL directly from the browser — every other data path
 * (players, schedule, matchups, rosters) already goes through this API server.
 * That asymmetry is the bug:
 *
 *   1. CORS. forge-dapi.d3.nhle.com and site.api.espn.com are not the app's
 *      origin and make no promise to send Access-Control-Allow-Origin. The
 *      upstream APIs are healthy — verified 2026-08-25, the NHL feed returned
 *      25 stories with same-day timestamps — so a browser that gets nothing is
 *      being blocked, not served empty.
 *   2. iOS. Under Capacitor the origin is capacitor://localhost, which is
 *      hostile to cross-origin fetches in a way plain web isn't. TestFlight
 *      would have been the worst case, not the best.
 *   3. No caching. Every visitor hit the upstreams directly.
 *
 * Server-side there is no CORS, one cache serves everyone, and an upstream
 * shape change breaks in a place we control instead of in the client bundle.
 */

const newsRoutes = new Hono<Env>();

const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;
/** Stories older than this are dropped — a "latest news" list of last month is worse than an empty one. */
const MAX_ARTICLE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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

let cache: { articles: NewsArticle[]; at: number } | null = null;

function categorize(text: string): NewsArticle['category'] {
  const lower = text.toLowerCase();
  if (lower.includes('fantasy') || lower.includes('waiver')) return 'fantasy';
  if (lower.includes('trade') || lower.includes('sign') || lower.includes('acquire')) return 'trade';
  if (lower.includes('injur') || lower.includes('day-to-day')) return 'injury';
  if (lower.includes('recap') || lower.includes('highlights')) return 'recap';
  if (lower.includes('olympic')) return 'olympics';
  return 'top';
}

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!resp.ok) {
      logger.warn(`[news] upstream ${url} responded ${resp.status}`);
      return null;
    }
    return await resp.json();
  } catch (error) {
    logger.warn(`[news] upstream ${url} failed:`, error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNHL(): Promise<NewsArticle[]> {
  const data = (await fetchJson(
    'https://forge-dapi.d3.nhle.com/v2/content/en-us/stories?context.slug=nhl&$skip=0&$top=20',
  )) as { items?: unknown[]; docs?: unknown[] } | null;
  if (!data) return [];

  const items = (data.items || data.docs || []) as Array<Record<string, any>>;
  return items
    .map((item, idx): NewsArticle | null => {
      const fields = (item.fields || {}) as Record<string, any>;
      const headline = item.headline || item.title || fields.headline;
      if (!headline) return null;

      const summary = item.summary || item.subhead || fields.summary || '';
      const slug = item.slug || item.contentUrl || fields.slug || '';
      const thumb =
        item.thumbnail?.templateUrl || item.image?.templateUrl || fields.thumbnail?.templateUrl || '';

      return {
        id: `nhl-${item._entityId || item.id || idx}`,
        title: String(headline),
        description: String(summary),
        url: slug ? `https://www.nhl.com/news/${String(slug).replace(/^\/+/, '')}` : 'https://www.nhl.com/news',
        imageUrl: thumb ? String(thumb).replace('{formatInstructions}', 't_ratio16_9-size40/f_auto') : '',
        source: 'NHL.com',
        category: categorize(`${headline} ${summary}`),
        publishedAt: String(item.contentDate || item.date || fields.date || new Date().toISOString()),
      };
    })
    .filter((a): a is NewsArticle => a !== null);
}

async function fetchESPN(): Promise<NewsArticle[]> {
  const data = (await fetchJson('https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news')) as
    | { articles?: Array<Record<string, any>> }
    | null;
  if (!data?.articles) return [];

  return data.articles
    .filter((a) => !a.premium)
    .map((article, idx): NewsArticle | null => {
      const headline = article.headline;
      if (!headline) return null;
      const description = article.description || '';
      const images = (article.images || []) as Array<Record<string, any>>;
      const best = images.find((img) => typeof img.width === 'number' && img.width >= 400) || images[0];

      return {
        id: `espn-${article.id || idx}`,
        title: String(headline),
        description: String(description),
        url: article.links?.web?.href || 'https://www.espn.com/nhl/',
        imageUrl: best?.url ? String(best.url) : '',
        source: 'ESPN',
        category: categorize(`${headline} ${description}`),
        publishedAt: String(article.published || new Date().toISOString()),
      };
    })
    .filter((a): a is NewsArticle => a !== null);
}

/**
 * GET /api/news
 *
 * Returns whatever the upstreams actually gave us, newest first. Deliberately
 * returns an EMPTY array when they give us nothing.
 *
 * The previous client-side implementation shipped six hard-coded "articles"
 * ("Trade Deadline Tracker", "Top Waiver Wire Pickups This Week") attributed
 * to NHL.com and ESPN, stamped with rolling "hours ago" timestamps and linked
 * to generic section pages. Those organisations did not write them, the
 * timestamps described nothing, and in August a trade-deadline story is
 * transparently wrong. Attributing invented articles to real newsrooms is not
 * a fallback, so an honest empty list replaces it and the client renders a
 * real empty state.
 */
/**
 * Citrus notes, shaped as articles so the News feed can render one list.
 *
 * These are OURS — generated from our own shot-quality data by
 * CitrusNewsService — so they carry source 'Citrus' and are never presented as
 * anyone else's reporting. They also survive when the wires are down, which
 * means the page has something true to show instead of an empty state.
 */
async function fetchCitrusNotes(limit = 30): Promise<NewsArticle[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('citrus_news')
      .select('id, kind, player_id, headline, body, analysis, severity, published_at')
      .order('published_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.warn('[news] citrus_news query failed:', error.message);
      return [];
    }

    return (data || []).map((row: Record<string, any>) => ({
      id: `citrus-${row.id}`,
      title: String(row.headline),
      description: String(row.body),
      // Citrus notes are not hosted articles; the player card is where the
      // full note lives, so link there rather than inventing a URL.
      url: row.player_id ? `/players?player=${row.player_id}` : '/news',
      imageUrl: '',
      source: 'Citrus',
      category: row.kind === 'goalie-workload' ? 'fantasy' : 'fantasy',
      publishedAt: String(row.published_at),
    }));
  } catch (error) {
    logger.warn('[news] citrus_news unavailable:', error);
    return [];
  }
}

/**
 * GET /api/news/player/:playerId — Citrus notes for one player.
 *
 * Feeds the "Latest News" block on the player card, the same slot Sleeper
 * fills with Rotowire copy.
 */
newsRoutes.get('/player/:playerId', async (c) => {
  const raw = c.req.param('playerId');
  const playerId = Number.parseInt(raw, 10);
  if (!Number.isFinite(playerId)) {
    return fail(c, AppError.badRequest('playerId must be an integer NHL player id'));
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('citrus_news')
      .select('id, kind, headline, body, analysis, severity, tags, published_at, season')
      .eq('player_id', playerId)
      .order('published_at', { ascending: false })
      .limit(5);

    if (error) {
      logger.warn(`[news] player notes query failed for ${playerId}:`, error.message);
      return ok(c, { notes: [] });
    }
    return ok(c, { notes: data || [] });
  } catch (error) {
    logger.warn(`[news] player notes unavailable for ${playerId}:`, error);
    return ok(c, { notes: [] });
  }
});

newsRoutes.get('/', async (c) => {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return ok(c, { articles: cache.articles, cached: true });
  }

  const [nhl, espn, citrus] = await Promise.all([fetchNHL(), fetchESPN(), fetchCitrusNotes()]);

  const cutoff = Date.now() - MAX_ARTICLE_AGE_MS;
  // Citrus notes bypass the staleness window on purpose: a bounce-back read on
  // last season is still true in August, whereas a wire headline from August
  // is not still true in December. The two have different shelf lives.
  const articles = [
    ...[...nhl, ...espn].filter((a) => {
      const t = new Date(a.publishedAt).getTime();
      return !Number.isNaN(t) && t > cutoff;
    }),
    ...citrus,
  ].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  // Only cache a real result. Caching an empty list would hold the page empty
  // for ten minutes past a transient upstream blip.
  if (articles.length > 0) {
    cache = { articles, at: Date.now() };
  }

  return ok(c, { articles, cached: false });
});

export { newsRoutes };

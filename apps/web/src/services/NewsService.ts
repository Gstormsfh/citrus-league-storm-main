/**
 * NewsService - Fetches NHL news from multiple sources: NHL.com + ESPN.
 * Falls back to curated headlines if all APIs are unavailable.
 */

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

// Cache for 10 minutes
let cachedArticles: NewsArticle[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000;

// Max article age — filter out stale content
const MAX_ARTICLE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const FETCH_TIMEOUT = 8000;

/**
 * Categorize an article based on keywords in headline/slug.
 */
function categorizeArticle(text: string): NewsArticle['category'] {
  const lower = text.toLowerCase();
  if (lower.includes('fantasy') || lower.includes('sleeper') || lower.includes('waiver')) return 'fantasy';
  if (lower.includes('trade') || lower.includes('sign') || lower.includes('acquire')) return 'trade';
  if (lower.includes('injur') || lower.includes('day-to-day') || lower.includes('ir ')) return 'injury';
  if (lower.includes('recap') || lower.includes('score') || lower.includes('highlights')) return 'recap';
  if (lower.includes('olympic')) return 'olympics';
  return 'top';
}

/**
 * Fetch news from the NHL public API.
 * Endpoint: https://forge-dapi.d3.nhle.com/v2/content/en-us/stories
 * This is the content API used by NHL.com — CORS-enabled for web.
 */
async function fetchNHLNews(): Promise<NewsArticle[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const resp = await fetch(
      'https://forge-dapi.d3.nhle.com/v2/content/en-us/stories?context.slug=nhl&$skip=0&$top=20',
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`NHL API ${resp.status}`);

    const data = await resp.json();
    const items = data?.items || data?.docs || [];

    interface NHLStoryItem {
      headline?: string;
      title?: string;
      summary?: string;
      subhead?: string;
      slug?: string;
      contentUrl?: string;
      thumbnail?: { templateUrl?: string };
      image?: { templateUrl?: string };
      contentDate?: string;
      date?: string;
      _entityId?: string;
      id?: string;
      fields?: {
        headline?: string;
        summary?: string;
        slug?: string;
        date?: string;
        thumbnail?: { templateUrl?: string };
      };
    }

    return items.slice(0, 20).map((item: NHLStoryItem, idx: number) => {
      const headline = item.headline || item.title || item.fields?.headline || 'NHL News';
      const summary = item.summary || item.subhead || item.fields?.summary || '';
      const slug = item.slug || item.contentUrl || item.fields?.slug || '';
      const img =
        item.thumbnail?.templateUrl?.replace('{formatInstructions}', 't_ratio16_9-size40/f_auto') ||
        item.image?.templateUrl?.replace('{formatInstructions}', 't_ratio16_9-size40/f_auto') ||
        item.fields?.thumbnail?.templateUrl?.replace('{formatInstructions}', 't_ratio16_9-size40/f_auto') ||
        '';
      const date = item.contentDate || item.date || item.fields?.date || new Date().toISOString();

      // NHL.com article URLs live under /news/ — bare slugs need this prefix
      let articleUrl: string;
      if (slug.startsWith('http')) {
        articleUrl = slug;
      } else if (slug.startsWith('/')) {
        articleUrl = `https://www.nhl.com${slug}`;
      } else {
        articleUrl = `https://www.nhl.com/news/${slug}`;
      }

      return {
        id: item._entityId || item.id || `nhl-${idx}`,
        title: headline,
        description: summary,
        url: articleUrl,
        imageUrl: img,
        source: 'NHL.com',
        category: categorizeArticle(headline + ' ' + slug),
        publishedAt: date,
      };
    });
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

/**
 * Fetch news from the ESPN public API.
 * Endpoint: https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news
 * Public JSON API — CORS-enabled for web.
 */
async function fetchESPNNews(): Promise<NewsArticle[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const resp = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news?limit=15',
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`ESPN API ${resp.status}`);

    const data = await resp.json();
    const articles = data?.articles || [];

    interface ESPNArticle {
      id?: number;
      headline?: string;
      description?: string;
      published?: string;
      premium?: boolean;
      links?: { web?: { href?: string } };
      images?: Array<{ url?: string; width?: number; height?: number }>;
    }

    return articles
      .filter((a: ESPNArticle) => !a.premium)
      .slice(0, 15)
      .map((article: ESPNArticle, idx: number) => {
        const headline = article.headline || 'ESPN NHL News';
        const description = article.description || '';
        const url = article.links?.web?.href || 'https://www.espn.com/nhl/';
        const bestImage = article.images?.find((img) => img.width && img.width >= 400);
        const imageUrl = bestImage?.url || article.images?.[0]?.url || '';
        const publishedAt = article.published || new Date().toISOString();

        return {
          id: article.id ? `espn-${article.id}` : `espn-${idx}`,
          title: headline,
          description,
          url,
          imageUrl,
          source: 'ESPN',
          category: categorizeArticle(headline + ' ' + description),
          publishedAt,
        };
      });
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

/**
 * Curated fallback articles — shown only when all live APIs fail.
 */
function getFallbackArticles(): NewsArticle[] {
  const now = new Date();
  return [
    {
      id: 'fb-1',
      title: 'Fantasy Hockey: Top Waiver Wire Pickups This Week',
      description: 'Looking for an edge in your fantasy league? These under-owned players are trending up and available in most leagues.',
      url: 'https://www.nhl.com/news/topic/fantasy',
      imageUrl: '',
      source: 'NHL.com',
      category: 'fantasy',
      publishedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'fb-2',
      title: 'Trade Deadline Tracker: Who\'s Buying, Who\'s Selling',
      description: 'With the NHL trade deadline approaching, teams are positioning themselves for playoff runs. Here\'s the latest intel on the biggest names on the market.',
      url: 'https://www.nhl.com/news',
      imageUrl: '',
      source: 'NHL.com',
      category: 'trade',
      publishedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'fb-3',
      title: 'Injury Report: Key Players on IR and Expected Return Dates',
      description: 'Stay updated on the latest injury news across the NHL. Several fantasy-relevant players are nearing their return from injury.',
      url: 'https://www.nhl.com/news',
      imageUrl: '',
      source: 'NHL.com',
      category: 'injury',
      publishedAt: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'fb-4',
      title: 'Last Night\'s Scores: Highlights and Recaps from Around the NHL',
      description: 'Catch up on all the action from last night\'s games with our full recap coverage including key fantasy takeaways.',
      url: 'https://www.nhl.com/news',
      imageUrl: '',
      source: 'NHL.com',
      category: 'recap',
      publishedAt: new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'fb-5',
      title: 'Fantasy Projections: Rest-of-Season Rankings Update',
      description: 'Our updated rest-of-season projections account for trade deadline moves, schedule difficulty, and recent performance trends.',
      url: 'https://www.espn.com/nhl/',
      imageUrl: '',
      source: 'ESPN',
      category: 'fantasy',
      publishedAt: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 'fb-6',
      title: 'Power Rankings: Who\'s Hot, Who\'s Not Heading Into the Stretch',
      description: 'Our weekly power rankings break down which teams are surging toward the playoffs and which are fading fast.',
      url: 'https://www.nhl.com/news',
      imageUrl: '',
      source: 'NHL.com',
      category: 'top',
      publishedAt: new Date(now.getTime() - 18 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

/**
 * Filter out stale articles (older than 7 days).
 */
function filterStaleArticles(articles: NewsArticle[]): NewsArticle[] {
  const cutoff = Date.now() - MAX_ARTICLE_AGE_MS;
  return articles.filter((a) => {
    const published = new Date(a.publishedAt).getTime();
    return !isNaN(published) && published > cutoff;
  });
}

/**
 * Main entry point — fetches from NHL + ESPN in parallel, merges, and dedupes.
 */
export async function getNewsArticles(): Promise<NewsArticle[]> {
  // Return cache if fresh
  if (cachedArticles && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedArticles;
  }

  // Fetch from both sources in parallel
  const [nhlArticles, espnArticles] = await Promise.all([
    fetchNHLNews(),
    fetchESPNNews(),
  ]);

  // Merge and sort by date (newest first)
  const merged = [...nhlArticles, ...espnArticles]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  // Filter out stale articles
  const fresh = filterStaleArticles(merged);

  if (fresh.length > 0) {
    cachedArticles = fresh;
    cacheTimestamp = Date.now();
    return fresh;
  }

  // Fallback
  const fallback = getFallbackArticles();
  cachedArticles = fallback;
  cacheTimestamp = Date.now();
  return fallback;
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

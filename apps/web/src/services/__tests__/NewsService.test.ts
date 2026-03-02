import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Mock fetch globally
// =============================================================================

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// =============================================================================
// Tests
// =============================================================================

// Each test dynamically imports to reset module-level cache
let getNewsArticles: typeof import('../NewsService').getNewsArticles;
let NEWS_CATEGORIES: typeof import('../NewsService').NEWS_CATEGORIES;

describe('NewsService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('../NewsService');
    getNewsArticles = mod.getNewsArticles;
    NEWS_CATEGORIES = mod.NEWS_CATEGORIES;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // NEWS_CATEGORIES
  // ---------------------------------------------------------------------------
  describe('NEWS_CATEGORIES', () => {
    it('exports expected category keys', () => {
      const keys = NEWS_CATEGORIES.map(c => c.key);
      expect(keys).toContain('all');
      expect(keys).toContain('top');
      expect(keys).toContain('fantasy');
      expect(keys).toContain('trade');
      expect(keys).toContain('injury');
      expect(keys).toContain('recap');
      expect(keys).toContain('olympics');
    });
  });

  // ---------------------------------------------------------------------------
  // getNewsArticles
  // ---------------------------------------------------------------------------
  describe('getNewsArticles', () => {
    const now = new Date();

    const mockNHLResponse = {
      items: [
        {
          headline: 'NHL Fantasy Sleeper Picks',
          summary: 'Top picks for the week',
          slug: 'fantasy-sleeper-picks',
          thumbnail: { templateUrl: 'https://img.nhl.com/{formatInstructions}/photo.jpg' },
          contentDate: new Date(now.getTime() - 1000 * 60 * 60).toISOString(),
          _entityId: 'nhl-1',
        },
        {
          headline: 'Trade Deadline: Team Signs Star',
          summary: 'Big trade today',
          slug: 'trade-deadline',
          contentDate: new Date(now.getTime() - 1000 * 60 * 120).toISOString(),
          _entityId: 'nhl-2',
        },
      ],
    };

    const mockESPNResponse = {
      articles: [
        {
          id: 1001,
          headline: 'Injury Report: Player Day-to-Day',
          description: 'Key player injured',
          published: new Date(now.getTime() - 1000 * 60 * 30).toISOString(),
          links: { web: { href: 'https://espn.com/nhl/story/1' } },
          images: [{ url: 'https://espn.com/img.jpg', width: 600, height: 400 }],
        },
      ],
    };

    it('fetches from NHL + ESPN and merges results sorted by date', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockNHLResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockESPNResponse),
        });

      const articles = await getNewsArticles();

      expect(articles.length).toBe(3);
      // ESPN article is newest (30 min ago), should be first
      expect(articles[0].source).toBe('ESPN');
      expect(articles[0].category).toBe('injury');
      // NHL articles follow
      expect(articles[1].source).toBe('NHL.com');
    });

    it('categorizes articles based on keywords', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockNHLResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ articles: [] }),
        });

      const articles = await getNewsArticles();

      const fantasyArticle = articles.find(a => a.title.includes('Fantasy'));
      expect(fantasyArticle?.category).toBe('fantasy');

      const tradeArticle = articles.find(a => a.title.includes('Trade'));
      expect(tradeArticle?.category).toBe('trade');
    });

    it('generates correct NHL.com article URLs from slugs', async () => {
      const nhlResponse = {
        items: [
          {
            headline: 'Test Article',
            slug: 'my-article',
            contentDate: now.toISOString(),
            _entityId: 'test-1',
          },
          {
            headline: 'Test Article 2',
            slug: '/news/other-article',
            contentDate: now.toISOString(),
            _entityId: 'test-2',
          },
          {
            headline: 'Test Article 3',
            slug: 'https://custom.url/article',
            contentDate: now.toISOString(),
            _entityId: 'test-3',
          },
        ],
      };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(nhlResponse) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ articles: [] }) });

      const articles = await getNewsArticles();

      // Bare slug -> /news/ prefix
      expect(articles.find(a => a.id === 'test-1')?.url).toBe('https://www.nhl.com/news/my-article');
      // Leading slash -> domain prefix only
      expect(articles.find(a => a.id === 'test-2')?.url).toBe('https://www.nhl.com/news/other-article');
      // Full URL -> kept as-is
      expect(articles.find(a => a.id === 'test-3')?.url).toBe('https://custom.url/article');
    });

    it('returns fallback articles when all APIs fail', async () => {
      mockFetch.mockRejectedValue(new Error('network error'));

      const articles = await getNewsArticles();

      // Should return fallback articles
      expect(articles.length).toBeGreaterThan(0);
      expect(articles[0].id).toMatch(/^fb-/);
    });

    it('filters premium ESPN articles', async () => {
      const espnWithPremium = {
        articles: [
          {
            id: 1,
            headline: 'Free Article',
            premium: false,
            published: now.toISOString(),
          },
          {
            id: 2,
            headline: 'Premium Article',
            premium: true,
            published: now.toISOString(),
          },
        ],
      };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ items: [] }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(espnWithPremium) });

      const articles = await getNewsArticles();

      const premiumArticle = articles.find(a => a.title === 'Premium Article');
      expect(premiumArticle).toBeUndefined();
    });

    it('returns cached results on second call within TTL', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockNHLResponse) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockESPNResponse) });

      const first = await getNewsArticles();
      const second = await getNewsArticles();

      // Should only call fetch twice (one for each source on first call)
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(first).toEqual(second);
    });

    it('filters out stale articles older than 7 days', async () => {
      const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const freshDate = new Date(Date.now() - 1000 * 60 * 60).toISOString();

      const nhlResponse = {
        items: [
          {
            headline: 'Old Article',
            contentDate: staleDate,
            _entityId: 'old-1',
            slug: 'old',
          },
          {
            headline: 'Fresh Article',
            contentDate: freshDate,
            _entityId: 'fresh-1',
            slug: 'fresh',
          },
        ],
      };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(nhlResponse) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ articles: [] }) });

      const articles = await getNewsArticles();

      expect(articles.find(a => a.title === 'Old Article')).toBeUndefined();
      expect(articles.find(a => a.title === 'Fresh Article')).toBeDefined();
    });
  });
});

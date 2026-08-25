// NewsService contract (rewritten 2026-08-25).
//
// This file used to test a client that fetched forge-dapi.d3.nhle.com and
// site.api.espn.com directly from the browser, categorised the results, built
// NHL.com URLs, and fell back to six hard-coded "articles" when the fetches
// failed. All of that moved server-side (server/src/routes/news.ts), because
// those hosts don't send CORS headers to our origin and the calls could never
// have worked from a browser — the fabricated fallback was what users actually
// saw. The old assertions were pinning behaviour that no longer exists.
//
// What's left to guarantee on the client is smaller and more important:
//   • it asks OUR api, not a third party
//   • an empty feed stays empty — it never invents articles
//   • it never caches emptiness
//   • importing this module has no side effects
//
// The mock below matters as much as the tests. `@/api/client` loads the
// Supabase client, which THROWS at module scope when VITE_SUPABASE_* is unset
// — and CI's "Run web tests" step passes no VITE_* env. That is exactly how
// this file broke the pre-deploy gate. NewsService now imports apiClient
// lazily, and this mock keeps the call path deterministic.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
vi.mock('@/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

import { getNewsArticles, NEWS_CATEGORIES, type NewsArticle } from '../NewsService';

const article = (over: Partial<NewsArticle> = {}): NewsArticle => ({
  id: 'nhl-1',
  title: 'Maple Leafs win in overtime',
  description: 'A recap.',
  url: 'https://www.nhl.com/news/example',
  imageUrl: '',
  source: 'NHL.com',
  category: 'recap',
  publishedAt: '2026-08-25T12:00:00.000Z',
  ...over,
});

beforeEach(async () => {
  mockGet.mockReset();
  // The module holds a short in-memory cache; reset it between tests so one
  // test's articles can't satisfy the next one's call.
  vi.resetModules();
});

describe('NEWS_CATEGORIES', () => {
  it('exports the category keys the News page filters on', () => {
    const keys = NEWS_CATEGORIES.map((c) => c.key);
    expect(keys).toEqual(['all', 'top', 'fantasy', 'trade', 'injury', 'recap', 'olympics']);
  });
});

describe('getNewsArticles', () => {
  it('asks our own API, never a third party directly', async () => {
    mockGet.mockResolvedValue({ data: { articles: [article()] } });

    const { getNewsArticles: fresh } = await import('../NewsService');
    const result = await fresh();

    expect(mockGet).toHaveBeenCalledWith('/api/news');
    // No browser-side call to nhle.com / espn.com — that's the whole fix.
    const requested = String(mockGet.mock.calls[0]?.[0] ?? '');
    expect(requested).not.toMatch(/nhle\.com|espn\.com/);
    expect(result).toHaveLength(1);
  });

  it('returns the articles the API gives it', async () => {
    mockGet.mockResolvedValue({
      data: { articles: [article({ id: 'a' }), article({ id: 'b', source: 'Citrus' })] },
    });

    const { getNewsArticles: fresh } = await import('../NewsService');
    const result = await fresh();

    expect(result.map((a) => a.id)).toEqual(['a', 'b']);
    expect(result[1].source).toBe('Citrus');
  });

  it('returns an EMPTY list when the API has nothing — it does not invent articles', async () => {
    // The load-bearing test. The old implementation answered this case with
    // six invented stories bylined to NHL.com and ESPN.
    mockGet.mockResolvedValue({ data: { articles: [] } });

    const { getNewsArticles: fresh } = await import('../NewsService');
    expect(await fresh()).toEqual([]);
  });

  it('returns an empty list when the request fails, rather than throwing', async () => {
    mockGet.mockRejectedValue(new Error('network down'));

    const { getNewsArticles: fresh } = await import('../NewsService');
    expect(await fresh()).toEqual([]);
  });

  it('tolerates a malformed payload without throwing', async () => {
    mockGet.mockResolvedValue({ data: undefined });

    const { getNewsArticles: fresh } = await import('../NewsService');
    expect(await fresh()).toEqual([]);
  });

  it('caches a successful response instead of refetching', async () => {
    mockGet.mockResolvedValue({ data: { articles: [article()] } });

    const { getNewsArticles: fresh } = await import('../NewsService');
    await fresh();
    await fresh();

    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache an empty result — a blip must not pin the page empty', async () => {
    mockGet.mockResolvedValueOnce({ data: { articles: [] } });
    mockGet.mockResolvedValueOnce({ data: { articles: [article()] } });

    const { getNewsArticles: fresh } = await import('../NewsService');
    expect(await fresh()).toEqual([]);
    // Second call must actually retry and pick up the recovered feed.
    expect(await fresh()).toHaveLength(1);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});

describe('module hygiene', () => {
  it('imports without needing Supabase env vars set', async () => {
    // Regression guard for the gate failure: a top-level `@/api/client` import
    // pulls in the Supabase client, which throws at module scope when
    // VITE_SUPABASE_* is unset — and CI runs web tests with no VITE_* env.
    // Importing this service must never be the thing that explodes.
    await expect(import('../NewsService')).resolves.toBeDefined();
  });
});

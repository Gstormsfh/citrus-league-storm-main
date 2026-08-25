import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Mock environment variables (import.meta.env)
// =============================================================================

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// =============================================================================
// Import after global stubs
// =============================================================================

// We need to dynamically import because the module reads import.meta.env at call time
let DemoMatchupCacheService: typeof import('../DemoMatchupCacheService').DemoMatchupCacheService;

// =============================================================================
// Tests
// =============================================================================

describe('DemoMatchupCacheService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Set env vars
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');

    // Re-import to get fresh module state (clear client cache)
    vi.resetModules();
    const mod = await import('../DemoMatchupCacheService');
    DemoMatchupCacheService = mod.DemoMatchupCacheService;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  const mockPayload = {
    league: { id: 'league-1' },
    matchup: { id: 'matchup-1' },
    allWeekMatchups: [],
    team1: { id: 'team-1' },
    team2: { id: 'team-2' },
    team1Lineup: null,
    team2Lineup: null,
    players: [],
    playerStats: [],
    team1DailyScores: [],
    team2DailyScores: [],
    availableWeeks: [1, 2, 3],
    week: 1,
    cachedAt: '2025-01-15T00:00:00Z',
  };

  // ---------------------------------------------------------------------------
  // getPayload
  // ---------------------------------------------------------------------------
  describe('getPayload', () => {
    it('fetches from the API server with correct URL and headers', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockPayload }),
      });

      const result = await DemoMatchupCacheService.getPayload();

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/demo/matchup',
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      expect(result).toEqual(mockPayload);
    });

    it('appends week query parameter when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { ...mockPayload, week: 5 } }),
      });

      await DemoMatchupCacheService.getPayload(5);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/demo/matchup?week=5',
        expect.any(Object)
      );
    });

    it('returns cached data on subsequent calls within TTL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockPayload }),
      });

      // First call
      const result1 = await DemoMatchupCacheService.getPayload();
      // Second call should not fetch again
      const result2 = await DemoMatchupCacheService.getPayload();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result1).toEqual(result2);
    });

    it('re-fetches after client cache expires (1 minute)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockPayload }),
      });

      // First call
      await DemoMatchupCacheService.getPayload();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance past TTL
      vi.advanceTimersByTime(61_000);

      // Second call should re-fetch
      await DemoMatchupCacheService.getPayload();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws when fetch returns non-OK response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(DemoMatchupCacheService.getPayload()).rejects.toThrow(
        'Demo payload fetch failed (500): Internal Server Error'
      );
    });

    // Chunk 11g.9: the old 'throws when environment variables are
    // missing' test is gone with the Edge Function — the service no
    // longer reads VITE_SUPABASE_* at all, it posts to the API server.
    // What replaced it is envelope unwrapping, tested here.
    it('unwraps the { data } API envelope', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockPayload }),
      });

      const result = await DemoMatchupCacheService.getPayload();
      expect(result).toEqual(mockPayload);
      expect(result).not.toHaveProperty('data');
    });

    it('tolerates a bare payload with no envelope', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPayload),
      });

      const result = await DemoMatchupCacheService.getPayload();
      expect(result).toEqual(mockPayload);
    });

    it('re-fetches when requested week differs from cached week', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: { ...mockPayload, week: 1 } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: { ...mockPayload, week: 3 } }),
        });

      await DemoMatchupCacheService.getPayload(1);
      await DemoMatchupCacheService.getPayload(3);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // clearCache
  // ---------------------------------------------------------------------------
  describe('clearCache', () => {
    it('forces re-fetch after cache is cleared', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockPayload }),
      });

      await DemoMatchupCacheService.getPayload();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      DemoMatchupCacheService.clearCache();

      await DemoMatchupCacheService.getPayload();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});

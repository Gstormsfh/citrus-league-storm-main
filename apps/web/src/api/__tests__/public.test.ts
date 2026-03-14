import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock apiClient — we mock the client module but NOT the cache.
// =============================================================================

vi.mock('../client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { apiClient } from '../client';
import { publicApi } from '../public';

const mockGet = apiClient.get as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as ReturnType<typeof vi.fn>;

// =============================================================================
// Helpers
// =============================================================================

const LEAGUE_ID = 'league-abc-123';
const TEAM_ID = 'team-xyz-456';
const MATCHUP_ID = 'matchup-789';

// =============================================================================
// Tests
// =============================================================================

describe('publicApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publicApi.clearCache();
  });

  // ---------------------------------------------------------------------------
  // getLeague
  // ---------------------------------------------------------------------------
  describe('getLeague', () => {
    it('calls apiClient.get with correct path', async () => {
      mockGet.mockResolvedValueOnce({ data: { id: LEAGUE_ID } });

      await publicApi.getLeague(LEAGUE_ID);

      expect(mockGet).toHaveBeenCalledWith(`/api/public/leagues/${LEAGUE_ID}`);
    });

    it('returns cached result on second call', async () => {
      mockGet.mockResolvedValueOnce({ data: { id: LEAGUE_ID } });

      const first = await publicApi.getLeague(LEAGUE_ID);
      const second = await publicApi.getLeague(LEAGUE_ID);

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });
  });

  // ---------------------------------------------------------------------------
  // getTeams
  // ---------------------------------------------------------------------------
  describe('getTeams', () => {
    it('calls apiClient.get with correct path', async () => {
      mockGet.mockResolvedValueOnce({ data: [{ id: 't1' }] });

      await publicApi.getTeams(LEAGUE_ID);

      expect(mockGet).toHaveBeenCalledWith(`/api/public/leagues/${LEAGUE_ID}/teams`);
    });

    it('returns cached result on second call', async () => {
      mockGet.mockResolvedValueOnce({ data: [{ id: 't1' }] });

      const first = await publicApi.getTeams(LEAGUE_ID);
      const second = await publicApi.getTeams(LEAGUE_ID);

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });
  });

  // ---------------------------------------------------------------------------
  // getPlayerIds
  // ---------------------------------------------------------------------------
  describe('getPlayerIds', () => {
    it('calls apiClient.get with correct path', async () => {
      mockGet.mockResolvedValueOnce({ data: [1, 2, 3] });

      await publicApi.getPlayerIds(LEAGUE_ID, TEAM_ID);

      expect(mockGet).toHaveBeenCalledWith(
        `/api/public/leagues/${LEAGUE_ID}/teams/${TEAM_ID}/player-ids`,
      );
    });

    it('returns cached result on second call', async () => {
      mockGet.mockResolvedValueOnce({ data: [1, 2, 3] });

      const first = await publicApi.getPlayerIds(LEAGUE_ID, TEAM_ID);
      const second = await publicApi.getPlayerIds(LEAGUE_ID, TEAM_ID);

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });
  });

  // ---------------------------------------------------------------------------
  // getLeagueMatchups
  // ---------------------------------------------------------------------------
  describe('getLeagueMatchups', () => {
    it('calls apiClient.get without query param when week is not provided', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      await publicApi.getLeagueMatchups(LEAGUE_ID);

      expect(mockGet).toHaveBeenCalledWith(`/api/public/matchups/league/${LEAGUE_ID}`);
    });

    it('calls apiClient.get with ?week= query param when week is provided', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      await publicApi.getLeagueMatchups(LEAGUE_ID, 5);

      expect(mockGet).toHaveBeenCalledWith(`/api/public/matchups/league/${LEAGUE_ID}?week=5`);
    });

    it('returns cached result on second call', async () => {
      mockGet.mockResolvedValueOnce({ data: [{ id: 'm1' }] });

      const first = await publicApi.getLeagueMatchups(LEAGUE_ID, 3);
      const second = await publicApi.getLeagueMatchups(LEAGUE_ID, 3);

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it('caches different weeks separately', async () => {
      mockGet.mockResolvedValueOnce({ data: [{ week: 1 }] });
      mockGet.mockResolvedValueOnce({ data: [{ week: 2 }] });

      const week1 = await publicApi.getLeagueMatchups(LEAGUE_ID, 1);
      const week2 = await publicApi.getLeagueMatchups(LEAGUE_ID, 2);

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(week1).not.toBe(week2);
    });
  });

  // ---------------------------------------------------------------------------
  // getDailyScores
  // ---------------------------------------------------------------------------
  describe('getDailyScores', () => {
    it('calls apiClient.get with correct path', async () => {
      mockGet.mockResolvedValueOnce({ data: { scores: [] } });

      await publicApi.getDailyScores(MATCHUP_ID);

      expect(mockGet).toHaveBeenCalledWith(`/api/public/matchups/${MATCHUP_ID}/daily-scores`);
    });

    it('returns cached result on second call', async () => {
      mockGet.mockResolvedValueOnce({ data: { scores: [] } });

      const first = await publicApi.getDailyScores(MATCHUP_ID);
      const second = await publicApi.getDailyScores(MATCHUP_ID);

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });
  });

  // ---------------------------------------------------------------------------
  // joinWaitlist
  // ---------------------------------------------------------------------------
  describe('joinWaitlist', () => {
    it('calls apiClient.post with correct path and body', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true } });

      await publicApi.joinWaitlist('test@example.com', 'homepage');

      expect(mockPost).toHaveBeenCalledWith('/api/public/waitlist', {
        email: 'test@example.com',
        source: 'homepage',
      });
    });

    it('is not cached (every call hits network)', async () => {
      mockPost.mockResolvedValue({ data: { success: true } });

      await publicApi.joinWaitlist('a@b.com', 'landing');
      await publicApi.joinWaitlist('a@b.com', 'landing');

      expect(mockPost).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // clearCache
  // ---------------------------------------------------------------------------
  describe('clearCache', () => {
    it('clears all cached entries so subsequent calls hit the network', async () => {
      mockGet.mockResolvedValueOnce({ data: { id: LEAGUE_ID } });
      await publicApi.getLeague(LEAGUE_ID);

      mockGet.mockResolvedValueOnce({ data: [{ id: 't1' }] });
      await publicApi.getTeams(LEAGUE_ID);

      expect(mockGet).toHaveBeenCalledTimes(2);

      publicApi.clearCache();

      mockGet.mockResolvedValueOnce({ data: { id: LEAGUE_ID } });
      await publicApi.getLeague(LEAGUE_ID);

      mockGet.mockResolvedValueOnce({ data: [{ id: 't1' }] });
      await publicApi.getTeams(LEAGUE_ID);

      expect(mockGet).toHaveBeenCalledTimes(4);
    });
  });

  // ---------------------------------------------------------------------------
  // invalidate
  // ---------------------------------------------------------------------------
  describe('invalidate', () => {
    it('invalidates entries matching a prefix', async () => {
      mockGet.mockResolvedValueOnce({ data: { id: LEAGUE_ID } });
      await publicApi.getLeague(LEAGUE_ID);

      mockGet.mockResolvedValueOnce({ data: [{ id: 't1' }] });
      await publicApi.getTeams(LEAGUE_ID);

      expect(mockGet).toHaveBeenCalledTimes(2);

      // Both keys start with "public:leagues:league-abc-123"
      publicApi.invalidate(`public:leagues:${LEAGUE_ID}`);

      mockGet.mockResolvedValueOnce({ data: { id: LEAGUE_ID } });
      await publicApi.getLeague(LEAGUE_ID);

      mockGet.mockResolvedValueOnce({ data: [{ id: 't1' }] });
      await publicApi.getTeams(LEAGUE_ID);

      expect(mockGet).toHaveBeenCalledTimes(4);
    });

    it('does not invalidate entries that do not match the prefix', async () => {
      mockGet.mockResolvedValueOnce({ data: { id: LEAGUE_ID } });
      await publicApi.getLeague(LEAGUE_ID);

      mockGet.mockResolvedValueOnce({ data: { scores: [] } });
      await publicApi.getDailyScores(MATCHUP_ID);

      expect(mockGet).toHaveBeenCalledTimes(2);

      // Invalidate only league entries, not matchup entries
      publicApi.invalidate(`public:leagues:${LEAGUE_ID}`);

      // getLeague should re-fetch
      mockGet.mockResolvedValueOnce({ data: { id: LEAGUE_ID } });
      await publicApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(3);

      // getDailyScores should still be cached
      const cached = await publicApi.getDailyScores(MATCHUP_ID);
      expect(mockGet).toHaveBeenCalledTimes(3);
      expect(cached).toEqual({ data: { scores: [] } });
    });
  });
});

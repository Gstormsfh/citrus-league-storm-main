import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock apiClient — we mock the client module but NOT the cache.
// We also mock the supabase client to prevent transitive import failures.
// =============================================================================

vi.mock('../client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

import { apiClient } from '../client';
import { rosterApi } from '../rosters';

const mockGet = apiClient.get as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as ReturnType<typeof vi.fn>;
const mockPut = apiClient.put as ReturnType<typeof vi.fn>;

// =============================================================================
// Tests
// =============================================================================

describe('rosterApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rosterApi.clearCache();
  });

  // ---------------------------------------------------------------------------
  // getTeamRoster
  // ---------------------------------------------------------------------------
  describe('getTeamRoster', () => {
    it('calls apiClient.get with the correct path', async () => {
      mockGet.mockResolvedValueOnce({ data: [{ id: 'r1' }] });

      const result = await rosterApi.getTeamRoster('league-1', 'team-1');

      expect(mockGet).toHaveBeenCalledWith('/api/rosters/league/league-1/team/team-1');
      expect(result).toEqual({ data: [{ id: 'r1' }] });
    });

    it('returns cached result on second call', async () => {
      mockGet.mockResolvedValueOnce({ data: [{ id: 'r1' }] });

      await rosterApi.getTeamRoster('league-1', 'team-1');
      const result = await rosterApi.getTeamRoster('league-1', 'team-1');

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: [{ id: 'r1' }] });
    });
  });

  // ---------------------------------------------------------------------------
  // getPlayerIds
  // ---------------------------------------------------------------------------
  describe('getPlayerIds', () => {
    it('calls apiClient.get with the correct path', async () => {
      mockGet.mockResolvedValueOnce({ data: [1, 2, 3] });

      const result = await rosterApi.getPlayerIds('league-1', 'team-1');

      expect(mockGet).toHaveBeenCalledWith('/api/rosters/league/league-1/team/team-1/player-ids');
      expect(result).toEqual({ data: [1, 2, 3] });
    });

    it('returns cached result on second call', async () => {
      mockGet.mockResolvedValueOnce({ data: [1, 2, 3] });

      await rosterApi.getPlayerIds('league-1', 'team-1');
      const result = await rosterApi.getPlayerIds('league-1', 'team-1');

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: [1, 2, 3] });
    });
  });

  // ---------------------------------------------------------------------------
  // getLeagueRosters
  // ---------------------------------------------------------------------------
  describe('getLeagueRosters', () => {
    it('calls apiClient.get with the correct path', async () => {
      mockGet.mockResolvedValueOnce({ data: [{ team: 'a' }, { team: 'b' }] });

      const result = await rosterApi.getLeagueRosters('league-1');

      expect(mockGet).toHaveBeenCalledWith('/api/rosters/league/league-1');
      expect(result).toEqual({ data: [{ team: 'a' }, { team: 'b' }] });
    });

    it('returns cached result on second call', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      await rosterApi.getLeagueRosters('league-1');
      const result = await rosterApi.getLeagueRosters('league-1');

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: [] });
    });
  });

  // ---------------------------------------------------------------------------
  // getLineup
  // ---------------------------------------------------------------------------
  describe('getLineup', () => {
    it('calls apiClient.get with the correct path', async () => {
      mockGet.mockResolvedValueOnce({ data: { starters: ['p1'] } });

      const result = await rosterApi.getLineup('league-1', 'team-1');

      expect(mockGet).toHaveBeenCalledWith('/api/rosters/league/league-1/team/team-1/lineup');
      expect(result).toEqual({ data: { starters: ['p1'] } });
    });

    it('returns cached result on second call', async () => {
      mockGet.mockResolvedValueOnce({ data: { starters: ['p1'] } });

      await rosterApi.getLineup('league-1', 'team-1');
      const result = await rosterApi.getLineup('league-1', 'team-1');

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: { starters: ['p1'] } });
    });
  });

  // ---------------------------------------------------------------------------
  // getDailyRoster
  // ---------------------------------------------------------------------------
  describe('getDailyRoster', () => {
    it('calls apiClient.get with correct query parameters', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      await rosterApi.getDailyRoster('team-1', 'matchup-1', '2026-03-14');

      expect(mockGet).toHaveBeenCalledWith(
        '/api/rosters/daily-roster?team_id=team-1&matchup_id=matchup-1&roster_date=2026-03-14',
      );
    });

    it('returns cached result on second call', async () => {
      mockGet.mockResolvedValueOnce({ data: ['entry1'] });

      await rosterApi.getDailyRoster('team-1', 'matchup-1', '2026-03-14');
      const result = await rosterApi.getDailyRoster('team-1', 'matchup-1', '2026-03-14');

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: ['entry1'] });
    });
  });

  // ---------------------------------------------------------------------------
  // getRosterCount
  // ---------------------------------------------------------------------------
  describe('getRosterCount', () => {
    it('calls apiClient.get with the correct path', async () => {
      mockGet.mockResolvedValueOnce({ data: { count: 15 } });

      const result = await rosterApi.getRosterCount('league-1', 'team-1');

      expect(mockGet).toHaveBeenCalledWith('/api/rosters/league/league-1/team/team-1/roster-count');
      expect(result).toEqual({ data: { count: 15 } });
    });

    it('returns cached result on second call', async () => {
      mockGet.mockResolvedValueOnce({ data: { count: 15 } });

      await rosterApi.getRosterCount('league-1', 'team-1');
      const result = await rosterApi.getRosterCount('league-1', 'team-1');

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: { count: 15 } });
    });
  });

  // ---------------------------------------------------------------------------
  // canUpdateRoster
  // ---------------------------------------------------------------------------
  describe('canUpdateRoster', () => {
    it('constructs correct query string with playerIds', async () => {
      mockGet.mockResolvedValueOnce({ data: { canUpdate: true } });

      await rosterApi.canUpdateRoster('2026-03-14', [101, 202, 303]);

      expect(mockGet).toHaveBeenCalledWith(
        '/api/rosters/can-update?date=2026-03-14&player_ids=101,202,303',
      );
    });

    it('handles empty playerIds array', async () => {
      mockGet.mockResolvedValueOnce({ data: { canUpdate: true } });

      await rosterApi.canUpdateRoster('2026-03-14', []);

      expect(mockGet).toHaveBeenCalledWith(
        '/api/rosters/can-update?date=2026-03-14&player_ids=',
      );
    });

    it('handles single playerId', async () => {
      mockGet.mockResolvedValueOnce({ data: { canUpdate: false } });

      await rosterApi.canUpdateRoster('2026-03-14', [42]);

      expect(mockGet).toHaveBeenCalledWith(
        '/api/rosters/can-update?date=2026-03-14&player_ids=42',
      );
    });

    it('is not cached (calls apiClient every time)', async () => {
      mockGet.mockResolvedValue({ data: { canUpdate: true } });

      await rosterApi.canUpdateRoster('2026-03-14', [1]);
      await rosterApi.canUpdateRoster('2026-03-14', [1]);

      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // saveLineup — mutation that invalidates cache
  // ---------------------------------------------------------------------------
  describe('saveLineup', () => {
    it('calls apiClient.put with correct path and body', async () => {
      mockPut.mockResolvedValueOnce({ data: { success: true } });
      const lineup = { starters: ['p1', 'p2'], bench: ['p3'] };

      const result = await rosterApi.saveLineup('league-1', 'team-1', lineup);

      expect(mockPut).toHaveBeenCalledWith(
        '/api/rosters/league/league-1/team/team-1/lineup',
        lineup,
      );
      expect(result).toEqual({ data: { success: true } });
    });

    it('invalidates team roster cache', async () => {
      // Prime the cache
      mockGet.mockResolvedValueOnce({ data: { cached: true } });
      await rosterApi.getTeamRoster('league-1', 'team-1');
      expect(mockGet).toHaveBeenCalledTimes(1);

      // Mutate
      mockPut.mockResolvedValueOnce({ data: { success: true } });
      await rosterApi.saveLineup('league-1', 'team-1', { starters: ['p1'] });

      // Next read should hit the network again
      mockGet.mockResolvedValueOnce({ data: { fresh: true } });
      const result = await rosterApi.getTeamRoster('league-1', 'team-1');

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ data: { fresh: true } });
    });

    it('passes optional fields like target_date and allow_player_removal', async () => {
      mockPut.mockResolvedValueOnce({ data: { success: true } });
      const lineup = {
        starters: ['p1'],
        bench: [],
        ir: [],
        slot_assignments: { p1: 'C' },
        target_date: '2026-03-15',
        allow_player_removal: true,
      };

      await rosterApi.saveLineup('league-1', 'team-1', lineup);

      expect(mockPut).toHaveBeenCalledWith(
        '/api/rosters/league/league-1/team/team-1/lineup',
        lineup,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // updateLineup — mutation that invalidates cache
  // ---------------------------------------------------------------------------
  describe('updateLineup', () => {
    it('calls apiClient.put with correct path and body', async () => {
      mockPut.mockResolvedValueOnce({ data: { success: true } });
      const lineup = { starters: ['p1'], bench: ['p2'], ir: [] };

      await rosterApi.updateLineup('league-1', 'team-1', lineup);

      expect(mockPut).toHaveBeenCalledWith(
        '/api/rosters/league/league-1/team/team-1/lineup',
        lineup,
      );
    });

    it('invalidates team roster cache', async () => {
      mockGet.mockResolvedValueOnce({ data: { old: true } });
      await rosterApi.getTeamRoster('league-1', 'team-1');

      mockPut.mockResolvedValueOnce({ data: {} });
      await rosterApi.updateLineup('league-1', 'team-1', { starters: [] });

      mockGet.mockResolvedValueOnce({ data: { new: true } });
      const result = await rosterApi.getTeamRoster('league-1', 'team-1');

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ data: { new: true } });
    });
  });

  // ---------------------------------------------------------------------------
  // initializeLineup — mutation that invalidates cache
  // ---------------------------------------------------------------------------
  describe('initializeLineup', () => {
    it('calls apiClient.post with correct path and empty body', async () => {
      mockPost.mockResolvedValueOnce({ data: { initialized: true } });

      const result = await rosterApi.initializeLineup('league-1', 'team-1');

      expect(mockPost).toHaveBeenCalledWith(
        '/api/rosters/league/league-1/team/team-1/initialize',
        {},
      );
      expect(result).toEqual({ data: { initialized: true } });
    });

    it('invalidates team roster cache', async () => {
      mockGet.mockResolvedValueOnce({ data: { before: true } });
      await rosterApi.getTeamRoster('league-1', 'team-1');

      mockPost.mockResolvedValueOnce({ data: {} });
      await rosterApi.initializeLineup('league-1', 'team-1');

      mockGet.mockResolvedValueOnce({ data: { after: true } });
      const result = await rosterApi.getTeamRoster('league-1', 'team-1');

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ data: { after: true } });
    });
  });

  // ---------------------------------------------------------------------------
  // syncRosters — mutation that invalidates cache
  // ---------------------------------------------------------------------------
  describe('syncRosters', () => {
    it('calls apiClient.post with correct path and empty body', async () => {
      mockPost.mockResolvedValueOnce({ data: { synced: true } });

      const result = await rosterApi.syncRosters('league-1');

      expect(mockPost).toHaveBeenCalledWith(
        '/api/rosters/league/league-1/sync',
        {},
      );
      expect(result).toEqual({ data: { synced: true } });
    });

    it('invalidates league-level roster caches', async () => {
      // Prime league roster cache and a team roster cache (both share league-1 prefix)
      mockGet.mockResolvedValueOnce({ data: { all: true } });
      await rosterApi.getLeagueRosters('league-1');

      mockGet.mockResolvedValueOnce({ data: { team: true } });
      await rosterApi.getTeamRoster('league-1', 'team-1');

      expect(mockGet).toHaveBeenCalledTimes(2);

      // syncRosters invalidates prefix "rosters:league-1"
      mockPost.mockResolvedValueOnce({ data: {} });
      await rosterApi.syncRosters('league-1');

      // Both should re-fetch
      mockGet.mockResolvedValueOnce({ data: { allFresh: true } });
      await rosterApi.getLeagueRosters('league-1');

      mockGet.mockResolvedValueOnce({ data: { teamFresh: true } });
      await rosterApi.getTeamRoster('league-1', 'team-1');

      expect(mockGet).toHaveBeenCalledTimes(4);
    });
  });

  // ---------------------------------------------------------------------------
  // backfillDailyRosters
  // ---------------------------------------------------------------------------
  describe('backfillDailyRosters', () => {
    it('calls apiClient.post with matchup_id in body', async () => {
      mockPost.mockResolvedValueOnce({ data: { backfilled: 5 } });

      const result = await rosterApi.backfillDailyRosters('league-1', 'team-1', 'matchup-99');

      expect(mockPost).toHaveBeenCalledWith(
        '/api/rosters/league/league-1/team/team-1/backfill',
        { matchup_id: 'matchup-99' },
      );
      expect(result).toEqual({ data: { backfilled: 5 } });
    });
  });

  // ---------------------------------------------------------------------------
  // backfillAllMatchups
  // ---------------------------------------------------------------------------
  describe('backfillAllMatchups', () => {
    it('calls apiClient.post with correct path and empty body', async () => {
      mockPost.mockResolvedValueOnce({ data: { ok: true } });

      const result = await rosterApi.backfillAllMatchups('league-1');

      expect(mockPost).toHaveBeenCalledWith(
        '/api/rosters/league/league-1/backfill-all',
        {},
      );
      expect(result).toEqual({ data: { ok: true } });
    });
  });

  // ---------------------------------------------------------------------------
  // clearCache
  // ---------------------------------------------------------------------------
  describe('clearCache', () => {
    it('clears all cached entries so subsequent calls hit the network', async () => {
      mockGet.mockResolvedValueOnce({ data: { a: 1 } });
      await rosterApi.getTeamRoster('league-1', 'team-1');

      mockGet.mockResolvedValueOnce({ data: { b: 2 } });
      await rosterApi.getLeagueRosters('league-1');

      expect(mockGet).toHaveBeenCalledTimes(2);

      rosterApi.clearCache();

      mockGet.mockResolvedValueOnce({ data: { a: 10 } });
      await rosterApi.getTeamRoster('league-1', 'team-1');

      mockGet.mockResolvedValueOnce({ data: { b: 20 } });
      await rosterApi.getLeagueRosters('league-1');

      expect(mockGet).toHaveBeenCalledTimes(4);
    });
  });

  // ---------------------------------------------------------------------------
  // invalidate
  // ---------------------------------------------------------------------------
  describe('invalidate', () => {
    it('invalidates entries matching a prefix', async () => {
      mockGet.mockResolvedValueOnce({ data: { roster: true } });
      await rosterApi.getTeamRoster('league-1', 'team-1');

      mockGet.mockResolvedValueOnce({ data: { ids: true } });
      await rosterApi.getPlayerIds('league-1', 'team-1');

      // Both keys start with "rosters:league-1:team-1"
      rosterApi.invalidate('rosters:league-1:team-1');

      mockGet.mockResolvedValueOnce({ data: { rosterFresh: true } });
      const r1 = await rosterApi.getTeamRoster('league-1', 'team-1');

      mockGet.mockResolvedValueOnce({ data: { idsFresh: true } });
      const r2 = await rosterApi.getPlayerIds('league-1', 'team-1');

      expect(mockGet).toHaveBeenCalledTimes(4);
      expect(r1).toEqual({ data: { rosterFresh: true } });
      expect(r2).toEqual({ data: { idsFresh: true } });
    });

    it('does not invalidate entries that do not match the prefix', async () => {
      mockGet.mockResolvedValueOnce({ data: { team1: true } });
      await rosterApi.getTeamRoster('league-1', 'team-1');

      mockGet.mockResolvedValueOnce({ data: { team2: true } });
      await rosterApi.getTeamRoster('league-1', 'team-2');

      // Invalidate only team-1
      rosterApi.invalidate('rosters:league-1:team-1');

      mockGet.mockResolvedValueOnce({ data: { team1Fresh: true } });
      await rosterApi.getTeamRoster('league-1', 'team-1');

      // team-2 should still be cached
      const result = await rosterApi.getTeamRoster('league-1', 'team-2');

      // get was called 3 times total: team-1 (initial), team-2 (initial), team-1 (after invalidation)
      expect(mockGet).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ data: { team2: true } });
    });
  });
});

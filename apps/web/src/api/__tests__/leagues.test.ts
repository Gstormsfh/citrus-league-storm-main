import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MOCK SETUP
// =============================================================================

const { mockGet, mockPost, mockPut, mockDelete } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockPut: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      refreshSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signOut: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('@/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

// Import AFTER mock setup so the module picks up the mocked client
import { leagueApi } from '../leagues';

// =============================================================================
// HELPERS
// =============================================================================

const LEAGUE_ID = 'league-abc-123';
const TEAM_ID = 'team-xyz-456';

function resolveWith(data: unknown) {
  return Promise.resolve({ data });
}

// =============================================================================
// TESTS
// =============================================================================

describe('leagueApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    leagueApi.clearCache();
  });

  // ---------------------------------------------------------------------------
  // getUserLeagues
  // ---------------------------------------------------------------------------
  describe('getUserLeagues', () => {
    it('calls apiClient.get with correct path', async () => {
      mockGet.mockReturnValue(resolveWith([{ id: '1' }]));
      await leagueApi.getUserLeagues();
      expect(mockGet).toHaveBeenCalledWith('/api/leagues');
    });

    it('returns cached result on second call', async () => {
      mockGet.mockReturnValue(resolveWith([{ id: '1' }]));
      const first = await leagueApi.getUserLeagues();
      const second = await leagueApi.getUserLeagues();
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });
  });

  // ---------------------------------------------------------------------------
  // getLeague
  // ---------------------------------------------------------------------------
  describe('getLeague', () => {
    it('calls apiClient.get with correct path', async () => {
      mockGet.mockReturnValue(resolveWith({ id: LEAGUE_ID }));
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledWith(`/api/leagues/${LEAGUE_ID}`);
    });

    it('returns cached result on second call', async () => {
      mockGet.mockReturnValue(resolveWith({ id: LEAGUE_ID }));
      const first = await leagueApi.getLeague(LEAGUE_ID);
      const second = await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });
  });

  // ---------------------------------------------------------------------------
  // getTeams
  // ---------------------------------------------------------------------------
  describe('getTeams', () => {
    it('calls apiClient.get without query param by default', async () => {
      mockGet.mockReturnValue(resolveWith([]));
      await leagueApi.getTeams(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledWith(`/api/leagues/${LEAGUE_ID}/teams`);
    });

    it('adds ?withOwners=true query parameter when withOwners is true', async () => {
      mockGet.mockReturnValue(resolveWith([]));
      await leagueApi.getTeams(LEAGUE_ID, true);
      expect(mockGet).toHaveBeenCalledWith(`/api/leagues/${LEAGUE_ID}/teams?withOwners=true`);
    });

    it('returns cached result on second call', async () => {
      mockGet.mockReturnValue(resolveWith([{ id: 't1' }]));
      const first = await leagueApi.getTeams(LEAGUE_ID);
      const second = await leagueApi.getTeams(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });

    it('caches withOwners=true and withOwners=false separately', async () => {
      mockGet.mockReturnValueOnce(resolveWith([{ id: 'basic' }]));
      mockGet.mockReturnValueOnce(resolveWith([{ id: 'owners' }]));

      const basic = await leagueApi.getTeams(LEAGUE_ID, false);
      const owners = await leagueApi.getTeams(LEAGUE_ID, true);

      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(basic).not.toBe(owners);
    });
  });

  // ---------------------------------------------------------------------------
  // getStandings
  // ---------------------------------------------------------------------------
  describe('getStandings', () => {
    it('calls apiClient.get with correct path', async () => {
      mockGet.mockReturnValue(resolveWith([]));
      await leagueApi.getStandings(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledWith(`/api/leagues/${LEAGUE_ID}/standings`);
    });

    it('returns cached result on second call', async () => {
      mockGet.mockReturnValue(resolveWith([]));
      const first = await leagueApi.getStandings(LEAGUE_ID);
      const second = await leagueApi.getStandings(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });
  });

  // ---------------------------------------------------------------------------
  // getMyTeam
  // ---------------------------------------------------------------------------
  describe('getMyTeam', () => {
    it('calls apiClient.get with correct path', async () => {
      mockGet.mockReturnValue(resolveWith({ id: TEAM_ID }));
      await leagueApi.getMyTeam(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledWith(`/api/leagues/${LEAGUE_ID}/my-team`);
    });

    it('returns cached result on second call', async () => {
      mockGet.mockReturnValue(resolveWith({ id: TEAM_ID }));
      const first = await leagueApi.getMyTeam(LEAGUE_ID);
      const second = await leagueApi.getMyTeam(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });
  });

  // ---------------------------------------------------------------------------
  // getTransactions
  // ---------------------------------------------------------------------------
  describe('getTransactions', () => {
    it('calls apiClient.get with correct path', async () => {
      mockGet.mockReturnValue(resolveWith([]));
      await leagueApi.getTransactions(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledWith(`/api/leagues/${LEAGUE_ID}/transactions`);
    });

    it('returns cached result on second call', async () => {
      mockGet.mockReturnValue(resolveWith([]));
      const first = await leagueApi.getTransactions(LEAGUE_ID);
      const second = await leagueApi.getTransactions(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
    });
  });

  // ---------------------------------------------------------------------------
  // createLeague
  // ---------------------------------------------------------------------------
  describe('createLeague', () => {
    it('calls apiClient.post with correct path and body', async () => {
      const params = { name: 'My League', roster_size: 16 };
      mockPost.mockReturnValue(resolveWith({ id: 'new-league' }));
      await leagueApi.createLeague(params);
      expect(mockPost).toHaveBeenCalledWith('/api/leagues', params);
    });

    it('invalidates user leagues cache', async () => {
      // Prime the cache
      mockGet.mockReturnValue(resolveWith([{ id: '1' }]));
      await leagueApi.getUserLeagues();
      expect(mockGet).toHaveBeenCalledTimes(1);

      // Mutate
      mockPost.mockReturnValue(resolveWith({ id: 'new' }));
      await leagueApi.createLeague({ name: 'New' });

      // Should re-fetch since cache was invalidated
      mockGet.mockReturnValue(resolveWith([{ id: '1' }, { id: 'new' }]));
      await leagueApi.getUserLeagues();
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // joinLeague
  // ---------------------------------------------------------------------------
  describe('joinLeague', () => {
    it('calls apiClient.post with correct path and body and retries:0 (non-idempotent)', async () => {
      const params = { joinCode: 'ABC123', teamName: 'My Team' };
      mockPost.mockReturnValue(resolveWith({ success: true }));
      await leagueApi.joinLeague(params);
      expect(mockPost).toHaveBeenCalledWith('/api/leagues/join', params, { retries: 0 });
    });

    it('invalidates user leagues cache', async () => {
      mockGet.mockReturnValue(resolveWith([]));
      await leagueApi.getUserLeagues();
      expect(mockGet).toHaveBeenCalledTimes(1);

      mockPost.mockReturnValue(resolveWith({ success: true }));
      await leagueApi.joinLeague({ joinCode: 'XYZ' });

      mockGet.mockReturnValue(resolveWith([{ id: 'joined' }]));
      await leagueApi.getUserLeagues();
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // updateSettings
  // ---------------------------------------------------------------------------
  describe('updateSettings', () => {
    it('calls apiClient.put with correct path and body', async () => {
      const params = { settings: { maxTeams: 12 } };
      mockPut.mockReturnValue(resolveWith({ success: true }));
      await leagueApi.updateSettings(LEAGUE_ID, params);
      expect(mockPut).toHaveBeenCalledWith(`/api/leagues/${LEAGUE_ID}/settings`, params);
    });

    it('invalidates league-specific cache', async () => {
      mockGet.mockReturnValue(resolveWith({ id: LEAGUE_ID }));
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(1);

      mockPut.mockReturnValue(resolveWith({ success: true }));
      await leagueApi.updateSettings(LEAGUE_ID, { settings: { maxTeams: 14 } });

      mockGet.mockReturnValue(resolveWith({ id: LEAGUE_ID, maxTeams: 14 }));
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // updateWaiverSettings
  // ---------------------------------------------------------------------------
  describe('updateWaiverSettings', () => {
    it('calls apiClient.put with correct path and body', async () => {
      const settings = { waiverType: 'faab' };
      mockPut.mockReturnValue(resolveWith({ success: true }));
      await leagueApi.updateWaiverSettings(LEAGUE_ID, settings);
      expect(mockPut).toHaveBeenCalledWith(`/api/leagues/${LEAGUE_ID}/waiver-settings`, settings);
    });

    it('invalidates league-specific cache', async () => {
      mockGet.mockReturnValue(resolveWith({ id: LEAGUE_ID }));
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(1);

      mockPut.mockReturnValue(resolveWith({ success: true }));
      await leagueApi.updateWaiverSettings(LEAGUE_ID, { waiverType: 'faab' });

      mockGet.mockReturnValue(resolveWith({ id: LEAGUE_ID }));
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // updateScoringSettings
  // ---------------------------------------------------------------------------
  describe('updateScoringSettings', () => {
    it('calls apiClient.put with correct path and body', async () => {
      const settings = { goals: 3 };
      mockPut.mockReturnValue(resolveWith({ success: true }));
      await leagueApi.updateScoringSettings(LEAGUE_ID, settings);
      expect(mockPut).toHaveBeenCalledWith(`/api/leagues/${LEAGUE_ID}/scoring-settings`, settings);
    });

    it('invalidates league-specific cache', async () => {
      mockGet.mockReturnValue(resolveWith({ id: LEAGUE_ID }));
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(1);

      mockPut.mockReturnValue(resolveWith({ success: true }));
      await leagueApi.updateScoringSettings(LEAGUE_ID, { goals: 5 });

      mockGet.mockReturnValue(resolveWith({ id: LEAGUE_ID }));
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // updateDraftSettings
  // ---------------------------------------------------------------------------
  describe('updateDraftSettings', () => {
    it('calls apiClient.put with correct path and body', async () => {
      const settings = { draftType: 'snake' };
      mockPut.mockReturnValue(resolveWith({ success: true }));
      await leagueApi.updateDraftSettings(LEAGUE_ID, settings);
      expect(mockPut).toHaveBeenCalledWith(`/api/leagues/${LEAGUE_ID}/draft-settings`, settings);
    });

    it('invalidates league-specific cache', async () => {
      mockGet.mockReturnValue(resolveWith({ id: LEAGUE_ID }));
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(1);

      mockPut.mockReturnValue(resolveWith({ success: true }));
      await leagueApi.updateDraftSettings(LEAGUE_ID, { draftType: 'auction' });

      mockGet.mockReturnValue(resolveWith({ id: LEAGUE_ID }));
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // updateRosterSlots
  // ---------------------------------------------------------------------------
  describe('updateRosterSlots', () => {
    it('calls apiClient.put with correct path and wrapped body', async () => {
      const rosterSlots = { C: 2, LW: 2 };
      mockPut.mockReturnValue(resolveWith({ success: true }));
      await leagueApi.updateRosterSlots(LEAGUE_ID, rosterSlots);
      expect(mockPut).toHaveBeenCalledWith(
        `/api/leagues/${LEAGUE_ID}/roster-slots`,
        { rosterSlots },
      );
    });

    it('invalidates league-specific cache', async () => {
      mockGet.mockReturnValue(resolveWith({ id: LEAGUE_ID }));
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(1);

      mockPut.mockReturnValue(resolveWith({ success: true }));
      await leagueApi.updateRosterSlots(LEAGUE_ID, { C: 3 });

      mockGet.mockReturnValue(resolveWith({ id: LEAGUE_ID }));
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // updateKeeperSettings
  // ---------------------------------------------------------------------------
  describe('updateKeeperSettings', () => {
    it('calls apiClient.put with correct path and body', async () => {
      const settings = {
        keeperEnabled: true,
        keeperCount: 3,
        keeperPenalty: 'round',
        dynastyMode: false,
      };
      mockPut.mockReturnValue(resolveWith({ success: true }));
      await leagueApi.updateKeeperSettings(LEAGUE_ID, settings);
      expect(mockPut).toHaveBeenCalledWith(`/api/leagues/${LEAGUE_ID}/keeper-settings`, settings);
    });
  });

  // ---------------------------------------------------------------------------
  // updateCategorySettings
  // ---------------------------------------------------------------------------
  describe('updateCategorySettings', () => {
    it('calls apiClient.put with correct path and wrapped body', async () => {
      const categories = ['goals', 'assists', 'saves'];
      mockPut.mockReturnValue(resolveWith({ success: true }));
      await leagueApi.updateCategorySettings(LEAGUE_ID, categories);
      expect(mockPut).toHaveBeenCalledWith(
        `/api/leagues/${LEAGUE_ID}/category-settings`,
        { categories },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // deleteTeam
  // ---------------------------------------------------------------------------
  describe('deleteTeam', () => {
    it('calls apiClient.delete with correct path', async () => {
      mockDelete.mockReturnValue(resolveWith({ success: true }));
      await leagueApi.deleteTeam(LEAGUE_ID, TEAM_ID);
      expect(mockDelete).toHaveBeenCalledWith(`/api/leagues/${LEAGUE_ID}/teams/${TEAM_ID}`);
    });

    it('invalidates league-specific cache', async () => {
      mockGet.mockReturnValue(resolveWith([{ id: 't1' }]));
      await leagueApi.getTeams(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(1);

      mockDelete.mockReturnValue(resolveWith({ success: true }));
      await leagueApi.deleteTeam(LEAGUE_ID, TEAM_ID);

      mockGet.mockReturnValue(resolveWith([]));
      await leagueApi.getTeams(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // clearCache
  // ---------------------------------------------------------------------------
  describe('clearCache', () => {
    it('clears all cached data so subsequent calls re-fetch', async () => {
      // Prime multiple caches
      mockGet.mockReturnValue(resolveWith([]));
      await leagueApi.getUserLeagues();
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(2);

      leagueApi.clearCache();

      // Both should re-fetch
      mockGet.mockReturnValue(resolveWith([]));
      await leagueApi.getUserLeagues();
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(4);
    });
  });

  // ---------------------------------------------------------------------------
  // invalidate
  // ---------------------------------------------------------------------------
  describe('invalidate', () => {
    it('invalidates entries matching prefix', async () => {
      mockGet.mockReturnValue(resolveWith({ id: LEAGUE_ID }));
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(1);

      leagueApi.invalidate(`leagues:${LEAGUE_ID}`);

      mockGet.mockReturnValue(resolveWith({ id: LEAGUE_ID }));
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('does not invalidate entries that do not match prefix', async () => {
      mockGet.mockReturnValueOnce(resolveWith([{ id: '1' }]));
      mockGet.mockReturnValueOnce(resolveWith({ id: LEAGUE_ID }));
      await leagueApi.getUserLeagues();
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(2);

      // Invalidate only the specific league, not 'leagues:user'
      leagueApi.invalidate(`leagues:${LEAGUE_ID}`);

      // getUserLeagues should still be cached
      await leagueApi.getUserLeagues();
      expect(mockGet).toHaveBeenCalledTimes(2);

      // getLeague should re-fetch
      mockGet.mockReturnValue(resolveWith({ id: LEAGUE_ID }));
      await leagueApi.getLeague(LEAGUE_ID);
      expect(mockGet).toHaveBeenCalledTimes(3);
    });
  });
});

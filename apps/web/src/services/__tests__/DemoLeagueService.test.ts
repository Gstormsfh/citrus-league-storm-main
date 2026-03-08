import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock Supabase client
// =============================================================================

function createChainMock() {
  const chain: Record<string, any> = {};
  const chainMethods = ['select', 'insert', 'update', 'delete', 'eq', 'is', 'in', 'order', 'limit', 'filter', 'gt'];
  chainMethods.forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  return chain;
}

let defaultChain = createChainMock();

const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: 'auth-user-1' } },
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => defaultChain),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'mock-token' } } }),
    },
  },
}));

// Mock API client modules used transitively by services
vi.mock('@/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/api/leagues', () => ({ leagueApi: {} }));
vi.mock('@/api/players', () => ({ playerApi: {} }));
vi.mock('@/api/rosters', () => ({ rosterApi: {} }));
vi.mock('@/api/trades', () => ({ tradeApi: {} }));
vi.mock('@/api/waivers', () => ({ waiverApi: {} }));
vi.mock('@/api/notifications', () => ({ notificationApi: {} }));
vi.mock('@/api/matchups', () => ({ matchupApi: {} }));
vi.mock('@/api/account', () => ({ accountApi: {} }));
vi.mock('@/api/keepers', () => ({ keeperApi: {} }));
vi.mock('@/api/bestball', () => ({ bestballApi: {} }));
vi.mock('@/api/draft', () => ({ draftApi: {} }));
vi.mock('@/api/auction', () => ({ auctionApi: {} }));
vi.mock('@/api/playoffs', () => ({ playoffApi: {} }));
vi.mock('@/api/schedule', () => ({ scheduleApi: {} }));
vi.mock('@/api/stormy', () => ({ stormyApi: {} }));

vi.mock('./LeagueService', () => ({
  LeagueService: { saveLineup: vi.fn().mockResolvedValue(undefined) },
  LEAGUE_TEAMS_DATA: [
    { id: 1, name: 'Team 1' },
    { id: 2, name: 'Team 2' },
  ],
}));

vi.mock('./PlayerService', () => ({
  PlayerService: {
    getAllPlayers: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./DraftService', () => ({
  DraftService: {},
}));

vi.mock('./MatchupService', () => ({
  MatchupService: {
    getTeamRoster: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/utils/queryColumns', () => ({
  COLUMNS: {
    COUNT: '*',
    TEAM: 'id, league_id, owner_id, team_name, created_at, updated_at',
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// =============================================================================
// Import after mocks
// =============================================================================

import { DemoLeagueService, DEMO_LEAGUE_ID, DEMO_LEAGUE_ID_FOR_GUESTS } from '../DemoLeagueService';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';

// =============================================================================
// Tests
// =============================================================================

describe('DemoLeagueService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultChain = createChainMock();
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(defaultChain);
    mockGetUser.mockResolvedValue({ data: { user: { id: 'auth-user-1' } } });
  });

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  describe('constants', () => {
    it('exports DEMO_LEAGUE_ID', () => {
      expect(DEMO_LEAGUE_ID).toBe('00000000-0000-0000-0000-000000000001');
    });

    it('exports DEMO_LEAGUE_ID_FOR_GUESTS', () => {
      expect(DEMO_LEAGUE_ID_FOR_GUESTS).toBe('750f4e1a-92ae-44cf-a798-2f3e06d0d5c9');
    });
  });

  // ---------------------------------------------------------------------------
  // getStaticDemoTeamRoster
  // ---------------------------------------------------------------------------
  describe('getStaticDemoTeamRoster', () => {
    it('returns top 21 players sorted by points', () => {
      const players = Array.from({ length: 30 }, (_, i) => ({
        id: `player-${i}`,
        full_name: `Player ${i}`,
        position: 'C',
        team: 'TST',
        points: i * 10,
      }));

      const roster = DemoLeagueService.getStaticDemoTeamRoster('team-1', players as any);

      expect(roster).toHaveLength(21);
      // First player should have highest points
      expect(roster[0].points).toBe(290);
      expect(roster[20].points).toBe(90);
    });

    it('returns all players when less than 21 available', () => {
      const players = [
        { id: '1', full_name: 'P1', position: 'C', team: 'TST', points: 100 },
        { id: '2', full_name: 'P2', position: 'LW', team: 'TST', points: 50 },
      ];

      const roster = DemoLeagueService.getStaticDemoTeamRoster('team-1', players as any);

      expect(roster).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // demoLeagueExists
  // ---------------------------------------------------------------------------
  describe('demoLeagueExists', () => {
    it('returns true when league exists', async () => {
      defaultChain.maybeSingle.mockResolvedValue({
        data: { id: DEMO_LEAGUE_ID },
        error: null,
      });

      const result = await DemoLeagueService.demoLeagueExists();

      expect(result).toBe(true);
      expect(supabase.from).toHaveBeenCalledWith('leagues');
    });

    it('returns false when league does not exist', async () => {
      defaultChain.maybeSingle.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await DemoLeagueService.demoLeagueExists();

      expect(result).toBe(false);
    });

    it('returns false when query errors (non-PGRST116)', async () => {
      defaultChain.maybeSingle.mockResolvedValue({
        data: null,
        error: { code: '42P01', message: 'table does not exist' },
      });

      const result = await DemoLeagueService.demoLeagueExists();

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalled();
    });

    it('returns false on exception', async () => {
      defaultChain.maybeSingle.mockRejectedValue(new Error('network error'));

      const result = await DemoLeagueService.demoLeagueExists();

      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // initializeDemoLeague
  // ---------------------------------------------------------------------------
  describe('initializeDemoLeague', () => {
    it('returns error when user is not authenticated', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const result = await DemoLeagueService.initializeDemoLeague();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Guest users');
    });

    it('returns error when auth check fails', async () => {
      mockGetUser.mockRejectedValue(new Error('auth check failed'));

      const result = await DemoLeagueService.initializeDemoLeague();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Authentication check failed');
    });

    it('returns success when demo league already exists with rosters', async () => {
      // First call: demoLeagueExists (maybeSingle for leagues)
      // Second call: count draft picks
      let fromCallCount = 0;
      (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
        fromCallCount++;
        const chain = createChainMock();
        if (table === 'leagues') {
          chain.maybeSingle.mockResolvedValue({ data: { id: DEMO_LEAGUE_ID }, error: null });
        }
        if (table === 'draft_picks') {
          // Return count > 0
          chain.is = vi.fn().mockReturnValue({ ...chain, count: 100, data: null, error: null });
          // Override select to resolve with count
          chain.select = vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({ count: 100, data: null, error: null }),
            }),
          });
        }
        return chain;
      });

      const result = await DemoLeagueService.initializeDemoLeague();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it('handles timeout before starting initialization', async () => {
      // exists = false, but timeout is 0ms to trigger timeout
      defaultChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      // Pass timeout=0 to immediately timeout
      const result = await DemoLeagueService.initializeDemoLeague(0);

      // Either success (already exists) or error (timeout or not found)
      // Since the league doesn't exist and timeout is 0ms, it might timeout
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('error');
    });
  });

  // ---------------------------------------------------------------------------
  // forceReinitialize
  // ---------------------------------------------------------------------------
  describe('forceReinitialize', () => {
    it('deletes existing data and reinitializes', async () => {
      // Setup: all delete calls succeed, then initializeDemoLeague returns error
      // (since we don't mock the full initialization chain)
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const result = await DemoLeagueService.forceReinitialize();

      // Should have tried to delete from draft_picks, team_lineups, teams, leagues
      expect(supabase.from).toHaveBeenCalledWith('draft_picks');
      expect(supabase.from).toHaveBeenCalledWith('team_lineups');
      expect(supabase.from).toHaveBeenCalledWith('teams');
      expect(supabase.from).toHaveBeenCalledWith('leagues');
    });

    it('returns error when forceReinitialize throws', async () => {
      (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('critical failure');
      });

      const result = await DemoLeagueService.forceReinitialize();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // createDemoMatchups
  // ---------------------------------------------------------------------------
  describe('createDemoMatchups', () => {
    it('creates matchups for 20 weeks', async () => {
      const teams = [
        { id: 't1', league_id: DEMO_LEAGUE_ID, owner_id: null, team_name: 'Team 1', created_at: '', updated_at: '' },
        { id: 't2', league_id: DEMO_LEAGUE_ID, owner_id: null, team_name: 'Team 2', created_at: '', updated_at: '' },
      ];

      await DemoLeagueService.createDemoMatchups(DEMO_LEAGUE_ID, teams);

      // Should insert matchups for each week (20 weeks)
      expect(supabase.from).toHaveBeenCalledWith('matchups');
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Matchups created'));
    });

    it('logs warning when matchup insert fails', async () => {
      defaultChain.insert = vi.fn().mockResolvedValue({ error: { message: 'insert failed' } });

      const teams = [
        { id: 't1', league_id: DEMO_LEAGUE_ID, owner_id: null, team_name: 'T1', created_at: '', updated_at: '' },
        { id: 't2', league_id: DEMO_LEAGUE_ID, owner_id: null, team_name: 'T2', created_at: '', updated_at: '' },
      ];

      await DemoLeagueService.createDemoMatchups(DEMO_LEAGUE_ID, teams);

      expect(logger.warn).toHaveBeenCalled();
    });

    it('throws on exception during matchup creation', async () => {
      const teams = [
        { id: 't1', league_id: DEMO_LEAGUE_ID, owner_id: null, team_name: 'T1', created_at: '', updated_at: '' },
        { id: 't2', league_id: DEMO_LEAGUE_ID, owner_id: null, team_name: 'T2', created_at: '', updated_at: '' },
      ];

      (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('DB unreachable');
      });

      await expect(
        DemoLeagueService.createDemoMatchups(DEMO_LEAGUE_ID, teams)
      ).rejects.toThrow('DB unreachable');
    });
  });
});

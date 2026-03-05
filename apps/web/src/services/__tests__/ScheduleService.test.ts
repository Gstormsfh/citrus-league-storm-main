import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NHLGame } from '../ScheduleService';

// =============================================================================
// Mock Supabase client
// =============================================================================

/**
 * Create a chainable mock that supports Supabase's thenable pattern.
 * The chain itself is a promise (has .then) so `await supabase.from(...).select(...)...`
 * resolves to { data, error } when no terminal method (.single/.maybeSingle) is used.
 *
 * Set chain._result to control what `await chain` resolves to.
 */
function createChainableMock(defaultResult: Record<string, any> = { data: null, error: null }) {
  let _result = defaultResult;
  const chain: Record<string, any> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.upsert = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.or = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  // Thenable: allows `await chain` to resolve
  chain.then = vi.fn((resolve: (v: any) => void) => resolve(_result));
  // Helper to set the awaited result
  chain._setResult = (result: Record<string, any>) => { _result = result; };
  return chain;
}

let mockChain = createChainableMock();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => mockChain),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'mock-token' } } }),
    },
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/utils/timezoneUtils', () => ({
  getTodayMST: vi.fn().mockReturnValue('2026-01-15'),
  getTodayMSTDate: vi.fn().mockReturnValue(new Date('2026-01-15T00:00:00')),
}));

vi.mock('@/utils/seasonConstants', () => ({
  DEFAULT_TEST_DATE: '2026-01-15',
}));

vi.mock('@/utils/queryColumns', () => ({
  COLUMNS: {
    NHL_GAME: 'id, game_id, game_date, game_time, home_team, away_team, home_score, away_score, status, period, period_time, venue, season, game_type',
  },
}));

vi.mock('@/utils/promiseUtils', () => ({
  withTimeout: vi.fn((promise: Promise<any>) => promise),
}));

// =============================================================================
// Import ScheduleService AFTER mocks are registered
// =============================================================================

let ScheduleService: typeof import('../ScheduleService').ScheduleService;

beforeEach(async () => {
  vi.clearAllMocks();
  mockChain = createChainableMock();

  const mod = await import('../ScheduleService');
  ScheduleService = mod.ScheduleService;

  const { supabase } = await import('@/integrations/supabase/client');
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);
});

// =============================================================================
// Test data factory
// =============================================================================

function createGame(overrides: Partial<NHLGame> = {}): NHLGame {
  return {
    id: 'game-1',
    game_id: 2026010001,
    game_date: '2026-01-15',
    game_time: '2026-01-16T00:00:00Z',
    home_team: 'EDM',
    away_team: 'CGY',
    home_score: 0,
    away_score: 0,
    status: 'scheduled',
    period: null,
    period_time: null,
    venue: 'Rogers Place',
    season: 2026,
    game_type: 'regular',
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ScheduleService', () => {
  // ---------------------------------------------------------------------------
  // getGamesForDateRange
  // ---------------------------------------------------------------------------
  describe('getGamesForDateRange', () => {
    it('returns games for a date range', async () => {
      const games = [createGame(), createGame({ id: 'game-2', home_team: 'TOR', away_team: 'MTL' })];
      mockChain._setResult({ data: games, error: null });

      const result = await ScheduleService.getGamesForDateRange(
        new Date('2026-01-15'),
        new Date('2026-01-20')
      );

      expect(result.games).toHaveLength(2);
      expect(result.error).toBeNull();
    });

    it('returns empty array when table does not exist', async () => {
      mockChain._setResult({
        data: null,
        error: { message: 'relation "nhl_games" does not exist' },
      });

      const result = await ScheduleService.getGamesForDateRange(
        new Date('2026-01-15'),
        new Date('2026-01-20')
      );

      expect(result.games).toEqual([]);
      expect(result.error).toBeNull();
    });

    it('returns empty array with error on database failure', async () => {
      mockChain._setResult({
        data: null,
        error: { message: 'Connection failed' },
      });

      const result = await ScheduleService.getGamesForDateRange(
        new Date('2026-01-15'),
        new Date('2026-01-20')
      );

      expect(result.games).toEqual([]);
      expect(result.error).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // getGamesForTeam
  // ---------------------------------------------------------------------------
  describe('getGamesForTeam', () => {
    it('returns games for a specific team', async () => {
      const games = [createGame()];
      mockChain._setResult({ data: games, error: null });

      const result = await ScheduleService.getGamesForTeam('EDM');

      expect(result.games).toHaveLength(1);
      expect(result.error).toBeNull();
    });

    it('applies date filters when start and end dates provided', async () => {
      mockChain._setResult({ data: [], error: null });

      const result = await ScheduleService.getGamesForTeam(
        'EDM',
        new Date('2026-01-10'),
        new Date('2026-01-20')
      );

      expect(result.games).toEqual([]);
      expect(result.error).toBeNull();
      // Verify gte and lte were called (date filters applied)
      expect(mockChain.gte).toHaveBeenCalled();
      expect(mockChain.lte).toHaveBeenCalled();
    });

    it('returns empty array when table does not exist', async () => {
      mockChain._setResult({
        data: null,
        error: { message: 'relation does not exist' },
      });

      const result = await ScheduleService.getGamesForTeam('EDM');

      expect(result.games).toEqual([]);
      expect(result.error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getGamesForTeams (batch)
  // ---------------------------------------------------------------------------
  describe('getGamesForTeams', () => {
    it('returns empty map when no teams provided', async () => {
      const result = await ScheduleService.getGamesForTeams([]);

      expect(result.gamesByTeam.size).toBe(0);
      expect(result.error).toBeNull();
    });

    it('returns games grouped by team', async () => {
      const games = [
        createGame({ home_team: 'EDM', away_team: 'CGY' }),
        createGame({ id: 'game-2', home_team: 'TOR', away_team: 'MTL' }),
      ];

      mockChain._setResult({ data: games, error: null });

      const result = await ScheduleService.getGamesForTeams(['EDM', 'TOR']);

      expect(result.gamesByTeam.has('EDM')).toBe(true);
      expect(result.gamesByTeam.has('TOR')).toBe(true);
      expect(result.gamesByTeam.get('EDM')!.length).toBe(1);
      expect(result.gamesByTeam.get('TOR')!.length).toBe(1);
      expect(result.error).toBeNull();
    });

    it('normalizes team abbreviations to uppercase', async () => {
      mockChain._setResult({ data: [], error: null });

      const result = await ScheduleService.getGamesForTeams(['edm', 'tor']);

      expect(result.gamesByTeam.has('EDM')).toBe(true);
      expect(result.gamesByTeam.has('TOR')).toBe(true);
    });

    it('returns empty map when table does not exist', async () => {
      mockChain._setResult({
        data: null,
        error: { message: 'relation does not exist' },
      });

      const result = await ScheduleService.getGamesForTeams(['EDM']);

      expect(result.gamesByTeam.size).toBe(0);
      expect(result.error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getNextGameForTeam
  // ---------------------------------------------------------------------------
  describe('getNextGameForTeam', () => {
    it('returns the next game for a team', async () => {
      const game = createGame();
      mockChain.maybeSingle.mockResolvedValue({ data: game, error: null });

      const result = await ScheduleService.getNextGameForTeam('EDM');

      expect(result.game).toBeDefined();
      expect(result.game!.home_team).toBe('EDM');
      expect(result.error).toBeNull();
    });

    it('returns null when no upcoming game', async () => {
      mockChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const result = await ScheduleService.getNextGameForTeam('EDM');

      expect(result.game).toBeNull();
      expect(result.error).toBeNull();
    });

    it('returns null when table does not exist', async () => {
      mockChain.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'relation does not exist' },
      });

      const result = await ScheduleService.getNextGameForTeam('EDM');

      expect(result.game).toBeNull();
      expect(result.error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // hasGameToday
  // ---------------------------------------------------------------------------
  describe('hasGameToday', () => {
    it('returns true when team has a game today', async () => {
      mockChain._setResult({
        data: [createGame()],
        error: null,
      });

      const result = await ScheduleService.hasGameToday('EDM');

      expect(result).toBe(true);
    });

    it('returns false when team has no game today', async () => {
      mockChain._setResult({
        data: [],
        error: null,
      });

      const result = await ScheduleService.hasGameToday('EDM');

      expect(result).toBe(false);
    });

    it('returns false on database error', async () => {
      mockChain._setResult({
        data: null,
        error: { message: 'Connection failed' },
      });

      const result = await ScheduleService.hasGameToday('EDM');

      expect(result).toBe(false);
    });

    it('returns false when table does not exist', async () => {
      mockChain._setResult({
        data: null,
        error: { message: 'relation does not exist' },
      });

      const result = await ScheduleService.hasGameToday('EDM');

      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // hasGamesOnDateBatch
  // ---------------------------------------------------------------------------
  describe('hasGamesOnDateBatch', () => {
    it('returns empty map when no teams provided', async () => {
      const result = await ScheduleService.hasGamesOnDateBatch([], '2026-01-15');
      expect(result.size).toBe(0);
    });

    it('returns correct boolean map for teams', async () => {
      mockChain._setResult({
        data: [
          { home_team: 'EDM', away_team: 'CGY' },
        ],
        error: null,
      });

      const result = await ScheduleService.hasGamesOnDateBatch(['EDM', 'TOR'], '2026-01-15');

      expect(result.get('EDM')).toBe(true);
      expect(result.get('TOR')).toBe(false);
    });

    it('returns all false on database error', async () => {
      mockChain._setResult({
        data: null,
        error: { message: 'Connection failed' },
      });

      const result = await ScheduleService.hasGamesOnDateBatch(['EDM', 'TOR'], '2026-01-15');

      expect(result.get('EDM')).toBe(false);
      expect(result.get('TOR')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getGameInfo (synchronous, pure function)
  // ---------------------------------------------------------------------------
  describe('getGameInfo', () => {
    it('returns undefined when game is null', () => {
      const result = ScheduleService.getGameInfo(null, 'EDM');
      expect(result).toBeUndefined();
    });

    it('returns undefined when player team is not in the game', () => {
      const game = createGame({ home_team: 'TOR', away_team: 'MTL' });
      const result = ScheduleService.getGameInfo(game, 'EDM');
      expect(result).toBeUndefined();
    });

    it('returns correct opponent for home team', () => {
      const game = createGame({ home_team: 'EDM', away_team: 'CGY' });
      const result = ScheduleService.getGameInfo(game, 'EDM');

      expect(result).toBeDefined();
      expect(result!.opponent).toBe('vs CGY');
    });

    it('returns correct opponent for away team', () => {
      const game = createGame({ home_team: 'EDM', away_team: 'CGY' });
      const result = ScheduleService.getGameInfo(game, 'CGY');

      expect(result).toBeDefined();
      expect(result!.opponent).toBe('@ EDM');
    });

    it('includes score for live games with non-zero scores', () => {
      const game = createGame({
        home_team: 'EDM',
        away_team: 'CGY',
        status: 'live',
        home_score: 3,
        away_score: 1,
        period: '2nd',
        period_time: '10:30',
      });

      const result = ScheduleService.getGameInfo(game, 'EDM');

      expect(result).toBeDefined();
      expect(result!.score).toBe('EDM 3-1 CGY');
      expect(result!.period).toBe('2nd 10:30');
    });

    it('includes score for final games with non-zero scores', () => {
      const game = createGame({
        home_team: 'TOR',
        away_team: 'MTL',
        status: 'final',
        home_score: 4,
        away_score: 2,
      });

      const result = ScheduleService.getGameInfo(game, 'MTL');

      expect(result).toBeDefined();
      expect(result!.score).toBe('MTL 2-4 TOR');
    });

    it('does not include 0-0 score for live games', () => {
      const game = createGame({
        home_team: 'EDM',
        away_team: 'CGY',
        status: 'live',
        home_score: 0,
        away_score: 0,
      });

      const result = ScheduleService.getGameInfo(game, 'EDM');

      expect(result).toBeDefined();
      expect(result!.score).toBeUndefined();
    });

    it('includes game_date in result', () => {
      const game = createGame({ game_date: '2026-01-15' });
      const result = ScheduleService.getGameInfo(game, 'EDM');

      expect(result).toBeDefined();
      expect(result!.date).toBe('2026-01-15');
    });
  });

  // ---------------------------------------------------------------------------
  // getGamesForTeamsOnDate
  // ---------------------------------------------------------------------------
  describe('getGamesForTeamsOnDate', () => {
    it('returns empty map when no teams provided', async () => {
      const result = await ScheduleService.getGamesForTeamsOnDate([], '2026-01-15');
      expect(result.size).toBe(0);
    });

    it('returns map with game for each team', async () => {
      const game = createGame({ home_team: 'EDM', away_team: 'CGY' });
      mockChain._setResult({
        data: [game],
        error: null,
      });

      const result = await ScheduleService.getGamesForTeamsOnDate(['EDM', 'TOR'], '2026-01-15');

      expect(result.get('EDM')).toBeDefined();
      expect(result.get('EDM')!.home_team).toBe('EDM');
      expect(result.get('TOR')).toBeNull();
    });

    it('returns null entries on table-not-exist error', async () => {
      mockChain._setResult({
        data: null,
        error: { message: 'relation does not exist' },
      });

      const result = await ScheduleService.getGamesForTeamsOnDate(['EDM'], '2026-01-15');

      expect(result.get('EDM')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getNextGamesForTeams (batch)
  // ---------------------------------------------------------------------------
  describe('getNextGamesForTeams', () => {
    it('returns empty map when no teams provided', async () => {
      const result = await ScheduleService.getNextGamesForTeams([]);
      expect(result.size).toBe(0);
    });

    it('returns next game for each team', async () => {
      const game = createGame({ home_team: 'EDM', away_team: 'CGY' });
      mockChain._setResult({
        data: [game],
        error: null,
      });

      const result = await ScheduleService.getNextGamesForTeams(['EDM', 'TOR']);

      expect(result.get('EDM')).toBeDefined();
      expect(result.get('TOR')).toBeNull();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NHLGame } from '../ScheduleService';

// =============================================================================
// Mock API client layer (ScheduleService now uses scheduleApi, not supabase)
// =============================================================================

const mockGetGames = vi.fn();
const mockGetGamesForTeams = vi.fn();
const mockGetNextGame = vi.fn();

vi.mock('@/api/schedule', () => ({
  scheduleApi: {
    getGames: (...args: unknown[]) => mockGetGames(...args),
    getGamesForTeams: (...args: unknown[]) => mockGetGamesForTeams(...args),
    getNextGame: (...args: unknown[]) => mockGetNextGame(...args),
    getFantasyWeeks: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/utils/timezoneUtils', () => ({
  getTodayMST: vi.fn().mockReturnValue('2026-01-15'),
  getTodayMSTDate: vi.fn().mockReturnValue(new Date('2026-01-15T00:00:00')),
}));

vi.mock('@/utils/seasonConstants', async (importOriginal) => ({
  // Spread the real module: a hand-written object here omits whatever the
  // service starts calling next. getCurrentSeason() was added to several
  // services on 2026-08-11 and every partial mock broke with `undefined is
  // not a function`, surfacing as assertion noise rather than a clear error.
  ...(await importOriginal<typeof import('@/utils/seasonConstants')>()),
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

// Supabase mock still needed for module resolution (some imports reference it)
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'mock-token' } } }),
    },
  },
}));

// =============================================================================
// Import ScheduleService AFTER mocks are registered
// =============================================================================

import { ScheduleService } from '../ScheduleService';

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
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the internal request dedup cache between tests
    ScheduleService.clearCache();
    mockGetGames.mockResolvedValue({ data: [] });
    mockGetGamesForTeams.mockResolvedValue({ data: {} });
    mockGetNextGame.mockResolvedValue({ data: null });
  });

  // ---------------------------------------------------------------------------
  // getGamesForDateRange
  // ---------------------------------------------------------------------------
  describe('getGamesForDateRange', () => {
    it('returns games for a date range', async () => {
      const games = [createGame(), createGame({ id: 'game-2', home_team: 'TOR', away_team: 'MTL' })];
      mockGetGames.mockResolvedValue({ data: games });

      const result = await ScheduleService.getGamesForDateRange(
        new Date(2026, 0, 15),
        new Date(2026, 0, 20)
      );

      expect(result.games).toHaveLength(2);
      expect(result.error).toBeNull();
      expect(mockGetGames).toHaveBeenCalledWith({ startDate: '2026-01-15', endDate: '2026-01-20' });
    });

    it('returns empty array when API returns null data', async () => {
      mockGetGames.mockResolvedValue({ data: null });

      const result = await ScheduleService.getGamesForDateRange(
        new Date(2026, 0, 15),
        new Date(2026, 0, 20)
      );

      expect(result.games).toEqual([]);
      expect(result.error).toBeNull();
    });

    it('returns empty array with error on API failure', async () => {
      mockGetGames.mockRejectedValue(new Error('Connection failed'));

      const result = await ScheduleService.getGamesForDateRange(
        new Date(2026, 0, 15),
        new Date(2026, 0, 20)
      );

      expect(result.games).toEqual([]);
      expect(result.error).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // getGamesForTeam
  // ---------------------------------------------------------------------------
  describe('getGamesForTeam', () => {
    it('retries a failed schedule immediately, then caches the successful result', async () => {
      mockGetGames.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ data: [createGame()] });
      expect((await ScheduleService.getGamesForTeam('EDM')).error).toBeTruthy();
      expect((await ScheduleService.getGamesForTeam('EDM')).games).toHaveLength(1);
      expect((await ScheduleService.getGamesForTeam('EDM')).games).toHaveLength(1);
      expect(mockGetGames).toHaveBeenCalledTimes(2);
    });
    it('returns games for a specific team', async () => {
      const games = [createGame()];
      mockGetGames.mockResolvedValue({ data: games });

      const result = await ScheduleService.getGamesForTeam('EDM');

      expect(result.games).toHaveLength(1);
      expect(result.error).toBeNull();
      expect(mockGetGames).toHaveBeenCalledWith({ team: 'EDM', startDate: undefined, endDate: undefined });
    });

    it('applies date filters when start and end dates provided', async () => {
      mockGetGames.mockResolvedValue({ data: [] });

      const result = await ScheduleService.getGamesForTeam(
        'EDM',
        new Date(2026, 0, 10),
        new Date(2026, 0, 20)
      );

      expect(result.games).toEqual([]);
      expect(result.error).toBeNull();
      expect(mockGetGames).toHaveBeenCalledWith({
        team: 'EDM',
        startDate: '2026-01-10',
        endDate: '2026-01-20',
      });
    });

    it('returns empty array on API error', async () => {
      mockGetGames.mockRejectedValue(new Error('API error'));

      const result = await ScheduleService.getGamesForTeam('EDM');

      expect(result.games).toEqual([]);
      expect(result.error).toBeTruthy();
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
      mockGetGamesForTeams.mockResolvedValue({
        data: {
          EDM: [createGame({ home_team: 'EDM', away_team: 'CGY' })],
          TOR: [createGame({ id: 'game-2', home_team: 'TOR', away_team: 'MTL' })],
        },
      });

      const result = await ScheduleService.getGamesForTeams(['EDM', 'TOR']);

      expect(result.gamesByTeam.has('EDM')).toBe(true);
      expect(result.gamesByTeam.has('TOR')).toBe(true);
      expect(result.gamesByTeam.get('EDM')!.length).toBe(1);
      expect(result.gamesByTeam.get('TOR')!.length).toBe(1);
      expect(result.error).toBeNull();
    });

    it('normalizes team abbreviations to uppercase', async () => {
      mockGetGamesForTeams.mockResolvedValue({ data: {} });

      const result = await ScheduleService.getGamesForTeams(['edm', 'tor']);

      expect(result.gamesByTeam.has('EDM')).toBe(true);
      expect(result.gamesByTeam.has('TOR')).toBe(true);
      // API should be called with uppercase teams
      expect(mockGetGamesForTeams).toHaveBeenCalledWith(
        ['EDM', 'TOR'],
        undefined,
        undefined,
      );
    });

    it('returns empty map on API error', async () => {
      mockGetGamesForTeams.mockRejectedValue(new Error('API error'));

      const result = await ScheduleService.getGamesForTeams(['EDM']);

      expect(result.gamesByTeam.size).toBe(0);
      expect(result.error).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // getNextGameForTeam
  // ---------------------------------------------------------------------------
  describe('getNextGameForTeam', () => {
    it('returns the next game for a team', async () => {
      const game = createGame();
      mockGetNextGame.mockResolvedValue({ data: game });

      const result = await ScheduleService.getNextGameForTeam('EDM');

      expect(result.game).toBeDefined();
      expect(result.game!.home_team).toBe('EDM');
      expect(result.error).toBeNull();
    });

    it('returns null when no upcoming game', async () => {
      mockGetNextGame.mockResolvedValue({ data: null });

      const result = await ScheduleService.getNextGameForTeam('EDM');

      expect(result.game).toBeNull();
      expect(result.error).toBeNull();
    });

    it('returns null on API error', async () => {
      mockGetNextGame.mockRejectedValue(new Error('API error'));

      const result = await ScheduleService.getNextGameForTeam('EDM');

      expect(result.game).toBeNull();
      expect(result.error).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // hasGameToday
  // ---------------------------------------------------------------------------
  describe('hasGameToday', () => {
    it('returns true when team has a game today', async () => {
      mockGetGames.mockResolvedValue({ data: [createGame()] });

      const result = await ScheduleService.hasGameToday('EDM');

      expect(result).toBe(true);
    });

    it('returns false when team has no game today', async () => {
      mockGetGames.mockResolvedValue({ data: [] });

      const result = await ScheduleService.hasGameToday('EDM');

      expect(result).toBe(false);
    });

    it('returns false on API error', async () => {
      mockGetGames.mockRejectedValue(new Error('API error'));

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
      mockGetGamesForTeams.mockResolvedValue({
        data: {
          EDM: [createGame({ home_team: 'EDM', away_team: 'CGY', game_date: '2026-01-15' })],
          TOR: [],
        },
      });

      const result = await ScheduleService.hasGamesOnDateBatch(['EDM', 'TOR'], '2026-01-15');

      expect(result.get('EDM')).toBe(true);
      expect(result.get('TOR')).toBe(false);
    });

    it('returns all false on API error', async () => {
      mockGetGamesForTeams.mockRejectedValue(new Error('API error'));

      const result = await ScheduleService.hasGamesOnDateBatch(['EDM', 'TOR'], '2026-01-15');

      expect(result.get('EDM')).toBe(false);
      expect(result.get('TOR')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getGameInfo (synchronous, pure function — no API mocking needed)
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
      const game = createGame({ home_team: 'EDM', away_team: 'CGY', game_date: '2026-01-15' });
      mockGetGamesForTeams.mockResolvedValue({
        data: {
          EDM: [game],
          TOR: [],
        },
      });

      const result = await ScheduleService.getGamesForTeamsOnDate(['EDM', 'TOR'], '2026-01-15');

      expect(result.get('EDM')).toBeDefined();
      expect(result.get('EDM')!.home_team).toBe('EDM');
      expect(result.get('TOR')).toBeNull();
    });

    it('returns null entries on API error', async () => {
      mockGetGamesForTeams.mockRejectedValue(new Error('API error'));

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
      const game = createGame({ home_team: 'EDM', away_team: 'CGY', game_date: '2026-01-15' });
      mockGetGamesForTeams.mockResolvedValue({
        data: {
          EDM: [game],
          TOR: [],
        },
      });

      const result = await ScheduleService.getNextGamesForTeams(['EDM', 'TOR']);

      expect(result.get('EDM')).toBeDefined();
      expect(result.get('TOR')).toBeNull();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock schedule API client
// =============================================================================

const mockGetGames = vi.fn();
const mockGetGamesForTeams = vi.fn();

vi.mock('@/api/schedule', () => ({
  scheduleApi: {
    getGames: (...args: unknown[]) => mockGetGames(...args),
    getGamesForTeams: (...args: unknown[]) => mockGetGamesForTeams(...args),
    getNextGame: vi.fn(),
    getFantasyWeeks: vi.fn(),
    clearCache: vi.fn(),
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

// =============================================================================
// Import GameLockService AFTER mocks are registered
// =============================================================================

let GameLockService: typeof import('../GameLockService').GameLockService;

beforeEach(async () => {
  vi.clearAllMocks();

  const mod = await import('../GameLockService');
  GameLockService = mod.GameLockService;
});

// =============================================================================
// Tests
// =============================================================================

describe('GameLockService', () => {
  // ---------------------------------------------------------------------------
  // isPlayerLocked
  // ---------------------------------------------------------------------------
  describe('isPlayerLocked', () => {
    it('returns unlocked when no game is scheduled', async () => {
      mockGetGames.mockResolvedValue({ data: [] });

      const result = await GameLockService.isPlayerLocked('player-1', 'EDM');

      expect(result.isLocked).toBe(false);
      expect(result.gameStatus).toBe('not_started');
    });

    it('returns locked when game status is final', async () => {
      mockGetGames.mockResolvedValue({
        data: [
          {
            game_time: '2026-01-15T02:00:00Z',
            status: 'final',
            home_team: 'EDM',
            away_team: 'CGY',
            game_date: '2026-01-15',
          },
        ],
      });

      const result = await GameLockService.isPlayerLocked('player-1', 'EDM');

      expect(result.isLocked).toBe(true);
      expect(result.gameStatus).toBe('final');
      expect(result.gameTime).toBe('2026-01-15T02:00:00Z');
      expect(result.gameDate).toBe('2026-01-15');
    });

    it('returns locked when game status is live', async () => {
      mockGetGames.mockResolvedValue({
        data: [
          {
            game_time: '2026-01-15T00:00:00Z',
            status: 'live',
            home_team: 'TOR',
            away_team: 'MTL',
            game_date: '2026-01-15',
          },
        ],
      });

      const result = await GameLockService.isPlayerLocked('player-1', 'TOR');

      expect(result.isLocked).toBe(true);
      expect(result.gameStatus).toBe('live');
    });

    it('returns locked when game is scheduled but game_time has passed', async () => {
      const pastTime = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      mockGetGames.mockResolvedValue({
        data: [
          {
            game_time: pastTime,
            status: 'scheduled',
            home_team: 'EDM',
            away_team: 'CGY',
            game_date: '2026-01-15',
          },
        ],
      });

      const result = await GameLockService.isPlayerLocked('player-1', 'EDM');

      expect(result.isLocked).toBe(true);
      expect(result.gameStatus).toBe('live'); // Treats as live when time has passed
    });

    it('returns unlocked when game is scheduled and game_time has not passed', async () => {
      const futureTime = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
      mockGetGames.mockResolvedValue({
        data: [
          {
            game_time: futureTime,
            status: 'scheduled',
            home_team: 'EDM',
            away_team: 'CGY',
            game_date: '2026-01-15',
          },
        ],
      });

      const result = await GameLockService.isPlayerLocked('player-1', 'EDM');

      expect(result.isLocked).toBe(false);
      expect(result.gameStatus).toBe('not_started');
      expect(result.gameTime).toBe(futureTime);
    });

    it('fails open (returns unlocked) on API error', async () => {
      mockGetGames.mockRejectedValue(new Error('Network error'));

      const result = await GameLockService.isPlayerLocked('player-1', 'EDM');

      expect(result.isLocked).toBe(false);
      expect(result.gameStatus).toBe('not_started');
    });

    it('accepts a custom target date', async () => {
      mockGetGames.mockResolvedValue({ data: [] });

      const customDate = new Date('2026-02-20T00:00:00');
      await GameLockService.isPlayerLocked('player-1', 'EDM', customDate);

      expect(mockGetGames).toHaveBeenCalledWith({ date: '2026-02-20', team: 'EDM' });
    });
  });

  // ---------------------------------------------------------------------------
  // getLockedPlayerIds
  // ---------------------------------------------------------------------------
  describe('getLockedPlayerIds', () => {
    it('returns empty set when no players provided', async () => {
      const result = await GameLockService.getLockedPlayerIds([]);
      expect(result.size).toBe(0);
    });

    it('returns empty set when players have no valid team abbreviations', async () => {
      const players = [
        { id: '1', team: '' },
        { id: '2', team: 'AB' }, // Too short
      ];

      const result = await GameLockService.getLockedPlayerIds(players);
      expect(result.size).toBe(0);
    });

    it('returns locked player IDs for teams with live games', async () => {
      mockGetGamesForTeams.mockResolvedValue({
        data: [
          {
            game_time: '2026-01-15T00:00:00Z',
            status: 'live',
            home_team: 'EDM',
            away_team: 'CGY',
            game_date: '2026-01-15',
          },
        ],
      });

      const players = [
        { id: '101', teamAbbreviation: 'EDM' },
        { id: '102', teamAbbreviation: 'TOR' },
      ];

      const result = await GameLockService.getLockedPlayerIds(players);

      expect(result.has('101')).toBe(true);
      expect(result.has('102')).toBe(false);
    });

    it('returns locked player IDs for teams with final games', async () => {
      mockGetGamesForTeams.mockResolvedValue({
        data: [
          {
            game_time: '2026-01-15T00:00:00Z',
            status: 'final',
            home_team: 'TOR',
            away_team: 'MTL',
            game_date: '2026-01-15',
          },
        ],
      });

      const players = [
        { id: '201', teamAbbreviation: 'TOR' },
        { id: '202', teamAbbreviation: 'MTL' },
      ];

      const result = await GameLockService.getLockedPlayerIds(players);

      expect(result.has('201')).toBe(true);
      expect(result.has('202')).toBe(true);
    });

    it('returns empty set on API error', async () => {
      mockGetGamesForTeams.mockRejectedValue(new Error('Network error'));

      const players = [{ id: '1', teamAbbreviation: 'EDM' }];
      const result = await GameLockService.getLockedPlayerIds(players);
      expect(result.size).toBe(0);
    });

    it('uses teamAbbreviation falling back to team property', async () => {
      mockGetGamesForTeams.mockResolvedValue({
        data: [
          {
            game_time: '2026-01-15T00:00:00Z',
            status: 'final',
            home_team: 'VAN',
            away_team: 'SEA',
            game_date: '2026-01-15',
          },
        ],
      });

      const players = [
        { id: '301', team: 'VAN' }, // Uses team, not teamAbbreviation
      ];

      const result = await GameLockService.getLockedPlayerIds(players);

      expect(result.has('301')).toBe(true);
    });

    it('handles record-based response format from API', async () => {
      mockGetGamesForTeams.mockResolvedValue({
        data: {
          EDM: [
            {
              game_time: '2026-01-15T00:00:00Z',
              status: 'live',
              home_team: 'EDM',
              away_team: 'CGY',
              game_date: '2026-01-15',
            },
          ],
          TOR: [],
        },
      });

      const players = [
        { id: '401', teamAbbreviation: 'EDM' },
        { id: '402', teamAbbreviation: 'TOR' },
      ];

      const result = await GameLockService.getLockedPlayerIds(players);

      expect(result.has('401')).toBe(true);
      expect(result.has('402')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getPlayerGameStatus
  // ---------------------------------------------------------------------------
  describe('getPlayerGameStatus', () => {
    it('returns game status for a team', async () => {
      mockGetGames.mockResolvedValue({
        data: [
          {
            game_time: '2026-01-15T00:00:00Z',
            status: 'live',
            home_team: 'EDM',
            away_team: 'CGY',
            game_date: '2026-01-15',
          },
        ],
      });

      const result = await GameLockService.getPlayerGameStatus('EDM');

      expect(result).toBe('live');
    });

    it('returns not_started when no game scheduled', async () => {
      mockGetGames.mockResolvedValue({ data: [] });

      const result = await GameLockService.getPlayerGameStatus('EDM');

      expect(result).toBe('not_started');
    });
  });
});

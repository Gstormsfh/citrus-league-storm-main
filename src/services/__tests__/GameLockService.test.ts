import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock Supabase client
// =============================================================================

function createChainableMock() {
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
  return chain;
}

let mockChain = createChainableMock();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => mockChain),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
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

// =============================================================================
// Import GameLockService AFTER mocks are registered
// =============================================================================

let GameLockService: typeof import('../GameLockService').GameLockService;

beforeEach(async () => {
  vi.clearAllMocks();
  mockChain = createChainableMock();

  const mod = await import('../GameLockService');
  GameLockService = mod.GameLockService;

  const { supabase } = await import('@/integrations/supabase/client');
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);
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
      mockChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const result = await GameLockService.isPlayerLocked('player-1', 'EDM');

      expect(result.isLocked).toBe(false);
      expect(result.gameStatus).toBe('not_started');
    });

    it('returns locked when game status is final', async () => {
      mockChain.maybeSingle.mockResolvedValue({
        data: {
          game_time: '2026-01-15T02:00:00Z',
          status: 'final',
          game_date: '2026-01-15',
        },
        error: null,
      });

      const result = await GameLockService.isPlayerLocked('player-1', 'EDM');

      expect(result.isLocked).toBe(true);
      expect(result.gameStatus).toBe('final');
      expect(result.gameTime).toBe('2026-01-15T02:00:00Z');
      expect(result.gameDate).toBe('2026-01-15');
    });

    it('returns locked when game status is live', async () => {
      mockChain.maybeSingle.mockResolvedValue({
        data: {
          game_time: '2026-01-15T00:00:00Z',
          status: 'live',
          game_date: '2026-01-15',
        },
        error: null,
      });

      const result = await GameLockService.isPlayerLocked('player-1', 'TOR');

      expect(result.isLocked).toBe(true);
      expect(result.gameStatus).toBe('live');
    });

    it('returns locked when game is scheduled but game_time has passed', async () => {
      // Use a time that is definitely in the past
      const pastTime = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      mockChain.maybeSingle.mockResolvedValue({
        data: {
          game_time: pastTime,
          status: 'scheduled',
          game_date: '2026-01-15',
        },
        error: null,
      });

      const result = await GameLockService.isPlayerLocked('player-1', 'EDM');

      expect(result.isLocked).toBe(true);
      expect(result.gameStatus).toBe('live'); // Treats as live when time has passed
    });

    it('returns unlocked when game is scheduled and game_time has not passed', async () => {
      // Use a time that is definitely in the future
      const futureTime = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
      mockChain.maybeSingle.mockResolvedValue({
        data: {
          game_time: futureTime,
          status: 'scheduled',
          game_date: '2026-01-15',
        },
        error: null,
      });

      const result = await GameLockService.isPlayerLocked('player-1', 'EDM');

      expect(result.isLocked).toBe(false);
      expect(result.gameStatus).toBe('not_started');
      expect(result.gameTime).toBe(futureTime);
    });

    it('fails open (returns unlocked) on database error', async () => {
      mockChain.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'Database error', code: '500' },
      });

      const result = await GameLockService.isPlayerLocked('player-1', 'EDM');

      expect(result.isLocked).toBe(false);
      expect(result.gameStatus).toBe('not_started');
    });

    it('accepts a custom target date', async () => {
      mockChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const customDate = new Date('2026-02-20T00:00:00');
      await GameLockService.isPlayerLocked('player-1', 'EDM', customDate);

      // Verify .eq was called with the custom date string
      expect(mockChain.eq).toHaveBeenCalledWith('game_date', '2026-02-20');
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
      // Mock the batch fetch — returns resolved array (no maybeSingle terminal)
      mockChain.in.mockResolvedValue({
        data: [
          {
            game_time: '2026-01-15T00:00:00Z',
            status: 'live',
            home_team: 'EDM',
            away_team: 'CGY',
            game_date: '2026-01-15',
          },
        ],
        error: null,
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
      mockChain.in.mockResolvedValue({
        data: [
          {
            game_time: '2026-01-15T00:00:00Z',
            status: 'final',
            home_team: 'TOR',
            away_team: 'MTL',
            game_date: '2026-01-15',
          },
        ],
        error: null,
      });

      const players = [
        { id: '201', teamAbbreviation: 'TOR' },
        { id: '202', teamAbbreviation: 'MTL' },
      ];

      const result = await GameLockService.getLockedPlayerIds(players);

      expect(result.has('201')).toBe(true);
      expect(result.has('202')).toBe(true);
    });

    it('returns empty set on database error', async () => {
      mockChain.in.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const players = [{ id: '1', teamAbbreviation: 'EDM' }];
      const result = await GameLockService.getLockedPlayerIds(players);
      expect(result.size).toBe(0);
    });

    it('uses teamAbbreviation falling back to team property', async () => {
      mockChain.in.mockResolvedValue({
        data: [
          {
            game_time: '2026-01-15T00:00:00Z',
            status: 'final',
            home_team: 'VAN',
            away_team: 'SEA',
            game_date: '2026-01-15',
          },
        ],
        error: null,
      });

      const players = [
        { id: '301', team: 'VAN' }, // Uses team, not teamAbbreviation
      ];

      const result = await GameLockService.getLockedPlayerIds(players);

      expect(result.has('301')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getPlayerGameStatus
  // ---------------------------------------------------------------------------
  describe('getPlayerGameStatus', () => {
    it('returns game status for a team', async () => {
      mockChain.maybeSingle.mockResolvedValue({
        data: {
          game_time: '2026-01-15T00:00:00Z',
          status: 'live',
          game_date: '2026-01-15',
        },
        error: null,
      });

      const result = await GameLockService.getPlayerGameStatus('EDM');

      expect(result).toBe('live');
    });

    it('returns not_started when no game scheduled', async () => {
      mockChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const result = await GameLockService.getPlayerGameStatus('EDM');

      expect(result).toBe('not_started');
    });
  });
});

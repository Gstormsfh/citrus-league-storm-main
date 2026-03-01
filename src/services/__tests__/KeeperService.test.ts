import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '@/integrations/supabase/client';

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
const mockRpc = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => mockChain),
    rpc: (...args: any[]) => mockRpc(...args),
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

// =============================================================================
// Import KeeperService AFTER mocks are registered
// =============================================================================

let KeeperService: typeof import('../KeeperService').KeeperService;

beforeEach(async () => {
  vi.clearAllMocks();
  mockChain = createChainableMock();
  mockRpc.mockResolvedValue({ data: null, error: null });

  const mod = await import('../KeeperService');
  KeeperService = mod.KeeperService;

  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);
});

// =============================================================================
// Tests
// =============================================================================

describe('KeeperService', () => {
  // ---------------------------------------------------------------------------
  // designateKeeper
  // ---------------------------------------------------------------------------
  describe('designateKeeper', () => {
    it('designates a keeper when validation passes', async () => {
      // Mock validateKeepers RPC — returns valid
      mockRpc.mockResolvedValueOnce({
        data: [{ is_valid: true, error_message: null, keepers_count: 1, max_keepers: 3 }],
        error: null,
      });

      const designation = {
        id: 'kd-1',
        league_id: 'league-1',
        team_id: 'team-1',
        player_id: 'player-1',
        season_year: 2026,
        keeper_round: null,
        keeper_penalty_type: 'none',
        original_draft_round: 3,
        years_kept: 1,
        designated_at: '2026-01-15T00:00:00Z',
        approved_by: null,
        status: 'designated',
      };

      mockChain.single.mockResolvedValue({ data: designation, error: null });

      const result = await KeeperService.designateKeeper(
        'league-1',
        'team-1',
        'player-1',
        2026,
        3
      );

      expect(result.success).toBe(true);
      expect(result.designation).toBeDefined();
      expect(result.designation!.player_id).toBe('player-1');
    });

    it('returns error when validation fails', async () => {
      // Mock validateKeepers — returns error
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Validation RPC error' },
      });

      const result = await KeeperService.designateKeeper(
        'league-1',
        'team-1',
        'player-1',
        2026
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns duplicate error on unique constraint violation', async () => {
      // Mock validateKeepers — passes
      mockRpc.mockResolvedValueOnce({
        data: [{ is_valid: true, error_message: null, keepers_count: 1, max_keepers: 3 }],
        error: null,
      });

      // Mock insert — returns duplicate key error
      mockChain.single.mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      });

      const result = await KeeperService.designateKeeper(
        'league-1',
        'team-1',
        'player-1',
        2026
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Player is already designated as a keeper');
    });
  });

  // ---------------------------------------------------------------------------
  // releaseKeeper
  // ---------------------------------------------------------------------------
  describe('releaseKeeper', () => {
    it('releases a keeper designation successfully', async () => {
      mockChain.in.mockResolvedValue({ data: null, error: null });

      const result = await KeeperService.releaseKeeper('kd-1', 'team-1');

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns error on database failure', async () => {
      mockChain.in.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const result = await KeeperService.releaseKeeper('kd-1', 'team-1');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getTeamKeepers
  // ---------------------------------------------------------------------------
  describe('getTeamKeepers', () => {
    it('returns keepers for a team', async () => {
      const keepers = [
        {
          id: 'kd-1',
          league_id: 'league-1',
          team_id: 'team-1',
          player_id: 'player-1',
          season_year: 2026,
          keeper_round: null,
          keeper_penalty_type: 'none',
          original_draft_round: 3,
          years_kept: 1,
          designated_at: '2026-01-15T00:00:00Z',
          approved_by: null,
          status: 'designated',
        },
      ];

      mockChain.order.mockResolvedValue({ data: keepers, error: null });

      const result = await KeeperService.getTeamKeepers('league-1', 'team-1', 2026);

      expect(result.keepers).toHaveLength(1);
      expect(result.keepers[0].player_id).toBe('player-1');
      expect(result.error).toBeUndefined();
    });

    it('returns empty array on error', async () => {
      mockChain.order.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const result = await KeeperService.getTeamKeepers('league-1', 'team-1', 2026);

      expect(result.keepers).toEqual([]);
      expect(result.error).toBeDefined();
    });

    it('returns empty array when no keepers exist', async () => {
      mockChain.order.mockResolvedValue({ data: [], error: null });

      const result = await KeeperService.getTeamKeepers('league-1', 'team-1', 2026);

      expect(result.keepers).toEqual([]);
      expect(result.error).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getLeagueKeepers
  // ---------------------------------------------------------------------------
  describe('getLeagueKeepers', () => {
    it('returns all keepers for a league', async () => {
      const keepers = [
        { id: 'kd-1', team_id: 'team-1', player_id: 'player-1' },
        { id: 'kd-2', team_id: 'team-2', player_id: 'player-2' },
      ];

      mockChain.order.mockResolvedValue({ data: keepers, error: null });

      const result = await KeeperService.getLeagueKeepers('league-1', 2026);

      expect(result.keepers).toHaveLength(2);
      expect(result.error).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // validateKeepers
  // ---------------------------------------------------------------------------
  describe('validateKeepers', () => {
    it('returns valid result from RPC', async () => {
      mockRpc.mockResolvedValue({
        data: [{
          is_valid: true,
          error_message: null,
          keepers_count: 2,
          max_keepers: 3,
        }],
        error: null,
      });

      const result = await KeeperService.validateKeepers('league-1', 'team-1', 2026);

      expect(result.is_valid).toBe(true);
      expect(result.error_message).toBeNull();
      expect(result.keepers_count).toBe(2);
      expect(result.max_keepers).toBe(3);
    });

    it('returns invalid result with error message', async () => {
      mockRpc.mockResolvedValue({
        data: [{
          is_valid: false,
          error_message: 'Maximum keepers exceeded',
          keepers_count: 4,
          max_keepers: 3,
        }],
        error: null,
      });

      const result = await KeeperService.validateKeepers('league-1', 'team-1', 2026);

      expect(result.is_valid).toBe(false);
      expect(result.error_message).toBe('Maximum keepers exceeded');
    });

    it('returns fallback values on RPC error', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' },
      });

      const result = await KeeperService.validateKeepers('league-1', 'team-1', 2026);

      expect(result.is_valid).toBe(false);
      expect(result.error_message).toBe('Validation failed');
      expect(result.error).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getKeeperDraftCosts
  // ---------------------------------------------------------------------------
  describe('getKeeperDraftCosts', () => {
    it('returns draft costs from RPC', async () => {
      const costs = [
        {
          player_id: 'player-1',
          keeper_round: 3,
          penalty_type: 'round-cost',
          original_draft_round: 5,
          years_kept: 2,
          effective_round: 3,
        },
      ];

      mockRpc.mockResolvedValue({ data: costs, error: null });

      const result = await KeeperService.getKeeperDraftCosts('league-1', 'team-1', 2026);

      expect(result.costs).toHaveLength(1);
      expect(result.costs[0].player_id).toBe('player-1');
      expect(result.error).toBeUndefined();
    });

    it('returns empty costs on RPC error', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' },
      });

      const result = await KeeperService.getKeeperDraftCosts('league-1', 'team-1', 2026);

      expect(result.costs).toEqual([]);
      expect(result.error).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // lockKeepersForSeason
  // ---------------------------------------------------------------------------
  describe('lockKeepersForSeason', () => {
    it('locks keepers and notifies league members', async () => {
      // First RPC call: lock_keepers_for_season
      // Second RPC call: notify_league_members
      mockRpc
        .mockResolvedValueOnce({
          data: [
            { team_id: 'team-1', keepers_locked: 2, rounds_consumed: [3, 5] },
            { team_id: 'team-2', keepers_locked: 1, rounds_consumed: [2] },
          ],
          error: null,
        })
        .mockResolvedValueOnce({ data: null, error: null }); // Notification RPC

      const result = await KeeperService.lockKeepersForSeason('league-1', 2026);

      expect(result.results).toHaveLength(2);
      expect(result.results[0].keepersLocked).toBe(2);
      expect(result.results[0].roundsConsumed).toEqual([3, 5]);
      expect(result.error).toBeUndefined();

      // Verify notify_league_members was called
      expect(mockRpc).toHaveBeenCalledWith('notify_league_members', expect.objectContaining({
        p_league_id: 'league-1',
        p_notification_type: 'SYSTEM',
      }));
    });

    it('returns empty results on RPC error', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Lock RPC failed' },
      });

      const result = await KeeperService.lockKeepersForSeason('league-1', 2026);

      expect(result.results).toEqual([]);
      expect(result.error).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // updateKeeperSettings
  // ---------------------------------------------------------------------------
  describe('updateKeeperSettings', () => {
    it('updates keeper settings when user is commissioner', async () => {
      // supabase is imported at module level (mocked via vi.mock)
      let callIndex = 0;

      (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callIndex++;
        const chain = createChainableMock();
        if (callIndex === 1) {
          // leagues.select for commissioner check
          chain.single.mockResolvedValue({
            data: { commissioner_id: 'user-1', settings: {} },
            error: null,
          });
        } else {
          // leagues.update
          chain.eq.mockResolvedValue({ data: null, error: null });
        }
        return chain;
      });

      // notify_league_members RPC
      mockRpc.mockResolvedValue({ data: null, error: null });

      const result = await KeeperService.updateKeeperSettings('league-1', 'user-1', {
        keeperEnabled: true,
        keeperCount: 3,
        keeperPenalty: 'round-cost',
        dynastyMode: false,
      });

      expect(result.success).toBe(true);
    });

    it('rejects update when user is not commissioner', async () => {
      mockChain.single.mockResolvedValue({
        data: { commissioner_id: 'other-user', settings: {} },
        error: null,
      });

      const result = await KeeperService.updateKeeperSettings('league-1', 'user-1', {
        keeperEnabled: true,
        keeperCount: 3,
        keeperPenalty: 'none',
        dynastyMode: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Only the commissioner can update keeper settings');
    });

    it('sets keeperCount to 999 when dynasty mode is enabled', async () => {
      // supabase is imported at module level (mocked via vi.mock)
      let updateChain: Record<string, any> | null = null;
      let callIndex = 0;

      (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callIndex++;
        const chain = createChainableMock();
        if (callIndex === 1) {
          chain.single.mockResolvedValue({
            data: { commissioner_id: 'user-1', settings: {} },
            error: null,
          });
        } else {
          updateChain = chain;
          chain.eq.mockResolvedValue({ data: null, error: null });
        }
        return chain;
      });

      mockRpc.mockResolvedValue({ data: null, error: null });

      await KeeperService.updateKeeperSettings('league-1', 'user-1', {
        keeperEnabled: true,
        keeperCount: 3,
        keeperPenalty: 'none',
        dynastyMode: true,
      });

      // Verify the update call included keeperCount: 999
      expect(updateChain).toBeTruthy();
      expect(updateChain!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            keeperCount: 999,
            dynastyMode: true,
          }),
        })
      );
    });
  });
});

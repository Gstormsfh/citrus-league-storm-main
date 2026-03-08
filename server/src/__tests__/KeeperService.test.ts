import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeeperService } from '../services/KeeperService';
import { createChain, createMockSupabase } from './helpers';

describe('KeeperService', () => {
  let service: KeeperService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    service = new KeeperService(mockSupabase);
  });

  describe('designateKeeper', () => {
    it('inserts keeper designation and returns it', async () => {
      const designation = { id: 'kd-1', player_id: 'p1', team_id: 't1', status: 'designated' };
      mockSupabase.from = vi.fn(() => createChain({ data: designation, error: null }));

      const result = await service.designateKeeper('league-1', 't1', 'p1', 2026, 3);

      expect(result.success).toBe(true);
      expect(result.designation).toEqual(designation);
      expect(mockSupabase.from).toHaveBeenCalledWith('keeper_designations');
    });

    it('returns error on duplicate keeper (unique constraint)', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: { code: '23505', message: 'duplicate key' } }));

      const result = await service.designateKeeper('league-1', 't1', 'p1', 2026);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Player is already designated as a keeper');
    });

    it('returns generic error message for other errors', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: { code: '42000', message: 'Some DB error' } }));

      const result = await service.designateKeeper('league-1', 't1', 'p1', 2026);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Some DB error');
    });

    it('passes null for original_draft_round when not provided', async () => {
      const chain = createChain({ data: { id: 'kd-1' }, error: null });
      mockSupabase.from = vi.fn(() => chain);

      await service.designateKeeper('league-1', 't1', 'p1', 2026);

      expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({
        original_draft_round: null,
      }));
    });
  });

  describe('releaseKeeper', () => {
    it('updates keeper status to released', async () => {
      mockSupabase.from = vi.fn(() => createChain({ error: null }));

      const result = await service.releaseKeeper('kd-1', 't1');

      expect(result.success).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith('keeper_designations');
    });

    it('returns error on failure', async () => {
      mockSupabase.from = vi.fn(() => createChain({ error: { message: 'Not found' } }));

      const result = await service.releaseKeeper('kd-1', 't1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not found');
    });
  });

  describe('getTeamKeepers', () => {
    it('returns keepers for a team', async () => {
      const keepers = [
        { id: 'kd-1', player_id: 'p1', status: 'designated' },
        { id: 'kd-2', player_id: 'p2', status: 'approved' },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: keepers, error: null }));

      const result = await service.getTeamKeepers('league-1', 't1', 2026);

      expect(result.keepers).toEqual(keepers);
      expect(result.error).toBeNull();
    });

    it('returns empty array when no keepers', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getTeamKeepers('league-1', 't1', 2026);

      expect(result.keepers).toEqual([]);
    });

    it('returns error from query', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: { message: 'Query failed' } }));

      const result = await service.getTeamKeepers('league-1', 't1', 2026);

      expect(result.error).toEqual({ message: 'Query failed' });
    });
  });

  describe('getLeagueKeepers', () => {
    it('returns all keepers for a league season', async () => {
      const keepers = [
        { id: 'kd-1', team_id: 't1', player_id: 'p1' },
        { id: 'kd-2', team_id: 't2', player_id: 'p2' },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: keepers, error: null }));

      const result = await service.getLeagueKeepers('league-1', 2026);

      expect(result.keepers).toEqual(keepers);
      expect(result.error).toBeNull();
    });

    it('returns empty array when no keepers', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getLeagueKeepers('league-1', 2026);

      expect(result.keepers).toEqual([]);
    });
  });

  describe('validateKeepers', () => {
    it('returns validation result via RPC', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: [{ is_valid: true, error_message: null, keepers_count: 3, max_keepers: 5 }],
        error: null,
      });

      const result = await service.validateKeepers('league-1', 't1', 2026);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('validate_keeper_selections', {
        p_league_id: 'league-1',
        p_team_id: 't1',
        p_season_year: 2026,
      });
      expect(result.is_valid).toBe(true);
      expect(result.keepers_count).toBe(3);
      expect(result.max_keepers).toBe(5);
    });

    it('returns invalid on RPC error', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Validation failed' },
      });

      const result = await service.validateKeepers('league-1', 't1', 2026);

      expect(result.is_valid).toBe(false);
      expect(result.error_message).toBe('Validation failed');
    });

    it('handles non-array RPC result', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: { is_valid: true, error_message: null, keepers_count: 2, max_keepers: 3 },
        error: null,
      });

      const result = await service.validateKeepers('league-1', 't1', 2026);

      expect(result.is_valid).toBe(true);
      expect(result.keepers_count).toBe(2);
    });

    it('defaults values when result is null', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      const result = await service.validateKeepers('league-1', 't1', 2026);

      expect(result.is_valid).toBe(false);
      expect(result.keepers_count).toBe(0);
      expect(result.max_keepers).toBe(0);
    });
  });

  describe('getKeeperDraftCosts', () => {
    it('returns draft costs via RPC', async () => {
      const costs = [{ player_id: 'p1', keeper_round: 2, cost: 25 }];
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: costs, error: null });

      const result = await service.getKeeperDraftCosts('league-1', 't1', 2026);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('get_keeper_draft_costs', {
        p_league_id: 'league-1',
        p_team_id: 't1',
        p_season_year: 2026,
      });
      expect(result.costs).toEqual(costs);
      expect(result.error).toBeNull();
    });

    it('returns empty costs when RPC returns null', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      const result = await service.getKeeperDraftCosts('league-1', 't1', 2026);

      expect(result.costs).toEqual([]);
    });
  });

  describe('lockKeepersForSeason', () => {
    it('locks keepers and sends notification', async () => {
      const lockData = [
        { team_id: 't1', keepers_locked: 3, rounds_consumed: [1, 2, 3] },
        { team_id: 't2', keepers_locked: 2, rounds_consumed: [1, 2] },
      ];
      let rpcCallCount = 0;
      mockSupabase.rpc = vi.fn().mockImplementation(() => {
        rpcCallCount++;
        if (rpcCallCount === 1) return Promise.resolve({ data: lockData, error: null });
        // notification RPC
        return Promise.resolve({ data: null, error: null });
      });

      const result = await service.lockKeepersForSeason('league-1', 2026);

      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toEqual({ team_id: 't1', keepers_locked: 3, rounds_consumed: [1, 2, 3] });
      expect(result.error).toBeUndefined();
      // Should have called notify_league_members
      expect(mockSupabase.rpc).toHaveBeenCalledWith('notify_league_members', expect.objectContaining({
        p_league_id: 'league-1',
        p_title: 'Keepers Locked',
      }));
    });

    it('returns error when lock RPC fails', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Lock failed' } });

      const result = await service.lockKeepersForSeason('league-1', 2026);

      expect(result.results).toEqual([]);
      expect(result.error).toBe('Lock failed');
    });

    it('handles missing rounds_consumed in results', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: [{ team_id: 't1', keepers_locked: 1 }],
        error: null,
      });

      const result = await service.lockKeepersForSeason('league-1', 2026);

      expect(result.results[0].rounds_consumed).toEqual([]);
    });

    it('does not fail when notification RPC throws', async () => {
      let rpcCallCount = 0;
      mockSupabase.rpc = vi.fn().mockImplementation(() => {
        rpcCallCount++;
        if (rpcCallCount === 1) return Promise.resolve({ data: [{ team_id: 't1', keepers_locked: 1 }], error: null });
        throw new Error('Notification failed');
      });

      const result = await service.lockKeepersForSeason('league-1', 2026);

      expect(result.results).toHaveLength(1);
    });
  });

  describe('updateKeeperSettings', () => {
    it('updates keeper settings when user is commissioner', async () => {
      let callCount = 0;
      let rpcCallCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'user-1', settings: {} }, error: null });
        if (callCount === 2) return createChain({ error: null });
        return createChain();
      });
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      const result = await service.updateKeeperSettings('league-1', 'user-1', {
        keeperEnabled: true,
        keeperCount: 5,
        keeperPenalty: 'round',
        dynastyMode: false,
      });

      expect(result.success).toBe(true);
    });

    it('rejects non-commissioner', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: { commissioner_id: 'other-user', settings: {} }, error: null }));

      const result = await service.updateKeeperSettings('league-1', 'user-1', {
        keeperEnabled: true,
        keeperCount: 5,
        keeperPenalty: 'round',
        dynastyMode: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('commissioner');
    });

    it('rejects when league not found', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.updateKeeperSettings('league-1', 'user-1', {
        keeperEnabled: true,
        keeperCount: 5,
        keeperPenalty: 'round',
        dynastyMode: false,
      });

      expect(result.success).toBe(false);
    });

    it('sets keeperCount to 999 for dynasty mode', async () => {
      const updateChain = createChain({ error: null });
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'user-1', settings: { existing: true } }, error: null });
        if (callCount === 2) return updateChain;
        return createChain();
      });
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      await service.updateKeeperSettings('league-1', 'user-1', {
        keeperEnabled: true,
        keeperCount: 5,
        keeperPenalty: 'none',
        dynastyMode: true,
      });

      expect(updateChain.update).toHaveBeenCalledWith({
        settings: expect.objectContaining({
          existing: true,
          keeperEnabled: true,
          keeperCount: 999,
          dynastyMode: true,
        }),
      });
    });

    it('returns error when update fails', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'user-1', settings: {} }, error: null });
        return createChain({ error: { message: 'Update failed' } });
      });

      const result = await service.updateKeeperSettings('league-1', 'user-1', {
        keeperEnabled: true,
        keeperCount: 3,
        keeperPenalty: 'round',
        dynastyMode: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Update failed');
    });

    it('does not fail when notification throws', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'user-1', settings: {} }, error: null });
        return createChain({ error: null });
      });
      mockSupabase.rpc = vi.fn().mockRejectedValue(new Error('Notification failed'));

      const result = await service.updateKeeperSettings('league-1', 'user-1', {
        keeperEnabled: true,
        keeperCount: 3,
        keeperPenalty: 'round',
        dynastyMode: false,
      });

      expect(result.success).toBe(true);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WaiverService } from '../services/WaiverService';
import { createChain, createMockSupabase } from './helpers';

describe('WaiverService', () => {
  let service: WaiverService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    service = new WaiverService(mockSupabase);
  });

  describe('checkTransactionLimits', () => {
    it('allows when no limits are set', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: { settings: {} }, error: null }));

      const result = await service.checkTransactionLimits('league-1', 'team-1');
      expect(result.allowed).toBe(true);
    });

    it('blocks when season limit reached', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return createChain({ data: { settings: { season_add_limit: 5 } }, error: null });
        }
        return createChain({ count: 5, error: null });
      });

      const result = await service.checkTransactionLimits('league-1', 'team-1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Season');
    });
  });

  describe('getLeagueWaivers', () => {
    it('returns league waiver claims', async () => {
      const claims = [{ id: 'c1', status: 'pending' }, { id: 'c2', status: 'successful' }];
      mockSupabase.from = vi.fn(() => createChain({ data: claims, error: null }));

      const result = await service.getLeagueWaivers('league-1');
      expect(result.claims).toEqual(claims);
    });
  });

  describe('submitWaiverClaim', () => {
    it('creates a waiver claim with priority', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn((table: string) => {
        callCount++;
        if (table === 'leagues') return createChain({ data: { settings: {} }, error: null });
        if (table === 'transaction_ledger') return createChain({ count: 0, error: null });
        if (table === 'waiver_priority') return createChain({ data: { priority: 3 }, error: null });
        if (table === 'waiver_claims') return createChain({ data: { id: 'claim-1' }, error: null });
        return createChain();
      });

      const result = await service.submitWaiverClaim('league-1', 'team-1', 100);
      expect(result.success).toBe(true);
      expect(result.claimId).toBe('claim-1');
    });
  });

  describe('submitFAABBid', () => {
    it('rejects negative bid amount', async () => {
      const result = await service.submitFAABBid('league-1', 'team-1', 100, -5);
      expect(result.success).toBe(false);
      expect(result.error).toContain('non-negative');
    });

    it('rejects bid exceeding budget', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'leagues') return createChain({ data: { settings: {} }, error: null });
        if (table === 'faab_budgets') return createChain({ data: { remaining_budget: 50 }, error: null });
        if (table === 'transaction_ledger') return createChain({ count: 0, error: null });
        return createChain();
      });

      const result = await service.submitFAABBid('league-1', 'team-1', 100, 75);
      expect(result.success).toBe(false);
      expect(result.error).toContain('budget');
    });
  });

  describe('cancelClaim', () => {
    it('cancels a pending claim', async () => {
      mockSupabase.from = vi.fn(() => createChain({ error: null }));

      const result = await service.cancelClaim('claim-1');
      expect(result.success).toBe(true);
    });
  });

  describe('getFAABBudget', () => {
    it('returns budget from faab_budgets table', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: { remaining_budget: 75 }, error: null }));

      const budget = await service.getFAABBudget('league-1', 'team-1');
      expect(budget).toBe(75);
    });

    it('calculates budget from transactions when faab_budgets empty', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'faab_budgets') return createChain({ data: null, error: null });
        if (table === 'leagues') return createChain({ data: { settings: { faab_budget: 100 } }, error: null });
        if (table === 'waiver_claims') return createChain({ data: [{ bid_amount: 20 }, { bid_amount: 15 }], error: null });
        return createChain();
      });

      const budget = await service.getFAABBudget('league-1', 'team-1');
      expect(budget).toBe(65); // 100 - 20 - 15
    });
  });

  describe('addFreeAgent', () => {
    it('rejects when user does not own team', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'leagues') return createChain({ data: { settings: {} }, error: null });
        if (table === 'teams') return createChain({ data: { owner_id: 'other-user' }, error: null });
        if (table === 'transaction_ledger') return createChain({ count: 0, error: null });
        return createChain();
      });

      const result = await service.addFreeAgent('league-1', 'team-1', 100, null, 'user-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('do not own');
    });

    it('executes roster move via RPC', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'leagues') return createChain({ data: { settings: {} }, error: null });
        if (table === 'teams') return createChain({ data: { owner_id: 'user-1' }, error: null });
        if (table === 'transaction_ledger') return createChain({ count: 0, error: null });
        return createChain();
      });
      mockSupabase.rpc = vi.fn().mockResolvedValue({ error: null });

      const result = await service.addFreeAgent('league-1', 'team-1', 100, 50, 'user-1');
      expect(result.success).toBe(true);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('process_roster_move', {
        p_league_id: 'league-1',
        p_user_id: 'user-1',
        p_add_player_id: 100,
        p_drop_player_id: 50,
      });
    });
  });

  describe('dropPlayer', () => {
    it('calls roster move RPC with null add', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ error: null });

      const result = await service.dropPlayer('league-1', 'team-1', 100, 'user-1');
      expect(result.success).toBe(true);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('process_roster_move', {
        p_league_id: 'league-1',
        p_user_id: 'user-1',
        p_add_player_id: null,
        p_drop_player_id: 100,
      });
    });
  });

  describe('getWaiverPriority', () => {
    it('returns priority list', async () => {
      const priorities = [
        { team_id: 't1', priority: 1, teams: { team_name: 'Team A' } },
        { team_id: 't2', priority: 2, teams: { team_name: 'Team B' } },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: priorities, error: null }));

      const result = await service.getWaiverPriority('league-1');
      expect(result.priority).toHaveLength(2);
    });
  });
});

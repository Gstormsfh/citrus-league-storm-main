import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WaiverService } from '../services/WaiverService';
import { createChain, createMockSupabase } from './helpers';

// Mock the admin client used internally for AI team operations
let mockAdminClient: any;
vi.mock('../lib/supabase', () => ({
  getSupabaseAdmin: vi.fn(() => mockAdminClient),
}));

describe('WaiverService', () => {
  let service: WaiverService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    service = new WaiverService(mockSupabase);
    // Default admin client for AI team checks
    mockAdminClient = {
      from: vi.fn(() => createChain({ data: { owner_id: 'some-user' }, error: null })),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
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

  describe('AI team roster operations', () => {
    it('addFreeAgent uses admin path for AI teams (owner_id = NULL)', async () => {
      // Mock limit check + waiver check + roster size pre-check
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: false, error: null });
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'leagues') return createChain({ data: { settings: {}, roster_size: 22 }, error: null });
        if (table === 'transaction_ledger') return createChain({ count: 0, error: null });
        return createChain();
      });

      // Mock admin client: existence check, roster size check, isAiTeam, then roster operations
      let adminRosterCallCount = 0;
      mockAdminClient = {
        from: vi.fn((table: string) => {
          // roster_assignments is called twice: first for existence check (count: 0), then for roster size / move
          if (table === 'roster_assignments') {
            adminRosterCallCount++;
            if (adminRosterCallCount === 1) return createChain({ data: null, error: null, count: 0 }); // not on any roster
            if (adminRosterCallCount === 2) return createChain({ data: null, error: null, count: 5 }); // roster size check
            return createChain({ data: null, error: null, count: 5 });
          }
          // isAiTeam check
          if (table === 'teams') return createChain({ data: { owner_id: null }, error: null });
          // executeAiTeamRosterMove calls
          if (table === 'leagues') return createChain({ data: { roster_size: 22, settings: {} }, error: null });
          if (table === 'nhl_players') return createChain({ data: { position: 'C' }, error: null });
          if (table === 'transaction_ledger') return createChain({ data: null, error: null });
          if (table === 'team_lineups') return createChain({ data: { id: 'lineup-1', bench: [] }, error: null });
          return createChain({ data: null, error: null });
        }),
        rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      const result = await service.addFreeAgent('league-1', 'ai-team-1', 100, null, 'user-1');
      expect(result.success).toBe(true);
      // Should NOT have called process_roster_move RPC (only is_player_on_waivers)
      expect(mockSupabase.rpc).not.toHaveBeenCalledWith('process_roster_move', expect.any(Object));
    });

    it('dropPlayer uses admin path for AI teams (owner_id = NULL)', async () => {
      let adminFromCallCount = 0;
      mockAdminClient = {
        from: vi.fn((table: string) => {
          adminFromCallCount++;
          // First call: isAiTeam check
          if (table === 'teams' && adminFromCallCount === 1) {
            return createChain({ data: { owner_id: null }, error: null });
          }
          // executeAiTeamRosterMove calls
          if (table === 'leagues') return createChain({ data: { roster_size: 22, settings: {} }, error: null });
          if (table === 'roster_assignments') return createChain({ data: { id: 'assignment-1' }, error: null });
          if (table === 'transaction_ledger') return createChain({ data: null, error: null });
          if (table === 'team_lineups') return createChain({ data: null, error: null });
          if (table === 'draft_picks') return createChain({ data: null, error: null });
          return createChain({ data: null, error: null });
        }),
        rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      const result = await service.dropPlayer('league-1', 'ai-team-1', 100, 'user-1');
      expect(result.success).toBe(true);
      // Should NOT have called process_roster_move RPC
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });

    it('addFreeAgent uses RPC path for human-owned teams', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'leagues') return createChain({ data: { settings: {} }, error: null });
        if (table === 'teams') return createChain({ data: { owner_id: 'user-1' }, error: null });
        if (table === 'transaction_ledger') return createChain({ count: 0, error: null });
        return createChain();
      });
      mockSupabase.rpc = vi.fn().mockResolvedValue({ error: null });

      // Admin client returns owner_id for human teams
      mockAdminClient = {
        from: vi.fn(() => createChain({ data: { owner_id: 'user-1' }, error: null })),
      };

      const result = await service.addFreeAgent('league-1', 'team-1', 100, null, 'user-1');
      expect(result.success).toBe(true);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('process_roster_move', expect.any(Object));
    });
  });
});

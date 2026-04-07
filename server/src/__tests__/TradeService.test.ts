import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TradeService } from '../services/TradeService';
import { createChain, createMockSupabase } from './helpers';

describe('TradeService', () => {
  let service: TradeService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    service = new TradeService(mockSupabase);
  });

  describe('getLeagueTrades', () => {
    it('returns trades for a league', async () => {
      const trades = [{ id: 't1', status: 'pending' }, { id: 't2', status: 'completed' }];
      mockSupabase.from = vi.fn(() => createChain({ data: trades, error: null }));

      const result = await service.getLeagueTrades('league-1');
      expect(result.trades).toEqual(trades);
      expect(result.error).toBeNull();
    });

    it('filters by status when provided', async () => {
      const chain = createChain({ data: [], error: null });
      mockSupabase.from = vi.fn(() => chain);

      await service.getLeagueTrades('league-1', 'pending');
      expect(chain.eq).toHaveBeenCalledWith('status', 'pending');
    });
  });

  describe('createTradeOffer', () => {
    const teamsRows = (ownerId: string) => [
      { id: 'team-1', owner_id: ownerId, league_id: 'league-1' },
      { id: 'team-2', owner_id: 'user-2', league_id: 'league-1' },
    ];

    it('rejects when user does not own from_team', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'teams') return createChain({ data: teamsRows('other-user'), error: null });
        return createChain({ data: [], error: null });
      });

      const result = await service.createTradeOffer(
        'league-1', 'team-1', 'team-2', [100], [200], 'user-1',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('do not own');
    });

    it('rejects trades in best-ball leagues', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'teams') return createChain({ data: teamsRows('user-1'), error: null });
        if (table === 'roster_assignments') {
          return createChain({ data: [{ player_id: '100' }, { player_id: '200' }], error: null });
        }
        if (table === 'leagues') return createChain({ data: { settings: { scoring_format: 'best-ball' } }, error: null });
        return createChain({ data: null, error: null });
      });

      const result = await service.createTradeOffer(
        'league-1', 'team-1', 'team-2', [100], [200], 'user-1',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Best Ball');
    });

    it('rejects when trade deadline has passed', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'teams') return createChain({ data: teamsRows('user-1'), error: null });
        if (table === 'roster_assignments') {
          return createChain({ data: [{ player_id: '100' }, { player_id: '200' }], error: null });
        }
        if (table === 'leagues') return createChain({ data: { settings: { trade_deadline: '2020-01-01T00:00:00Z' } }, error: null });
        return createChain({ data: null, error: null });
      });

      const result = await service.createTradeOffer(
        'league-1', 'team-1', 'team-2', [100], [200], 'user-1',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('deadline');
    });

    it('creates trade offer with expiration', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'teams') return createChain({ data: teamsRows('user-1'), error: null });
        if (table === 'roster_assignments') {
          return createChain({ data: [{ player_id: '100' }, { player_id: '200' }], error: null });
        }
        if (table === 'leagues') return createChain({ data: { settings: { trade_expiration_days: 3 } }, error: null });
        if (table === 'trade_offers') return createChain({ data: { id: 'trade-1', status: 'pending' }, error: null });
        return createChain({ data: null, error: null });
      });

      const result = await service.createTradeOffer(
        'league-1', 'team-1', 'team-2', [100], [200], 'user-1', 'Fair trade!',
      );
      expect(result.success).toBe(true);
      expect(result.tradeId).toBe('trade-1');
    });
  });

  describe('rejectTradeOffer', () => {
    it('rejects when trade not found', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.rejectTradeOffer('trade-1', 'user-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('rejects when user is not the recipient', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { to_team_id: 'team-2' }, error: null });
        return createChain({ data: { owner_id: 'other-user' }, error: null });
      });

      const result = await service.rejectTradeOffer('trade-1', 'user-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('recipient');
    });
  });

  describe('cancelTradeOffer', () => {
    it('rejects when user is not the proposer', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { from_team_id: 'team-1' }, error: null });
        return createChain({ data: { owner_id: 'other-user' }, error: null });
      });

      const result = await service.cancelTradeOffer('trade-1', 'user-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('proposer');
    });
  });

  describe('commissionerDecision', () => {
    it('vetoes a trade', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'leagues') return createChain({ data: { commissioner_id: 'commish-1' }, error: null });
        if (table === 'teams') return createChain({ data: null, error: null });
        return createChain({ error: null });
      });
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      const result = await service.commissionerDecision('trade-1', 'league-1', 'veto', 'commish-1');
      expect(result.success).toBe(true);
    });

    it('approves and executes via RPC', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'leagues') return createChain({ data: { commissioner_id: 'commish-1' }, error: null });
        if (table === 'trade_offers') return createChain({
          data: {
            league_id: 'league-1',
            from_team_id: 'team-1',
            to_team_id: 'team-2',
            offered_player_ids: [100],
            requested_player_ids: [200],
          },
          error: null,
        });
        return createChain({ data: null, error: null });
      });
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null });

      const result = await service.commissionerDecision('trade-1', 'league-1', 'approve', 'commish-1');
      expect(mockSupabase.rpc).toHaveBeenCalledWith('execute_trade', expect.objectContaining({
        p_trade_id: 'trade-1',
        p_league_id: 'league-1',
        p_from_team_id: 'team-1',
        p_to_team_id: 'team-2',
      }));
      expect(result.success).toBe(true);
    });
  });

  describe('submitTradeVote', () => {
    it('calls RPC and returns vote counts', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: { veto_count: 1, approve_count: 3, votes_needed: 4, is_vetoed: false },
        error: null,
      });

      const result = await service.submitTradeVote('trade-1', 'team-1', 'approve');
      expect(result.success).toBe(true);
      expect(result.approveCount).toBe(3);
      expect(result.isVetoed).toBe(false);
    });

    it('returns error when RPC fails', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Already voted' } });

      const result = await service.submitTradeVote('trade-1', 'team-1', 'approve');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Already voted');
    });
  });

  describe('getTradeVotes', () => {
    it('returns formatted votes', async () => {
      const votes = [
        { voter_team_id: 't1', vote: 'approve', created_at: '2026-01-01' },
        { voter_team_id: 't2', vote: 'veto', created_at: '2026-01-02' },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: votes, error: null }));

      const result = await service.getTradeVotes('trade-1');
      expect(result.votes).toHaveLength(2);
      expect(result.votes[0].voterTeamId).toBe('t1');
    });
  });

  describe('getTradeReviewSettings', () => {
    it('returns review settings with defaults', async () => {
      mockSupabase.from = vi.fn(() => createChain({
        data: { trade_review_type: 'league_vote', trade_review_period_hours: 24, trade_veto_threshold: 0.3 },
        error: null,
      }));

      const result = await service.getTradeReviewSettings('league-1');
      expect(result.reviewType).toBe('league_vote');
      expect(result.reviewPeriodHours).toBe(24);
      expect(result.vetoThreshold).toBe(0.3);
    });
  });
});

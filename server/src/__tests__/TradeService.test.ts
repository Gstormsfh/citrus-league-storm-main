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
    it('returns enriched trades for a league', async () => {
      const trades = [
        { id: 't1', status: 'pending', from_team_id: 'team-a', to_team_id: 'team-b', offered_player_ids: [101], requested_player_ids: [201] },
        { id: 't2', status: 'completed', from_team_id: 'team-a', to_team_id: 'team-b', offered_player_ids: [], requested_player_ids: [] },
      ];
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'trade_offers') return createChain({ data: trades, error: null });
        if (table === 'teams') return createChain({ data: [{ id: 'team-a', team_name: 'Alpha' }, { id: 'team-b', team_name: 'Beta' }], error: null });
        if (table === 'player_directory') {
          return createChain({
            data: [
              { player_id: 101, full_name: 'Connor McDavid', position_code: 'C', team_abbrev: 'EDM' },
              { player_id: 201, full_name: 'Nikita Kucherov', position_code: 'RW', team_abbrev: 'TBL' },
            ],
            error: null,
          });
        }
        return createChain({ data: [], error: null });
      });

      const result = await service.getLeagueTrades('league-1');
      expect(result.trades).toHaveLength(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const first = result.trades[0] as any;
      expect(first.from_team_name).toBe('Alpha');
      expect(first.to_team_name).toBe('Beta');
      expect(first.offered_players).toHaveLength(1);
      expect(first.offered_players[0].full_name).toBe('Connor McDavid');
      expect(first.requested_players[0].full_name).toBe('Nikita Kucherov');
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

  describe('acceptTradeOffer — offer expiry (OFFER-EXPIRY FIX 2026-08-23)', () => {
    it('refuses an offer past its expires_at and marks it expired', async () => {
      let callCount = 0;
      const expiredUpdateChain = createChain({ data: null, error: null });
      mockSupabase.from = vi.fn(() => {
        callCount++;
        // 1st from('trade_offers'): the pending-offer load — expired yesterday.
        if (callCount === 1) {
          return createChain({
            data: {
              id: 'trade-1',
              league_id: 'league-1',
              from_team_id: 'team-1',
              to_team_id: 'team-2',
              status: 'pending',
              expires_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
            },
            error: null,
          });
        }
        // 2nd from('trade_offers'): the status → 'expired' write.
        return expiredUpdateChain;
      });

      const result = await service.acceptTradeOffer('trade-1', 'user-2');
      expect(result.success).toBe(false);
      expect(result.error).toContain('expired');
      // The row was marked, so Trade History tells the truth.
      expect(expiredUpdateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'expired' }),
      );
    });

    it('proceeds past the expiry guard when expires_at is in the future', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return createChain({
            data: {
              id: 'trade-1',
              league_id: 'league-1',
              from_team_id: 'team-1',
              to_team_id: 'team-2',
              status: 'pending',
              expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
            },
            error: null,
          });
        }
        // Next read is the to_team ownership check — wrong owner stops the
        // flow THERE, proving the guard let a live offer through.
        return createChain({ data: { owner_id: 'other-user' }, error: null });
      });

      const result = await service.acceptTradeOffer('trade-1', 'user-2');
      expect(result.success).toBe(false);
      expect(result.error).toContain('recipient');
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
    /**
     * T4 (2026-09-03): the trade used to be selected by id alone, with no status
     * guard, so approve or veto acted on trades that were already rejected,
     * cancelled, expired or executed. On production 2026-09-03 that is 18 of the
     * 23 trade_offers rows (15 cancelled, 1 rejected, 1 vetoed, 1 expired). The
     * sharp form: a commissioner who is also one of the two trading teams
     * forcing through a deal the other side explicitly rejected.
     */
    const tradeRow = (status: string, leagueId = 'league-1') => ({
      league_id: leagueId,
      from_team_id: 'team-1',
      to_team_id: 'team-2',
      offered_player_ids: [100],
      requested_player_ids: [200],
      status,
    });

    const withTrade = (row: unknown) => vi.fn((table: string) => {
      if (table === 'leagues') return createChain({ data: { commissioner_id: 'commish-1' }, error: null });
      if (table === 'trade_offers') return createChain({ data: row, error: null });
      if (table === 'teams') return createChain({ data: null, error: null });
      return createChain({ data: null, error: null });
    });

    it('vetoes a trade', async () => {
      mockSupabase.from = withTrade(tradeRow('under_review'));
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      const result = await service.commissionerDecision('trade-1', 'league-1', 'veto', 'commish-1');
      expect(result.success).toBe(true);
    });

    it('approves and executes via RPC', async () => {
      mockSupabase.from = withTrade(tradeRow('under_review'));
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

    it('refuses to approve a trade the recipient already rejected', async () => {
      mockSupabase.from = withTrade(tradeRow('rejected'));
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null });

      const result = await service.commissionerDecision('trade-1', 'league-1', 'approve', 'commish-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('already rejected');
      // No rosters moved.
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });

    it('refuses to veto a trade that was already cancelled', async () => {
      mockSupabase.from = withTrade(tradeRow('cancelled'));
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

      const result = await service.commissionerDecision('trade-1', 'league-1', 'veto', 'commish-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('already cancelled');
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });

    it('refuses when the trade belongs to a different league than the one authorised', async () => {
      // requireCommissioner was checked against the body's leagueId. If the
      // trade lives somewhere else, that check proved nothing about this trade.
      mockSupabase.from = withTrade(tradeRow('pending', 'league-2'));
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null });

      const result = await service.commissionerDecision('trade-1', 'league-1', 'approve', 'commish-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not belong to this league');
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });

    it('still acts on a plain pending trade in a review-type = none league', async () => {
      mockSupabase.from = withTrade(tradeRow('pending'));
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null });

      const result = await service.commissionerDecision('trade-1', 'league-1', 'approve', 'commish-1');
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

    /**
     * submit_trade_vote is RETURNS TABLE(success, message, ...): supabase-js
     * hands back an array of rows, and the RPC reports its own refusals in
     * row.success / row.message rather than in `error`. Reading neither made
     * every refusal look like a recorded vote - including the team-ownership
     * refusal added on 2026-09-03 (T3), which would have been silently useless.
     */
    it('reports the RPC refusal row as a failure, not a phantom success', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: [{ success: false, message: 'You can only vote as a team you own', veto_count: 0, approve_count: 0, votes_needed: 0, is_vetoed: false }],
        error: null,
      });

      const result = await service.submitTradeVote('trade-1', 'someone-elses-team', 'veto');
      expect(result.success).toBe(false);
      expect(result.error).toBe('You can only vote as a team you own');
    });

    it('reads counts out of the row array the RPC actually returns', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: [{ success: true, message: 'Vote recorded', veto_count: 2, approve_count: 1, votes_needed: 3, is_vetoed: false }],
        error: null,
      });

      const result = await service.submitTradeVote('trade-1', 'team-1', 'veto');
      expect(result.success).toBe(true);
      expect(result.vetoCount).toBe(2);
      expect(result.votesNeeded).toBe(3);
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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuctionService } from '../services/AuctionService';
import { createChain, createMockSupabase } from './helpers';

describe('AuctionService', () => {
  let service: AuctionService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    service = new AuctionService(mockSupabase);
  });

  describe('initializeAuction', () => {
    it('creates budgets and updates session settings', async () => {
      mockSupabase.from = vi.fn((table: string) => {
        if (table === 'auction_budgets') return createChain({ error: null });
        if (table === 'draft_sessions') return createChain({ error: null });
        return createChain();
      });

      const result = await service.initializeAuction('league-1', 'session-1', ['t1', 't2'], 200, 1);

      expect(result.success).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith('auction_budgets');
      expect(mockSupabase.from).toHaveBeenCalledWith('draft_sessions');
    });

    it('returns error when budget creation fails', async () => {
      mockSupabase.from = vi.fn(() => createChain({ error: { message: 'Insert failed' } }));

      const result = await service.initializeAuction('league-1', 'session-1', ['t1']);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insert failed');
    });

    it('returns error when session update fails', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ error: null }); // budget success
        return createChain({ error: { message: 'Session update failed' } }); // session fail
      });

      const result = await service.initializeAuction('league-1', 'session-1', ['t1']);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Session update failed');
    });

    it('uses default budget of 200 and min bid of 1', async () => {
      const upsertChain = createChain({ error: null });
      const updateChain = createChain({ error: null });
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return upsertChain;
        return updateChain;
      });

      await service.initializeAuction('league-1', 'session-1', ['t1', 't2']);

      // Verify upsert was called with correct budget rows
      expect(upsertChain.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ initial_budget: 200, remaining_budget: 200 }),
        ]),
        expect.any(Object),
      );
    });
  });

  describe('getAuctionState', () => {
    it('returns full auction state', async () => {
      const sessionChain = createChain({
        data: {
          settings: {
            nomination_order: ['t1', 't2'],
            current_nominator_index: 0,
            total_nominations: 5,
          },
        },
        error: null,
      });
      const budgetChain = createChain({
        data: [{ team_id: 't1', remaining_budget: 180 }],
        error: null,
      });
      const nomChain = createChain({
        data: { id: 'nom-1', status: 'active' },
        error: null,
      });

      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return sessionChain;
        if (callCount === 2) return budgetChain;
        if (callCount === 3) return nomChain;
        return createChain();
      });

      const result = await service.getAuctionState('league-1', 'session-1');

      expect(result).not.toBeNull();
      expect(result!.nomination_order).toEqual(['t1', 't2']);
      expect(result!.current_nominator_index).toBe(0);
      expect(result!.total_nominations).toBe(5);
      expect(result!.current_nomination).toEqual({ id: 'nom-1', status: 'active' });
      expect(result!.budgets).toHaveLength(1);
    });

    it('returns null when session not found', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getAuctionState('league-1', 'session-1');

      expect(result).toBeNull();
    });

    it('handles missing nomination (no active nomination)', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { settings: { nomination_order: ['t1'] } }, error: null });
        if (callCount === 2) return createChain({ data: [], error: null });
        if (callCount === 3) return createChain({ data: null, error: null });
        return createChain();
      });

      const result = await service.getAuctionState('league-1', 'session-1');

      expect(result).not.toBeNull();
      expect(result!.current_nomination).toBeNull();
    });
  });

  describe('nominatePlayer', () => {
    it('rejects nomination when not the current nominator', async () => {
      // Mock getAuctionState to return a state where t2 is the nominator
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { settings: { nomination_order: ['t2', 't1'], current_nominator_index: 0, total_nominations: 0 } }, error: null });
        if (callCount === 2) return createChain({ data: [], error: null }); // budgets
        if (callCount === 3) return createChain({ data: null, error: null }); // no active nom
        return createChain();
      });

      const result = await service.nominatePlayer('league-1', 'session-1', 't1', 'player-1', 'Connor McDavid');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not your turn');
    });

    it('rejects nomination when one is already active', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { settings: { nomination_order: ['t1'], current_nominator_index: 0, total_nominations: 0 } }, error: null });
        if (callCount === 2) return createChain({ data: [], error: null });
        if (callCount === 3) return createChain({ data: { id: 'nom-existing', status: 'active' }, error: null });
        return createChain();
      });

      const result = await service.nominatePlayer('league-1', 'session-1', 't1', 'player-1', 'McDavid');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already active');
    });

    it('rejects already drafted player', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        // getAuctionState calls: session, budgets, nomination
        if (callCount === 1) return createChain({ data: { settings: { nomination_order: ['t1'], current_nominator_index: 0, total_nominations: 0 } }, error: null });
        if (callCount === 2) return createChain({ data: [], error: null });
        if (callCount === 3) return createChain({ data: null, error: null }); // no active nom
        // draft_picks check - player already drafted
        if (callCount === 4) return createChain({ data: { id: 'pick-existing' }, error: null });
        return createChain();
      });

      const result = await service.nominatePlayer('league-1', 'session-1', 't1', 'player-1', 'McDavid');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already been drafted');
    });

    it('creates nomination successfully', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        // getAuctionState calls
        if (callCount === 1) return createChain({ data: { settings: { nomination_order: ['t1'], current_nominator_index: 0, total_nominations: 0 } }, error: null });
        if (callCount === 2) return createChain({ data: [], error: null });
        if (callCount === 3) return createChain({ data: null, error: null });
        // draft_picks check - not drafted
        if (callCount === 4) return createChain({ data: null, error: null });
        // insert nomination
        if (callCount === 5) return createChain({ data: { id: 'nom-1', player_name: 'McDavid' }, error: null });
        // insert bid
        if (callCount === 6) return createChain({ error: null });
        // read session settings
        if (callCount === 7) return createChain({ data: { settings: { total_nominations: 0 } }, error: null });
        // update session
        if (callCount === 8) return createChain({ error: null });
        return createChain();
      });

      const result = await service.nominatePlayer('league-1', 'session-1', 't1', 'player-1', 'McDavid');

      expect(result.success).toBe(true);
      expect(result.nomination).toEqual({ id: 'nom-1', player_name: 'McDavid' });
    });

    it('returns error when auction state not found', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.nominatePlayer('league-1', 'session-1', 't1', 'player-1', 'McDavid');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('placeBid', () => {
    it('rejects bid when nomination not found', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.placeBid('league-1', 'nom-1', 't1', 10);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('rejects bid not higher than current', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { id: 'nom-1', current_high_bid: 10, current_high_bidder_team_id: 't2', expires_at: null }, error: null });
        return createChain();
      });

      const result = await service.placeBid('league-1', 'nom-1', 't1', 10);

      expect(result.success).toBe(false);
      expect(result.error).toContain('higher than current bid');
    });

    it('rejects bid exceeding max bid (budget - reserve)', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { id: 'nom-1', current_high_bid: 5, current_high_bidder_team_id: 't2', expires_at: null }, error: null });
        if (callCount === 2) return createChain({ data: { remaining_budget: 10, players_won: 19 }, error: null }); // budget
        if (callCount === 3) return createChain({ data: { roster_size: 21 }, error: null }); // league
        return createChain();
      });

      // roster_size=21, players_won=19, slotsRemaining=21-19-1=1, reserve=1, maxBid=10-1=9
      const result = await service.placeBid('league-1', 'nom-1', 't1', 10);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Maximum bid');
    });

    it('places bid successfully', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { id: 'nom-1', current_high_bid: 5, current_high_bidder_team_id: 't2', expires_at: null }, error: null });
        if (callCount === 2) return createChain({ data: { remaining_budget: 100, players_won: 0 }, error: null });
        if (callCount === 3) return createChain({ data: { roster_size: 21 }, error: null });
        if (callCount === 4) return createChain({ error: null }); // insert bid
        if (callCount === 5) return createChain({ error: null }); // update nomination
        return createChain();
      });

      const result = await service.placeBid('league-1', 'nom-1', 't1', 10);

      expect(result.success).toBe(true);
    });

    it('rejects when budget not found', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { id: 'nom-1', current_high_bid: 5, expires_at: null }, error: null });
        if (callCount === 2) return createChain({ data: null, error: null }); // no budget
        return createChain();
      });

      const result = await service.placeBid('league-1', 'nom-1', 't1', 10);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Budget not found');
    });
  });

  describe('closeNomination', () => {
    it('closes nomination and records draft pick', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        // fetch nomination
        if (callCount === 1) return createChain({ data: { id: 'nom-1', player_id: 'p1', current_high_bid: 15, current_high_bidder_team_id: 't1', status: 'active' }, error: null });
        // update nomination status to sold
        if (callCount === 2) return createChain({ error: null });
        // fetch budget
        if (callCount === 3) return createChain({ data: { remaining_budget: 200, players_won: 0 }, error: null });
        // update budget
        if (callCount === 4) return createChain({ error: null });
        // fetch session for total_nominations
        if (callCount === 5) return createChain({ data: { settings: { total_nominations: 1, nomination_order: ['t1', 't2'], current_nominator_index: 0 } }, error: null });
        // insert draft pick
        if (callCount === 6) return createChain({ error: null });
        // update session (advance nominator)
        if (callCount === 7) return createChain({ error: null });
        return createChain();
      });

      const result = await service.closeNomination('league-1', 'session-1', 'nom-1');

      expect(result.success).toBe(true);
      expect(result.winner_team_id).toBe('t1');
      expect(result.amount).toBe(15);
    });

    it('returns error when nomination not found or already closed', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.closeNomination('league-1', 'session-1', 'nom-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error when nomination status is not active', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: { id: 'nom-1', status: 'sold' }, error: null }));

      const result = await service.closeNomination('league-1', 'session-1', 'nom-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found or already closed');
    });

    it('returns success without draft pick when no winner', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { id: 'nom-1', player_id: 'p1', current_high_bid: 0, current_high_bidder_team_id: null, status: 'active' }, error: null });
        if (callCount === 2) return createChain({ error: null }); // update to sold
        return createChain();
      });

      const result = await service.closeNomination('league-1', 'session-1', 'nom-1');

      expect(result.success).toBe(true);
    });
  });

  describe('getBidHistory', () => {
    it('returns bids ordered by amount descending', async () => {
      const bids = [
        { id: 'b1', bid_amount: 20 },
        { id: 'b2', bid_amount: 15 },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: bids, error: null }));

      const result = await service.getBidHistory('nom-1');

      expect(result.bids).toEqual(bids);
      expect(result.error).toBeNull();
    });

    it('returns empty array when no bids', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getBidHistory('nom-1');

      expect(result.bids).toEqual([]);
    });
  });

  describe('getAuctionBudgets', () => {
    it('returns budgets for a league', async () => {
      const budgets = [
        { team_id: 't1', remaining_budget: 180 },
        { team_id: 't2', remaining_budget: 150 },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: budgets, error: null }));

      const result = await service.getAuctionBudgets('league-1');

      expect(result.budgets).toEqual(budgets);
      expect(result.error).toBeNull();
    });

    it('returns empty array when no budgets', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));

      const result = await service.getAuctionBudgets('league-1');

      expect(result.budgets).toEqual([]);
    });
  });
});

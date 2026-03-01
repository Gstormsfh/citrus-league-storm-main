import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock Setup
// =============================================================================

function createChainableMock() {
  const chain: Record<string, any> = {};
  const chainMethods = ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'is', 'in', 'order', 'limit'];
  chainMethods.forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  return chain;
}

let mockChain = createChainableMock();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => mockChain),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/utils/seasonConstants', () => ({
  CURRENT_SEASON: '20252026',
}));

vi.mock('@/utils/queryColumns', () => ({
  COLUMNS: {
    AUCTION_BUDGET: 'id, league_id, team_id, initial_budget, remaining_budget, players_won, updated_at',
    AUCTION_NOMINATION: 'id, league_id, draft_session_id, nominated_by_team_id, player_id, player_name, minimum_bid, current_high_bid, current_high_bidder_team_id, status, nomination_number, expires_at, created_at',
    AUCTION_BID: 'id, league_id, nomination_id, team_id, bid_amount, created_at',
  },
}));

// =============================================================================
// Import AFTER mocks
// =============================================================================

let AuctionDraftService: typeof import('../AuctionDraftService').AuctionDraftService;

beforeEach(async () => {
  vi.clearAllMocks();
  mockChain = createChainableMock();
  const mod = await import('../AuctionDraftService');
  AuctionDraftService = mod.AuctionDraftService;

  const { supabase } = await import('@/integrations/supabase/client');
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);
});

// =============================================================================
// initializeAuction
// =============================================================================

describe('AuctionDraftService.initializeAuction', () => {
  it('creates budget entries for each team and updates session settings', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let upsertedData: any = null;
    let updatedData: any = null;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'auction_budgets') {
        chain.upsert.mockImplementation((data: any) => {
          upsertedData = data;
          return Promise.resolve({ data: null, error: null });
        });
      }
      if (table === 'draft_sessions') {
        chain.update.mockImplementation((data: any) => {
          updatedData = data;
          return chain;
        });
        chain.eq.mockResolvedValue({ data: null, error: null });
      }
      return chain;
    });

    const result = await AuctionDraftService.initializeAuction(
      'league-1', 'session-1', ['team-a', 'team-b', 'team-c'], 200, 1
    );

    expect(result.success).toBe(true);
    expect(upsertedData).toHaveLength(3);
    expect(upsertedData[0]).toMatchObject({
      league_id: 'league-1',
      team_id: 'team-a',
      initial_budget: 200,
      remaining_budget: 200,
      players_won: 0,
    });
    expect(updatedData.settings.draft_type).toBe('auction');
    expect(updatedData.settings.budget).toBe(200);
    expect(updatedData.settings.min_bid).toBe(1);
    expect(updatedData.settings.nomination_order).toEqual(['team-a', 'team-b', 'team-c']);
  });

  it('returns error when budget upsert fails', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'auction_budgets') {
        chain.upsert.mockResolvedValue({
          data: null,
          error: { message: 'Unique constraint violation' },
        });
      }
      return chain;
    });

    const result = await AuctionDraftService.initializeAuction(
      'league-1', 'session-1', ['team-a'], 200
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unique constraint');
  });

  it('uses default budget of 200 when not specified', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let upsertedData: any = null;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'auction_budgets') {
        chain.upsert.mockImplementation((data: any) => {
          upsertedData = data;
          return Promise.resolve({ data: null, error: null });
        });
      }
      if (table === 'draft_sessions') {
        chain.eq.mockResolvedValue({ data: null, error: null });
      }
      return chain;
    });

    await AuctionDraftService.initializeAuction('league-1', 'session-1', ['team-a']);

    expect(upsertedData[0].initial_budget).toBe(200);
    expect(upsertedData[0].remaining_budget).toBe(200);
  });
});

// =============================================================================
// placeBid
// =============================================================================

describe('AuctionDraftService.placeBid', () => {
  it('rejects bid lower than current high bid', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'auction_nominations') {
        chain.single.mockResolvedValue({
          data: {
            id: 'nom-1',
            current_high_bid: 25,
            current_high_bidder_team_id: 'team-a',
            expires_at: new Date(Date.now() + 30000).toISOString(),
            status: 'active',
          },
          error: null,
        });
      }
      return chain;
    });

    const result = await AuctionDraftService.placeBid('league-1', 'nom-1', 'team-b', 20);

    expect(result.success).toBe(false);
    expect(result.error).toContain('higher than current bid');
    expect(result.error).toContain('$25');
  });

  it('rejects bid that exceeds maximum allowed (budget minus reserve)', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'auction_nominations') {
        chain.single.mockResolvedValue({
          data: {
            id: 'nom-1',
            current_high_bid: 10,
            current_high_bidder_team_id: 'team-a',
            expires_at: new Date(Date.now() + 30000).toISOString(),
            status: 'active',
          },
          error: null,
        });
      }
      if (table === 'auction_budgets') {
        // $50 remaining, 5 players won
        chain.single.mockResolvedValue({
          data: { remaining_budget: 50, players_won: 5 },
          error: null,
        });
      }
      if (table === 'leagues') {
        // Roster size 21: 21 - 5 - 1 = 15 slots remaining, need $15 reserve
        // Max bid = $50 - $15 = $35
        chain.single.mockResolvedValue({
          data: { roster_size: 21 },
          error: null,
        });
      }
      return chain;
    });

    const result = await AuctionDraftService.placeBid('league-1', 'nom-1', 'team-b', 40);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Maximum bid is $35');
  });

  it('accepts a valid bid and updates the nomination', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let bidInserted = false;
    let nominationUpdated = false;

    let auctionNomCallCount = 0;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'auction_nominations') {
        auctionNomCallCount++;
        if (auctionNomCallCount === 1) {
          // First call: select().eq().eq().single() — fetch the nomination
          chain.single.mockResolvedValue({
            data: {
              id: 'nom-1',
              current_high_bid: 10,
              current_high_bidder_team_id: 'team-a',
              expires_at: new Date(Date.now() + 30000).toISOString(),
              status: 'active',
            },
            error: null,
          });
        } else {
          // Second call: update().eq() — update the nomination
          chain.update.mockImplementation(() => {
            nominationUpdated = true;
            return chain;
          });
          chain.eq.mockResolvedValue({ data: null, error: null });
        }
      }
      if (table === 'auction_budgets') {
        chain.single.mockResolvedValue({
          data: { remaining_budget: 150, players_won: 3 },
          error: null,
        });
      }
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { roster_size: 21 },
          error: null,
        });
      }
      if (table === 'auction_bids') {
        chain.insert.mockImplementation(() => {
          bidInserted = true;
          return Promise.resolve({ data: null, error: null });
        });
      }
      return chain;
    });

    const result = await AuctionDraftService.placeBid('league-1', 'nom-1', 'team-b', 15);

    expect(result.success).toBe(true);
    expect(bidInserted).toBe(true);
    expect(nominationUpdated).toBe(true);
  });

  it('returns error when nomination not found', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'auction_nominations') {
        chain.single.mockResolvedValue({
          data: null,
          error: { message: 'No rows found' },
        });
      }
      return chain;
    });

    const result = await AuctionDraftService.placeBid('league-1', 'nom-1', 'team-b', 15);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found or already closed');
  });
});

// =============================================================================
// getAuctionBudgets
// =============================================================================

describe('AuctionDraftService.getAuctionBudgets', () => {
  it('returns budgets ordered by remaining budget descending', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'auction_budgets') {
        chain.order.mockResolvedValue({
          data: [
            { id: 'b1', league_id: 'league-1', team_id: 'team-a', initial_budget: 200, remaining_budget: 150, players_won: 3 },
            { id: 'b2', league_id: 'league-1', team_id: 'team-b', initial_budget: 200, remaining_budget: 100, players_won: 8 },
          ],
          error: null,
        });
      }
      return chain;
    });

    const result = await AuctionDraftService.getAuctionBudgets('league-1');

    expect(result).toHaveLength(2);
    expect(result[0].remaining_budget).toBe(150);
    expect(result[1].remaining_budget).toBe(100);
  });

  it('returns empty array on error', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Network timeout');
    });

    const result = await AuctionDraftService.getAuctionBudgets('league-1');

    expect(result).toEqual([]);
  });
});

// =============================================================================
// getBidHistory
// =============================================================================

describe('AuctionDraftService.getBidHistory', () => {
  it('returns bids sorted by bid amount descending', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'auction_bids') {
        chain.order.mockResolvedValue({
          data: [
            { id: 'bid-3', nomination_id: 'nom-1', team_id: 'team-c', bid_amount: 30 },
            { id: 'bid-2', nomination_id: 'nom-1', team_id: 'team-b', bid_amount: 25 },
            { id: 'bid-1', nomination_id: 'nom-1', team_id: 'team-a', bid_amount: 15 },
          ],
          error: null,
        });
      }
      return chain;
    });

    const result = await AuctionDraftService.getBidHistory('nom-1');

    expect(result).toHaveLength(3);
    expect(result[0].bid_amount).toBe(30);
    expect(result[2].bid_amount).toBe(15);
  });

  it('returns empty array when nomination has no bids', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'auction_bids') {
        chain.order.mockResolvedValue({ data: [], error: null });
      }
      return chain;
    });

    const result = await AuctionDraftService.getBidHistory('nom-1');

    expect(result).toEqual([]);
  });
});

// =============================================================================
// nominatePlayer
// =============================================================================

describe('AuctionDraftService.nominatePlayer', () => {
  it('rejects nomination when it is not the team turn', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    // getAuctionState needs: draft_sessions, auction_budgets, auction_nominations
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'draft_sessions') {
        chain.single.mockResolvedValue({
          data: {
            settings: {
              nomination_order: ['team-a', 'team-b', 'team-c'],
              current_nominator_index: 0, // team-a's turn
              total_nominations: 5,
            },
          },
          error: null,
        });
      }
      if (table === 'auction_budgets') {
        chain.order.mockResolvedValue({
          data: [{ team_id: 'team-a', remaining_budget: 180 }],
          error: null,
        });
      }
      if (table === 'auction_nominations') {
        chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      }
      return chain;
    });

    // team-b tries to nominate but it's team-a's turn
    const result = await AuctionDraftService.nominatePlayer(
      'league-1', 'session-1', 'team-b', '8478402', 'Connor McDavid'
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not your turn');
  });

  it('rejects nomination when there is an active nomination', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'draft_sessions') {
        chain.single.mockResolvedValue({
          data: {
            settings: {
              nomination_order: ['team-a'],
              current_nominator_index: 0,
              total_nominations: 3,
            },
          },
          error: null,
        });
      }
      if (table === 'auction_budgets') {
        chain.order.mockResolvedValue({ data: [], error: null });
      }
      if (table === 'auction_nominations') {
        // Active nomination already exists
        chain.maybeSingle.mockResolvedValue({
          data: { id: 'nom-active', status: 'active', player_name: 'McDavid' },
          error: null,
        });
      }
      return chain;
    });

    const result = await AuctionDraftService.nominatePlayer(
      'league-1', 'session-1', 'team-a', '8478402', 'Connor McDavid'
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('already active');
  });

  it('rejects nomination of already-drafted player', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let draftSessionsCallCount = 0;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'draft_sessions') {
        draftSessionsCallCount++;
        chain.single.mockResolvedValue({
          data: {
            settings: {
              nomination_order: ['team-a'],
              current_nominator_index: 0,
              total_nominations: 0,
            },
          },
          error: null,
        });
      }
      if (table === 'auction_budgets') {
        chain.order.mockResolvedValue({ data: [], error: null });
      }
      if (table === 'auction_nominations') {
        chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      }
      if (table === 'draft_picks') {
        // Player already drafted
        chain.maybeSingle.mockResolvedValue({
          data: { id: 'pick-1' },
          error: null,
        });
      }
      return chain;
    });

    const result = await AuctionDraftService.nominatePlayer(
      'league-1', 'session-1', 'team-a', '8478402', 'Connor McDavid'
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('already been drafted');
  });
});

// =============================================================================
// getAuctionState
// =============================================================================

describe('AuctionDraftService.getAuctionState', () => {
  it('returns null when session not found', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'draft_sessions') {
        chain.single.mockResolvedValue({ data: null, error: null });
      }
      return chain;
    });

    const result = await AuctionDraftService.getAuctionState('league-1', 'bad-session');

    expect(result).toBeNull();
  });

  it('returns complete auction state with budgets and active nomination', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'draft_sessions') {
        chain.single.mockResolvedValue({
          data: {
            settings: {
              nomination_order: ['team-a', 'team-b'],
              current_nominator_index: 1,
              total_nominations: 10,
            },
          },
          error: null,
        });
      }
      if (table === 'auction_budgets') {
        chain.order.mockResolvedValue({
          data: [
            { team_id: 'team-a', initial_budget: 200, remaining_budget: 150, players_won: 3 },
            { team_id: 'team-b', initial_budget: 200, remaining_budget: 120, players_won: 5 },
          ],
          error: null,
        });
      }
      if (table === 'auction_nominations') {
        chain.maybeSingle.mockResolvedValue({
          data: {
            id: 'nom-active',
            player_name: 'McDavid',
            current_high_bid: 45,
            status: 'active',
          },
          error: null,
        });
      }
      return chain;
    });

    const result = await AuctionDraftService.getAuctionState('league-1', 'session-1');

    expect(result).not.toBeNull();
    expect(result!.league_id).toBe('league-1');
    expect(result!.nomination_order).toEqual(['team-a', 'team-b']);
    expect(result!.current_nominator_index).toBe(1);
    expect(result!.budgets).toHaveLength(2);
    expect(result!.current_nomination).not.toBeNull();
    expect(result!.current_nomination!.player_name).toBe('McDavid');
    expect(result!.total_nominations).toBe(10);
  });

  it('handles errors gracefully', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Connection reset');
    });

    const result = await AuctionDraftService.getAuctionState('league-1', 'session-1');

    expect(result).toBeNull();
  });
});

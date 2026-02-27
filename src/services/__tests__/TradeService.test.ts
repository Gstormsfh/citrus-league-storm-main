import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TradeOffer, TradeOfferWithPlayers } from '../TradeService';

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

vi.mock('../PlayerService', () => ({
  PlayerService: {
    getPlayersByIds: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../LeagueMembershipService', () => ({
  LeagueMembershipService: {
    requireMembership: vi.fn().mockResolvedValue(undefined),
    requireCommissioner: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/utils/queryColumns', () => ({
  COLUMNS: {
    TRADE: 'id, league_id, from_team_id, to_team_id, offered_player_ids, requested_player_ids, status, message, created_at, expires_at, processed_at, counter_offer_id',
  },
}));

// =============================================================================
// Import TradeService AFTER mocks
// =============================================================================

let TradeService: typeof import('../TradeService').TradeService;

beforeEach(async () => {
  vi.clearAllMocks();
  mockChain = createChainableMock();
  const mod = await import('../TradeService');
  TradeService = mod.TradeService;

  const { supabase } = await import('@/integrations/supabase/client');
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);
});

// =============================================================================
// Interface Type Checks (compile-time validation)
// =============================================================================

describe('TradeService Interfaces', () => {
  it('TradeOffer has all required fields', () => {
    const offer: TradeOffer = {
      id: 'trade-1',
      league_id: 'league-1',
      from_team_id: 'team-a',
      to_team_id: 'team-b',
      offered_player_ids: [101, 102],
      requested_player_ids: [201],
      status: 'pending',
      message: 'Fair trade?',
      created_at: '2025-01-01T00:00:00Z',
      expires_at: '2025-01-08T00:00:00Z',
      processed_at: null,
      counter_offer_id: null,
    };
    expect(offer.status).toBe('pending');
    expect(offer.offered_player_ids).toHaveLength(2);
    expect(offer.requested_player_ids).toHaveLength(1);
  });

  it('TradeOffer supports all valid status values', () => {
    const statuses: TradeOffer['status'][] = [
      'pending', 'accepted', 'rejected', 'countered', 'cancelled', 'expired', 'under_review', 'vetoed',
    ];
    statuses.forEach(status => {
      const offer: TradeOffer = {
        id: 'x', league_id: 'x', from_team_id: 'x', to_team_id: 'x',
        offered_player_ids: [], requested_player_ids: [],
        status, message: null, created_at: '', expires_at: null,
        processed_at: null, counter_offer_id: null,
      };
      expect(offer.status).toBe(status);
    });
  });

  it('TradeOfferWithPlayers extends TradeOffer with team names and player summaries', () => {
    const extendedOffer: TradeOfferWithPlayers = {
      id: 'trade-2',
      league_id: 'league-1',
      from_team_id: 'team-a',
      to_team_id: 'team-b',
      offered_player_ids: [101],
      requested_player_ids: [201],
      status: 'pending',
      message: null,
      created_at: '',
      expires_at: null,
      processed_at: null,
      counter_offer_id: null,
      from_team_name: 'Hurricanes',
      to_team_name: 'Lightning',
      offered_players: [
        { player_id: 101, full_name: 'Connor McDavid', position_code: 'C', team_abbrev: 'EDM' },
      ],
      requested_players: [
        { player_id: 201, full_name: 'Nikita Kucherov', position_code: 'RW', team_abbrev: 'TBL' },
      ],
    };
    expect(extendedOffer.from_team_name).toBe('Hurricanes');
    expect(extendedOffer.offered_players[0].full_name).toBe('Connor McDavid');
  });
});

// =============================================================================
// createTradeOffer — Validation
// =============================================================================

describe('TradeService.createTradeOffer', () => {
  it('rejects trades in Best Ball leagues', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { settings: { bestBallEnabled: true } },
          error: null,
        });
      }
      return chain;
    });

    const result = await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101], [201]
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Best Ball');
  });

  it('rejects trades after the trade deadline', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: {
            settings: {
              bestBallEnabled: false,
              tradeDeadlineWeek: 12,
            },
          },
          error: null,
        });
      }
      if (table === 'matchups') {
        // Current week is 14, past the deadline of 12
        chain.maybeSingle.mockResolvedValue({
          data: { week_number: 14 },
          error: null,
        });
      }
      return chain;
    });

    const result = await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101], [201]
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('trade deadline has passed');
    expect(result.error).toContain('Week 12');
  });

  it('allows trades before the trade deadline', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: {
            settings: {
              bestBallEnabled: false,
              tradeDeadlineWeek: 12,
              tradeExpirationDays: 3,
            },
          },
          error: null,
        });
      }
      if (table === 'matchups') {
        // Current week is 8, before the deadline
        chain.maybeSingle.mockResolvedValue({
          data: { week_number: 8 },
          error: null,
        });
      }
      if (table === 'trade_offers') {
        chain.single.mockResolvedValue({
          data: { id: 'new-trade-id' },
          error: null,
        });
      }
      return chain;
    });

    const result = await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101], [201], 'Please accept'
    );

    expect(result.success).toBe(true);
    expect(result.tradeId).toBe('new-trade-id');
  });

  it('allows trades when no trade deadline is set (week 0)', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: {
            settings: {
              bestBallEnabled: false,
              tradeDeadlineWeek: 0,
            },
          },
          error: null,
        });
      }
      if (table === 'trade_offers') {
        chain.single.mockResolvedValue({
          data: { id: 'trade-no-deadline' },
          error: null,
        });
      }
      return chain;
    });

    const result = await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101], [201]
    );

    expect(result.success).toBe(true);
    expect(result.tradeId).toBe('trade-no-deadline');
  });

  it('returns error when league is not found', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: null,
          error: { message: 'League not found' },
        });
      }
      return chain;
    });

    const result = await TradeService.createTradeOffer(
      'nonexistent', 'team-a', 'team-b', [101], [201]
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('League not found');
  });

  it('returns error on insert failure', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { settings: { bestBallEnabled: false, tradeDeadlineWeek: 0 } },
          error: null,
        });
      }
      if (table === 'trade_offers') {
        chain.single.mockResolvedValue({
          data: null,
          error: { message: 'Unique constraint violation' },
        });
      }
      return chain;
    });

    const result = await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101], [201]
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unique constraint violation');
  });

  it('sets null message when no message provided', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let insertedData: any = null;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { settings: { bestBallEnabled: false, tradeDeadlineWeek: 0 } },
          error: null,
        });
      }
      if (table === 'trade_offers') {
        chain.insert.mockImplementation((data: any) => {
          insertedData = data;
          return chain;
        });
        chain.single.mockResolvedValue({ data: { id: 'trade-1' }, error: null });
      }
      return chain;
    });

    await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101], [201]
      // no message
    );

    expect(insertedData.message).toBeNull();
  });

  it('catches unexpected errors gracefully', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Unexpected network failure');
    });

    const result = await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101], [201]
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unexpected network failure');
  });
});

// =============================================================================
// Trade Expiration Calculation
// =============================================================================

describe('Trade Expiration', () => {
  it('uses default 7-day expiration when league has no custom setting', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let insertedData: any = null;
    const now = new Date();

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { settings: { bestBallEnabled: false, tradeDeadlineWeek: 0 } },
          error: null,
        });
      }
      if (table === 'trade_offers') {
        chain.insert.mockImplementation((data: any) => {
          insertedData = data;
          return chain;
        });
        chain.single.mockResolvedValue({ data: { id: 'trade-exp' }, error: null });
      }
      return chain;
    });

    await TradeService.createTradeOffer('league-1', 'team-a', 'team-b', [101], [201]);

    expect(insertedData).not.toBeNull();
    const expiresAt = new Date(insertedData.expires_at);
    // Should be approximately 7 days from now
    const diffMs = expiresAt.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(6.9);
    expect(diffDays).toBeLessThanOrEqual(7.1);
  });

  it('uses commissioner-configured expiration days', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let insertedData: any = null;
    const now = new Date();

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: {
            settings: {
              bestBallEnabled: false,
              tradeDeadlineWeek: 0,
              tradeExpirationDays: 3,
            },
          },
          error: null,
        });
      }
      if (table === 'trade_offers') {
        chain.insert.mockImplementation((data: any) => {
          insertedData = data;
          return chain;
        });
        chain.single.mockResolvedValue({ data: { id: 'trade-exp' }, error: null });
      }
      return chain;
    });

    await TradeService.createTradeOffer('league-1', 'team-a', 'team-b', [101], [201]);

    const expiresAt = new Date(insertedData.expires_at);
    const diffMs = expiresAt.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(2.9);
    expect(diffDays).toBeLessThanOrEqual(3.1);
  });

  it('sets status to pending on creation', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let insertedData: any = null;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { settings: { bestBallEnabled: false, tradeDeadlineWeek: 0 } },
          error: null,
        });
      }
      if (table === 'trade_offers') {
        chain.insert.mockImplementation((data: any) => {
          insertedData = data;
          return chain;
        });
        chain.single.mockResolvedValue({ data: { id: 'trade-new' }, error: null });
      }
      return chain;
    });

    await TradeService.createTradeOffer('league-1', 'team-a', 'team-b', [101], [201]);

    expect(insertedData.status).toBe('pending');
  });
});

// =============================================================================
// acceptTradeOffer — Status Transitions & Validation
// =============================================================================

describe('TradeService.acceptTradeOffer', () => {
  it('returns error when trade is not found or no longer pending', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'trade_offers') {
        chain.single.mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'No rows found' },
        });
      }
      return chain;
    });

    const result = await TradeService.acceptTradeOffer('trade-expired');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found or no longer pending');
  });

  it('rejects accept from user who does not own the to_team', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'trade_offers') {
        chain.single.mockResolvedValue({
          data: {
            id: 'trade-1',
            league_id: 'league-1',
            from_team_id: 'team-a',
            to_team_id: 'team-b',
            offered_player_ids: [101],
            requested_player_ids: [201],
            status: 'pending',
          },
          error: null,
        });
      }
      if (table === 'teams') {
        chain.single.mockResolvedValue({
          data: { owner_id: 'user-OTHER' }, // Different user
          error: null,
        });
      }
      return chain;
    });

    const result = await TradeService.acceptTradeOffer('trade-1', 'user-IMPOSTER');

    expect(result.success).toBe(false);
    expect(result.error).toContain('only accept trades sent to your team');
  });

  it('routes to review process when league has commissioner review', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let tradeOffersCallCount = 0;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'trade_offers') {
        tradeOffersCallCount++;
        if (tradeOffersCallCount === 1) {
          // First call: select(COLUMNS.TRADE).eq('id', tradeId).eq('status', 'pending').single()
          let eqCallCount = 0;
          chain.eq.mockImplementation(() => {
            eqCallCount++;
            if (eqCallCount >= 2) {
              // After second .eq(), return chain so .single() can be called
              return chain;
            }
            return chain;
          });
          chain.single.mockResolvedValue({
            data: {
              id: 'trade-1',
              league_id: 'league-1',
              from_team_id: 'team-a',
              to_team_id: 'team-b',
              offered_player_ids: [101],
              requested_player_ids: [201],
              status: 'pending',
            },
            error: null,
          });
        } else {
          // Subsequent calls: submitTradeForReview update
          chain.update.mockReturnValue(chain);
          chain.eq.mockResolvedValue({ data: null, error: null });
        }
      }
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: {
            trade_review_type: 'commissioner',
            trade_review_period_hours: 24,
            roster_size: null,
          },
          error: null,
        });
      }
      if (table === 'roster_assignments') {
        chain.eq.mockResolvedValue({ count: 10, data: null, error: null });
      }
      return chain;
    });

    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: null });

    const result = await TradeService.acceptTradeOffer('trade-1');

    expect(result.success).toBe(true);
    expect(result.error).toContain('commissioner approval');
  });

  it('catches unexpected errors gracefully', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Connection reset');
    });

    const result = await TradeService.acceptTradeOffer('trade-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection reset');
  });
});

// =============================================================================
// rejectTradeOffer
// =============================================================================

describe('TradeService.rejectTradeOffer', () => {
  it('updates status to rejected', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let updatedData: any = null;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'trade_offers') {
        chain.update.mockImplementation((data: any) => {
          updatedData = data;
          return chain;
        });
        // .eq('id', tradeId).eq('status', 'pending') — two chained eq calls
        let eqCallCount = 0;
        chain.eq.mockImplementation(() => {
          eqCallCount++;
          if (eqCallCount >= 2) return Promise.resolve({ data: null, error: null });
          return chain;
        });
      }
      return chain;
    });

    const result = await TradeService.rejectTradeOffer('trade-1');

    expect(result.success).toBe(true);
    expect(updatedData.status).toBe('rejected');
    expect(updatedData.processed_at).toBeDefined();
  });

  it('validates ownership when userId is provided', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'trade_offers') {
        // select().eq('id', tradeId).eq('status', 'pending').single()
        chain.single.mockResolvedValue({
          data: { to_team_id: 'team-b', league_id: 'league-1' },
          error: null,
        });
      }
      if (table === 'teams') {
        chain.single.mockResolvedValue({
          data: { owner_id: 'user-WRONG' },
          error: null,
        });
      }
      return chain;
    });

    const result = await TradeService.rejectTradeOffer('trade-1', 'user-NOT-OWNER');

    expect(result.success).toBe(false);
    expect(result.error).toContain('only reject trades sent to your team');
  });

  it('returns error on DB failure', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'trade_offers') {
        chain.update.mockReturnValue(chain);
        // .eq('id', tradeId).eq('status', 'pending') — two chained eq calls
        let eqCallCount = 0;
        chain.eq.mockImplementation(() => {
          eqCallCount++;
          if (eqCallCount >= 2) return Promise.resolve({ data: null, error: { message: 'DB write error' } });
          return chain;
        });
      }
      return chain;
    });

    const result = await TradeService.rejectTradeOffer('trade-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('DB write error');
  });

  it('catches thrown exceptions gracefully', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Network timeout');
    });

    const result = await TradeService.rejectTradeOffer('trade-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network timeout');
  });
});

// =============================================================================
// cancelTradeOffer
// =============================================================================

describe('TradeService.cancelTradeOffer', () => {
  it('updates status to cancelled', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let updatedData: any = null;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'trade_offers') {
        chain.update.mockImplementation((data: any) => {
          updatedData = data;
          return chain;
        });
        // .eq('id', tradeId).eq('status', 'pending') — two chained eq calls
        let eqCallCount = 0;
        chain.eq.mockImplementation(() => {
          eqCallCount++;
          if (eqCallCount >= 2) return Promise.resolve({ data: null, error: null });
          return chain;
        });
      }
      return chain;
    });

    const result = await TradeService.cancelTradeOffer('trade-1');

    expect(result.success).toBe(true);
    expect(updatedData.status).toBe('cancelled');
    expect(updatedData.processed_at).toBeDefined();
  });

  it('validates that only the proposer (from_team owner) can cancel', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let fromCallCount = 0;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === 'trade_offers') {
        fromCallCount++;
        const chain = createChainableMock();
        if (fromCallCount === 1) {
          // First call: select().eq('id', tradeId).eq('status', 'pending').single()
          chain.single.mockResolvedValue({
            data: { from_team_id: 'team-a', league_id: 'league-1' },
            error: null,
          });
        }
        return chain;
      }
      if (table === 'teams') {
        const chain = createChainableMock();
        chain.single.mockResolvedValue({
          data: { owner_id: 'user-REAL-OWNER' },
          error: null,
        });
        return chain;
      }
      return createChainableMock();
    });

    const result = await TradeService.cancelTradeOffer('trade-1', 'user-IMPOSTER');

    expect(result.success).toBe(false);
    expect(result.error).toContain('only cancel trades you proposed');
  });

  it('allows the proposer to cancel', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let fromCallCount = 0;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === 'trade_offers') {
        fromCallCount++;
        const chain = createChainableMock();
        if (fromCallCount === 1) {
          // First call: select().eq('id', tradeId).eq('status', 'pending').single()
          chain.single.mockResolvedValue({
            data: { from_team_id: 'team-a', league_id: 'league-1' },
            error: null,
          });
        } else {
          // Second call: update({...}).eq('id', tradeId).eq('status', 'pending')
          chain.update.mockReturnValue(chain);
          let eqCallCount = 0;
          chain.eq.mockImplementation(() => {
            eqCallCount++;
            if (eqCallCount >= 2) return Promise.resolve({ data: null, error: null });
            return chain;
          });
        }
        return chain;
      }
      if (table === 'teams') {
        const chain = createChainableMock();
        chain.single.mockResolvedValue({
          data: { owner_id: 'user-PROPOSER' },
          error: null,
        });
        return chain;
      }
      return createChainableMock();
    });

    const result = await TradeService.cancelTradeOffer('trade-1', 'user-PROPOSER');

    expect(result.success).toBe(true);
  });
});

// =============================================================================
// getTeamTradeOffers
// =============================================================================

describe('TradeService.getTeamTradeOffers', () => {
  it('returns empty array when no trades exist', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'trade_offers') {
        chain.order.mockResolvedValue({ data: [], error: null });
      }
      return chain;
    });

    const result = await TradeService.getTeamTradeOffers('league-1', 'team-a');

    expect(result).toEqual([]);
  });

  it('validates membership when userId is provided', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    const { LeagueMembershipService } = await import('../LeagueMembershipService');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'trade_offers') {
        chain.order.mockResolvedValue({ data: [], error: null });
      }
      return chain;
    });

    await TradeService.getTeamTradeOffers('league-1', 'team-a', 'user-1');

    expect(LeagueMembershipService.requireMembership).toHaveBeenCalledWith('league-1', 'user-1');
  });

  it('returns empty array on DB error (graceful fallback)', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'trade_offers') {
        chain.order.mockResolvedValue({
          data: null,
          error: { message: 'Query timeout' },
        });
      }
      return chain;
    });

    const result = await TradeService.getTeamTradeOffers('league-1', 'team-a');

    expect(result).toEqual([]);
  });
});

// =============================================================================
// getLeagueTradeHistory
// =============================================================================

describe('TradeService.getLeagueTradeHistory', () => {
  it('returns empty array when no history exists', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'trade_history') {
        chain.limit.mockResolvedValue({ data: [], error: null });
      }
      return chain;
    });

    const result = await TradeService.getLeagueTradeHistory('league-1');

    expect(result).toEqual([]);
  });

  it('limits results to 20', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let limitArg: number | undefined;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'trade_history') {
        chain.limit.mockImplementation((n: number) => {
          limitArg = n;
          return Promise.resolve({ data: [], error: null });
        });
      }
      return chain;
    });

    await TradeService.getLeagueTradeHistory('league-1');

    expect(limitArg).toBe(20);
  });

  it('returns empty array on DB error', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'trade_history') {
        chain.limit.mockResolvedValue({
          data: null,
          error: { message: 'Not found' },
        });
      }
      return chain;
    });

    const result = await TradeService.getLeagueTradeHistory('league-1');

    expect(result).toEqual([]);
  });
});

// =============================================================================
// submitTradeForReview
// =============================================================================

describe('TradeService.submitTradeForReview', () => {
  it('returns immediately for "none" review type', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { trade_review_type: 'none', trade_review_period_hours: 48 },
          error: null,
        });
      }
      return chain;
    });

    const result = await TradeService.submitTradeForReview('trade-1', 'league-1');

    expect(result.success).toBe(true);
    expect(result.reviewType).toBe('none');
  });

  it('sets trade to under_review for commissioner review type', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let updatedData: any = null;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { trade_review_type: 'commissioner', trade_review_period_hours: 24 },
          error: null,
        });
      }
      if (table === 'trade_offers') {
        chain.update.mockImplementation((data: any) => {
          updatedData = data;
          return chain;
        });
        chain.eq.mockResolvedValue({ data: null, error: null });
      }
      return chain;
    });

    // Mock the notification RPC
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: null });

    const result = await TradeService.submitTradeForReview('trade-1', 'league-1');

    expect(result.success).toBe(true);
    expect(result.reviewType).toBe('commissioner');
    expect(updatedData.status).toBe('under_review');
    expect(updatedData.review_started_at).toBeDefined();
    expect(updatedData.review_ends_at).toBeDefined();
  });

  it('uses dynamic review period from league settings', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let updatedData: any = null;
    const now = new Date();

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { trade_review_type: 'league_vote', trade_review_period_hours: 72 },
          error: null,
        });
      }
      if (table === 'trade_offers') {
        chain.update.mockImplementation((data: any) => {
          updatedData = data;
          return chain;
        });
        chain.eq.mockResolvedValue({ data: null, error: null });
      }
      return chain;
    });

    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: null });

    await TradeService.submitTradeForReview('trade-1', 'league-1');

    const reviewEnds = new Date(updatedData.review_ends_at);
    const diffHours = (reviewEnds.getTime() - now.getTime()) / (1000 * 60 * 60);
    // Should be approximately 72 hours
    expect(diffHours).toBeGreaterThanOrEqual(71);
    expect(diffHours).toBeLessThanOrEqual(73);
  });

  it('returns error on update failure', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { trade_review_type: 'commissioner', trade_review_period_hours: 48 },
          error: null,
        });
      }
      if (table === 'trade_offers') {
        chain.update.mockReturnValue(chain);
        chain.eq.mockResolvedValue({ data: null, error: { message: 'Row not found' } });
      }
      return chain;
    });

    const result = await TradeService.submitTradeForReview('trade-1', 'league-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Row not found');
  });
});

// =============================================================================
// submitTradeVote
// =============================================================================

describe('TradeService.submitTradeVote', () => {
  it('calls submit_trade_vote RPC and returns vote counts', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{
        success: true,
        veto_count: 3,
        approve_count: 5,
        votes_needed: 4,
        is_vetoed: false,
        message: 'Vote recorded',
      }],
      error: null,
    });

    const result = await TradeService.submitTradeVote('trade-1', 'voter-team', 'approve');

    expect(result.success).toBe(true);
    expect(result.vetoCount).toBe(3);
    expect(result.approveCount).toBe(5);
    expect(result.votesNeeded).toBe(4);
    expect(result.isVetoed).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('returns vetoed state when veto threshold reached', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{
        success: true,
        veto_count: 5,
        approve_count: 2,
        votes_needed: 4,
        is_vetoed: true,
        message: 'Trade vetoed',
      }],
      error: null,
    });

    const result = await TradeService.submitTradeVote('trade-1', 'voter-team', 'veto');

    expect(result.isVetoed).toBe(true);
    expect(result.vetoCount).toBe(5);
  });

  it('handles RPC error gracefully', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    const rpcError = new Error('Cannot vote on own trade');
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: rpcError,
    });

    const result = await TradeService.submitTradeVote('trade-1', 'voter-team', 'approve');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot vote on own trade');
    expect(result.vetoCount).toBe(0);
    expect(result.approveCount).toBe(0);
  });

  it('defaults to safe values when RPC returns unexpected structure', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: null,
    });

    const result = await TradeService.submitTradeVote('trade-1', 'voter-team', 'veto');

    // data is null, so result?.[0] is undefined
    expect(result.success).toBe(false);
    expect(result.vetoCount).toBe(0);
    expect(result.approveCount).toBe(0);
    expect(result.votesNeeded).toBe(0);
    expect(result.isVetoed).toBe(false);
  });
});

// =============================================================================
// getTradeVotes
// =============================================================================

describe('TradeService.getTradeVotes', () => {
  it('returns mapped votes from DB', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'trade_votes') {
        chain.order.mockResolvedValue({
          data: [
            { voter_team_id: 'team-1', vote: 'approve', created_at: '2025-01-01' },
            { voter_team_id: 'team-2', vote: 'veto', created_at: '2025-01-02' },
          ],
          error: null,
        });
      }
      return chain;
    });

    const result = await TradeService.getTradeVotes('trade-1');

    expect(result.votes).toHaveLength(2);
    expect(result.votes[0].voterTeamId).toBe('team-1');
    expect(result.votes[0].vote).toBe('approve');
    expect(result.votes[1].voterTeamId).toBe('team-2');
    expect(result.votes[1].vote).toBe('veto');
    expect(result.error).toBeUndefined();
  });

  it('returns empty array on error', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    const dbError = new Error('RLS violation');
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'trade_votes') {
        chain.order.mockResolvedValue({
          data: null,
          error: dbError,
        });
      }
      return chain;
    });

    const result = await TradeService.getTradeVotes('trade-1');

    expect(result.votes).toEqual([]);
    expect(result.error).toContain('RLS violation');
  });
});

// =============================================================================
// commissionerDecision
// =============================================================================

describe('TradeService.commissionerDecision', () => {
  it('rejects when league is not configured for commissioner review', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { trade_review_type: 'league_vote' },
          error: null,
        });
      }
      return chain;
    });

    const result = await TradeService.commissionerDecision('trade-1', 'league-1', 'approve', 'commissioner-id');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not configured for commissioner review');
  });

  it('returns error when league is not found', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({ data: null, error: null });
      }
      return chain;
    });

    const result = await TradeService.commissionerDecision('trade-1', 'league-1', 'veto', 'commissioner-id');

    expect(result.success).toBe(false);
    expect(result.error).toContain('League not found');
  });

  it('vetoes trade and sends notification', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let updatedData: any = null;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { trade_review_type: 'commissioner' },
          error: null,
        });
      }
      if (table === 'trade_offers') {
        chain.update.mockImplementation((data: any) => {
          updatedData = data;
          return chain;
        });
        // .eq('id', tradeId).eq('status', 'under_review') — two chained eq calls
        let eqCallCount = 0;
        chain.eq.mockImplementation(() => {
          eqCallCount++;
          if (eqCallCount >= 2) return Promise.resolve({ data: null, error: null });
          return chain;
        });
      }
      return chain;
    });

    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: null });

    const result = await TradeService.commissionerDecision('trade-1', 'league-1', 'veto', 'commissioner-id');

    expect(result.success).toBe(true);
    expect(updatedData.status).toBe('vetoed');
    expect(updatedData.vetoed_at).toBeDefined();
    expect(updatedData.processed_at).toBeDefined();
  });

  it('validates commissioner identity via LeagueMembershipService', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    const { LeagueMembershipService } = await import('../LeagueMembershipService');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { trade_review_type: 'commissioner' },
          error: null,
        });
      }
      if (table === 'trade_offers') {
        chain.update.mockReturnValue(chain);
        chain.eq.mockResolvedValue({ data: null, error: null });
      }
      return chain;
    });

    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: null });

    await TradeService.commissionerDecision('trade-1', 'league-1', 'veto', 'comm-user');

    expect(LeagueMembershipService.requireCommissioner).toHaveBeenCalledWith('league-1', 'comm-user');
  });
});

// =============================================================================
// getTradeReviewSettings
// =============================================================================

describe('TradeService.getTradeReviewSettings', () => {
  it('returns settings from league table', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: {
            trade_review_type: 'league_vote',
            trade_review_period_hours: 72,
            trade_veto_threshold: 0.67,
          },
          error: null,
        });
      }
      return chain;
    });

    const result = await TradeService.getTradeReviewSettings('league-1');

    expect(result.reviewType).toBe('league_vote');
    expect(result.reviewPeriodHours).toBe(72);
    expect(result.vetoThreshold).toBe(0.67);
    expect(result.error).toBeUndefined();
  });

  it('returns defaults when league has no settings', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: {
            trade_review_type: null,
            trade_review_period_hours: null,
            trade_veto_threshold: null,
          },
          error: null,
        });
      }
      return chain;
    });

    const result = await TradeService.getTradeReviewSettings('league-1');

    expect(result.reviewType).toBe('none');
    expect(result.reviewPeriodHours).toBe(48);
    expect(result.vetoThreshold).toBe(0.5);
  });

  it('returns defaults on error', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: null,
          error: { message: 'Not found' },
        });
      }
      return chain;
    });

    const result = await TradeService.getTradeReviewSettings('league-1');

    expect(result.reviewType).toBe('none');
    expect(result.reviewPeriodHours).toBe(48);
    expect(result.vetoThreshold).toBe(0.5);
    expect(result.error).toBeDefined();
  });
});

// =============================================================================
// updateTradeReviewSettings
// =============================================================================

describe('TradeService.updateTradeReviewSettings', () => {
  it('updates league settings and sends notification', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let updatedData: any = null;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.update.mockImplementation((data: any) => {
          updatedData = data;
          return chain;
        });
        chain.eq.mockResolvedValue({ data: null, error: null });
      }
      return chain;
    });

    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: null });

    const result = await TradeService.updateTradeReviewSettings('league-1', 'comm-id', {
      trade_review_type: 'league_vote',
      trade_review_period_hours: 72,
      trade_veto_threshold: 0.6,
    });

    expect(result.success).toBe(true);
    expect(updatedData.trade_review_type).toBe('league_vote');
    expect(updatedData.trade_review_period_hours).toBe(72);
    expect(updatedData.trade_veto_threshold).toBe(0.6);
  });

  it('validates commissioner identity', async () => {
    const { supabase } = await import('@/integrations/supabase/client');
    const { LeagueMembershipService } = await import('../LeagueMembershipService');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      chain.update.mockReturnValue(chain);
      chain.eq.mockResolvedValue({ data: null, error: null });
      return chain;
    });

    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: null });

    await TradeService.updateTradeReviewSettings('league-1', 'comm-user', {
      trade_review_type: 'none',
      trade_review_period_hours: 48,
      trade_veto_threshold: 0.5,
    });

    expect(LeagueMembershipService.requireCommissioner).toHaveBeenCalledWith('league-1', 'comm-user');
  });

  it('returns error on update failure', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    const updateError = new Error('Permission denied');
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      chain.update.mockReturnValue(chain);
      chain.eq.mockResolvedValue({ data: null, error: updateError });
      return chain;
    });

    const result = await TradeService.updateTradeReviewSettings('league-1', 'comm-id', {
      trade_review_type: 'commissioner',
      trade_review_period_hours: 48,
      trade_veto_threshold: 0.5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('TradeService Edge Cases', () => {
  it('handles empty player arrays in trade offer creation', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let insertedData: any = null;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { settings: { bestBallEnabled: false, tradeDeadlineWeek: 0 } },
          error: null,
        });
      }
      if (table === 'trade_offers') {
        chain.insert.mockImplementation((data: any) => {
          insertedData = data;
          return chain;
        });
        chain.single.mockResolvedValue({ data: { id: 'trade-empty' }, error: null });
      }
      return chain;
    });

    const result = await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [], []
    );

    // The service does not validate empty arrays at the application level
    // (that's typically handled by the DB or UI layer)
    expect(result.success).toBe(true);
    expect(insertedData.offered_player_ids).toEqual([]);
    expect(insertedData.requested_player_ids).toEqual([]);
  });

  it('trade deadline check handles when no matchups exist (week 0)', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: {
            settings: {
              bestBallEnabled: false,
              tradeDeadlineWeek: 12,
            },
          },
          error: null,
        });
      }
      if (table === 'matchups') {
        // No matchups yet
        chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      }
      if (table === 'trade_offers') {
        chain.single.mockResolvedValue({ data: { id: 'trade-pre-season' }, error: null });
      }
      return chain;
    });

    // When no matchups exist, currentWeek = 0, which is < 12 (deadline)
    const result = await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101], [201]
    );

    expect(result.success).toBe(true);
  });

  it('trade deadline check blocks when current week equals deadline week', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: {
            settings: {
              bestBallEnabled: false,
              tradeDeadlineWeek: 10,
            },
          },
          error: null,
        });
      }
      if (table === 'matchups') {
        // Current week IS the deadline week (10 >= 10)
        chain.maybeSingle.mockResolvedValue({
          data: { week_number: 10 },
          error: null,
        });
      }
      return chain;
    });

    const result = await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101], [201]
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('trade deadline has passed');
  });

  it('self-trade (same from and to team) is not rejected at service level', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let insertedData: any = null;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { settings: { bestBallEnabled: false, tradeDeadlineWeek: 0 } },
          error: null,
        });
      }
      if (table === 'trade_offers') {
        chain.insert.mockImplementation((data: any) => {
          insertedData = data;
          return chain;
        });
        chain.single.mockResolvedValue({ data: { id: 'self-trade' }, error: null });
      }
      return chain;
    });

    // Self-trade: from and to are the same team
    // The service doesn't block this — it's enforced by DB constraints or UI
    const result = await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-a', [101], [201]
    );

    expect(result.success).toBe(true);
    expect(insertedData.from_team_id).toBe('team-a');
    expect(insertedData.to_team_id).toBe('team-a');
  });

  it('handles league with null settings gracefully', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { settings: null },
          error: null,
        });
      }
      if (table === 'trade_offers') {
        chain.single.mockResolvedValue({ data: { id: 'trade-null-settings' }, error: null });
      }
      return chain;
    });

    // When settings is null:
    // - bestBallEnabled: (null)?.bestBallEnabled = undefined (falsy, so no block)
    // - tradeDeadlineWeek: (null)?.tradeDeadlineWeek ?? 0 = 0 (no deadline)
    // - tradeExpirationDays: (null)?.tradeExpirationDays ?? 7 = 7 (default)
    const result = await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101], [201]
    );

    expect(result.success).toBe(true);
  });

  it('preserves message in trade offer', async () => {
    const { supabase } = await import('@/integrations/supabase/client');

    let insertedData: any = null;

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const chain = createChainableMock();
      if (table === 'leagues') {
        chain.single.mockResolvedValue({
          data: { settings: { bestBallEnabled: false, tradeDeadlineWeek: 0 } },
          error: null,
        });
      }
      if (table === 'trade_offers') {
        chain.insert.mockImplementation((data: any) => {
          insertedData = data;
          return chain;
        });
        chain.single.mockResolvedValue({ data: { id: 'trade-msg' }, error: null });
      }
      return chain;
    });

    await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101, 102], [201, 202, 203],
      'This is a fair trade, McDavid for three depth players.'
    );

    expect(insertedData.message).toBe('This is a fair trade, McDavid for three depth players.');
    expect(insertedData.offered_player_ids).toEqual([101, 102]);
    expect(insertedData.requested_player_ids).toEqual([201, 202, 203]);
  });
});

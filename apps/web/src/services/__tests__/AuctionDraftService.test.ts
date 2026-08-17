import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock Setup
// =============================================================================

vi.mock('@/api/auction', () => ({
  auctionApi: {
    getAuctionState: vi.fn(),
    initializeAuction: vi.fn(),
    nominatePlayer: vi.fn(),
    placeBid: vi.fn(),
    closeNomination: vi.fn(),
    getAuctionBudgets: vi.fn(),
    getBidHistory: vi.fn(),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/utils/seasonConstants', async (importOriginal) => ({
  // Spread the real module: a hand-written object here omits whatever the
  // service starts calling next. getCurrentSeason() was added to several
  // services on 2026-08-11 and every partial mock broke with `undefined is
  // not a function`, surfacing as assertion noise rather than a clear error.
  ...(await importOriginal<typeof import('@/utils/seasonConstants')>()),
  CURRENT_SEASON: '20252026',
}));

// =============================================================================
// Import AFTER mocks
// =============================================================================

import { auctionApi } from '@/api/auction';

let AuctionDraftService: typeof import('../AuctionDraftService').AuctionDraftService;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import('../AuctionDraftService');
  AuctionDraftService = mod.AuctionDraftService;
});

// =============================================================================
// initializeAuction
// =============================================================================

describe('AuctionDraftService.initializeAuction', () => {
  it('creates budget entries for each team and updates session settings', async () => {
    (auctionApi.initializeAuction as any).mockResolvedValue({ data: null, error: undefined });

    const result = await AuctionDraftService.initializeAuction(
      'league-1', 'session-1', ['team-a', 'team-b', 'team-c'], 200, 1
    );

    expect(result.success).toBe(true);
    expect(auctionApi.initializeAuction).toHaveBeenCalledWith('league-1', {
      sessionId: 'session-1',
      teamIds: ['team-a', 'team-b', 'team-c'],
      budget: 200,
      minBid: 1,
    });
  });

  it('returns error when budget upsert fails', async () => {
    (auctionApi.initializeAuction as any).mockResolvedValue({
      data: null,
      error: 'Unique constraint violation',
    });

    const result = await AuctionDraftService.initializeAuction(
      'league-1', 'session-1', ['team-a'], 200
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unique constraint');
  });

  it('uses default budget of 200 when not specified', async () => {
    (auctionApi.initializeAuction as any).mockResolvedValue({ data: null, error: undefined });

    await AuctionDraftService.initializeAuction('league-1', 'session-1', ['team-a']);

    expect(auctionApi.initializeAuction).toHaveBeenCalledWith('league-1', {
      sessionId: 'session-1',
      teamIds: ['team-a'],
      budget: 200,
      minBid: 1,
    });
  });
});

// =============================================================================
// placeBid
// =============================================================================

describe('AuctionDraftService.placeBid', () => {
  it('rejects bid lower than current high bid', async () => {
    (auctionApi.placeBid as any).mockResolvedValue({
      data: null,
      error: 'Bid must be higher than current bid of $25',
    });

    const result = await AuctionDraftService.placeBid('league-1', 'nom-1', 'team-b', 20);

    expect(result.success).toBe(false);
    expect(result.error).toContain('higher than current bid');
    expect(result.error).toContain('$25');
  });

  it('rejects bid that exceeds maximum allowed (budget minus reserve)', async () => {
    (auctionApi.placeBid as any).mockResolvedValue({
      data: null,
      error: 'Maximum bid is $35',
    });

    const result = await AuctionDraftService.placeBid('league-1', 'nom-1', 'team-b', 40);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Maximum bid is $35');
  });

  it('accepts a valid bid and updates the nomination', async () => {
    (auctionApi.placeBid as any).mockResolvedValue({ data: { success: true }, error: undefined });

    const result = await AuctionDraftService.placeBid('league-1', 'nom-1', 'team-b', 15);

    expect(result.success).toBe(true);
    expect(auctionApi.placeBid).toHaveBeenCalledWith('league-1', {
      nominationId: 'nom-1',
      teamId: 'team-b',
      bidAmount: 15,
    });
  });

  it('returns error when nomination not found', async () => {
    (auctionApi.placeBid as any).mockResolvedValue({
      data: null,
      error: 'Nomination not found or already closed',
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
    (auctionApi.getAuctionBudgets as any).mockResolvedValue({
      data: [
        { id: 'b1', league_id: 'league-1', team_id: 'team-a', initial_budget: 200, remaining_budget: 150, players_won: 3 },
        { id: 'b2', league_id: 'league-1', team_id: 'team-b', initial_budget: 200, remaining_budget: 100, players_won: 8 },
      ],
      error: undefined,
    });

    const result = await AuctionDraftService.getAuctionBudgets('league-1');

    expect(result).toHaveLength(2);
    expect(result[0].remaining_budget).toBe(150);
    expect(result[1].remaining_budget).toBe(100);
  });

  it('returns empty array on error', async () => {
    (auctionApi.getAuctionBudgets as any).mockRejectedValue(new Error('Network timeout'));

    const result = await AuctionDraftService.getAuctionBudgets('league-1');

    expect(result).toEqual([]);
  });
});

// =============================================================================
// getBidHistory
// =============================================================================

describe('AuctionDraftService.getBidHistory', () => {
  it('returns bids sorted by bid amount descending', async () => {
    (auctionApi.getBidHistory as any).mockResolvedValue({
      data: [
        { id: 'bid-3', nomination_id: 'nom-1', team_id: 'team-c', bid_amount: 30 },
        { id: 'bid-2', nomination_id: 'nom-1', team_id: 'team-b', bid_amount: 25 },
        { id: 'bid-1', nomination_id: 'nom-1', team_id: 'team-a', bid_amount: 15 },
      ],
      error: undefined,
    });

    const result = await AuctionDraftService.getBidHistory('nom-1');

    expect(result).toHaveLength(3);
    expect(result[0].bid_amount).toBe(30);
    expect(result[2].bid_amount).toBe(15);
  });

  it('returns empty array when nomination has no bids', async () => {
    (auctionApi.getBidHistory as any).mockResolvedValue({ data: [], error: undefined });

    const result = await AuctionDraftService.getBidHistory('nom-1');

    expect(result).toEqual([]);
  });
});

// =============================================================================
// nominatePlayer
// =============================================================================

describe('AuctionDraftService.nominatePlayer', () => {
  it('rejects nomination when it is not the team turn', async () => {
    (auctionApi.nominatePlayer as any).mockResolvedValue({
      data: null,
      error: 'It is not your turn to nominate',
    });

    // team-b tries to nominate but it's team-a's turn
    const result = await AuctionDraftService.nominatePlayer(
      'league-1', 'session-1', 'team-b', '8478402', 'Connor McDavid'
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not your turn');
  });

  it('rejects nomination when there is an active nomination', async () => {
    (auctionApi.nominatePlayer as any).mockResolvedValue({
      data: null,
      error: 'A nomination is already active',
    });

    const result = await AuctionDraftService.nominatePlayer(
      'league-1', 'session-1', 'team-a', '8478402', 'Connor McDavid'
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('already active');
  });

  it('rejects nomination of already-drafted player', async () => {
    (auctionApi.nominatePlayer as any).mockResolvedValue({
      data: null,
      error: 'Player has already been drafted',
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
    (auctionApi.getAuctionState as any).mockResolvedValue({ data: null, error: undefined });

    const result = await AuctionDraftService.getAuctionState('league-1', 'bad-session');

    expect(result).toBeNull();
  });

  it('returns complete auction state with budgets and active nomination', async () => {
    (auctionApi.getAuctionState as any).mockResolvedValue({
      data: {
        league_id: 'league-1',
        session_id: 'session-1',
        nomination_order: ['team-a', 'team-b'],
        current_nominator_index: 1,
        total_nominations: 10,
        budgets: [
          { team_id: 'team-a', initial_budget: 200, remaining_budget: 150, players_won: 3 },
          { team_id: 'team-b', initial_budget: 200, remaining_budget: 120, players_won: 5 },
        ],
        current_nomination: {
          id: 'nom-active',
          player_name: 'McDavid',
          current_high_bid: 45,
          status: 'active',
        },
        is_complete: false,
      },
      error: undefined,
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
    (auctionApi.getAuctionState as any).mockRejectedValue(new Error('Connection reset'));

    const result = await AuctionDraftService.getAuctionState('league-1', 'session-1');

    expect(result).toBeNull();
  });
});

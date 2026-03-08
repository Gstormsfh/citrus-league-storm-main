import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TradeOffer, TradeOfferWithPlayers } from '../TradeService';

// =============================================================================
// Mock API modules
// =============================================================================

vi.mock('@/api/trades', () => ({
  tradeApi: {
    getLeagueTrades: vi.fn(),
    getReviewSettings: vi.fn(),
    createTradeOffer: vi.fn(),
    acceptTrade: vi.fn(),
    rejectTrade: vi.fn(),
    cancelTrade: vi.fn(),
    submitVote: vi.fn(),
    getVotes: vi.fn(),
    commissionerDecision: vi.fn(),
  },
}));

vi.mock('@/api/account', () => ({
  accountApi: {
    logSecurityEvent: vi.fn().mockResolvedValue({ data: null }),
  },
}));

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
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
// Import TradeService AFTER mocks
// =============================================================================

import { TradeService } from '../TradeService';
import { tradeApi } from '@/api/trades';
import { accountApi } from '@/api/account';
import { apiClient } from '@/api/client';

beforeEach(() => {
  vi.clearAllMocks();
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
// createTradeOffer
// =============================================================================

describe('TradeService.createTradeOffer', () => {
  it('creates a trade offer successfully', async () => {
    (tradeApi.createTradeOffer as any).mockResolvedValue({
      data: { id: 'new-trade-id' },
    });

    const result = await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101], [201], 'Please accept'
    );

    expect(result.success).toBe(true);
    expect(result.tradeId).toBe('new-trade-id');
    expect(tradeApi.createTradeOffer).toHaveBeenCalledWith('league-1', {
      fromTeamId: 'team-a',
      toTeamId: 'team-b',
      offeredPlayerIds: ['101'],
      requestedPlayerIds: ['201'],
      message: 'Please accept',
    });
  });

  it('returns error when API returns error', async () => {
    (tradeApi.createTradeOffer as any).mockResolvedValue({
      error: 'Best Ball leagues do not allow trades',
    });

    const result = await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101], [201]
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Best Ball');
  });

  it('returns error when API returns trade deadline error', async () => {
    (tradeApi.createTradeOffer as any).mockResolvedValue({
      error: 'The trade deadline has passed (Week 12)',
    });

    const result = await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101], [201]
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('trade deadline has passed');
  });

  it('returns error when API returns league not found', async () => {
    (tradeApi.createTradeOffer as any).mockResolvedValue({
      error: 'League not found',
    });

    const result = await TradeService.createTradeOffer(
      'nonexistent', 'team-a', 'team-b', [101], [201]
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('League not found');
  });

  it('catches unexpected errors gracefully', async () => {
    (tradeApi.createTradeOffer as any).mockRejectedValue(new Error('Unexpected network failure'));

    const result = await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101], [201]
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unexpected network failure');
  });

  it('logs security event on successful creation', async () => {
    (tradeApi.createTradeOffer as any).mockResolvedValue({
      data: { id: 'trade-1' },
    });

    await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101], [201]
    );

    expect(accountApi.logSecurityEvent).toHaveBeenCalledWith(
      'TRADE_OFFER', 'league-1',
      expect.objectContaining({ fromTeamId: 'team-a', toTeamId: 'team-b' })
    );
  });

  it('handles empty player arrays', async () => {
    (tradeApi.createTradeOffer as any).mockResolvedValue({
      data: { id: 'trade-empty' },
    });

    const result = await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [], []
    );

    expect(result.success).toBe(true);
    expect(tradeApi.createTradeOffer).toHaveBeenCalledWith('league-1', expect.objectContaining({
      offeredPlayerIds: [],
      requestedPlayerIds: [],
    }));
  });

  it('converts player IDs to strings', async () => {
    (tradeApi.createTradeOffer as any).mockResolvedValue({
      data: { id: 'trade-msg' },
    });

    await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101, 102], [201, 202, 203],
      'This is a fair trade, McDavid for three depth players.'
    );

    expect(tradeApi.createTradeOffer).toHaveBeenCalledWith('league-1', expect.objectContaining({
      offeredPlayerIds: ['101', '102'],
      requestedPlayerIds: ['201', '202', '203'],
      message: 'This is a fair trade, McDavid for three depth players.',
    }));
  });

  it('sets undefined message when no message provided', async () => {
    (tradeApi.createTradeOffer as any).mockResolvedValue({
      data: { id: 'trade-1' },
    });

    await TradeService.createTradeOffer(
      'league-1', 'team-a', 'team-b', [101], [201]
    );

    expect(tradeApi.createTradeOffer).toHaveBeenCalledWith('league-1', expect.objectContaining({
      message: undefined,
    }));
  });
});

// =============================================================================
// acceptTradeOffer
// =============================================================================

describe('TradeService.acceptTradeOffer', () => {
  it('accepts a trade successfully', async () => {
    (tradeApi.acceptTrade as any).mockResolvedValue({ data: {} });

    const result = await TradeService.acceptTradeOffer('trade-1');

    expect(result.success).toBe(true);
    expect(tradeApi.acceptTrade).toHaveBeenCalledWith('trade-1');
  });

  it('returns error when API returns error', async () => {
    (tradeApi.acceptTrade as any).mockResolvedValue({
      error: 'Trade not found or no longer pending',
    });

    const result = await TradeService.acceptTradeOffer('trade-expired');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found or no longer pending');
  });

  it('returns review message when trade is routed to commissioner approval', async () => {
    (tradeApi.acceptTrade as any).mockResolvedValue({
      data: { message: 'Trade submitted for commissioner approval' },
    });

    const result = await TradeService.acceptTradeOffer('trade-1');

    expect(result.success).toBe(true);
    expect(result.error).toContain('commissioner approval');
  });

  it('logs security event on successful accept', async () => {
    (tradeApi.acceptTrade as any).mockResolvedValue({ data: {} });

    await TradeService.acceptTradeOffer('trade-1');

    expect(accountApi.logSecurityEvent).toHaveBeenCalledWith(
      'TRADE_ACCEPT', null, { tradeId: 'trade-1' }
    );
  });

  it('catches unexpected errors gracefully', async () => {
    (tradeApi.acceptTrade as any).mockRejectedValue(new Error('Connection reset'));

    const result = await TradeService.acceptTradeOffer('trade-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection reset');
  });
});

// =============================================================================
// rejectTradeOffer
// =============================================================================

describe('TradeService.rejectTradeOffer', () => {
  it('rejects a trade successfully', async () => {
    (tradeApi.rejectTrade as any).mockResolvedValue({ data: {} });

    const result = await TradeService.rejectTradeOffer('trade-1');

    expect(result.success).toBe(true);
    expect(tradeApi.rejectTrade).toHaveBeenCalledWith('trade-1');
  });

  it('returns error when API returns error', async () => {
    (tradeApi.rejectTrade as any).mockResolvedValue({
      error: 'You can only reject trades sent to your team',
    });

    const result = await TradeService.rejectTradeOffer('trade-1', 'user-NOT-OWNER');

    expect(result.success).toBe(false);
    expect(result.error).toContain('only reject trades sent to your team');
  });

  it('returns error on API failure', async () => {
    (tradeApi.rejectTrade as any).mockResolvedValue({
      error: 'DB write error',
    });

    const result = await TradeService.rejectTradeOffer('trade-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('DB write error');
  });

  it('logs security event on successful reject', async () => {
    (tradeApi.rejectTrade as any).mockResolvedValue({ data: {} });

    await TradeService.rejectTradeOffer('trade-1');

    expect(accountApi.logSecurityEvent).toHaveBeenCalledWith(
      'TRADE_REJECT', null, { tradeId: 'trade-1' }
    );
  });

  it('catches thrown exceptions gracefully', async () => {
    (tradeApi.rejectTrade as any).mockRejectedValue(new Error('Network timeout'));

    const result = await TradeService.rejectTradeOffer('trade-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network timeout');
  });
});

// =============================================================================
// cancelTradeOffer
// =============================================================================

describe('TradeService.cancelTradeOffer', () => {
  it('cancels a trade successfully', async () => {
    (tradeApi.cancelTrade as any).mockResolvedValue({ data: {} });

    const result = await TradeService.cancelTradeOffer('trade-1');

    expect(result.success).toBe(true);
    expect(tradeApi.cancelTrade).toHaveBeenCalledWith('trade-1');
  });

  it('returns error when API returns error', async () => {
    (tradeApi.cancelTrade as any).mockResolvedValue({
      error: 'You can only cancel trades you proposed',
    });

    const result = await TradeService.cancelTradeOffer('trade-1', 'user-IMPOSTER');

    expect(result.success).toBe(false);
    expect(result.error).toContain('only cancel trades you proposed');
  });

  it('catches thrown exceptions gracefully', async () => {
    (tradeApi.cancelTrade as any).mockRejectedValue(new Error('Connection error'));

    const result = await TradeService.cancelTradeOffer('trade-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection error');
  });
});

// =============================================================================
// getTeamTradeOffers
// =============================================================================

describe('TradeService.getTeamTradeOffers', () => {
  it('returns empty array when no trades exist', async () => {
    (tradeApi.getLeagueTrades as any).mockResolvedValue({ data: [] });

    const result = await TradeService.getTeamTradeOffers('league-1', 'team-a');

    expect(result).toEqual([]);
  });

  it('filters trades by team ID', async () => {
    const trades = [
      { id: 't1', from_team_id: 'team-a', to_team_id: 'team-b' },
      { id: 't2', from_team_id: 'team-c', to_team_id: 'team-a' },
      { id: 't3', from_team_id: 'team-c', to_team_id: 'team-d' },
    ];
    (tradeApi.getLeagueTrades as any).mockResolvedValue({ data: trades });

    const result = await TradeService.getTeamTradeOffers('league-1', 'team-a');

    expect(result).toHaveLength(2);
    expect(result.map((t: any) => t.id)).toEqual(['t1', 't2']);
  });

  it('returns empty array on API error (graceful fallback)', async () => {
    (tradeApi.getLeagueTrades as any).mockResolvedValue({
      data: null,
      error: 'Query timeout',
    });

    const result = await TradeService.getTeamTradeOffers('league-1', 'team-a');

    expect(result).toEqual([]);
  });

  it('returns empty array on thrown exception', async () => {
    (tradeApi.getLeagueTrades as any).mockRejectedValue(new Error('Network error'));

    const result = await TradeService.getTeamTradeOffers('league-1', 'team-a');

    expect(result).toEqual([]);
  });
});

// =============================================================================
// getLeagueTradeHistory
// =============================================================================

describe('TradeService.getLeagueTradeHistory', () => {
  it('returns empty array when no history exists', async () => {
    (tradeApi.getLeagueTrades as any).mockResolvedValue({ data: [] });

    const result = await TradeService.getLeagueTradeHistory('league-1');

    expect(result).toEqual([]);
  });

  it('returns trade data from API', async () => {
    const trades = [{ id: 't1', status: 'accepted' }];
    (tradeApi.getLeagueTrades as any).mockResolvedValue({ data: trades });

    const result = await TradeService.getLeagueTradeHistory('league-1');

    expect(result).toEqual(trades);
  });

  it('returns empty array on API error', async () => {
    (tradeApi.getLeagueTrades as any).mockResolvedValue({
      data: null,
      error: 'Not found',
    });

    const result = await TradeService.getLeagueTradeHistory('league-1');

    expect(result).toEqual([]);
  });
});

// =============================================================================
// submitTradeForReview
// =============================================================================

describe('TradeService.submitTradeForReview', () => {
  it('returns success with review type from API', async () => {
    (tradeApi.acceptTrade as any).mockResolvedValue({
      data: { reviewType: 'none' },
    });

    const result = await TradeService.submitTradeForReview('trade-1', 'league-1');

    expect(result.success).toBe(true);
    expect(result.reviewType).toBe('none');
  });

  it('returns commissioner review type', async () => {
    (tradeApi.acceptTrade as any).mockResolvedValue({
      data: { reviewType: 'commissioner' },
    });

    const result = await TradeService.submitTradeForReview('trade-1', 'league-1');

    expect(result.success).toBe(true);
    expect(result.reviewType).toBe('commissioner');
  });

  it('returns error on API failure', async () => {
    (tradeApi.acceptTrade as any).mockResolvedValue({
      error: 'Row not found',
    });

    const result = await TradeService.submitTradeForReview('trade-1', 'league-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Row not found');
  });

  it('catches exceptions gracefully', async () => {
    (tradeApi.acceptTrade as any).mockRejectedValue(new Error('Network error'));

    const result = await TradeService.submitTradeForReview('trade-1', 'league-1');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });
});

// =============================================================================
// submitTradeVote
// =============================================================================

describe('TradeService.submitTradeVote', () => {
  it('calls API and returns vote counts', async () => {
    (tradeApi.submitVote as any).mockResolvedValue({
      data: {
        success: true,
        veto_count: 3,
        approve_count: 5,
        votes_needed: 4,
        is_vetoed: false,
      },
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
    (tradeApi.submitVote as any).mockResolvedValue({
      data: {
        success: true,
        veto_count: 5,
        approve_count: 2,
        votes_needed: 4,
        is_vetoed: true,
      },
    });

    const result = await TradeService.submitTradeVote('trade-1', 'voter-team', 'veto');

    expect(result.isVetoed).toBe(true);
    expect(result.vetoCount).toBe(5);
  });

  it('handles API error gracefully', async () => {
    (tradeApi.submitVote as any).mockResolvedValue({
      error: 'Cannot vote on own trade',
    });

    const result = await TradeService.submitTradeVote('trade-1', 'voter-team', 'approve');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot vote on own trade');
    expect(result.vetoCount).toBe(0);
    expect(result.approveCount).toBe(0);
  });

  it('handles exceptions gracefully', async () => {
    (tradeApi.submitVote as any).mockRejectedValue(new Error('Network error'));

    const result = await TradeService.submitTradeVote('trade-1', 'voter-team', 'veto');

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
  it('returns mapped votes from API', async () => {
    (tradeApi.getVotes as any).mockResolvedValue({
      data: [
        { voter_team_id: 'team-1', vote: 'approve', created_at: '2025-01-01' },
        { voter_team_id: 'team-2', vote: 'veto', created_at: '2025-01-02' },
      ],
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
    (tradeApi.getVotes as any).mockResolvedValue({
      error: 'RLS violation',
    });

    const result = await TradeService.getTradeVotes('trade-1');

    expect(result.votes).toEqual([]);
    expect(result.error).toContain('RLS violation');
  });

  it('returns empty array on thrown exception', async () => {
    (tradeApi.getVotes as any).mockRejectedValue(new Error('DB error'));

    const result = await TradeService.getTradeVotes('trade-1');

    expect(result.votes).toEqual([]);
    expect(result.error).toContain('DB error');
  });
});

// =============================================================================
// commissionerDecision
// =============================================================================

describe('TradeService.commissionerDecision', () => {
  it('approves trade successfully', async () => {
    (tradeApi.commissionerDecision as any).mockResolvedValue({ data: {} });

    const result = await TradeService.commissionerDecision('trade-1', 'league-1', 'approve', 'commissioner-id');

    expect(result.success).toBe(true);
    expect(tradeApi.commissionerDecision).toHaveBeenCalledWith('trade-1', {
      leagueId: 'league-1',
      decision: 'approve',
    });
  });

  it('vetoes trade successfully', async () => {
    (tradeApi.commissionerDecision as any).mockResolvedValue({ data: {} });

    const result = await TradeService.commissionerDecision('trade-1', 'league-1', 'veto', 'commissioner-id');

    expect(result.success).toBe(true);
  });

  it('returns error when API returns error', async () => {
    (tradeApi.commissionerDecision as any).mockResolvedValue({
      error: 'League not configured for commissioner review',
    });

    const result = await TradeService.commissionerDecision('trade-1', 'league-1', 'approve', 'commissioner-id');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not configured for commissioner review');
  });

  it('catches exceptions gracefully', async () => {
    (tradeApi.commissionerDecision as any).mockRejectedValue(new Error('Permission denied'));

    const result = await TradeService.commissionerDecision('trade-1', 'league-1', 'veto', 'commissioner-id');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
  });
});

// =============================================================================
// getTradeReviewSettings
// =============================================================================

describe('TradeService.getTradeReviewSettings', () => {
  it('returns settings from API', async () => {
    (tradeApi.getReviewSettings as any).mockResolvedValue({
      data: {
        reviewType: 'league_vote',
        reviewPeriodHours: 72,
        vetoThreshold: 0.67,
      },
    });

    const result = await TradeService.getTradeReviewSettings('league-1');

    expect(result.reviewType).toBe('league_vote');
    expect(result.reviewPeriodHours).toBe(72);
    expect(result.vetoThreshold).toBe(0.67);
    expect(result.error).toBeUndefined();
  });

  it('returns defaults when API returns null values', async () => {
    (tradeApi.getReviewSettings as any).mockResolvedValue({
      data: {
        reviewType: null,
        reviewPeriodHours: null,
        vetoThreshold: null,
      },
    });

    const result = await TradeService.getTradeReviewSettings('league-1');

    expect(result.reviewType).toBe('none');
    expect(result.reviewPeriodHours).toBe(48);
    expect(result.vetoThreshold).toBe(0.5);
  });

  it('returns defaults with snake_case field names', async () => {
    (tradeApi.getReviewSettings as any).mockResolvedValue({
      data: {
        trade_review_type: 'commissioner',
        trade_review_period_hours: 24,
        trade_veto_threshold: 0.6,
      },
    });

    const result = await TradeService.getTradeReviewSettings('league-1');

    expect(result.reviewType).toBe('commissioner');
    expect(result.reviewPeriodHours).toBe(24);
    expect(result.vetoThreshold).toBe(0.6);
  });

  it('returns defaults on API error', async () => {
    (tradeApi.getReviewSettings as any).mockResolvedValue({
      error: 'Not found',
    });

    const result = await TradeService.getTradeReviewSettings('league-1');

    expect(result.reviewType).toBe('none');
    expect(result.reviewPeriodHours).toBe(48);
    expect(result.vetoThreshold).toBe(0.5);
    expect(result.error).toBeDefined();
  });

  it('returns defaults on thrown exception', async () => {
    (tradeApi.getReviewSettings as any).mockRejectedValue(new Error('Network error'));

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
  it('updates league settings successfully', async () => {
    (apiClient.put as any).mockResolvedValue({ data: null });

    const result = await TradeService.updateTradeReviewSettings('league-1', 'comm-id', {
      trade_review_type: 'league_vote',
      trade_review_period_hours: 72,
      trade_veto_threshold: 0.6,
    });

    expect(result.success).toBe(true);
    expect(apiClient.put).toHaveBeenCalledWith(
      '/api/trades/league/league-1/review-settings',
      expect.objectContaining({
        trade_review_type: 'league_vote',
        trade_review_period_hours: 72,
        trade_veto_threshold: 0.6,
      })
    );
  });

  it('returns error when API returns error', async () => {
    (apiClient.put as any).mockResolvedValue({
      error: 'Permission denied',
    });

    const result = await TradeService.updateTradeReviewSettings('league-1', 'comm-id', {
      trade_review_type: 'commissioner',
      trade_review_period_hours: 48,
      trade_veto_threshold: 0.5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
  });

  it('catches thrown exceptions gracefully', async () => {
    (apiClient.put as any).mockRejectedValue(new Error('Network error'));

    const result = await TradeService.updateTradeReviewSettings('league-1', 'comm-id', {
      trade_review_type: 'none',
      trade_review_period_hours: 48,
      trade_veto_threshold: 0.5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });
});

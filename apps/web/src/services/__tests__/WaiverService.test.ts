import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WaiverService } from '../WaiverService';

// =============================================================================
// MOCK SETUP
// =============================================================================

vi.mock('@/api/waivers', () => ({
  waiverApi: {
    getLeagueWaivers: vi.fn(),
    getTeamWaivers: vi.fn(),
    getWaiverPriority: vi.fn(),
    getFAABBudgets: vi.fn(),
    getWaiverSettings: vi.fn(),
    submitClaim: vi.fn(),
    submitFAABBid: vi.fn(),
    addFreeAgent: vi.fn(),
    dropPlayer: vi.fn(),
    cancelClaim: vi.fn(),
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

vi.mock('../PlayerService', () => ({
  PlayerService: {
    getAllPlayers: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/seasonConstants', () => ({
  CURRENT_SEASON: 2025,
}));

import { waiverApi } from '@/api/waivers';
import { accountApi } from '@/api/account';
import { apiClient } from '@/api/client';
import { PlayerService } from '../PlayerService';

// =============================================================================
// checkTransactionLimits — Now a no-op (server validates)
// =============================================================================

describe('WaiverService.checkTransactionLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always returns allowed (server validates limits)', async () => {
    const result = await WaiverService.checkTransactionLimits('league-1', 'team-1');
    expect(result.allowed).toBe(true);
  });

  it('returns allowed regardless of input', async () => {
    const result = await WaiverService.checkTransactionLimits('missing-league', 'team-1');
    expect(result.allowed).toBe(true);
  });
});

// =============================================================================
// submitWaiverClaim
// =============================================================================

describe('WaiverService.submitWaiverClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully submits a waiver claim', async () => {
    (waiverApi.submitClaim as any).mockResolvedValue({
      data: { success: true, claimId: 'claim-uuid-123' },
    });

    const result = await WaiverService.submitWaiverClaim('league-1', 'team-1', 8478402, null);
    expect(result.success).toBe(true);
    expect(result.claimId).toBe('claim-uuid-123');
  });

  it('passes drop_player_id when provided', async () => {
    (waiverApi.submitClaim as any).mockResolvedValue({
      data: { success: true, claimId: 'claim-uuid-456' },
    });

    await WaiverService.submitWaiverClaim('league-1', 'team-1', 8478402, 8477474);

    expect(waiverApi.submitClaim).toHaveBeenCalledWith('league-1', {
      teamId: 'team-1',
      playerId: '8478402',
      dropPlayerId: '8477474',
    });
  });

  it('passes null drop_player_id when not provided', async () => {
    (waiverApi.submitClaim as any).mockResolvedValue({
      data: { success: true },
    });

    await WaiverService.submitWaiverClaim('league-1', 'team-1', 8478402, null);

    expect(waiverApi.submitClaim).toHaveBeenCalledWith('league-1', {
      teamId: 'team-1',
      playerId: '8478402',
      dropPlayerId: null,
    });
  });

  it('logs security event on success', async () => {
    (waiverApi.submitClaim as any).mockResolvedValue({
      data: { success: true, claimId: 'claim-1' },
    });

    await WaiverService.submitWaiverClaim('league-1', 'team-1', 8478402, null);

    expect(accountApi.logSecurityEvent).toHaveBeenCalledWith(
      'WAIVER_CLAIM', 'league-1',
      expect.objectContaining({ teamId: 'team-1', playerId: 8478402 })
    );
  });

  it('returns error on API failure', async () => {
    (waiverApi.submitClaim as any).mockRejectedValue(new Error('Unique constraint violation'));

    const result = await WaiverService.submitWaiverClaim('league-1', 'team-1', 8478402, null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unique constraint violation');
  });
});

// =============================================================================
// checkPlayerAvailability
// =============================================================================

describe('WaiverService.checkPlayerAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns available when settings can be fetched', async () => {
    (waiverApi.getWaiverSettings as any).mockResolvedValue({
      data: { waiver_game_lock: false, waiver_period_hours: 0 },
    });

    const result = await WaiverService.checkPlayerAvailability(8478402, 'league-1', 'user-1');
    expect(result.is_available).toBe(true);
    expect(result.is_game_locked).toBe(false);
    expect(result.is_on_waivers).toBe(false);
    expect(result.lock_reason).toBeNull();
  });

  it('returns available with null lock_reason when settings are null', async () => {
    (waiverApi.getWaiverSettings as any).mockResolvedValue({
      data: null,
    });

    const result = await WaiverService.checkPlayerAvailability(8478402, 'league-1', 'user-1');
    expect(result.is_available).toBe(true);
    expect(result.lock_reason).toBe('Unable to check availability');
  });

  it('throws when API call fails', async () => {
    (waiverApi.getWaiverSettings as any).mockRejectedValue(new Error('Not a member'));

    await expect(
      WaiverService.checkPlayerAvailability(8478402, 'league-1', 'user-1')
    ).rejects.toThrow('Not a member');
  });
});

// =============================================================================
// addFreeAgent
// =============================================================================

describe('WaiverService.addFreeAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds a free agent successfully', async () => {
    (waiverApi.addFreeAgent as any).mockResolvedValue({
      data: { success: true },
    });

    const result = await WaiverService.addFreeAgent('league-1', 'team-1', 8478402, null);
    expect(result.success).toBe(true);
  });

  it('passes drop player ID when provided', async () => {
    (waiverApi.addFreeAgent as any).mockResolvedValue({
      data: { success: true },
    });

    await WaiverService.addFreeAgent('league-1', 'team-1', 8478402, 8477474);

    expect(waiverApi.addFreeAgent).toHaveBeenCalledWith('league-1', {
      teamId: 'team-1',
      playerId: '8478402',
      dropPlayerId: '8477474',
    });
  });

  it('logs security event on success', async () => {
    (waiverApi.addFreeAgent as any).mockResolvedValue({
      data: { success: true },
    });

    await WaiverService.addFreeAgent('league-1', 'team-1', 8478402, null);

    expect(accountApi.logSecurityEvent).toHaveBeenCalledWith(
      'ROSTER_MOVE', 'league-1',
      expect.objectContaining({ addPlayerId: '8478402', teamId: 'team-1' })
    );
  });

  it('logs failure event on error', async () => {
    (waiverApi.addFreeAgent as any).mockRejectedValue(new Error('Player already rostered'));

    const result = await WaiverService.addFreeAgent('league-1', 'team-1', 8478402, null);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Player already rostered');
    expect(accountApi.logSecurityEvent).toHaveBeenCalledWith(
      'ROSTER_MOVE_FAILED', 'league-1',
      expect.objectContaining({ addPlayerId: '8478402', teamId: 'team-1' })
    );
  });
});

// =============================================================================
// submitFAABBid
// =============================================================================

describe('WaiverService.submitFAABBid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits a FAAB bid successfully', async () => {
    (waiverApi.submitFAABBid as any).mockResolvedValue({
      data: { success: true, claimId: 'claim-faab-1' },
    });

    const result = await WaiverService.submitFAABBid('league-1', 'team-1', 8478402, 25, null);
    expect(result.success).toBe(true);
    expect(result.claimId).toBe('claim-faab-1');
  });

  it('passes correct parameters to API', async () => {
    (waiverApi.submitFAABBid as any).mockResolvedValue({
      data: { success: true },
    });

    await WaiverService.submitFAABBid('league-1', 'team-1', 8478402, 50, 8477474, true);

    expect(waiverApi.submitFAABBid).toHaveBeenCalledWith('league-1', {
      teamId: 'team-1',
      playerId: '8478402',
      bidAmount: 50,
      dropPlayerId: '8477474',
      isConditionalDrop: true,
    });
  });

  it('allows a zero-dollar bid ($0 FAAB)', async () => {
    (waiverApi.submitFAABBid as any).mockResolvedValue({
      data: { success: true, claimId: 'claim-faab-0' },
    });

    const result = await WaiverService.submitFAABBid('league-1', 'team-1', 8478402, 0, null);
    expect(result.success).toBe(true);
  });

  it('returns error on API failure', async () => {
    (waiverApi.submitFAABBid as any).mockRejectedValue(new Error('Budget exceeded'));

    const result = await WaiverService.submitFAABBid('league-1', 'team-1', 8478402, 200, null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Budget exceeded');
  });
});

// =============================================================================
// getFAABBudget
// =============================================================================

describe('WaiverService.getFAABBudget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns budget for the team from API', async () => {
    (waiverApi.getFAABBudgets as any).mockResolvedValue({
      data: [
        { team_id: 'team-1', remaining_budget: 75 },
        { team_id: 'team-2', remaining_budget: 50 },
      ],
    });

    const budget = await WaiverService.getFAABBudget('league-1', 'team-1');
    expect(budget).toBe(75);
  });

  it('returns null when team is not found in budgets', async () => {
    (waiverApi.getFAABBudgets as any).mockResolvedValue({
      data: [
        { team_id: 'team-2', remaining_budget: 50 },
      ],
    });

    const budget = await WaiverService.getFAABBudget('league-1', 'team-1');
    expect(budget).toBeNull();
  });

  it('returns null when budgets data is null', async () => {
    (waiverApi.getFAABBudgets as any).mockResolvedValue({
      data: null,
    });

    const budget = await WaiverService.getFAABBudget('league-1', 'team-1');
    expect(budget).toBeNull();
  });

  it('returns null when API throws', async () => {
    (waiverApi.getFAABBudgets as any).mockRejectedValue(new Error('DB error'));

    const budget = await WaiverService.getFAABBudget('league-1', 'team-1');
    expect(budget).toBeNull();
  });
});

// =============================================================================
// getAllFAABBudgets
// =============================================================================

describe('WaiverService.getAllFAABBudgets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all budgets from API', async () => {
    const budgets = [
      { team_id: 'team-1', team_name: 'Team 1', remaining_budget: 75, total_spent: 25 },
      { team_id: 'team-2', team_name: 'Team 2', remaining_budget: 50, total_spent: 50 },
    ];
    (waiverApi.getFAABBudgets as any).mockResolvedValue({ data: budgets });

    const result = await WaiverService.getAllFAABBudgets('league-1');
    expect(result).toEqual(budgets);
  });

  it('returns empty array on API error', async () => {
    (waiverApi.getFAABBudgets as any).mockRejectedValue(new Error('Error'));

    const result = await WaiverService.getAllFAABBudgets('league-1');
    expect(result).toEqual([]);
  });
});

// =============================================================================
// cancelWaiverClaim
// =============================================================================

describe('WaiverService.cancelWaiverClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully cancels a pending claim', async () => {
    (waiverApi.cancelClaim as any).mockResolvedValue({ data: null });

    const result = await WaiverService.cancelWaiverClaim('claim-123');
    expect(result.success).toBe(true);
  });

  it('returns error on API failure', async () => {
    (waiverApi.cancelClaim as any).mockRejectedValue(new Error('Row not found'));

    const result = await WaiverService.cancelWaiverClaim('claim-123');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Row not found');
  });
});

// =============================================================================
// getWaiverPriority
// =============================================================================

describe('WaiverService.getWaiverPriority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns priority data from API', async () => {
    const priorities = [
      { id: 'p1', league_id: 'league-1', team_id: 'team-1', team_name: 'Team 1', priority: 1, updated_at: '2025-01-01' },
      { id: 'p2', league_id: 'league-1', team_id: 'team-2', team_name: 'Team 2', priority: 2, updated_at: '2025-01-01' },
    ];
    (waiverApi.getWaiverPriority as any).mockResolvedValue({ data: priorities });

    const result = await WaiverService.getWaiverPriority('league-1');
    expect(result).toEqual(priorities);
  });

  it('returns empty array on error', async () => {
    (waiverApi.getWaiverPriority as any).mockRejectedValue(new Error('Error'));

    const result = await WaiverService.getWaiverPriority('league-1');
    expect(result).toEqual([]);
  });
});

// =============================================================================
// getTeamWaiverClaims
// =============================================================================

describe('WaiverService.getTeamWaiverClaims', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns claims from API', async () => {
    const claims = [{ id: 'claim-1', status: 'pending' }];
    (waiverApi.getTeamWaivers as any).mockResolvedValue({ data: claims });

    const result = await WaiverService.getTeamWaiverClaims('league-1', 'team-1');
    expect(result).toEqual(claims);
  });

  it('returns empty array on error', async () => {
    (waiverApi.getTeamWaivers as any).mockRejectedValue(new Error('Error'));

    const result = await WaiverService.getTeamWaiverClaims('league-1', 'team-1');
    expect(result).toEqual([]);
  });
});

// =============================================================================
// getLeagueWaiverSettings
// =============================================================================

describe('WaiverService.getLeagueWaiverSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns settings from API', async () => {
    const settings = {
      waiver_process_time: '03:00',
      waiver_period_hours: 24,
      waiver_game_lock: true,
      waiver_type: 'rolling',
      allow_trades_during_games: false,
    };
    (waiverApi.getWaiverSettings as any).mockResolvedValue({ data: settings });

    const result = await WaiverService.getLeagueWaiverSettings('league-1', 'user-1');
    expect(result).toEqual(settings);
  });

  it('returns null on error', async () => {
    (waiverApi.getWaiverSettings as any).mockRejectedValue(new Error('Error'));

    const result = await WaiverService.getLeagueWaiverSettings('league-1', 'user-1');
    expect(result).toBeNull();
  });
});

// =============================================================================
// getAvailablePlayers
// =============================================================================

describe('WaiverService.getAvailablePlayers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns filtered players', async () => {
    (waiverApi.getLeagueWaivers as any).mockResolvedValue({
      data: { rosteredPlayerIds: ['101'] },
    });

    (PlayerService.getAllPlayers as any).mockResolvedValue([
      { id: 101, full_name: 'Player A', position: 'C', team: 'TOR', jersey_number: '97' },
      { id: 102, full_name: 'Player B', position: 'LW', team: 'EDM', jersey_number: '29' },
    ]);

    const result = await WaiverService.getAvailablePlayers('league-1');
    expect(result).toHaveLength(1);
    expect(result[0].player_id).toBe(102);
    expect(result[0].full_name).toBe('Player B');
  });

  it('filters by position', async () => {
    (waiverApi.getLeagueWaivers as any).mockResolvedValue({ data: {} });
    (PlayerService.getAllPlayers as any).mockResolvedValue([
      { id: 101, full_name: 'Player A', position: 'C', team: 'TOR', jersey_number: '' },
      { id: 102, full_name: 'Player B', position: 'G', team: 'EDM', jersey_number: '' },
    ]);

    const result = await WaiverService.getAvailablePlayers('league-1', 'G');
    expect(result).toHaveLength(1);
    expect(result[0].position_code).toBe('G');
  });

  it('filters by search term', async () => {
    (waiverApi.getLeagueWaivers as any).mockResolvedValue({ data: {} });
    (PlayerService.getAllPlayers as any).mockResolvedValue([
      { id: 101, full_name: 'Connor McDavid', position: 'C', team: 'EDM', jersey_number: '97' },
      { id: 102, full_name: 'Leon Draisaitl', position: 'C', team: 'EDM', jersey_number: '29' },
    ]);

    const result = await WaiverService.getAvailablePlayers('league-1', undefined, 'mcdavid');
    expect(result).toHaveLength(1);
    expect(result[0].full_name).toBe('Connor McDavid');
  });

  it('returns empty array on error', async () => {
    (waiverApi.getLeagueWaivers as any).mockRejectedValue(new Error('Error'));

    const result = await WaiverService.getAvailablePlayers('league-1');
    expect(result).toEqual([]);
  });
});

// =============================================================================
// processAllPendingWaivers
// =============================================================================

describe('WaiverService.processAllPendingWaivers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success with results from API', async () => {
    (apiClient.post as any).mockResolvedValue({
      data: {
        results: [
          {
            league_id: 'league-1',
            league_name: 'Test League',
            total_processed: 3,
            successful: 2,
            failed: 1,
            details: [],
          },
        ],
      },
    });

    const result = await WaiverService.processAllPendingWaivers();
    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].successful).toBe(2);
  });

  it('returns error when API fails', async () => {
    (apiClient.post as any).mockRejectedValue(new Error('RPC timeout'));

    const result = await WaiverService.processAllPendingWaivers();
    expect(result.success).toBe(false);
    expect(result.error).toContain('RPC timeout');
    expect(result.results).toEqual([]);
  });

  it('handles empty results gracefully', async () => {
    (apiClient.post as any).mockResolvedValue({ data: null });

    const result = await WaiverService.processAllPendingWaivers();
    expect(result.success).toBe(true);
    expect(result.results).toEqual([]);
  });
});

// =============================================================================
// getWaiverProcessingStatus
// =============================================================================

describe('WaiverService.getWaiverProcessingStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns league status data from API', async () => {
    const statusData = {
      leagues: [
        {
          league_id: 'league-1',
          league_name: 'Test League',
          pending_claims: 5,
          last_processed: '2025-12-08T03:00:00Z',
          next_process_time: '2025-12-09T03:00:00Z',
        },
      ],
    };

    (apiClient.get as any).mockResolvedValue({ data: statusData });

    const result = await WaiverService.getWaiverProcessingStatus();
    expect(result.leagues).toHaveLength(1);
    expect(result.leagues[0].pending_claims).toBe(5);
    expect(result.error).toBeUndefined();
  });

  it('returns empty array and error on API failure', async () => {
    (apiClient.get as any).mockRejectedValue(new Error('Permission denied'));

    const result = await WaiverService.getWaiverProcessingStatus();
    expect(result.leagues).toEqual([]);
    expect(result.error).toContain('Permission denied');
  });
});

// =============================================================================
// recalculateReverseStandingsPriority
// =============================================================================

describe('WaiverService.recalculateReverseStandingsPriority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success when API succeeds', async () => {
    (apiClient.post as any).mockResolvedValue({ data: { success: true } });

    const result = await WaiverService.recalculateReverseStandingsPriority('league-1');
    expect(result.success).toBe(true);
    expect(apiClient.post).toHaveBeenCalledWith('/api/waivers/league/league-1/recalculate-priority');
  });

  it('returns error when API fails', async () => {
    (apiClient.post as any).mockRejectedValue(new Error('Function does not exist'));

    const result = await WaiverService.recalculateReverseStandingsPriority('league-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Function does not exist');
  });
});

// =============================================================================
// updateWaiverSettings
// =============================================================================

describe('WaiverService.updateWaiverSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates settings successfully', async () => {
    (apiClient.put as any).mockResolvedValue({ data: { success: true } });

    const result = await WaiverService.updateWaiverSettings('league-1', 'commissioner-1', {
      waiver_type: 'reverse_standings',
    });

    expect(result.success).toBe(true);
    expect(apiClient.put).toHaveBeenCalledWith(
      '/api/waivers/league/league-1/settings',
      { waiver_type: 'reverse_standings' }
    );
  });

  it('returns error when API fails', async () => {
    (apiClient.put as any).mockRejectedValue(new Error('Update failed'));

    const result = await WaiverService.updateWaiverSettings('league-1', 'commissioner-1', {
      waiver_game_lock: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Update failed');
  });
});

// =============================================================================
// processFAABWaivers
// =============================================================================

describe('WaiverService.processFAABWaivers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns processed results from API', async () => {
    (apiClient.post as any).mockResolvedValue({
      data: {
        processed: 3,
        results: [
          { player_id: 101, winner_team_id: 'team-1', bid: 25 },
        ],
      },
    });

    const result = await WaiverService.processFAABWaivers('league-1');
    expect(result.processed).toBe(3);
    expect(result.results).toHaveLength(1);
  });

  it('returns error on API failure', async () => {
    (apiClient.post as any).mockRejectedValue(new Error('Processing error'));

    const result = await WaiverService.processFAABWaivers('league-1');
    expect(result.processed).toBe(0);
    expect(result.error).toContain('Processing error');
  });
});

// =============================================================================
// addPlayer — Smart add (free agent vs waiver claim routing)
// =============================================================================

describe('WaiverService.addPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes to free agent pickup when API succeeds', async () => {
    (waiverApi.addFreeAgent as any).mockResolvedValue({
      data: { success: true },
    });

    const result = await WaiverService.addPlayer('league-1', 'team-1', 8478402, null);
    expect(result.success).toBe(true);
    expect(result.isFreeAgent).toBe(true);
  });

  it('falls back to waiver claim when free agent add fails', async () => {
    (waiverApi.addFreeAgent as any).mockRejectedValue(new Error('Player locked'));
    (waiverApi.submitClaim as any).mockResolvedValue({
      data: { success: true, claimId: 'claim-xyz' },
    });

    const result = await WaiverService.addPlayer('league-1', 'team-1', 8478402, null);
    expect(result.success).toBe(true);
    expect(result.isFreeAgent).toBe(false);
    expect(result.claimId).toBe('claim-xyz');
  });

  it('returns error when both free agent and waiver claim fail', async () => {
    (waiverApi.addFreeAgent as any).mockRejectedValue(new Error('Player locked'));
    (waiverApi.submitClaim as any).mockRejectedValue(new Error('Claim failed'));

    const result = await WaiverService.addPlayer('league-1', 'team-1', 8478402, null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Claim failed');
  });

  it('passes drop player ID through', async () => {
    (waiverApi.addFreeAgent as any).mockResolvedValue({
      data: { success: true },
    });

    await WaiverService.addPlayer('league-1', 'team-1', 8478402, 8477474);

    expect(waiverApi.addFreeAgent).toHaveBeenCalledWith('league-1', {
      teamId: 'team-1',
      playerId: '8478402',
      dropPlayerId: '8477474',
    });
  });
});

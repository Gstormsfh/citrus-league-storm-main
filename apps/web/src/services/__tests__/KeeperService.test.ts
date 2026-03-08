import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock API client
// =============================================================================

vi.mock('@/api/keepers', () => ({
  keeperApi: {
    getTeamKeepers: vi.fn(),
    getLeagueKeepers: vi.fn(),
    designateKeeper: vi.fn(),
    releaseKeeper: vi.fn(),
    validateKeepers: vi.fn(),
    getKeeperDraftCosts: vi.fn(),
    lockKeepers: vi.fn(),
    updateKeeperSettings: vi.fn(),
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
// Import KeeperService AFTER mocks are registered
// =============================================================================

import { keeperApi } from '@/api/keepers';

let KeeperService: typeof import('../KeeperService').KeeperService;

beforeEach(async () => {
  vi.clearAllMocks();

  const mod = await import('../KeeperService');
  KeeperService = mod.KeeperService;
});

// =============================================================================
// Tests
// =============================================================================

describe('KeeperService', () => {
  // ---------------------------------------------------------------------------
  // designateKeeper
  // ---------------------------------------------------------------------------
  describe('designateKeeper', () => {
    it('designates a keeper when validation passes', async () => {
      // Mock validateKeepers API — returns valid
      (keeperApi.validateKeepers as any).mockResolvedValue({
        data: { is_valid: true, error_message: null, keepers_count: 1, max_keepers: 3 },
        error: undefined,
      });

      const designation = {
        id: 'kd-1',
        league_id: 'league-1',
        team_id: 'team-1',
        player_id: 'player-1',
        season_year: 2026,
        keeper_round: null,
        keeper_penalty_type: 'none',
        original_draft_round: 3,
        years_kept: 1,
        designated_at: '2026-01-15T00:00:00Z',
        approved_by: null,
        status: 'designated',
      };

      (keeperApi.designateKeeper as any).mockResolvedValue({
        data: designation,
        error: undefined,
      });

      const result = await KeeperService.designateKeeper(
        'league-1',
        'team-1',
        'player-1',
        2026,
        3
      );

      expect(result.success).toBe(true);
      expect(result.designation).toBeDefined();
      expect(result.designation!.player_id).toBe('player-1');
    });

    it('returns error when validation fails', async () => {
      // Mock validateKeepers — returns error
      (keeperApi.validateKeepers as any).mockResolvedValue({
        data: null,
        error: 'Validation RPC error',
      });

      const result = await KeeperService.designateKeeper(
        'league-1',
        'team-1',
        'player-1',
        2026
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns duplicate error on unique constraint violation', async () => {
      // Mock validateKeepers — passes
      (keeperApi.validateKeepers as any).mockResolvedValue({
        data: { is_valid: true, error_message: null, keepers_count: 1, max_keepers: 3 },
        error: undefined,
      });

      // Mock designateKeeper — returns duplicate key error
      (keeperApi.designateKeeper as any).mockResolvedValue({
        data: null,
        error: 'Player is already designated as a keeper',
      });

      const result = await KeeperService.designateKeeper(
        'league-1',
        'team-1',
        'player-1',
        2026
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Player is already designated as a keeper');
    });
  });

  // ---------------------------------------------------------------------------
  // releaseKeeper
  // ---------------------------------------------------------------------------
  describe('releaseKeeper', () => {
    it('releases a keeper designation successfully', async () => {
      (keeperApi.releaseKeeper as any).mockResolvedValue({ data: null, error: undefined });

      const result = await KeeperService.releaseKeeper('kd-1', 'team-1');

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns error on database failure', async () => {
      (keeperApi.releaseKeeper as any).mockResolvedValue({
        data: null,
        error: 'Database error',
      });

      const result = await KeeperService.releaseKeeper('kd-1', 'team-1');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getTeamKeepers
  // ---------------------------------------------------------------------------
  describe('getTeamKeepers', () => {
    it('returns keepers for a team', async () => {
      const keepers = [
        {
          id: 'kd-1',
          league_id: 'league-1',
          team_id: 'team-1',
          player_id: 'player-1',
          season_year: 2026,
          keeper_round: null,
          keeper_penalty_type: 'none',
          original_draft_round: 3,
          years_kept: 1,
          designated_at: '2026-01-15T00:00:00Z',
          approved_by: null,
          status: 'designated',
        },
      ];

      (keeperApi.getTeamKeepers as any).mockResolvedValue({ data: keepers, error: undefined });

      const result = await KeeperService.getTeamKeepers('league-1', 'team-1', 2026);

      expect(result.keepers).toHaveLength(1);
      expect(result.keepers[0].player_id).toBe('player-1');
      expect(result.error).toBeUndefined();
    });

    it('returns empty array on error', async () => {
      (keeperApi.getTeamKeepers as any).mockResolvedValue({
        data: null,
        error: 'Database error',
      });

      const result = await KeeperService.getTeamKeepers('league-1', 'team-1', 2026);

      expect(result.keepers).toEqual([]);
      expect(result.error).toBeDefined();
    });

    it('returns empty array when no keepers exist', async () => {
      (keeperApi.getTeamKeepers as any).mockResolvedValue({ data: [], error: undefined });

      const result = await KeeperService.getTeamKeepers('league-1', 'team-1', 2026);

      expect(result.keepers).toEqual([]);
      expect(result.error).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getLeagueKeepers
  // ---------------------------------------------------------------------------
  describe('getLeagueKeepers', () => {
    it('returns all keepers for a league', async () => {
      const keepers = [
        { id: 'kd-1', team_id: 'team-1', player_id: 'player-1' },
        { id: 'kd-2', team_id: 'team-2', player_id: 'player-2' },
      ];

      (keeperApi.getLeagueKeepers as any).mockResolvedValue({ data: keepers, error: undefined });

      const result = await KeeperService.getLeagueKeepers('league-1', 2026);

      expect(result.keepers).toHaveLength(2);
      expect(result.error).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // validateKeepers
  // ---------------------------------------------------------------------------
  describe('validateKeepers', () => {
    it('returns valid result from API', async () => {
      (keeperApi.validateKeepers as any).mockResolvedValue({
        data: {
          is_valid: true,
          error_message: null,
          keepers_count: 2,
          max_keepers: 3,
        },
        error: undefined,
      });

      const result = await KeeperService.validateKeepers('league-1', 'team-1', 2026);

      expect(result.is_valid).toBe(true);
      expect(result.error_message).toBeNull();
      expect(result.keepers_count).toBe(2);
      expect(result.max_keepers).toBe(3);
    });

    it('returns invalid result with error message', async () => {
      (keeperApi.validateKeepers as any).mockResolvedValue({
        data: {
          is_valid: false,
          error_message: 'Maximum keepers exceeded',
          keepers_count: 4,
          max_keepers: 3,
        },
        error: undefined,
      });

      const result = await KeeperService.validateKeepers('league-1', 'team-1', 2026);

      expect(result.is_valid).toBe(false);
      expect(result.error_message).toBe('Maximum keepers exceeded');
    });

    it('returns fallback values on API error', async () => {
      (keeperApi.validateKeepers as any).mockResolvedValue({
        data: null,
        error: 'RPC failed',
      });

      const result = await KeeperService.validateKeepers('league-1', 'team-1', 2026);

      expect(result.is_valid).toBe(false);
      expect(result.error_message).toBe('RPC failed');
      expect(result.error).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getKeeperDraftCosts
  // ---------------------------------------------------------------------------
  describe('getKeeperDraftCosts', () => {
    it('returns draft costs from API', async () => {
      const costs = [
        {
          player_id: 'player-1',
          keeper_round: 3,
          penalty_type: 'round-cost',
          original_draft_round: 5,
          years_kept: 2,
          effective_round: 3,
        },
      ];

      (keeperApi.getKeeperDraftCosts as any).mockResolvedValue({ data: costs, error: undefined });

      const result = await KeeperService.getKeeperDraftCosts('league-1', 'team-1', 2026);

      expect(result.costs).toHaveLength(1);
      expect(result.costs[0].player_id).toBe('player-1');
      expect(result.error).toBeUndefined();
    });

    it('returns empty costs on API error', async () => {
      (keeperApi.getKeeperDraftCosts as any).mockResolvedValue({
        data: null,
        error: 'RPC failed',
      });

      const result = await KeeperService.getKeeperDraftCosts('league-1', 'team-1', 2026);

      expect(result.costs).toEqual([]);
      expect(result.error).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // lockKeepersForSeason
  // ---------------------------------------------------------------------------
  describe('lockKeepersForSeason', () => {
    it('locks keepers successfully', async () => {
      (keeperApi.lockKeepers as any).mockResolvedValue({
        data: [
          { team_id: 'team-1', keepers_locked: 2, rounds_consumed: [3, 5] },
          { team_id: 'team-2', keepers_locked: 1, rounds_consumed: [2] },
        ],
        error: undefined,
      });

      const result = await KeeperService.lockKeepersForSeason('league-1', 2026);

      expect(result.results).toHaveLength(2);
      expect(result.results[0].keepersLocked).toBe(2);
      expect(result.results[0].roundsConsumed).toEqual([3, 5]);
      expect(result.error).toBeUndefined();
    });

    it('returns empty results on API error', async () => {
      (keeperApi.lockKeepers as any).mockResolvedValue({
        data: null,
        error: 'Lock RPC failed',
      });

      const result = await KeeperService.lockKeepersForSeason('league-1', 2026);

      expect(result.results).toEqual([]);
      expect(result.error).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // updateKeeperSettings
  // ---------------------------------------------------------------------------
  describe('updateKeeperSettings', () => {
    it('updates keeper settings successfully', async () => {
      (keeperApi.updateKeeperSettings as any).mockResolvedValue({ data: null, error: undefined });

      const result = await KeeperService.updateKeeperSettings('league-1', 'user-1', {
        keeperEnabled: true,
        keeperCount: 3,
        keeperPenalty: 'round-cost',
        dynastyMode: false,
      });

      expect(result.success).toBe(true);
    });

    it('rejects update when API returns error', async () => {
      (keeperApi.updateKeeperSettings as any).mockResolvedValue({
        data: null,
        error: 'Only the commissioner can update keeper settings',
      });

      const result = await KeeperService.updateKeeperSettings('league-1', 'user-1', {
        keeperEnabled: true,
        keeperCount: 3,
        keeperPenalty: 'none',
        dynastyMode: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Only the commissioner can update keeper settings');
    });

    it('sends dynasty mode settings to the API', async () => {
      (keeperApi.updateKeeperSettings as any).mockResolvedValue({ data: null, error: undefined });

      await KeeperService.updateKeeperSettings('league-1', 'user-1', {
        keeperEnabled: true,
        keeperCount: 3,
        keeperPenalty: 'none',
        dynastyMode: true,
      });

      expect(keeperApi.updateKeeperSettings).toHaveBeenCalledWith('league-1', {
        keeperEnabled: true,
        keeperCount: 3,
        keeperPenalty: 'none',
        dynastyMode: true,
      });
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock API client modules
// =============================================================================

const mockGetLeague = vi.fn();
const mockGetTeams = vi.fn();

vi.mock('@/api/leagues', () => ({
  leagueApi: {
    getLeague: (...args: unknown[]) => mockGetLeague(...args),
    getTeams: (...args: unknown[]) => mockGetTeams(...args),
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
// Import LeagueMembershipService AFTER mocks are registered
// =============================================================================

let LeagueMembershipService: typeof import('../LeagueMembershipService').LeagueMembershipService;
let clearMembershipCache: typeof import('../LeagueMembershipService').clearMembershipCache;

beforeEach(async () => {
  vi.clearAllMocks();

  const mod = await import('../LeagueMembershipService');
  LeagueMembershipService = mod.LeagueMembershipService;
  clearMembershipCache = mod.clearMembershipCache;

  // Always clear cache before each test to avoid stale results
  clearMembershipCache();
});

// =============================================================================
// Helpers
// =============================================================================

/**
 * Set up API mocks to return appropriate league and teams data.
 */
function mockMembershipQueries(options: {
  isCommissioner: boolean;
  hasTeam: boolean;
  teamId?: string;
}) {
  mockGetLeague.mockResolvedValue({
    data: options.isCommissioner
      ? { commissioner_id: 'user-1' }
      : { commissioner_id: 'other-user' },
  });

  mockGetTeams.mockResolvedValue({
    data: options.hasTeam
      ? [{ id: options.teamId || 'team-1', owner_id: 'user-1' }]
      : [{ id: 'team-other', owner_id: 'other-user' }],
  });
}

// =============================================================================
// Tests
// =============================================================================

describe('LeagueMembershipService', () => {
  // ---------------------------------------------------------------------------
  // checkMembership
  // ---------------------------------------------------------------------------
  describe('checkMembership', () => {
    it('returns isMember=true and isCommissioner=true for commissioner', async () => {
      mockMembershipQueries({ isCommissioner: true, hasTeam: false });

      const result = await LeagueMembershipService.checkMembership('league-1', 'user-1');

      expect(result.isMember).toBe(true);
      expect(result.isCommissioner).toBe(true);
    });

    it('returns isMember=true for team owner who is not commissioner', async () => {
      mockMembershipQueries({ isCommissioner: false, hasTeam: true, teamId: 'team-42' });

      const result = await LeagueMembershipService.checkMembership('league-1', 'user-1');

      expect(result.isMember).toBe(true);
      expect(result.isCommissioner).toBe(false);
      expect(result.teamId).toBe('team-42');
    });

    it('returns isMember=false for non-member', async () => {
      mockGetLeague.mockResolvedValue({
        data: { commissioner_id: 'other-user' },
      });
      mockGetTeams.mockResolvedValue({
        data: [{ id: 'team-other', owner_id: 'other-user' }],
      });

      const result = await LeagueMembershipService.checkMembership('league-1', 'user-1');

      expect(result.isMember).toBe(false);
      expect(result.isCommissioner).toBe(false);
      expect(result.teamId).toBeUndefined();
    });

    it('throws error for invalid userId', async () => {
      await expect(
        LeagueMembershipService.checkMembership('league-1', '')
      ).rejects.toThrow('SECURITY ERROR');
    });

    it('throws error for undefined userId string', async () => {
      await expect(
        LeagueMembershipService.checkMembership('league-1', 'undefined')
      ).rejects.toThrow('SECURITY ERROR');
    });

    it('fails closed (denies access) on unexpected error', async () => {
      mockGetLeague.mockRejectedValue(new Error('Unexpected API failure'));
      mockGetTeams.mockRejectedValue(new Error('Unexpected API failure'));

      const result = await LeagueMembershipService.checkMembership('league-1', 'user-1');

      expect(result.isMember).toBe(false);
      expect(result.isCommissioner).toBe(false);
    });

    it('uses cached result on second call within TTL', async () => {
      mockMembershipQueries({ isCommissioner: false, hasTeam: true });

      const result1 = await LeagueMembershipService.checkMembership('league-1', 'user-1');
      expect(result1.isMember).toBe(true);

      // Second call should use cache
      const callCountBefore = mockGetLeague.mock.calls.length;
      const result2 = await LeagueMembershipService.checkMembership('league-1', 'user-1');
      const callCountAfter = mockGetLeague.mock.calls.length;

      expect(result2.isMember).toBe(true);
      expect(callCountAfter).toBe(callCountBefore); // No additional API calls
    });
  });

  // ---------------------------------------------------------------------------
  // verifyMembership (isMember boolean wrapper)
  // ---------------------------------------------------------------------------
  describe('verifyMembership', () => {
    it('returns true for a valid member', async () => {
      mockMembershipQueries({ isCommissioner: false, hasTeam: true });

      const result = await LeagueMembershipService.verifyMembership('league-1', 'user-1');
      expect(result).toBe(true);
    });

    it('returns false for a non-member', async () => {
      mockGetLeague.mockResolvedValue({ data: { commissioner_id: 'other-user' } });
      mockGetTeams.mockResolvedValue({ data: [{ id: 'team-other', owner_id: 'other-user' }] });

      const result = await LeagueMembershipService.verifyMembership('league-1', 'user-1');
      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // requireMembership
  // ---------------------------------------------------------------------------
  describe('requireMembership', () => {
    it('does not throw for a valid member', async () => {
      mockMembershipQueries({ isCommissioner: false, hasTeam: true });

      await expect(
        LeagueMembershipService.requireMembership('league-1', 'user-1')
      ).resolves.toBeUndefined();
    });

    it('throws Access denied for a non-member', async () => {
      mockGetLeague.mockResolvedValue({ data: { commissioner_id: 'other-user' } });
      mockGetTeams.mockResolvedValue({ data: [{ id: 'team-other', owner_id: 'other-user' }] });

      await expect(
        LeagueMembershipService.requireMembership('league-1', 'user-1')
      ).rejects.toThrow('Access denied: You are not a member of this league');
    });
  });

  // ---------------------------------------------------------------------------
  // requireCommissioner
  // ---------------------------------------------------------------------------
  describe('requireCommissioner', () => {
    it('does not throw for the commissioner', async () => {
      mockMembershipQueries({ isCommissioner: true, hasTeam: false });

      await expect(
        LeagueMembershipService.requireCommissioner('league-1', 'user-1')
      ).resolves.toBeUndefined();
    });

    it('throws Access denied for a non-commissioner member', async () => {
      mockMembershipQueries({ isCommissioner: false, hasTeam: true });

      await expect(
        LeagueMembershipService.requireCommissioner('league-1', 'user-1')
      ).rejects.toThrow('Access denied: Only the league commissioner can perform this action');
    });
  });

  // ---------------------------------------------------------------------------
  // getUserRole
  // ---------------------------------------------------------------------------
  describe('getUserRole', () => {
    it('returns commissioner for the commissioner', async () => {
      mockMembershipQueries({ isCommissioner: true, hasTeam: true });

      const role = await LeagueMembershipService.getUserRole('league-1', 'user-1');
      expect(role).toBe('commissioner');
    });

    it('returns member for a team owner', async () => {
      mockMembershipQueries({ isCommissioner: false, hasTeam: true });

      const role = await LeagueMembershipService.getUserRole('league-1', 'user-1');
      expect(role).toBe('member');
    });

    it('returns none for a non-member', async () => {
      mockGetLeague.mockResolvedValue({ data: { commissioner_id: 'other-user' } });
      mockGetTeams.mockResolvedValue({ data: [{ id: 'team-other', owner_id: 'other-user' }] });

      const role = await LeagueMembershipService.getUserRole('league-1', 'user-1');
      expect(role).toBe('none');
    });
  });

  // ---------------------------------------------------------------------------
  // isCommissioner
  // ---------------------------------------------------------------------------
  describe('isCommissioner', () => {
    it('returns true for the commissioner', async () => {
      mockMembershipQueries({ isCommissioner: true, hasTeam: false });

      const result = await LeagueMembershipService.isCommissioner('league-1', 'user-1');
      expect(result).toBe(true);
    });

    it('returns false for a non-commissioner', async () => {
      mockMembershipQueries({ isCommissioner: false, hasTeam: true });

      const result = await LeagueMembershipService.isCommissioner('league-1', 'user-1');
      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getUserTeamId
  // ---------------------------------------------------------------------------
  describe('getUserTeamId', () => {
    it('returns team ID for a team owner', async () => {
      mockMembershipQueries({ isCommissioner: false, hasTeam: true, teamId: 'team-99' });

      const teamId = await LeagueMembershipService.getUserTeamId('league-1', 'user-1');
      expect(teamId).toBe('team-99');
    });

    it('returns null for a user without a team', async () => {
      mockMembershipQueries({ isCommissioner: true, hasTeam: false });

      const teamId = await LeagueMembershipService.getUserTeamId('league-1', 'user-1');
      expect(teamId).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // clearMembershipCache
  // ---------------------------------------------------------------------------
  describe('clearMembershipCache', () => {
    it('clears cache for a specific user/league so next call hits API', async () => {
      mockMembershipQueries({ isCommissioner: false, hasTeam: true });

      // Populate cache
      await LeagueMembershipService.checkMembership('league-1', 'user-1');
      const callCount1 = mockGetLeague.mock.calls.length;

      // Clear cache
      clearMembershipCache('league-1', 'user-1');

      // Next call should hit API again
      await LeagueMembershipService.checkMembership('league-1', 'user-1');
      const callCount2 = mockGetLeague.mock.calls.length;

      expect(callCount2).toBeGreaterThan(callCount1);
    });
  });
});

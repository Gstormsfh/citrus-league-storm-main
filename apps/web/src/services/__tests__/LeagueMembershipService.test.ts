import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '@/integrations/supabase/client';

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
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  return chain;
}

let mockChain = createChainableMock();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => mockChain),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'mock-token' } } }),
    },
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
  mockChain = createChainableMock();

  const mod = await import('../LeagueMembershipService');
  LeagueMembershipService = mod.LeagueMembershipService;
  clearMembershipCache = mod.clearMembershipCache;

  // Always clear cache before each test to avoid stale results
  clearMembershipCache();

  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);
});

// =============================================================================
// Helpers
// =============================================================================

/**
 * Set up from() mock to return different chains for leagues and teams tables.
 */
function mockMembershipQueries(options: {
  isCommissioner: boolean;
  hasTeam: boolean;
  teamId?: string;
}) {
  // supabase is imported at module level (mocked via vi.mock)

  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    const chain = createChainableMock();

    if (table === 'leagues') {
      chain.single.mockResolvedValue({
        data: options.isCommissioner
          ? { commissioner_id: 'user-1' }
          : { commissioner_id: 'other-user' },
        error: null,
      });
    } else if (table === 'teams') {
      chain.maybeSingle.mockResolvedValue({
        data: options.hasTeam
          ? { id: options.teamId || 'team-1' }
          : null,
        error: null,
      });
    }

    return chain;
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
      mockMembershipQueries({ isCommissioner: false, hasTeam: false });

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
      // supabase is imported at module level (mocked via vi.mock)

      (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Unexpected database failure');
      });

      const result = await LeagueMembershipService.checkMembership('league-1', 'user-1');

      expect(result.isMember).toBe(false);
      expect(result.isCommissioner).toBe(false);
    });

    it('uses cached result on second call within TTL', async () => {
      mockMembershipQueries({ isCommissioner: false, hasTeam: true });

      // supabase is imported at module level (mocked via vi.mock)

      const result1 = await LeagueMembershipService.checkMembership('league-1', 'user-1');
      expect(result1.isMember).toBe(true);

      // Second call should use cache
      const callCountBefore = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.length;
      const result2 = await LeagueMembershipService.checkMembership('league-1', 'user-1');
      const callCountAfter = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.length;

      expect(result2.isMember).toBe(true);
      expect(callCountAfter).toBe(callCountBefore); // No additional DB calls
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
      mockMembershipQueries({ isCommissioner: false, hasTeam: false });

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
      mockMembershipQueries({ isCommissioner: false, hasTeam: false });

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
      mockMembershipQueries({ isCommissioner: false, hasTeam: false });

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
    it('clears cache for a specific user/league so next call hits DB', async () => {
      mockMembershipQueries({ isCommissioner: false, hasTeam: true });

      // supabase is imported at module level (mocked via vi.mock)

      // Populate cache
      await LeagueMembershipService.checkMembership('league-1', 'user-1');
      const callCount1 = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.length;

      // Clear cache
      clearMembershipCache('league-1', 'user-1');

      // Next call should hit DB again
      await LeagueMembershipService.checkMembership('league-1', 'user-1');
      const callCount2 = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.length;

      expect(callCount2).toBeGreaterThan(callCount1);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeagueMembershipService } from '../services/LeagueMembershipService';
import { createChain, createMockSupabase } from './helpers';

describe('LeagueMembershipService', () => {
  let service: LeagueMembershipService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    service = new LeagueMembershipService(mockSupabase);
    // Clear cache between tests
    LeagueMembershipService.clearCache();
  });

  describe('checkMembership', () => {
    it('returns isMember=true and isCommissioner=true for commissioner', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'user-1' }, error: null });
        if (callCount === 2) return createChain({ data: { id: 'team-1' }, error: null });
        return createChain();
      });

      const result = await service.checkMembership('league-1', 'user-1');

      expect(result.isMember).toBe(true);
      expect(result.isCommissioner).toBe(true);
      expect(result.teamId).toBe('team-1');
    });

    it('returns isMember=true for team owner who is not commissioner', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'other-user' }, error: null });
        if (callCount === 2) return createChain({ data: { id: 'team-2' }, error: null });
        return createChain();
      });

      const result = await service.checkMembership('league-1', 'user-2');

      expect(result.isMember).toBe(true);
      expect(result.isCommissioner).toBe(false);
      expect(result.teamId).toBe('team-2');
    });

    it('returns isMember=false for non-member', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'other-user' }, error: null });
        if (callCount === 2) return createChain({ data: null, error: null });
        return createChain();
      });

      const result = await service.checkMembership('league-1', 'outsider');

      expect(result.isMember).toBe(false);
      expect(result.isCommissioner).toBe(false);
      expect(result.teamId).toBeUndefined();
    });

    it('throws on invalid userId', async () => {
      await expect(service.checkMembership('league-1', '')).rejects.toThrow('SECURITY ERROR');
      await expect(service.checkMembership('league-1', 'undefined')).rejects.toThrow('SECURITY ERROR');
    });

    it('caches results for subsequent calls', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'user-1' }, error: null });
        if (callCount === 2) return createChain({ data: { id: 'team-1' }, error: null });
        return createChain();
      });

      // First call hits DB
      const result1 = await service.checkMembership('league-1', 'user-1');
      // Second call should use cache
      const result2 = await service.checkMembership('league-1', 'user-1');

      expect(result1).toEqual(result2);
      // from() should only be called twice (for the first check), not four times
      expect(mockSupabase.from).toHaveBeenCalledTimes(2);
    });

    it('fails closed on unexpected error', async () => {
      mockSupabase.from = vi.fn(() => {
        throw new Error('Unexpected DB crash');
      });

      const result = await service.checkMembership('league-1', 'user-1');

      expect(result.isMember).toBe(false);
      expect(result.isCommissioner).toBe(false);
    });

    it('handles league query error gracefully (non-PGRST116)', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: null, error: { code: '42P01', message: 'Table not found' } });
        if (callCount === 2) return createChain({ data: { id: 'team-1' }, error: null });
        return createChain();
      });

      const result = await service.checkMembership('league-1', 'user-1');

      // Not commissioner (since league query failed), but still a member via team
      expect(result.isMember).toBe(true);
      expect(result.isCommissioner).toBe(false);
    });

    it('commissioner without a team is still a member', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'user-1' }, error: null });
        if (callCount === 2) return createChain({ data: null, error: null }); // no team
        return createChain();
      });

      const result = await service.checkMembership('league-1', 'user-1');

      expect(result.isMember).toBe(true);
      expect(result.isCommissioner).toBe(true);
    });
  });

  describe('verifyMembership', () => {
    it('returns true for members', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'other' }, error: null });
        if (callCount === 2) return createChain({ data: { id: 'team-1' }, error: null });
        return createChain();
      });

      const isMember = await service.verifyMembership('league-1', 'user-1');

      expect(isMember).toBe(true);
    });

    it('returns false for non-members', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'other' }, error: null });
        if (callCount === 2) return createChain({ data: null, error: null });
        return createChain();
      });

      const isMember = await service.verifyMembership('league-1', 'user-1');

      expect(isMember).toBe(false);
    });
  });

  describe('requireMembership', () => {
    it('does not throw for members', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'user-1' }, error: null });
        if (callCount === 2) return createChain({ data: { id: 'team-1' }, error: null });
        return createChain();
      });

      await expect(service.requireMembership('league-1', 'user-1')).resolves.toBeUndefined();
    });

    it('throws for non-members', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'other' }, error: null });
        if (callCount === 2) return createChain({ data: null, error: null });
        return createChain();
      });

      await expect(service.requireMembership('league-1', 'user-1')).rejects.toThrow('Access denied');
    });
  });

  describe('requireCommissioner', () => {
    it('does not throw for commissioner', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'user-1' }, error: null });
        if (callCount === 2) return createChain({ data: { id: 'team-1' }, error: null });
        return createChain();
      });

      await expect(service.requireCommissioner('league-1', 'user-1')).resolves.toBeUndefined();
    });

    it('throws for non-commissioner member', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'other' }, error: null });
        if (callCount === 2) return createChain({ data: { id: 'team-1' }, error: null });
        return createChain();
      });

      await expect(service.requireCommissioner('league-1', 'user-1')).rejects.toThrow('Commissioner privileges required');
    });
  });

  describe('isCommissioner', () => {
    it('returns true for commissioner', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'user-1' }, error: null });
        if (callCount === 2) return createChain({ data: null, error: null });
        return createChain();
      });

      const result = await service.isCommissioner('league-1', 'user-1');

      expect(result).toBe(true);
    });

    it('returns false for non-commissioner', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'other' }, error: null });
        if (callCount === 2) return createChain({ data: null, error: null });
        return createChain();
      });

      const result = await service.isCommissioner('league-1', 'user-1');

      expect(result).toBe(false);
    });
  });

  describe('getUserTeamId', () => {
    it('returns team ID for member', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'other' }, error: null });
        if (callCount === 2) return createChain({ data: { id: 'team-1' }, error: null });
        return createChain();
      });

      const teamId = await service.getUserTeamId('league-1', 'user-1');

      expect(teamId).toBe('team-1');
    });

    it('returns null for non-member', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) return createChain({ data: { commissioner_id: 'other' }, error: null });
        if (callCount === 2) return createChain({ data: null, error: null });
        return createChain();
      });

      const teamId = await service.getUserTeamId('league-1', 'user-1');

      expect(teamId).toBeNull();
    });
  });

  describe('clearCache', () => {
    it('clears specific cache entry', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount <= 2) {
          if (callCount === 1) return createChain({ data: { commissioner_id: 'user-1' }, error: null });
          return createChain({ data: { id: 'team-1' }, error: null });
        }
        // After cache clear, should hit DB again
        if (callCount === 3) return createChain({ data: { commissioner_id: 'user-1' }, error: null });
        return createChain({ data: { id: 'team-1' }, error: null });
      });

      await service.checkMembership('league-1', 'user-1');
      expect(mockSupabase.from).toHaveBeenCalledTimes(2);

      LeagueMembershipService.clearCache('league-1', 'user-1');

      await service.checkMembership('league-1', 'user-1');
      expect(mockSupabase.from).toHaveBeenCalledTimes(4); // Two more DB calls
    });

    it('clears entire cache when no args', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount % 2 === 1) return createChain({ data: { commissioner_id: 'user-1' }, error: null });
        return createChain({ data: { id: 'team-1' }, error: null });
      });

      await service.checkMembership('league-1', 'user-1');
      expect(mockSupabase.from).toHaveBeenCalledTimes(2);

      LeagueMembershipService.clearCache();

      await service.checkMembership('league-1', 'user-1');
      expect(mockSupabase.from).toHaveBeenCalledTimes(4);
    });
  });
});

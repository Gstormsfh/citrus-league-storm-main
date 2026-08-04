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
      // F14(a) (2026-08-03): teamId removed from cached result.
      // Cache holds boolean membership only; identity resolved via
      // getUserTeamIdFresh (tested below).
      expect((result as { teamId?: string }).teamId).toBeUndefined();
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
      // F14(a) (2026-08-03): teamId removed from cache.
      expect((result as { teamId?: string }).teamId).toBeUndefined();
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
      // F14(a) (2026-08-03): teamId no longer on the cached result.
      expect((result as { teamId?: string }).teamId).toBeUndefined();
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

  // F14(a) (2026-08-03): `getUserTeamId` deleted (was cached-lookup
  // helper for the removed `.teamId` field). Replaced with
  // `getUserTeamIdFresh` — always a direct DB query, never cached.
  // Name carries the contract; if someone later adds caching inside,
  // the name becomes a lie a reviewer can catch. See below.
  describe('getUserTeamIdFresh', () => {
    it('returns team ID via fresh DB query (bypasses cache)', async () => {
      mockSupabase.from = vi.fn(() =>
        createChain({ data: { id: 'team-1' }, error: null }),
      );

      const teamId = await service.getUserTeamIdFresh('league-1', 'user-1');
      expect(teamId).toBe('team-1');
      // Single query — no cache read + no commissioner check.
      expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    });

    it('returns null when user does not own a team in the league', async () => {
      mockSupabase.from = vi.fn(() => createChain({ data: null, error: null }));
      const teamId = await service.getUserTeamIdFresh('league-1', 'user-1');
      expect(teamId).toBeNull();
    });

    it('throws on invalid userId (matches checkMembership guard)', async () => {
      await expect(service.getUserTeamIdFresh('league-1', '')).rejects.toThrow(
        'SECURITY ERROR',
      );
      await expect(
        service.getUserTeamIdFresh('league-1', 'undefined'),
      ).rejects.toThrow('SECURITY ERROR');
    });

    // F14 EXACT REPRO (method-level): prime cache with stale
    // membership, rewrite owner_id in DB, call getUserTeamIdFresh
    // WITHIN the 30s TTL — the fresh method must return the NEW
    // value regardless of the cache. Route-level version of the
    // same repro lives in draftRoutes.f14.test.ts (Amendment 2).
    it('F14 REPRO (method-level): returns fresh teamId even when membership cache is warm with stale value', async () => {
      // Prime the cache with a checkMembership call (isMember=true).
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1)
          return createChain({ data: { commissioner_id: 'other' }, error: null });
        if (callCount === 2)
          return createChain({ data: { id: 'old-team-uuid' }, error: null });
        // After priming, subsequent teams queries return the NEW value.
        return createChain({ data: { id: 'new-team-uuid' }, error: null });
      });
      await service.checkMembership('league-1', 'user-1');
      expect(callCount).toBe(2); // 2 queries: leagues + teams

      // Simulated ownership rewrite happens externally (DB direct or
      // DB-side RPC — either bypasses this cache). Now call the
      // fresh resolver.
      const teamId = await service.getUserTeamIdFresh('league-1', 'user-1');
      expect(teamId).toBe('new-team-uuid');
      // Extra call proves the fresh method went to DB, not cache.
      expect(callCount).toBe(3);
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

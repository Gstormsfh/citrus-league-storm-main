import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '@/integrations/supabase/client';

// =============================================================================
// Mock Supabase client
// =============================================================================

/**
 * Create a chainable mock that supports Supabase's thenable pattern.
 * Set chain._setResult to control what `await chain` resolves to.
 */
function createChainableMock(defaultResult: Record<string, any> = { data: null, error: null }) {
  let _result = defaultResult;
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
  // Thenable: allows `await chain` to resolve
  chain.then = vi.fn((resolve: (v: any) => void) => resolve(_result));
  chain._setResult = (result: Record<string, any>) => { _result = result; };
  return chain;
}

let mockChain = createChainableMock();

const mockGetUser = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => mockChain),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
    auth: {
      getUser: (...args: any[]) => mockGetUser(...args),
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
// Import NotificationService AFTER mocks are registered
// =============================================================================

let NotificationService: typeof import('../NotificationService').NotificationService;

beforeEach(async () => {
  vi.clearAllMocks();
  mockChain = createChainableMock();

  // Default: authenticated user
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });

  const mod = await import('../NotificationService');
  NotificationService = mod.NotificationService;

  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(mockChain);

  // Re-establish channel mock after clearAllMocks
  (supabase.channel as ReturnType<typeof vi.fn>).mockReturnValue({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn(),
  });
});

// =============================================================================
// Helper to mock league membership verification
// =============================================================================

function mockMembershipAsValid() {
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    const chain = createChainableMock();

    if (table === 'teams') {
      chain._setResult({ data: [{ id: 'team-1' }], error: null });
    } else if (table === 'leagues') {
      chain._setResult({ data: [], error: null });
    } else if (table === 'notifications') {
      return mockChain;
    }

    return chain;
  });
}

function mockMembershipAsInvalid() {
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    const chain = createChainableMock();

    if (table === 'teams') {
      chain._setResult({ data: [], error: null });
    } else if (table === 'leagues') {
      chain._setResult({ data: [], error: null });
    } else if (table === 'notifications') {
      return mockChain;
    }

    return chain;
  });
}

// =============================================================================
// Tests
// =============================================================================

describe('NotificationService', () => {
  // ---------------------------------------------------------------------------
  // verifyAuth
  // ---------------------------------------------------------------------------
  describe('verifyAuth', () => {
    it('returns userId when authenticated', async () => {
      const result = await NotificationService.verifyAuth();
      expect(result.userId).toBe('user-1');
      expect(result.error).toBeNull();
    });

    it('returns error when not authenticated', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: new Error('Not authenticated'),
      });

      const result = await NotificationService.verifyAuth();
      expect(result.userId).toBeNull();
      expect(result.error).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // verifyLeagueMembership
  // ---------------------------------------------------------------------------
  describe('verifyLeagueMembership', () => {
    it('returns isMember=true when user owns a team in the league', async () => {
      (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
        const chain = createChainableMock();
        if (table === 'teams') {
          chain._setResult({ data: [{ id: 'team-1' }], error: null });
        } else if (table === 'leagues') {
          chain._setResult({ data: [], error: null });
        }
        return chain;
      });

      const result = await NotificationService.verifyLeagueMembership('league-1', 'user-1');

      expect(result.isMember).toBe(true);
      expect(result.error).toBeNull();
    });

    it('returns isMember=false when user has no team and is not commissioner', async () => {
      (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
        const chain = createChainableMock();
        if (table === 'teams') {
          chain._setResult({ data: [], error: null });
        } else if (table === 'leagues') {
          chain._setResult({ data: [], error: null });
        }
        return chain;
      });

      const result = await NotificationService.verifyLeagueMembership('league-1', 'user-1');

      expect(result.isMember).toBe(false);
      expect(result.error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getNotifications
  // ---------------------------------------------------------------------------
  describe('getNotifications', () => {
    it('returns notifications for an authenticated league member', async () => {
      const mockNotifications = [
        {
          id: 'notif-1',
          league_id: 'league-1',
          user_id: 'user-1',
          type: 'TRADE',
          title: 'Trade Offer',
          message: 'You received a trade offer',
          metadata: {},
          read_status: false,
          created_at: '2026-01-15T00:00:00Z',
          read_at: null,
        },
      ];

      mockMembershipAsValid();
      mockChain._setResult({ data: mockNotifications, error: null });

      const result = await NotificationService.getNotifications('league-1', 'user-1');

      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(1);
      expect(result.data![0].title).toBe('Trade Offer');
    });

    it('returns auth error when user is not authenticated', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: new Error('Not authenticated'),
      });

      const result = await NotificationService.getNotifications('league-1', 'user-1');

      expect(result.data).toBeNull();
      expect(result.error).toEqual(
        expect.objectContaining({ code: 401 })
      );
    });

    it('returns 403 when userId does not match authenticated user', async () => {
      const result = await NotificationService.getNotifications('league-1', 'wrong-user');

      expect(result.data).toBeNull();
      expect(result.error).toEqual(
        expect.objectContaining({ code: 403 })
      );
    });

    it('returns 403 when user is not a league member', async () => {
      mockMembershipAsInvalid();

      const result = await NotificationService.getNotifications('league-1', 'user-1');

      expect(result.data).toBeNull();
      expect(result.error).toEqual(
        expect.objectContaining({ code: 403 })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // markAsRead
  // ---------------------------------------------------------------------------
  describe('markAsRead', () => {
    it('marks a notification as read successfully', async () => {
      let callIndex = 0;

      (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callIndex++;
        const chain = createChainableMock();
        if (callIndex === 1) {
          // Notification ownership check — uses .single() terminal
          chain.single.mockResolvedValue({
            data: { user_id: 'user-1' },
            error: null,
          });
        } else {
          // Update call — .update().eq().eq() is awaited via thenable
          chain._setResult({ data: null, error: null });
        }
        return chain;
      });

      const result = await NotificationService.markAsRead('notif-1', 'user-1');

      expect(result.data).toBe(true);
      expect(result.error).toBeNull();
    });

    it('returns auth error when user is not authenticated', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: new Error('Not authenticated'),
      });

      const result = await NotificationService.markAsRead('notif-1', 'user-1');

      expect(result.data).toBeNull();
      expect(result.error).toEqual(
        expect.objectContaining({ code: 401 })
      );
    });

    it('returns 403 when userId does not match authenticated user', async () => {
      const result = await NotificationService.markAsRead('notif-1', 'wrong-user');

      expect(result.data).toBeNull();
      expect(result.error).toEqual(
        expect.objectContaining({ code: 403 })
      );
    });

    it('returns 404 when notification is not found', async () => {
      mockChain.single.mockResolvedValue({
        data: null,
        error: { message: 'Not found', code: 'PGRST116' },
      });

      const result = await NotificationService.markAsRead('notif-unknown', 'user-1');

      expect(result.data).toBeNull();
      expect(result.error).toEqual(
        expect.objectContaining({ code: 404 })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getUnreadCount
  // ---------------------------------------------------------------------------
  describe('getUnreadCount', () => {
    it('returns unread notification count', async () => {
      mockMembershipAsValid();

      // The notifications query uses select('*', { count: 'exact', head: true })
      // followed by .eq().eq().eq() chain that is awaited via thenable
      mockChain._setResult({ count: 5, error: null });

      const result = await NotificationService.getUnreadCount('league-1', 'user-1');

      expect(result.error).toBeNull();
      expect(result.data).toBe(5);
    });

    it('returns auth error when not authenticated', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: new Error('Not authenticated'),
      });

      const result = await NotificationService.getUnreadCount('league-1', 'user-1');

      expect(result.data).toBeNull();
      expect(result.error).toEqual(
        expect.objectContaining({ code: 401 })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // subscribeToNotifications
  // ---------------------------------------------------------------------------
  describe('subscribeToNotifications', () => {
    it('returns an unsubscribe function', async () => {
      const mockChannelObj: Record<string, any> = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(),
      };
      mockChannelObj.subscribe.mockReturnValue(mockChannelObj);
      (supabase.channel as ReturnType<typeof vi.fn>).mockReturnValue(mockChannelObj);

      const callback = vi.fn();
      const unsubscribe = NotificationService.subscribeToNotifications(
        'league-1',
        'user-1',
        callback
      );

      expect(typeof unsubscribe).toBe('function');
      expect(supabase.channel).toHaveBeenCalledWith('notifications:league-1:user-1');
      expect(mockChannelObj.on).toHaveBeenCalledWith(
        'postgres_changes',
        expect.objectContaining({
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
        }),
        expect.any(Function)
      );

      // Test unsubscribe calls removeChannel
      unsubscribe();
      expect(supabase.removeChannel).toHaveBeenCalledWith(mockChannelObj);
    });
  });
});

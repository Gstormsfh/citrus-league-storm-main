import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock API client modules
// =============================================================================

const mockGetNotifications = vi.fn();
const mockGetUnreadCount = vi.fn();
const mockMarkAsRead = vi.fn();
const mockMarkAllAsRead = vi.fn();

vi.mock('@/api/notifications', () => ({
  notificationApi: {
    getNotifications: (...args: unknown[]) => mockGetNotifications(...args),
    getUnreadCount: (...args: unknown[]) => mockGetUnreadCount(...args),
    markAsRead: (...args: unknown[]) => mockMarkAsRead(...args),
    markAllAsRead: (...args: unknown[]) => mockMarkAllAsRead(...args),
  },
}));

// Supabase is still used for realtime subscriptions
const mockChannel = vi.fn();
const mockRemoveChannel = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    channel: (...args: unknown[]) => mockChannel(...args),
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
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

  const mod = await import('../NotificationService');
  NotificationService = mod.NotificationService;

  // Re-establish channel mock after clearAllMocks
  const mockChannelObj: Record<string, any> = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn(),
  };
  mockChannelObj.subscribe.mockReturnValue(mockChannelObj);
  mockChannel.mockReturnValue(mockChannelObj);
});

// =============================================================================
// Tests
// =============================================================================

describe('NotificationService', () => {
  // ---------------------------------------------------------------------------
  // getNotifications
  // ---------------------------------------------------------------------------
  describe('getNotifications', () => {
    it('returns notifications from API for a league', async () => {
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

      mockGetNotifications.mockResolvedValue({ data: mockNotifications });

      const result = await NotificationService.getNotifications('league-1', 'user-1');

      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(1);
      expect(result.data![0].title).toBe('Trade Offer');
      expect(mockGetNotifications).toHaveBeenCalledWith({ leagueId: 'league-1' });
    });

    it('returns empty array when API returns no data', async () => {
      mockGetNotifications.mockResolvedValue({ data: null });

      const result = await NotificationService.getNotifications('league-1', 'user-1');

      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    });

    it('returns error when API call fails', async () => {
      mockGetNotifications.mockRejectedValue(new Error('Network error'));

      const result = await NotificationService.getNotifications('league-1', 'user-1');

      expect(result.data).toBeNull();
      expect(result.error).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // getUnreadCount
  // ---------------------------------------------------------------------------
  describe('getUnreadCount', () => {
    it('returns unread notification count from API', async () => {
      mockGetUnreadCount.mockResolvedValue({ data: 5 });

      const result = await NotificationService.getUnreadCount('league-1', 'user-1');

      expect(result.error).toBeNull();
      expect(result.data).toBe(5);
      expect(mockGetUnreadCount).toHaveBeenCalledWith('league-1');
    });

    it('returns 0 when API returns no data', async () => {
      mockGetUnreadCount.mockResolvedValue({ data: null });

      const result = await NotificationService.getUnreadCount('league-1', 'user-1');

      expect(result.error).toBeNull();
      expect(result.data).toBe(0);
    });

    it('returns error when API call fails', async () => {
      mockGetUnreadCount.mockRejectedValue(new Error('Network error'));

      const result = await NotificationService.getUnreadCount('league-1', 'user-1');

      expect(result.data).toBeNull();
      expect(result.error).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // markAsRead
  // ---------------------------------------------------------------------------
  describe('markAsRead', () => {
    it('marks a notification as read successfully', async () => {
      mockMarkAsRead.mockResolvedValue({ data: true });

      const result = await NotificationService.markAsRead('notif-1', 'user-1');

      expect(result.data).toBe(true);
      expect(result.error).toBeNull();
      expect(mockMarkAsRead).toHaveBeenCalledWith('notif-1');
    });

    it('returns error when API call fails', async () => {
      mockMarkAsRead.mockRejectedValue(new Error('Network error'));

      const result = await NotificationService.markAsRead('notif-1', 'user-1');

      expect(result.data).toBeNull();
      expect(result.error).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // markAllAsRead
  // ---------------------------------------------------------------------------
  describe('markAllAsRead', () => {
    it('marks all notifications as read for a league', async () => {
      mockMarkAllAsRead.mockResolvedValue({ data: 3 });

      const result = await NotificationService.markAllAsRead('league-1', 'user-1');

      expect(result.data).toBe(3);
      expect(result.error).toBeNull();
      expect(mockMarkAllAsRead).toHaveBeenCalledWith('league-1');
    });

    it('returns 0 when API returns no data', async () => {
      mockMarkAllAsRead.mockResolvedValue({ data: null });

      const result = await NotificationService.markAllAsRead('league-1', 'user-1');

      expect(result.error).toBeNull();
      expect(result.data).toBe(0);
    });

    it('returns error when API call fails', async () => {
      mockMarkAllAsRead.mockRejectedValue(new Error('Network error'));

      const result = await NotificationService.markAllAsRead('league-1', 'user-1');

      expect(result.data).toBeNull();
      expect(result.error).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // subscribeToNotifications (still uses Supabase realtime directly)
  // ---------------------------------------------------------------------------
  describe('subscribeToNotifications', () => {
    // Helper: wire up a fresh channel mock that captures the handler and the
    // filter config passed to `.on(...)`, and return the spies so each test
    // can assert on them independently.
    function setupChannelMock() {
      const mockChannelObj: Record<string, any> = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(),
      };
      mockChannelObj.subscribe.mockReturnValue(mockChannelObj);
      mockChannel.mockReturnValue(mockChannelObj);
      return mockChannelObj;
    }

    it('returns an unsubscribe function', () => {
      const mockChannelObj = setupChannelMock();

      const callback = vi.fn();
      const unsubscribe = NotificationService.subscribeToNotifications(
        'league-1',
        'user-1',
        callback
      );

      expect(typeof unsubscribe).toBe('function');
      expect(mockChannel).toHaveBeenCalledWith('notifications:league-1:user-1');
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
      expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannelObj);
    });

    // -------------------------------------------------------------------------
    // Regression: April 10 2026 live draft disaster, postmortem §1.
    // The old filter `league_id=eq.X,user_id=eq.Y` was not an AND — Supabase
    // Realtime parses that as a single malformed predicate and silently
    // degrades the subscription to "every row the JWT can SELECT", which
    // leaked notifications across leagues. The filter must scope by a single
    // predicate and the league check must happen client-side in the callback.
    // See docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md.
    // -------------------------------------------------------------------------
    it('passes a single-predicate filter with no comma (postmortem §1 regression)', () => {
      const mockChannelObj = setupChannelMock();

      NotificationService.subscribeToNotifications('league-1', 'user-1', vi.fn());

      expect(mockChannelObj.on).toHaveBeenCalledTimes(1);
      const config = mockChannelObj.on.mock.calls[0][1] as { filter: string };
      expect(config.filter).toBeDefined();
      // A literal comma in a postgres_changes filter is the exact bug we
      // are regressing against. Never ship one.
      expect(config.filter).not.toContain(',');
      // The single predicate must scope to the user, not the league (the
      // league check moves into the callback).
      expect(config.filter).toBe('user_id=eq.user-1');
    });

    it('does NOT forward notifications from a different league (postmortem §1 regression)', () => {
      const mockChannelObj = setupChannelMock();
      const callback = vi.fn();

      NotificationService.subscribeToNotifications('league-1', 'user-1', callback);

      // Grab the handler the service registered with the channel
      const handler = mockChannelObj.on.mock.calls[0][2] as (
        payload: { eventType: string; new: Record<string, unknown> }
      ) => void;

      // Simulate a realtime INSERT event for user-1 but in a DIFFERENT league.
      // Pre-fix: this leaked to the callback. Post-fix: it must be dropped.
      handler({
        eventType: 'INSERT',
        new: {
          id: 'notif-leak',
          league_id: 'league-2',
          user_id: 'user-1',
          type: 'TRADE',
          title: 'Leak attempt',
          message: 'You should never see this',
          metadata: {},
          read_status: false,
          created_at: '2026-04-10T20:00:00Z',
          read_at: null,
        },
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('DOES forward notifications from the same league', () => {
      const mockChannelObj = setupChannelMock();
      const callback = vi.fn();

      NotificationService.subscribeToNotifications('league-1', 'user-1', callback);

      const handler = mockChannelObj.on.mock.calls[0][2] as (
        payload: { eventType: string; new: Record<string, unknown> }
      ) => void;

      const notification = {
        id: 'notif-legit',
        league_id: 'league-1',
        user_id: 'user-1',
        type: 'TRADE',
        title: 'Trade offer',
        message: 'You received a trade offer',
        metadata: {},
        read_status: false,
        created_at: '2026-04-10T20:00:00Z',
        read_at: null,
      };

      handler({ eventType: 'INSERT', new: notification });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(notification);
    });
  });
});

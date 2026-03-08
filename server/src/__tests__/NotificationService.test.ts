import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from '../services/NotificationService';
import { createChain, createMockSupabase } from './helpers';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    service = new NotificationService(mockSupabase);
  });

  describe('getNotifications', () => {
    it('returns notifications for a user', async () => {
      const notifications = [
        { id: 'n1', title: 'Trade Offer', read: false },
        { id: 'n2', title: 'Draft Started', read: true },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: notifications, error: null }));

      const result = await service.getNotifications('user-1');
      expect(result.notifications).toEqual(notifications);
    });

    it('filters unread only when specified', async () => {
      const chain = createChain({ data: [], error: null });
      mockSupabase.from = vi.fn(() => chain);

      await service.getNotifications('user-1', { unreadOnly: true });
      expect(chain.eq).toHaveBeenCalledWith('read', false);
    });

    it('respects custom limit', async () => {
      const chain = createChain({ data: [], error: null });
      mockSupabase.from = vi.fn(() => chain);

      await service.getNotifications('user-1', { limit: 10 });
      expect(chain.limit).toHaveBeenCalledWith(10);
    });
  });

  describe('getUnreadCount', () => {
    it('returns count of unread notifications', async () => {
      const chain = createChain({ count: 5, error: null });
      mockSupabase.from = vi.fn(() => chain);

      const result = await service.getUnreadCount('user-1');
      expect(result.count).toBe(5);
    });

    it('filters by league when provided', async () => {
      const chain = createChain({ count: 2, error: null });
      mockSupabase.from = vi.fn(() => chain);

      await service.getUnreadCount('user-1', 'league-1');
      expect(chain.eq).toHaveBeenCalledWith('league_id', 'league-1');
    });
  });

  describe('markAsRead', () => {
    it('marks a single notification as read', async () => {
      const chain = createChain({ error: null });
      mockSupabase.from = vi.fn(() => chain);

      const result = await service.markAsRead('notif-1', 'user-1');
      expect(result.success).toBe(true);
    });

    it('returns error on failure', async () => {
      const chain = createChain({ error: { message: 'Not found' } });
      mockSupabase.from = vi.fn(() => chain);

      const result = await service.markAsRead('notif-1', 'user-1');
      expect(result.success).toBe(false);
    });
  });

  describe('markAllAsRead', () => {
    it('marks all unread notifications as read', async () => {
      const chain = createChain({ error: null });
      mockSupabase.from = vi.fn(() => chain);

      const result = await service.markAllAsRead('user-1');
      expect(result.success).toBe(true);
    });

    it('scopes to league when provided', async () => {
      const chain = createChain({ error: null });
      mockSupabase.from = vi.fn(() => chain);

      await service.markAllAsRead('user-1', 'league-1');
      expect(chain.eq).toHaveBeenCalledWith('league_id', 'league-1');
    });
  });
});

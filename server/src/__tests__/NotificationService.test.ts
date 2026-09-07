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
        { id: 'n1', title: 'Trade Offer', read_status: false },
        { id: 'n2', title: 'Draft Started', read_status: true },
      ];
      mockSupabase.from = vi.fn(() => createChain({ data: notifications, error: null }));

      const result = await service.getNotifications('user-1');
      expect(result.notifications).toEqual(notifications);
    });

    it('filters unread only when specified', async () => {
      const chain = createChain({ data: [], error: null });
      mockSupabase.from = vi.fn(() => chain);

      await service.getNotifications('user-1', { unreadOnly: true });
      expect(chain.eq).toHaveBeenCalledWith('read_status', false);
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

describe('NotificationService moderation', () => {
  const user = 'viewer';
  function fixture(sender = 'sender', error: { code: string } | null = null) {
    const notifications = createChain({ data: { id: 'message', metadata: { sender_id: sender }, league_id: 'league' }, error: null });
    const writes = createChain({ data: [], error });
    const client = createMockSupabase({ notifications, content_reports: writes, user_blocks: writes });
    return { service: new NotificationService(client), client, notifications, writes };
  }
  it('reports only a chat delivered to the authenticated user and derives the sender', async () => {
    const f = fixture();
    expect((await f.service.reportMessage(user, 'message', 'Concern')).success).toBe(true);
    expect(f.notifications.eq).toHaveBeenCalledWith('user_id', user);
    expect(f.notifications.eq).toHaveBeenCalledWith('type', 'CHAT');
    expect(f.writes.insert).toHaveBeenCalledWith({ reporter_id: user, reported_user_id: 'sender', notification_id: 'message', reason: 'Concern' });
  });
  it('refuses unavailable messages without writing a report', async () => {
    const f = fixture();
    f.notifications.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await f.service.reportMessage(user, 'message', 'Concern')).success).toBe(false);
    expect(f.writes.insert).not.toHaveBeenCalled();
  });
  it('treats repeated reports as successful but surfaces database failures', async () => {
    expect((await fixture('sender', { code: '23505' }).service.reportMessage(user, 'message', 'Concern')).success).toBe(true);
    expect((await fixture('sender', { code: '42501' }).service.reportMessage(user, 'message', 'Concern')).success).toBe(false);
  });
  it('blocks the actual sender and never allows a self-block', async () => {
    const f = fixture();
    expect(await f.service.blockMessageSender(user, 'message')).toMatchObject({ success: true, blockedId: 'sender' });
    expect(f.notifications.eq).toHaveBeenCalledWith('user_id', user);
    expect(f.writes.insert).toHaveBeenCalledWith({ blocker_id: user, blocked_id: 'sender' });
    expect((await fixture(user).service.blockMessageSender(user, 'message')).success).toBe(false);
    expect((await fixture('sender', { code: '42501' }).service.blockMessageSender(user, 'message')).success).toBe(false);
  });
  it('scopes block lists and unblock deletion to the authenticated owner', async () => {
    const f = fixture();
    await f.service.getBlockedUsers(user);
    expect(f.writes.eq).toHaveBeenCalledWith('blocker_id', user);
    expect((await f.service.unblockUser(user, 'sender')).success).toBe(true);
    expect(f.writes.eq).toHaveBeenCalledWith('blocked_id', 'sender');
    expect((await fixture('sender', { code: '42501' }).service.unblockUser(user, 'sender')).success).toBe(false);
  });
  it('reads the bounded oldest open review queue', async () => {
    const f = fixture();
    expect((await f.service.getContentReports()).error).toBeNull();
    expect(f.writes.eq).toHaveBeenCalledWith('status', 'open');
    expect(f.writes.order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(f.writes.limit).toHaveBeenCalledWith(100);
  });
  it('requires an explicit successful result from the secured moderation RPC', async () => {
    const f = fixture();
    expect((await f.service.moderateReport('report', 'remove')).success).toBe(false);
    f.client.rpc.mockResolvedValue({ data: { success: true }, error: null });
    expect((await f.service.moderateReport('report', 'remove')).success).toBe(true);
    expect(f.client.rpc).toHaveBeenCalledWith('moderate_content_report', { p_report_id: 'report', p_action: 'remove' });
  });
});

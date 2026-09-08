import { SupabaseClient } from '@supabase/supabase-js';
import { COLUMNS } from '@citrus/shared';

/**
 * NotificationService — Server-side notification management with DI Supabase client.
 *
 * Extracted from apps/web/src/services/NotificationService.ts.
 * Realtime subscriptions stay in the web app.
 */
export class NotificationService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async reportMessage(userId: string, notificationId: string, reason: string) {
    const { data: message, error } = await this.supabase.from('notifications')
      .select('id,metadata,league_id').eq('id', notificationId).eq('user_id', userId).eq('type', 'CHAT').maybeSingle();
    if (error || !message || typeof message.metadata?.sender_id !== 'string') {
      return { success: false, error: 'Message unavailable' };
    }
    const { error: reportError } = await this.supabase.from('content_reports').insert({
      reporter_id: userId, reported_user_id: message.metadata.sender_id,
      notification_id: notificationId, reason,
    });
    if (reportError && reportError.code !== '23505') return { success: false, error: 'Could not submit report. Please retry.' };
    return { success: true, leagueId: message.league_id };
  }

  async blockMessageSender(userId: string, notificationId: string) {
    const { data: message, error } = await this.supabase.from('notifications')
      .select('metadata,league_id').eq('id', notificationId).eq('user_id', userId).eq('type', 'CHAT').maybeSingle();
    const sender = message?.metadata?.sender_id;
    if (error || typeof sender !== 'string' || sender === userId) return { success: false, error: 'Message unavailable' };
    const { error: blockError } = await this.supabase.from('user_blocks').insert({ blocker_id: userId, blocked_id: sender });
    if (blockError && blockError.code !== '23505') return { success: false, error: 'Could not block user. Please retry.' };
    return { success: true, leagueId: message!.league_id, blockedId: sender };
  }

  async getBlockedUsers(userId: string) {
    const { data, error } = await this.supabase.from('user_blocks').select('blocked_id,created_at').eq('blocker_id', userId);
    return { data: data || [], error };
  }

  async unblockUser(userId: string, blockedId: string) {
    const { error } = await this.supabase.from('user_blocks').delete().eq('blocker_id', userId).eq('blocked_id', blockedId);
    return { success: !error, error };
  }

  /** Admin route supplies its authorized admin client for this queue read. */
  async getContentReports() {
    const { data, error } = await this.supabase.from('content_reports')
      .select('id,reason,created_at,reported_user_id,notifications(message,league_id)')
      .eq('status', 'open').order('created_at', { ascending: true }).limit(100);
    return { data: data || [], error };
  }

  async moderateReport(reportId: string, action: 'dismiss' | 'remove' | 'suspend') {
    const { data, error } = await this.supabase.rpc('moderate_content_report', { p_report_id: reportId, p_action: action });
    return { success: !error && data?.success === true, error };
  }

  /** Get notifications for a user */
  async getNotifications(userId: string, options?: { limit?: number; unreadOnly?: boolean; leagueId?: string }) {
    const limit = options?.limit || 50;

    let query = this.supabase
      .from('notifications')
      .select(COLUMNS.NOTIFICATION)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (options?.unreadOnly) {
      query = query.eq('read_status', false);
    }

    if (options?.leagueId) {
      query = query.eq('league_id', options.leagueId);
    }

    const { data, error } = await query;
    return { notifications: data || [], error };
  }

  /** Get unread notification count */
  async getUnreadCount(userId: string, leagueId?: string) {
    let query = this.supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read_status', false);

    if (leagueId) {
      query = query.eq('league_id', leagueId);
    }

    const { count, error } = await query;
    return { count: count || 0, error };
  }

  /** Mark a single notification as read */
  async markAsRead(notificationId: string, userId: string) {
    const { error } = await this.supabase
      .from('notifications')
      .update({ read_status: true, read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('user_id', userId);

    return { success: !error, error };
  }

  /** Mark all notifications as read */
  async markAllAsRead(userId: string, leagueId?: string) {
    let query = this.supabase
      .from('notifications')
      .update({ read_status: true, read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('read_status', false);

    if (leagueId) {
      query = query.eq('league_id', leagueId);
    }

    const { error } = await query;
    return { success: !error, error };
  }
}

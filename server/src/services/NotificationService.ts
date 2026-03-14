import { SupabaseClient } from '@supabase/supabase-js';

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

  /** Get notifications for a user */
  async getNotifications(userId: string, options?: { limit?: number; unreadOnly?: boolean }) {
    const limit = options?.limit || 50;

    let query = this.supabase
      .from('notifications')
      .select('id, user_id, type, title, message, read_status, league_id, metadata, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (options?.unreadOnly) {
      query = query.eq('read_status', false);
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

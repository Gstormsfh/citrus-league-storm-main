import { notificationApi } from '@/api/notifications';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';

export interface Notification {
  id: string;
  league_id: string;
  user_id: string;
  type: 'ADD' | 'DROP' | 'WAIVER' | 'TRADE' | 'CHAT' | 'SYSTEM';
  title: string;
  message: string;
  metadata: Record<string, any>;
  read_status: boolean;
  created_at: string;
  read_at: string | null;
}

export interface NotificationServiceResponse<T> {
  data: T | null;
  error: unknown;
}

/**
 * NotificationService - Handles all notification operations via API server.
 * Auth and league membership are verified server-side.
 */
export const NotificationService = {
  /**
   * Get notifications for a league
   */
  async getNotifications(
    leagueId: string,
    _userId: string
  ): Promise<NotificationServiceResponse<Notification[]>> {
    try {
      const response = await notificationApi.getNotifications({ leagueId });
      return { data: (response.data || []) as Notification[], error: null };
    } catch (error) {
      logger.error('[NotificationService] Error fetching notifications:', error);
      return { data: null, error };
    }
  },

  /**
   * Get unread notification count for a league
   */
  async getUnreadCount(
    leagueId: string,
    _userId: string
  ): Promise<NotificationServiceResponse<number>> {
    try {
      const response = await notificationApi.getUnreadCount(leagueId);
      return { data: (response.data as number) || 0, error: null };
    } catch (error) {
      logger.error('[NotificationService] Error counting unread notifications:', error);
      return { data: null, error };
    }
  },

  /**
   * Mark a notification as read
   */
  async markAsRead(
    notificationId: string,
    _userId: string
  ): Promise<NotificationServiceResponse<boolean>> {
    try {
      await notificationApi.markAsRead(notificationId);
      return { data: true, error: null };
    } catch (error) {
      logger.error('[NotificationService] Error marking notification as read:', error);
      return { data: null, error };
    }
  },

  /**
   * Mark all notifications as read for a league
   */
  async markAllAsRead(
    leagueId: string,
    _userId: string
  ): Promise<NotificationServiceResponse<number>> {
    try {
      const response = await notificationApi.markAllAsRead(leagueId);
      return { data: (response.data as number) || 0, error: null };
    } catch (error) {
      logger.error('[NotificationService] Error marking all as read:', error);
      return { data: null, error };
    }
  },

  /**
   * Subscribe to real-time notification updates.
   * Realtime subscriptions are client-side by design (not a 3-tier violation).
   *
   * NOTE: Supabase Realtime `postgres_changes` filter strings do NOT support
   * comma-separated AND. Do not write `filter: "a=eq.1,b=eq.2"` — the broker
   * parses the comma as part of the value, the filter matches nothing, and
   * the subscription silently degrades to delivering every row the JWT can
   * SELECT. That exact bug caused the April 10 2026 draft-disaster
   * cross-league notification leak (see
   * `docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md` §1). We scope the server-side
   * filter to `user_id` only and do the league check in the callback.
   */
  subscribeToNotifications(
    leagueId: string,
    userId: string,
    callback: (notification: Notification) => void
  ): () => void {
    const channel = supabase
      .channel(`notifications:${leagueId}:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType !== 'INSERT') return;
          const notification = payload.new as Notification;
          // Client-side league guard — the server filter only scopes by
          // user_id (see method-level NOTE above).
          if (notification.league_id !== leagueId) return;
          callback(notification);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
};

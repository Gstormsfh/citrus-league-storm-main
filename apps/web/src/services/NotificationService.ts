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
          filter: `league_id=eq.${leagueId},user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            callback(payload.new as Notification);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
};

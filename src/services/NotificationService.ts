import { supabase } from '@/integrations/supabase/client';

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
  error: any;
}

/**
 * NotificationService - Handles all notification operations with strict authentication
 */
export const NotificationService = {
  /**
   * Verify user is authenticated
   */
  async verifyAuth(): Promise<{ userId: string | null; error: any }> {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) {
        return { userId: null, error: new Error('Authentication required') };
      }
      return { userId: user.id, error: null };
    } catch (error) {
      return { userId: null, error };
    }
  },

  /**
   * Verify user is a member of the league
   */
  async verifyLeagueMembership(leagueId: string, userId: string): Promise<{ isMember: boolean; error: any }> {
    try {
      const { data, error } = await supabase
        .from('teams')
        .select('id')
        .eq('league_id', leagueId)
        .eq('owner_id', userId)
        .limit(1);

      if (error) {
        return { isMember: false, error };
      }

      // Also check if user is commissioner
      const { data: leagueData, error: leagueError } = await supabase
        .from('leagues')
        .select('commissioner_id')
        .eq('id', leagueId)
        .eq('commissioner_id', userId)
        .limit(1);

      if (leagueError && leagueError.code !== 'PGRST116') {
        return { isMember: false, error: leagueError };
      }

      const isMember = (data && data.length > 0) || (leagueData && leagueData.length > 0);
      return { isMember, error: null };
    } catch (error) {
      return { isMember: false, error };
    }
  },

  /**
   * Get notifications for a league (with authentication and league membership checks)
   */
  async getNotifications(
    leagueId: string,
    userId: string
  ): Promise<NotificationServiceResponse<Notification[]>> {
    try {
      // Verify authentication
      const { userId: authUserId, error: authError } = await this.verifyAuth();
      if (authError || !authUserId) {
        return { data: null, error: { message: 'Authentication required', code: 401 } };
      }

      // Verify userId matches authenticated user
      if (userId !== authUserId) {
        return { data: null, error: { message: 'Unauthorized: User ID mismatch', code: 403 } };
      }

      // Verify league membership
      const { isMember, error: membershipError } = await this.verifyLeagueMembership(leagueId, userId);
      if (membershipError) {
        return { data: null, error: { message: 'Failed to verify league membership', code: 500 } };
      }
      if (!isMember) {
        return { data: null, error: { message: 'You do not have access to this league', code: 403 } };
      }

      // Fetch notifications (RLS will filter by user_id automatically)
      const { data, error } = await supabase
        .from('notifications')
        .select('id,league_id,user_id,type,title,message,metadata,read_status,created_at,read_at')
        .eq('league_id', leagueId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50); // ← OPTIMIZATION: Reduced from 100 to 50 (pagination can load more)

      if (error) {
        console.error('[NotificationService] Error fetching notifications:', error);
        return { data: null, error };
      }

      return { data: (data || []) as Notification[], error: null };
    } catch (error) {
      console.error('[NotificationService] Unexpected error in getNotifications:', error);
      return { data: null, error };
    }
  },

  /**
   * Get unread notification count for a league
   */
  async getUnreadCount(
    leagueId: string,
    userId: string
  ): Promise<NotificationServiceResponse<number>> {
    try {
      // Verify authentication
      const { userId: authUserId, error: authError } = await this.verifyAuth();
      if (authError || !authUserId) {
        return { data: null, error: { message: 'Authentication required', code: 401 } };
      }

      // Verify userId matches authenticated user
      if (userId !== authUserId) {
        return { data: null, error: { message: 'Unauthorized: User ID mismatch', code: 403 } };
      }

      // Verify league membership
      const { isMember, error: membershipError } = await this.verifyLeagueMembership(leagueId, userId);
      if (membershipError) {
        return { data: null, error: { message: 'Failed to verify league membership', code: 500 } };
      }
      if (!isMember) {
        return { data: null, error: { message: 'You do not have access to this league', code: 403 } };
      }

      // Count unread notifications
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .eq('user_id', userId)
        .eq('read_status', false);

      if (error) {
        console.error('[NotificationService] Error counting unread notifications:', error);
        return { data: null, error };
      }

      return { data: count || 0, error: null };
    } catch (error) {
      console.error('[NotificationService] Unexpected error in getUnreadCount:', error);
      return { data: null, error };
    }
  },

  /**
   * Mark a notification as read
   */
  async markAsRead(
    notificationId: string,
    userId: string
  ): Promise<NotificationServiceResponse<boolean>> {
    try {
      // Verify authentication
      const { userId: authUserId, error: authError } = await this.verifyAuth();
      if (authError || !authUserId) {
        return { data: null, error: { message: 'Authentication required', code: 401 } };
      }

      // Verify userId matches authenticated user
      if (userId !== authUserId) {
        return { data: null, error: { message: 'Unauthorized: User ID mismatch', code: 403 } };
      }

      // Verify notification ownership (RLS will enforce this, but we check explicitly)
      const { data: notification, error: fetchError } = await supabase
        .from('notifications')
        .select('user_id')
        .eq('id', notificationId)
        .eq('user_id', userId)
        .single();

      if (fetchError || !notification) {
        return { data: null, error: { message: 'Notification not found or access denied', code: 404 } };
      }

      // Update read status
      const { error: updateError } = await supabase
        .from('notifications')
        .update({
          read_status: true,
          read_at: new Date().toISOString(),
        })
        .eq('id', notificationId)
        .eq('user_id', userId);

      if (updateError) {
        console.error('[NotificationService] Error marking notification as read:', updateError);
        return { data: null, error: updateError };
      }

      return { data: true, error: null };
    } catch (error) {
      console.error('[NotificationService] Unexpected error in markAsRead:', error);
      return { data: null, error };
    }
  },

  /**
   * Mark all notifications as read for a league
   */
  async markAllAsRead(
    leagueId: string,
    userId: string
  ): Promise<NotificationServiceResponse<number>> {
    try {
      // Verify authentication
      const { userId: authUserId, error: authError } = await this.verifyAuth();
      if (authError || !authUserId) {
        return { data: null, error: { message: 'Authentication required', code: 401 } };
      }

      // Verify userId matches authenticated user
      if (userId !== authUserId) {
        return { data: null, error: { message: 'Unauthorized: User ID mismatch', code: 403 } };
      }

      // Verify league membership
      const { isMember, error: membershipError } = await this.verifyLeagueMembership(leagueId, userId);
      if (membershipError) {
        return { data: null, error: { message: 'Failed to verify league membership', code: 500 } };
      }
      if (!isMember) {
        return { data: null, error: { message: 'You do not have access to this league', code: 403 } };
      }

      // Get count before update
      const { count: beforeCount } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .eq('user_id', userId)
        .eq('read_status', false);

      // Update all unread notifications
      const { error: updateError } = await supabase
        .from('notifications')
        .update({
          read_status: true,
          read_at: new Date().toISOString(),
        })
        .eq('league_id', leagueId)
        .eq('user_id', userId)
        .eq('read_status', false);

      if (updateError) {
        console.error('[NotificationService] Error marking all as read:', updateError);
        return { data: null, error: updateError };
      }

      return { data: beforeCount || 0, error: null };
    } catch (error) {
      console.error('[NotificationService] Unexpected error in markAllAsRead:', error);
      return { data: null, error };
    }
  },

  /**
   * Subscribe to real-time notification updates
   * 
   * EGRESS OPTIMIZATION: Only listen to INSERT events (new notifications)
   * Reduces egress by ~50% compared to listening to all events
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
          event: 'INSERT', // ← OPTIMIZATION: Only new notifications (not UPDATE/DELETE)
          schema: 'public',
          table: 'notifications',
          filter: `league_id=eq.${leagueId},user_id=eq.${userId}`, // ← AND condition with comma
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            callback(payload.new as Notification);
          }
        }
      )
      .subscribe();

    // Return unsubscribe function
    return () => {
      supabase.removeChannel(channel);
    };
  },
};


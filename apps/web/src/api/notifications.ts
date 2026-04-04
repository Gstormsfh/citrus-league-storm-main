/**
 * Notification API client — replaces direct Supabase calls for notifications.
 */

import { apiClient } from './client';

export const notificationApi = {
  /** Get notifications for the authenticated user, scoped to a league */
  getNotifications(params?: { leagueId?: string; limit?: number; unread?: boolean }) {
    const query = new URLSearchParams();
    if (params?.leagueId) query.set('leagueId', params.leagueId);
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.unread) query.set('unread', 'true');
    const qs = query.toString();
    return apiClient.get(`/api/notifications${qs ? `?${qs}` : ''}`);
  },

  /** Get unread notification count */
  getUnreadCount(leagueId?: string) {
    const qs = leagueId ? `?leagueId=${leagueId}` : '';
    return apiClient.get(`/api/notifications/unread-count${qs}`);
  },

  /** Mark a notification as read */
  markAsRead(notificationId: string) {
    return apiClient.put(`/api/notifications/${notificationId}/read`);
  },

  /** Mark all notifications as read */
  markAllAsRead(leagueId?: string) {
    const qs = leagueId ? `?leagueId=${leagueId}` : '';
    return apiClient.put(`/api/notifications/read-all${qs}`);
  },

  /** Send a chat message in a league */
  sendChatMessage(leagueId: string, message: string, senderName?: string | null) {
    return apiClient.post('/api/notifications/chat', { leagueId, message, senderName });
  },
};

/**
 * Notification API client — replaces direct Supabase calls for notifications.
 */

import { apiClient } from './client';

export const notificationApi = {
  /** Get notifications for the authenticated user */
  getNotifications(params?: { limit?: number; unread?: boolean }) {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', params.limit.toString());
    if (params?.unread) query.set('unread', 'true');
    const qs = query.toString();
    return apiClient.get(`/api/notifications${qs ? `?${qs}` : ''}`);
  },

  /** Mark a notification as read */
  markAsRead(notificationId: string) {
    return apiClient.put(`/api/notifications/${notificationId}/read`);
  },

  /** Mark all notifications as read */
  markAllAsRead() {
    return apiClient.put('/api/notifications/read-all');
  },
};

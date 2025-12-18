import { create } from 'zustand';
import { NotificationService, Notification } from '@/services/NotificationService';

interface NotificationState {
  // State maps: leagueId -> data
  notifications: Map<string, Notification[]>;
  unreadCounts: Map<string, number>;
  loading: Map<string, boolean>;
  errors: Map<string, string>;
  
  // Active subscriptions: leagueId -> unsubscribe function
  subscriptions: Map<string, () => void>;
  
  // Actions
  loadNotifications: (leagueId: string, userId: string) => Promise<void>;
  markAsRead: (notificationId: string, userId: string) => Promise<void>;
  markAllAsRead: (leagueId: string, userId: string) => Promise<void>;
  updateUnreadCount: (leagueId: string, userId: string) => Promise<void>;
  subscribe: (leagueId: string, userId: string) => void;
  unsubscribe: (leagueId: string) => void;
  clearError: (leagueId: string) => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  // Initial state
  notifications: new Map(),
  unreadCounts: new Map(),
  loading: new Map(),
  errors: new Map(),
  subscriptions: new Map(),

  // Load notifications for a league
  loadNotifications: async (leagueId: string, userId: string) => {
    // Set loading state
    set((state) => {
      const newLoading = new Map(state.loading);
      newLoading.set(leagueId, true);
      return { loading: newLoading };
    });

    // Clear any previous error
    set((state) => {
      const newErrors = new Map(state.errors);
      newErrors.delete(leagueId);
      return { errors: newErrors };
    });

    try {
      const { data, error } = await NotificationService.getNotifications(leagueId, userId);

      if (error) {
        // Handle different error types
        let errorMessage = 'Failed to load notifications';
        if (error.code === 401) {
          errorMessage = 'Please sign in to view notifications';
        } else if (error.code === 403) {
          errorMessage = 'You do not have access to this league';
        } else if (error.message) {
          errorMessage = error.message;
        }

        set((state) => {
          const newErrors = new Map(state.errors);
          newErrors.set(leagueId, errorMessage);
          const newLoading = new Map(state.loading);
          newLoading.set(leagueId, false);
          return { errors: newErrors, loading: newLoading };
        });
        return;
      }

      // Update notifications
      set((state) => {
        const newNotifications = new Map(state.notifications);
        newNotifications.set(leagueId, data || []);
        const newLoading = new Map(state.loading);
        newLoading.set(leagueId, false);
        return { notifications: newNotifications, loading: newLoading };
      });

      // Update unread count
      await get().updateUnreadCount(leagueId, userId);
    } catch (error: any) {
      console.error('[NotificationStore] Error loading notifications:', error);
      set((state) => {
        const newErrors = new Map(state.errors);
        newErrors.set(leagueId, error?.message || 'Failed to load notifications');
        const newLoading = new Map(state.loading);
        newLoading.set(leagueId, false);
        return { errors: newErrors, loading: newLoading };
      });
    }
  },

  // Mark a notification as read
  markAsRead: async (notificationId: string, userId: string) => {
    try {
      const { error } = await NotificationService.markAsRead(notificationId, userId);
      
      if (error) {
        console.error('[NotificationStore] Error marking notification as read:', error);
        return;
      }

      // Update local state - find which league this notification belongs to
      set((state) => {
        const newNotifications = new Map(state.notifications);
        let updatedLeagueId: string | null = null;

        for (const [leagueId, notifications] of newNotifications.entries()) {
          const notification = notifications.find(n => n.id === notificationId);
          if (notification) {
            updatedLeagueId = leagueId;
            const updatedNotifications = notifications.map(n =>
              n.id === notificationId
                ? { ...n, read_status: true, read_at: new Date().toISOString() }
                : n
            );
            newNotifications.set(leagueId, updatedNotifications);
            break;
          }
        }

        // Update unread count for the affected league
        if (updatedLeagueId) {
          const newUnreadCounts = new Map(state.unreadCounts);
          const currentCount = newUnreadCounts.get(updatedLeagueId) || 0;
          newUnreadCounts.set(updatedLeagueId, Math.max(0, currentCount - 1));
          return { notifications: newNotifications, unreadCounts: newUnreadCounts };
        }

        return { notifications: newNotifications };
      });
    } catch (error) {
      console.error('[NotificationStore] Unexpected error in markAsRead:', error);
    }
  },

  // Mark all notifications as read for a league
  markAllAsRead: async (leagueId: string, userId: string) => {
    try {
      const { data: count, error } = await NotificationService.markAllAsRead(leagueId, userId);
      
      if (error) {
        console.error('[NotificationStore] Error marking all as read:', error);
        return;
      }

      // Update local state
      set((state) => {
        const newNotifications = new Map(state.notifications);
        const notifications = newNotifications.get(leagueId) || [];
        const updatedNotifications = notifications.map(n => ({
          ...n,
          read_status: true,
          read_at: n.read_at || new Date().toISOString(),
        }));
        newNotifications.set(leagueId, updatedNotifications);

        const newUnreadCounts = new Map(state.unreadCounts);
        newUnreadCounts.set(leagueId, 0);

        return { notifications: newNotifications, unreadCounts: newUnreadCounts };
      });
    } catch (error) {
      console.error('[NotificationStore] Unexpected error in markAllAsRead:', error);
    }
  },

  // Update unread count for a league
  updateUnreadCount: async (leagueId: string, userId: string) => {
    try {
      const { data: count, error } = await NotificationService.getUnreadCount(leagueId, userId);
      
      if (error) {
        console.error('[NotificationStore] Error updating unread count:', error);
        return;
      }

      set((state) => {
        const newUnreadCounts = new Map(state.unreadCounts);
        newUnreadCounts.set(leagueId, count || 0);
        return { unreadCounts: newUnreadCounts };
      });
    } catch (error) {
      console.error('[NotificationStore] Unexpected error in updateUnreadCount:', error);
    }
  },

  // Subscribe to real-time updates
  subscribe: (leagueId: string, userId: string) => {
    // Unsubscribe from existing subscription if any
    const existingUnsubscribe = get().subscriptions.get(leagueId);
    if (existingUnsubscribe) {
      existingUnsubscribe();
    }

    // Create new subscription
    const unsubscribe = NotificationService.subscribeToNotifications(
      leagueId,
      userId,
      (notification: Notification) => {
        // Update notifications in store
        set((state) => {
          const newNotifications = new Map(state.notifications);
          const existing = newNotifications.get(leagueId) || [];
          
          // Check if notification already exists (avoid duplicates)
          const exists = existing.some(n => n.id === notification.id);
          if (!exists) {
            // Add new notification at the beginning
            newNotifications.set(leagueId, [notification, ...existing]);
          } else {
            // Update existing notification
            const updated = existing.map(n =>
              n.id === notification.id ? notification : n
            );
            newNotifications.set(leagueId, updated);
          }

          return { notifications: newNotifications };
        });

        // Update unread count if notification is unread
        if (!notification.read_status) {
          set((state) => {
            const newUnreadCounts = new Map(state.unreadCounts);
            const currentCount = newUnreadCounts.get(leagueId) || 0;
            newUnreadCounts.set(leagueId, currentCount + 1);
            return { unreadCounts: newUnreadCounts };
          });
        }

        // Also refresh unread count to ensure accuracy
        get().updateUnreadCount(leagueId, userId);
      }
    );

    // Store unsubscribe function
    set((state) => {
      const newSubscriptions = new Map(state.subscriptions);
      newSubscriptions.set(leagueId, unsubscribe);
      return { subscriptions: newSubscriptions };
    });
  },

  // Unsubscribe from real-time updates
  unsubscribe: (leagueId: string) => {
    const unsubscribe = get().subscriptions.get(leagueId);
    if (unsubscribe) {
      unsubscribe();
      set((state) => {
        const newSubscriptions = new Map(state.subscriptions);
        newSubscriptions.delete(leagueId);
        return { subscriptions: newSubscriptions };
      });
    }
  },

  // Clear error for a league
  clearError: (leagueId: string) => {
    set((state) => {
      const newErrors = new Map(state.errors);
      newErrors.delete(leagueId);
      return { errors: newErrors };
    });
  },
}));


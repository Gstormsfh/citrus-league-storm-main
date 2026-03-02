import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { NotificationService } from '../services/NotificationService';

const notificationRoutes = new Hono<Env>();

notificationRoutes.use('*', authMiddleware);

// PUT /api/notifications/read-all — Mark all notifications as read
// IMPORTANT: This route MUST be defined before /:id to avoid param collision
notificationRoutes.put('/read-all', async (c) => {
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new NotificationService(supabase);

  const leagueId = c.req.query('leagueId');
  const { success, error } = await service.markAllAsRead(userId, leagueId);

  if (!success) {
    return c.json({ error: 'Failed to mark all as read' }, 400);
  }

  return c.json({ success: true });
});

// GET /api/notifications — Get notifications for the authenticated user
notificationRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new NotificationService(supabase);

  const limit = parseInt(c.req.query('limit') || '50', 10);
  const unreadOnly = c.req.query('unread') === 'true';

  const { notifications, error } = await service.getNotifications(userId, { limit, unreadOnly });
  if (error) {
    return c.json({ error: 'Failed to fetch notifications' }, 500);
  }

  return c.json({ data: notifications });
});

// GET /api/notifications/unread-count — Get unread notification count
notificationRoutes.get('/unread-count', async (c) => {
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new NotificationService(supabase);

  const leagueId = c.req.query('leagueId');
  const { count, error } = await service.getUnreadCount(userId, leagueId);

  if (error) {
    return c.json({ error: 'Failed to fetch count' }, 500);
  }

  return c.json({ data: { count } });
});

// PUT /api/notifications/:id/read — Mark a notification as read
notificationRoutes.put('/:id/read', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new NotificationService(supabase);

  const { success, error } = await service.markAsRead(id, userId);
  if (!success) {
    return c.json({ error: 'Failed to mark as read' }, 400);
  }

  return c.json({ success: true });
});

export { notificationRoutes };

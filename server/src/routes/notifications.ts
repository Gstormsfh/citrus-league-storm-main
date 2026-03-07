import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { NotificationService } from '../services/NotificationService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';

const notificationRoutes = new Hono<Env>();

notificationRoutes.use('*', authMiddleware);

// PUT /api/notifications/read-all — Mark all notifications as read
// IMPORTANT: This route MUST be defined before /:id to avoid param collision
notificationRoutes.put('/read-all', async (c) => {
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new NotificationService(supabase);

  const leagueId = c.req.query('leagueId');
  const { success } = await service.markAllAsRead(userId, leagueId);

  if (!success) {
    return fail(c, AppError.badRequest('Failed to mark all as read'));
  }

  return ok(c, { success: true });
});

// GET /api/notifications — Get notifications for the authenticated user
notificationRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new NotificationService(supabase);

  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const unreadOnly = c.req.query('unread') === 'true';

  const { notifications, error } = await service.getNotifications(userId, { limit, unreadOnly });
  if (error) {
    return handleError(c, error, 'Failed to fetch notifications');
  }

  return ok(c, notifications);
});

// GET /api/notifications/unread-count — Get unread notification count
notificationRoutes.get('/unread-count', async (c) => {
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new NotificationService(supabase);

  const leagueId = c.req.query('leagueId');
  const { count, error } = await service.getUnreadCount(userId, leagueId);

  if (error) {
    return handleError(c, error, 'Failed to fetch count');
  }

  return ok(c, { count });
});

// PUT /api/notifications/:id/read — Mark a notification as read
notificationRoutes.put('/:id/read', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new NotificationService(supabase);

  const { success } = await service.markAsRead(id, userId);
  if (!success) {
    return fail(c, AppError.badRequest('Failed to mark as read'));
  }

  return ok(c, { success: true });
});

// POST /api/notifications/chat — Send a chat message in a league
notificationRoutes.post('/chat', async (c) => {
  const body = await c.req.json<{ leagueId: string; message: string; senderName?: string | null }>();

  if (!body.leagueId || !body.message?.trim()) {
    return fail(c, AppError.badRequest('leagueId and message are required'));
  }

  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase.rpc('send_league_chat_message', {
    p_league_id: body.leagueId,
    p_message: body.message.trim(),
    p_sender_name: body.senderName || null,
  });

  if (error) {
    return handleError(c, error, 'Failed to send message');
  }

  if (data && !data.success) {
    return fail(c, AppError.badRequest(data.error || 'Failed to send message'));
  }

  return ok(c, { success: true });
});

export { notificationRoutes };

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { NotificationService } from '../services/NotificationService';
import { LeagueMembershipService } from '../services/LeagueMembershipService';
import { AuditService } from '../services/AuditService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';

const notificationRoutes = new Hono<Env>();

notificationRoutes.use('*', authMiddleware);

notificationRoutes.post('/report', validateBody(z.object({ notificationId: z.string().uuid(), reason: z.string().trim().min(1).max(1000) })), async (c) => {
  const body = getValidatedBody<{ notificationId: string; reason: string }>(c);
  const client = createUserClient(c.get('userToken'));
  const result = await new NotificationService(client).reportMessage(c.get('userId'), body.notificationId, body.reason);
  if (!result.success) return fail(c, AppError.badRequest(result.error!));
  await new AuditService(client).log('SECURITY_VIOLATION', result.leagueId, { action: 'content_report', notificationId: body.notificationId }, 'WARN');
  return ok(c, { success: true });
});

notificationRoutes.post('/block', validateBody(z.object({ notificationId: z.string().uuid() })), async (c) => {
  const body = getValidatedBody<{ notificationId: string }>(c);
  const client = createUserClient(c.get('userToken'));
  const result = await new NotificationService(client).blockMessageSender(c.get('userId'), body.notificationId);
  if (!result.success) return fail(c, AppError.badRequest(result.error!));
  await new AuditService(client).log('ADMIN_ACTION', result.leagueId, { action: 'user_block' });
  return ok(c, { success: true, blockedId: result.blockedId });
});

notificationRoutes.get('/blocks', async (c) => {
  const result = await new NotificationService(createUserClient(c.get('userToken'))).getBlockedUsers(c.get('userId'));
  if (result.error) return handleError(c, result.error, 'Could not load blocked users');
  return ok(c, result.data);
});

notificationRoutes.delete('/blocks/:userId', async (c) => {
  if (!z.string().uuid().safeParse(c.req.param('userId')).success) return fail(c, AppError.badRequest('Invalid user'));
  const client = createUserClient(c.get('userToken'));
  const result = await new NotificationService(client).unblockUser(c.get('userId'), c.req.param('userId'));
  if (!result.success) return handleError(c, result.error, 'Could not unblock user');
  await new AuditService(client).log('ADMIN_ACTION', null, { action: 'user_unblock' });
  return ok(c, { success: true });
});

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
  const leagueId = c.req.query('leagueId');

  const { notifications, error } = await service.getNotifications(userId, { limit, unreadOnly, leagueId });
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
notificationRoutes.post('/chat', validateBody(schemas.notificationChat), async (c) => {
  const body = getValidatedBody<z.infer<typeof schemas.notificationChat>>(c);

  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));

  // Verify league membership before allowing chat messages
  const membership = new LeagueMembershipService(supabase);
  const memberCheck = await membership.checkMembership(body.leagueId, userId);
  if (!memberCheck.isMember) {
    return fail(c, AppError.forbidden('Not a member of this league'));
  }

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

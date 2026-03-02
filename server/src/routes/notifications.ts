import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';

const notificationRoutes = new Hono<Env>();

notificationRoutes.use('*', authMiddleware);

// GET /api/notifications — Get notifications for the authenticated user
notificationRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const unreadOnly = c.req.query('unread') === 'true';

  let query = supabase
    .from('notifications')
    .select('id, user_id, type, title, message, read, league_id, data, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.eq('read', false);
  }

  const { data, error } = await query;

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ data: data || [] });
});

// PUT /api/notifications/:id/read — Mark a notification as read
notificationRoutes.put('/:id/read', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  return c.json({ success: true });
});

// PUT /api/notifications/read-all — Mark all notifications as read
notificationRoutes.put('/read-all', async (c) => {
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  return c.json({ success: true });
});

export { notificationRoutes };

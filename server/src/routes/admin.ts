import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { ok, okPaginated, fail, handleError } from '../lib/responses';

const adminRoutes = new Hono<Env>();

adminRoutes.use('*', authMiddleware);

// Admin auth middleware — checks is_admin flag on profile
adminRoutes.use('*', async (c, next) => {
  const userId = c.get('userId');

  if (!supabaseAdmin) {
    return fail(c, AppError.serviceUnavailable('Admin client not configured'));
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .single();

  if (!profile?.is_admin) {
    return fail(c, AppError.forbidden('Admin access required'));
  }

  await next();
});

// GET /api/admin/stats — Platform-wide statistics
adminRoutes.get('/stats', async (c) => {
  const { count: userCount } = await supabaseAdmin
    .from('profiles')
    .select('id', { count: 'exact', head: true });

  const { count: leagueCount } = await supabaseAdmin
    .from('leagues')
    .select('id', { count: 'exact', head: true });

  const { count: activeDrafts } = await supabaseAdmin
    .from('leagues')
    .select('id', { count: 'exact', head: true })
    .eq('draft_status', 'in_progress');

  return ok(c, {
    totalUsers: userCount || 0,
    totalLeagues: leagueCount || 0,
    activeDrafts: activeDrafts || 0,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/admin/users — List users with pagination
adminRoutes.get('/users', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  const search = c.req.query('search');
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from('profiles')
    .select('id, username, first_name, last_name, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.or(`username.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
  }

  const { data, count, error } = await query;

  if (error) {
    return handleError(c, error, 'Failed to fetch users');
  }

  return okPaginated(c, data || [], { page, limit, total: count || 0 });
});

// GET /api/admin/leagues — List leagues with pagination
adminRoutes.get('/leagues', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  const search = c.req.query('search');
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from('leagues')
    .select('id, name, commissioner_id, draft_status, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.ilike('name', `%${search}%`);
  }

  const { data, count, error } = await query;

  if (error) {
    return handleError(c, error, 'Failed to fetch leagues');
  }

  return okPaginated(c, data || [], { page, limit, total: count || 0 });
});

// GET /api/admin/audit-log — View security audit log
adminRoutes.get('/audit-log', async (c) => {
  const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') || '100', 10)));

  const { data, error } = await supabaseAdmin
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return handleError(c, error, 'Failed to fetch audit log');
  }

  return ok(c, data || []);
});

// POST /api/admin/recalculate-scores — Trigger score recalculation
adminRoutes.post('/recalculate-scores', async (c) => {
  const body = await c.req.json();
  const { leagueId, week } = body;

  if (!leagueId) {
    return fail(c, AppError.badRequest('leagueId is required'));
  }

  // TODO: Trigger Python pipeline score recalculation
  return ok(c, {
    message: 'Score recalculation queued',
    leagueId,
    week,
  });
});

// GET /api/admin/pipeline-status — Data pipeline health
adminRoutes.get('/pipeline-status', async (c) => {
  const { data: latestGame } = await supabaseAdmin
    .from('nhl_games')
    .select('game_date, updated_at')
    .order('game_date', { ascending: false })
    .limit(1)
    .single();

  const { data: latestProjection } = await supabaseAdmin
    .from('player_projected_stats')
    .select('projection_date, updated_at')
    .order('projection_date', { ascending: false })
    .limit(1)
    .single();

  return ok(c, {
    latestGameDate: latestGame?.game_date,
    latestGameUpdate: latestGame?.updated_at,
    latestProjectionDate: latestProjection?.projection_date,
    latestProjectionUpdate: latestProjection?.updated_at,
    timestamp: new Date().toISOString(),
  });
});

export { adminRoutes };

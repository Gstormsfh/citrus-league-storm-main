import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { createUserClient, supabaseAdmin } from '../lib/supabase';
import { AuditService } from '../services/AuditService';
import { AppError } from '../lib/errors';
import { ok, okPaginated, fail, handleError } from '../lib/responses';
import { COLUMNS } from '@citrus/shared';

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
    // Whitelist: only allow alphanumeric, spaces, and hyphens
    const sanitized = search.replace(/[^a-zA-Z0-9\s\-]/g, '').trim();
    if (sanitized) {
      query = query.or(
        ['username', 'first_name', 'last_name']
          .map((col) => `${col}.ilike.%${sanitized}%`)
          .join(',')
      );
    }
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
    const sanitized = search.replace(/[^a-zA-Z0-9\s\-]/g, '').trim();
    if (sanitized) {
      query = query.ilike('name', `%${sanitized}%`);
    }
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
    .select(COLUMNS.AUDIT_LOG)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return handleError(c, error, 'Failed to fetch audit log');
  }

  return ok(c, data || []);
});

// POST /api/admin/recalculate-scores — Trigger score recalculation
adminRoutes.post('/recalculate-scores', validateBody(schemas.adminRecalculateScores), async (c) => {
  const { leagueId, week } = getValidatedBody<z.infer<typeof schemas.adminRecalculateScores>>(c);

  try {
    // Step 1: Lock completed daily rosters for the league
    const { data: lockResult, error: lockError } = await supabaseAdmin
      .from('fantasy_daily_rosters')
      .update({ is_locked: true, locked_at: new Date().toISOString() })
      .eq('league_id', leagueId)
      .eq('is_locked', false)
      .lt('roster_date', new Date().toISOString().split('T')[0])
      .select('player_id');

    // Step 2: Recalculate matchup scores via RPC
    const { error: rpcError } = await supabaseAdmin.rpc('update_all_matchup_scores', {
      p_league_id: leagueId,
    });

    if (rpcError) {
      return fail(c, AppError.internal(`Score recalculation failed: ${rpcError.message}`));
    }

    // Step 3: If a specific week was requested, auto-complete matchups for that week
    if (week) {
      await supabaseAdmin
        .from('matchups')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('league_id', leagueId)
        .eq('week_number', week)
        .eq('status', 'in_progress');
    }

    const supabase = createUserClient(c.get('userToken'));
    const audit = new AuditService(supabase);
    audit.log('ADMIN_ACTION', leagueId, { action: 'recalculate_scores', week: week || 'all', rostersLocked: lockResult?.length || 0 });

    return ok(c, {
      message: 'Score recalculation completed',
      leagueId,
      week: week || 'all',
      rostersLocked: lockResult?.length || 0,
    });
  } catch (err: unknown) {
    return handleError(c, err, 'Score recalculation failed');
  }
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

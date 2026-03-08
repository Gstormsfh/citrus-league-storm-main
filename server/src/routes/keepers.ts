import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { KeeperService } from '../services/KeeperService';
import { AppError } from '../lib/errors';
import { ok, created, fail, handleError } from '../lib/responses';

const keeperRoutes = new Hono<Env>();
keeperRoutes.use('*', authMiddleware);

// GET /api/keepers/league/:leagueId/team/:teamId
keeperRoutes.get('/league/:leagueId/team/:teamId', membershipMiddleware, async (c) => {
  const { leagueId, teamId } = c.req.param();
  const seasonYear = Number(c.req.query('seasonYear') || new Date().getFullYear());
  const supabase = createUserClient(c.get('userToken'));
  const service = new KeeperService(supabase);
  const result = await service.getTeamKeepers(leagueId, teamId, seasonYear);
  if (result.error) return handleError(c, result.error, 'Failed to fetch keepers');
  return ok(c, result.keepers);
});

// GET /api/keepers/league/:leagueId
keeperRoutes.get('/league/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const seasonYear = Number(c.req.query('seasonYear') || new Date().getFullYear());
  const supabase = createUserClient(c.get('userToken'));
  const service = new KeeperService(supabase);
  const result = await service.getLeagueKeepers(leagueId, seasonYear);
  if (result.error) return handleError(c, result.error, 'Failed to fetch keepers');
  return ok(c, result.keepers);
});

// POST /api/keepers/league/:leagueId/designate
keeperRoutes.post('/league/:leagueId/designate', membershipMiddleware, validateBody(schemas.designateKeeper), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.designateKeeper>>(c);
  const supabase = createUserClient(c.get('userToken'));

  // Verify user owns the team
  const { data: team } = await supabase
    .from('teams')
    .select('id, owner_id')
    .eq('id', body.teamId)
    .eq('league_id', leagueId)
    .single();
  if (!team || team.owner_id !== userId) {
    return fail(c, AppError.forbidden('You do not own this team'));
  }

  const service = new KeeperService(supabase);
  const result = await service.designateKeeper(leagueId, body.teamId, body.playerId, body.seasonYear, body.originalDraftRound);
  if (!result.success) return fail(c, AppError.badRequest(result.error || 'Failed to designate keeper'));
  return created(c, result);
});

// PUT /api/keepers/:keeperId/release
keeperRoutes.put('/:keeperId/release', validateBody(schemas.releaseKeeper), async (c) => {
  const keeperId = c.req.param('keeperId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.releaseKeeper>>(c);
  const supabase = createUserClient(c.get('userToken'));

  // Verify user owns the team before allowing keeper release
  const { data: team } = await supabase
    .from('teams')
    .select('id, owner_id')
    .eq('id', body.teamId)
    .single();
  if (!team || team.owner_id !== userId) {
    return fail(c, AppError.forbidden('You do not own this team'));
  }

  const service = new KeeperService(supabase);
  const result = await service.releaseKeeper(keeperId, body.teamId);
  if (!result.success) return fail(c, AppError.badRequest(result.error || 'Failed to release keeper'));
  return ok(c, result);
});

// POST /api/keepers/league/:leagueId/validate
keeperRoutes.post('/league/:leagueId/validate', membershipMiddleware, validateBody(schemas.designateKeeper.pick({ teamId: true, seasonYear: true })), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<{ teamId: string; seasonYear: number }>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new KeeperService(supabase);
  const result = await service.validateKeepers(leagueId, body.teamId, body.seasonYear);
  return ok(c, result);
});

// GET /api/keepers/league/:leagueId/draft-costs
keeperRoutes.get('/league/:leagueId/draft-costs', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.query('teamId');
  const seasonYear = Number(c.req.query('seasonYear') || new Date().getFullYear());
  if (!teamId) return fail(c, AppError.badRequest('teamId is required'));
  const supabase = createUserClient(c.get('userToken'));
  const service = new KeeperService(supabase);
  const result = await service.getKeeperDraftCosts(leagueId, teamId, seasonYear);
  if (result.error) return handleError(c, result.error, 'Failed to fetch draft costs');
  return ok(c, result.costs);
});

// POST /api/keepers/league/:leagueId/lock
keeperRoutes.post('/league/:leagueId/lock', membershipMiddleware, validateBody(schemas.lockKeepers), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.lockKeepers>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new KeeperService(supabase);
  const result = await service.lockKeepersForSeason(leagueId, body.seasonYear);
  if (result.error) return fail(c, AppError.badRequest(result.error));
  return ok(c, result);
});

// PUT /api/keepers/league/:leagueId/settings
keeperRoutes.put('/league/:leagueId/settings', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new KeeperService(supabase);
  const result = await service.updateKeeperSettings(leagueId, userId, body);
  if (!result.success) return fail(c, AppError.badRequest(result.error || 'Failed to update settings'));
  return ok(c, result);
});

export { keeperRoutes };

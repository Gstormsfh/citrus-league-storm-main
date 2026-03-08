import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { z } from 'zod';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { WaiverService } from '../services/WaiverService';
import { AuditService } from '../services/AuditService';
import { AppError, getErrorMessage } from '../lib/errors';
import { ok, created, fail, handleError } from '../lib/responses';
import { logger } from '@citrus/shared';

const waiverRoutes = new Hono<Env>();

waiverRoutes.use('*', authMiddleware);

// GET /api/waivers/league/:leagueId — Get waiver claims for a league
waiverRoutes.get('/league/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const status = c.req.query('status');
  const supabase = createUserClient(c.get('userToken'));
  const service = new WaiverService(supabase);

  const { claims, error } = await service.getLeagueWaivers(leagueId, status);
  if (error) {
    const msg = getErrorMessage(error);
    if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('not found')) {
      logger.warn('[waivers] Table/column not ready, returning empty claims:', msg);
      return ok(c, []);
    }
    logger.error('[waivers] Failed to fetch league waivers:', JSON.stringify(error));
    return handleError(c, error, 'Failed to fetch waivers');
  }

  return ok(c, claims);
});

// GET /api/waivers/league/:leagueId/team/:teamId — Get team waiver claims
waiverRoutes.get('/league/:leagueId/team/:teamId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.param('teamId');
  const status = c.req.query('status');
  const supabase = createUserClient(c.get('userToken'));
  const service = new WaiverService(supabase);

  const { claims, error } = await service.getTeamWaiverClaims(leagueId, teamId, status);
  if (error) {
    const msg = getErrorMessage(error);
    if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('not found')) {
      logger.warn('[waivers] Table/column not ready, returning empty claims:', msg);
      return ok(c, []);
    }
    logger.error('[waivers] Failed to fetch team waivers:', JSON.stringify(error));
    return handleError(c, error, 'Failed to fetch team waivers');
  }

  return ok(c, claims);
});

// GET /api/waivers/league/:leagueId/priority — Get waiver priority
waiverRoutes.get('/league/:leagueId/priority', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new WaiverService(supabase);

  const { priority, error } = await service.getWaiverPriority(leagueId);
  if (error) {
    const msg = getErrorMessage(error);
    if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('not found')) {
      logger.warn('[waivers] Priority table not ready, returning empty:', msg);
      return ok(c, []);
    }
    return handleError(c, error, 'Failed to fetch waiver priority');
  }

  return ok(c, priority);
});

// GET /api/waivers/league/:leagueId/faab — Get all FAAB budgets
waiverRoutes.get('/league/:leagueId/faab', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new WaiverService(supabase);

  const budgets = await service.getAllFAABBudgets(leagueId);
  return ok(c, budgets);
});

// GET /api/waivers/league/:leagueId/settings — Get waiver settings
waiverRoutes.get('/league/:leagueId/settings', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new WaiverService(supabase);

  try {
    const { settings, error } = await service.getLeagueWaiverSettings(leagueId, userId);
    if (error) {
      return handleError(c, error, 'Failed to fetch settings');
    }
    return ok(c, settings);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch waiver settings');
  }
});

// POST /api/waivers/league/:leagueId — Submit a waiver claim
waiverRoutes.post('/league/:leagueId', membershipMiddleware, validateBody(schemas.submitWaiverClaim), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.submitWaiverClaim>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new WaiverService(supabase);

  const { success, error, claimId } = await service.submitWaiverClaim(
    leagueId,
    String(body.teamId),
    Number(body.playerId),
    body.dropPlayerId ? Number(body.dropPlayerId) : null,
  );

  if (!success) {
    return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to submit waiver claim'));
  }

  const audit = new AuditService(supabase);
  audit.log('WAIVER_CLAIM', leagueId, { claimId, playerId: body.playerId, teamId: body.teamId, dropPlayerId: body.dropPlayerId });

  return created(c, { claimId });
});

// POST /api/waivers/league/:leagueId/faab-bid — Submit a FAAB bid
waiverRoutes.post('/league/:leagueId/faab-bid', membershipMiddleware, validateBody(schemas.submitFAABBid), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.submitFAABBid>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new WaiverService(supabase);

  const { success, error, claimId } = await service.submitFAABBid(
    leagueId,
    String(body.teamId),
    Number(body.playerId),
    body.bidAmount,
    body.dropPlayerId ? Number(body.dropPlayerId) : null,
    body.isConditionalDrop || false,
  );

  if (!success) {
    return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to submit FAAB bid'));
  }

  const audit = new AuditService(supabase);
  audit.log('WAIVER_CLAIM', leagueId, { claimId, playerId: body.playerId, teamId: body.teamId, bidAmount: body.bidAmount, type: 'faab' });

  return created(c, { claimId });
});

// POST /api/waivers/league/:leagueId/add-free-agent — Add free agent (instant)
waiverRoutes.post('/league/:leagueId/add-free-agent', membershipMiddleware, validateBody(schemas.addFreeAgent), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.addFreeAgent>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new WaiverService(supabase);

  const { success, error } = await service.addFreeAgent(
    leagueId,
    String(body.teamId),
    Number(body.playerId),
    body.dropPlayerId ? Number(body.dropPlayerId) : null,
    userId,
  );

  if (!success) {
    return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to add free agent'));
  }

  const audit = new AuditService(supabase);
  audit.logRosterMove(leagueId, { addPlayerId: String(body.playerId), dropPlayerId: body.dropPlayerId ? String(body.dropPlayerId) : undefined, teamId: String(body.teamId) });

  return ok(c, { success: true });
});

// POST /api/waivers/league/:leagueId/drop-player — Drop player from roster
waiverRoutes.post('/league/:leagueId/drop-player', membershipMiddleware, validateBody(schemas.dropPlayer), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.dropPlayer>>(c);

  const supabase = createUserClient(c.get('userToken'));

  // Verify user owns the team before allowing player drop
  const { data: team } = await supabase
    .from('teams')
    .select('id, owner_id')
    .eq('id', String(body.teamId))
    .eq('league_id', leagueId)
    .single();
  if (!team || team.owner_id !== userId) {
    return fail(c, AppError.forbidden('You do not own this team'));
  }

  const service = new WaiverService(supabase);

  const { success, error } = await service.dropPlayer(leagueId, String(body.teamId), Number(body.playerId));
  if (!success) {
    return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to drop player'));
  }

  const audit = new AuditService(supabase);
  audit.logRosterMove(leagueId, { dropPlayerId: String(body.playerId), teamId: String(body.teamId) });

  return ok(c, { success: true });
});

// DELETE /api/waivers/:claimId — Cancel a waiver claim
waiverRoutes.delete('/:claimId', async (c) => {
  const claimId = c.req.param('claimId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new WaiverService(supabase);

  const { success, error } = await service.cancelClaim(claimId);
  if (!success) {
    return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to cancel claim'));
  }

  return ok(c, { success: true });
});

export { waiverRoutes };

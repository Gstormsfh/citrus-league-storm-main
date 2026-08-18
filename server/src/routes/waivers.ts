import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware, commissionerMiddleware } from '../middleware/membership';
import { getSupabaseAdmin } from '../lib/supabase';
import { LeagueMembershipService } from '../services/LeagueMembershipService';
import { z } from 'zod';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { WaiverService } from '../services/WaiverService';
import { SeasonStateService } from '../services/SeasonStateService';
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

  const seasonState = await new SeasonStateService(supabase).isSeasonComplete(leagueId);
  if (seasonState.complete) {
    logger.info('[waivers] claim blocked — season complete', { leagueId });
    return fail(c, AppError.forbidden('Season is complete; rosters are locked'));
  }

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

  const seasonState = await new SeasonStateService(supabase).isSeasonComplete(leagueId);
  if (seasonState.complete) {
    logger.info('[waivers] faab bid blocked — season complete', { leagueId });
    return fail(c, AppError.forbidden('Season is complete; rosters are locked'));
  }

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

  const seasonState = await new SeasonStateService(supabase).isSeasonComplete(leagueId);
  if (seasonState.complete) {
    logger.info('[waivers] add free agent blocked — season complete', { leagueId });
    return fail(c, AppError.forbidden('Season is complete; rosters are locked'));
  }

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

  const seasonState = await new SeasonStateService(supabase).isSeasonComplete(leagueId);
  if (seasonState.complete) {
    logger.info('[waivers] drop player blocked — season complete', { leagueId });
    return fail(c, AppError.forbidden('Season is complete; rosters are locked'));
  }

  // Verify user owns the team before allowing player drop.
  // AI teams (owner_id = NULL) are allowed — the WaiverService.dropPlayer
  // method handles them via admin client.
  const { data: team } = await supabase
    .from('teams')
    .select('id, owner_id')
    .eq('id', String(body.teamId))
    .eq('league_id', leagueId)
    .single();

  if (!team) {
    return fail(c, AppError.forbidden('Team not found'));
  }
  // AI teams (owner_id = null): only commissioners can manage their roster.
  // Human teams: verify ownership.
  if (team.owner_id === null) {
    const membershipService = new LeagueMembershipService(supabase);
    const membership = await membershipService.checkMembership(leagueId, userId);
    if (!membership.isCommissioner) {
      return fail(c, AppError.forbidden('Only commissioners can manage AI teams'));
    }
  } else if (team.owner_id !== userId) {
    return fail(c, AppError.forbidden('You do not own this team'));
  }

  const service = new WaiverService(supabase);

  const { success, error } = await service.dropPlayer(leagueId, String(body.teamId), Number(body.playerId), userId);
  if (!success) {
    return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to drop player'));
  }

  const audit = new AuditService(supabase);
  audit.logRosterMove(leagueId, { dropPlayerId: String(body.playerId), teamId: String(body.teamId) });

  return ok(c, { success: true });
});

/**
 * POST /api/waivers/league/:leagueId/process-all
 *
 * Commissioner-triggered waiver processor for a single league. Fires the
 * appropriate RPCs based on the league's waiver_type:
 *   - rolling / reverse_standings → process_all_pending_waivers() (global
 *     RPC — filters to this league in the response; other leagues get
 *     processed too but that is idempotent for anything not pending).
 *   - faab → process_faab_waivers_for_league(leagueId) (per-league RPC).
 *
 * Prior state: the frontend's WaiverService.processAllPendingWaivers()
 * POSTed to /api/waivers/process-all — a route that did not exist. Both
 * callers (LeagueDashboard, Profile) already had leagueId in scope; this
 * endpoint captures it via the path param and reuses the existing
 * commissioner middleware.
 */
waiverRoutes.post('/league/:leagueId/process-all', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const admin = getSupabaseAdmin();

  const { data: league, error: leagueErr } = await admin
    .from('leagues')
    .select('waiver_type')
    .eq('id', leagueId)
    .single();
  if (leagueErr) {
    logger.error('[waivers.process-all] failed to read league:', leagueErr);
    return handleError(c, leagueErr, 'Failed to read league waiver_type');
  }
  const waiverType = (league?.waiver_type as string) || 'rolling';

  const responseBody: Record<string, unknown> = { leagueId, waiverType };

  if (waiverType === 'faab') {
    // Per-league FAAB processor. Returns per-claim rows.
    const { data, error } = await admin.rpc('process_faab_waivers_for_league', {
      p_league_id: leagueId,
    });
    if (error) {
      logger.error('[waivers.process-all][faab] rpc failed:', error);
      return handleError(c, error, 'Failed to process FAAB waivers');
    }
    responseBody.rpc = 'process_faab_waivers_for_league';
    responseBody.claims = data || [];
    responseBody.processed = Array.isArray(data) ? data.length : 0;
  } else {
    // Global rolling processor — RPC has no per-league entry point today.
    // We filter to this league in the response; other leagues that also
    // had pending claims incidentally get processed, which is a no-op on
    // any that don't have work. Follow-up: process_pending_waivers_for_
    // league(uuid) migration (SQL handed to Claude in the PR body).
    const { data, error } = await admin.rpc('process_all_pending_waivers');
    if (error) {
      logger.error('[waivers.process-all][rolling] rpc failed:', error);
      return handleError(c, error, 'Failed to process waivers');
    }
    const allResults = Array.isArray(data) ? data : [];
    const leagueResult = allResults.find(
      (r: { league_id?: string }) => r?.league_id === leagueId,
    ) || null;
    responseBody.rpc = 'process_all_pending_waivers';
    responseBody.league_result = leagueResult;
    responseBody.other_leagues_touched = allResults.filter(
      (r: { league_id?: string }) => r?.league_id !== leagueId,
    ).length;
  }

  logger.info('[waivers.process-all] complete:', responseBody);
  return ok(c, responseBody);
});

// POST /api/waivers/league/:leagueId/initialize-priority — Initialize waiver priority
waiverRoutes.post('/league/:leagueId/initialize-priority', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');

  try {
    const body = await c.req.json();
    const teamId = body.teamId;
    if (!teamId) {
      return fail(c, AppError.badRequest('teamId is required'));
    }

    const supabase = createUserClient(c.get('userToken'));
    const { error } = await supabase.rpc('create_waiver_priority_for_team', {
      p_league_id: leagueId,
      p_team_id: teamId,
    });

    if (error) {
      const msg = getErrorMessage(error);
      logger.error('[waivers] Failed to initialize waiver priority:', msg);
      return handleError(c, error, 'Failed to initialize waiver priority');
    }

    return ok(c, { success: true });
  } catch (err) {
    return handleError(c, err, 'Failed to initialize waiver priority');
  }
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


/**
 * POST /api/waivers/league/:leagueId/recalculate-priority
 *
 * SETTINGS-ENFORCEMENT (2026-08-16) — the client
 * (WaiverService.recalculateReverseStandingsPriority) has POSTed to this
 * path all along; the route never existed, so `reverse_standings`
 * leagues silently behaved as rolling. The RPC
 * `recalculate_reverse_standings_priority` already exists in the DB —
 * this is purely the missing wire.
 */
waiverRoutes.post('/league/:leagueId/recalculate-priority', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('recalculate_reverse_standings_priority', {
    p_league_id: leagueId,
  });
  if (error) {
    logger.error('[waivers.recalculate-priority] rpc failed:', error);
    return fail(c, AppError.internal(error.message));
  }
  const audit = new AuditService(createUserClient(c.get('userToken')));
  audit.log('ADMIN_ACTION', leagueId, { action: 'waiver_priority_recalc', by: 'commissioner' });
  return ok(c, { success: true, result: data ?? null });
});

export { waiverRoutes };

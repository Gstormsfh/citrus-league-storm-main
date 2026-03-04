import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { validateBody, schemas } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { WaiverService } from '../services/WaiverService';

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
    console.error('[waivers] Failed to fetch league waivers:', JSON.stringify(error));
    return c.json({ error: 'Failed to fetch waivers' }, 500);
  }

  return c.json({ data: claims });
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
    console.error('[waivers] Failed to fetch team waivers:', JSON.stringify(error));
    return c.json({ error: 'Failed to fetch team waivers' }, 500);
  }

  return c.json({ data: claims });
});

// GET /api/waivers/league/:leagueId/priority — Get waiver priority
waiverRoutes.get('/league/:leagueId/priority', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new WaiverService(supabase);

  const { priority, error } = await service.getWaiverPriority(leagueId);
  if (error) {
    return c.json({ error: 'Failed to fetch waiver priority' }, 500);
  }

  return c.json({ data: priority });
});

// GET /api/waivers/league/:leagueId/faab — Get all FAAB budgets
waiverRoutes.get('/league/:leagueId/faab', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new WaiverService(supabase);

  const budgets = await service.getAllFAABBudgets(leagueId);
  return c.json({ data: budgets });
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
      return c.json({ error: 'Failed to fetch settings' }, 500);
    }
    return c.json({ data: settings });
  } catch (err: any) {
    return c.json({ error: err.message }, 403);
  }
});

// POST /api/waivers/league/:leagueId — Submit a waiver claim
waiverRoutes.post('/league/:leagueId', membershipMiddleware, validateBody(schemas.submitWaiverClaim), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = (c as any).get('validatedBody');
  const supabase = createUserClient(c.get('userToken'));
  const service = new WaiverService(supabase);

  const { success, error, claimId } = await service.submitWaiverClaim(
    leagueId,
    body.teamId,
    body.playerId,
    body.dropPlayerId || null,
  );

  if (!success) {
    return c.json({ error: error || 'Failed to submit waiver claim' }, 400);
  }

  return c.json({ data: { claimId } }, 201);
});

// POST /api/waivers/league/:leagueId/faab-bid — Submit a FAAB bid
waiverRoutes.post('/league/:leagueId/faab-bid', membershipMiddleware, validateBody(schemas.submitFAABBid), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = (c as any).get('validatedBody');
  const supabase = createUserClient(c.get('userToken'));
  const service = new WaiverService(supabase);

  const { success, error, claimId } = await service.submitFAABBid(
    leagueId,
    body.teamId,
    body.playerId,
    body.bidAmount,
    body.dropPlayerId || null,
    body.isConditionalDrop || false,
  );

  if (!success) {
    return c.json({ error: error || 'Failed to submit FAAB bid' }, 400);
  }

  return c.json({ data: { claimId } }, 201);
});

// POST /api/waivers/league/:leagueId/add-free-agent — Add free agent (instant)
waiverRoutes.post('/league/:leagueId/add-free-agent', membershipMiddleware, validateBody(schemas.addFreeAgent), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = (c as any).get('validatedBody');
  const supabase = createUserClient(c.get('userToken'));
  const service = new WaiverService(supabase);

  const { success, error } = await service.addFreeAgent(
    leagueId,
    body.teamId,
    body.playerId,
    body.dropPlayerId || null,
    userId,
  );

  if (!success) {
    return c.json({ error: error || 'Failed to add free agent' }, 400);
  }

  return c.json({ success: true });
});

// POST /api/waivers/league/:leagueId/drop-player — Drop player from roster
waiverRoutes.post('/league/:leagueId/drop-player', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new WaiverService(supabase);

  const { success, error } = await service.dropPlayer(leagueId, body.teamId, body.playerId);
  if (!success) {
    return c.json({ error: error || 'Failed to drop player' }, 400);
  }

  return c.json({ success: true });
});

// DELETE /api/waivers/:claimId — Cancel a waiver claim
waiverRoutes.delete('/:claimId', async (c) => {
  const claimId = c.req.param('claimId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new WaiverService(supabase);

  const { success, error } = await service.cancelClaim(claimId);
  if (!success) {
    return c.json({ error: error || 'Failed to cancel claim' }, 400);
  }

  return c.json({ success: true });
});

export { waiverRoutes };

import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware, commissionerMiddleware } from '../middleware/membership';
import { z } from 'zod';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { DraftService } from '../services/DraftService';
import { AppError } from '../lib/errors';
import { ok, created, fail, handleError } from '../lib/responses';

const draftRoutes = new Hono<Env>();

draftRoutes.use('*', authMiddleware);

// GET /api/draft/league/:leagueId/session — Get active draft session
draftRoutes.get('/league/:leagueId/session', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { sessionId, error } = await service.getActiveDraftSession(leagueId);
  if (error) {
    return handleError(c, error, 'Failed to get draft session');
  }

  return ok(c, { sessionId });
});

// GET /api/draft/league/:leagueId/picks — Get draft picks
draftRoutes.get('/league/:leagueId/picks', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const sessionId = c.req.query('sessionId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { picks, error } = await service.getDraftPicks(leagueId, sessionId);
  if (error) {
    return handleError(c, error, 'Failed to fetch draft picks');
  }

  return ok(c, picks);
});

// GET /api/draft/league/:leagueId/order/:roundNumber — Get draft order for a round
draftRoutes.get('/league/:leagueId/order/:roundNumber', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const roundNumber = parseInt(c.req.param('roundNumber'), 10);
  const sessionId = c.req.query('sessionId');

  if (isNaN(roundNumber) || roundNumber < 1) {
    return fail(c, AppError.badRequest('Invalid round number'));
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { order, error } = await service.getDraftOrder(leagueId, roundNumber, sessionId);
  if (error) {
    return handleError(c, error, 'Failed to fetch draft order');
  }

  return ok(c, order);
});

// DELETE /api/draft/league/:leagueId — Hard delete draft data (commissioner only)
draftRoutes.delete('/league/:leagueId', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { error } = await service.hardDeleteDraft(leagueId);
  if (error) {
    return handleError(c, error, 'Failed to delete draft data');
  }

  return ok(c, { success: true });
});

// GET /api/draft/league/:leagueId — Get draft state for a league
draftRoutes.get('/league/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { league, picks, order, error } = await service.getDraftState(leagueId);
  if (error) {
    return handleError(c, error, 'Failed to fetch draft state');
  }

  return ok(c, { league, picks, order });
});

// POST /api/draft/league/:leagueId/pick — Make a draft pick
draftRoutes.post('/league/:leagueId/pick', membershipMiddleware, validateBody(schemas.makeDraftPick), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.makeDraftPick>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { playerId, teamId, pickNumber, roundNumber, draftSessionId, teamsCount } = body;

  const { pick, error, isComplete } = await service.makePick(
    leagueId,
    String(teamId),
    playerId,
    roundNumber,
    pickNumber,
    draftSessionId,
    teamsCount,
  );

  if (error) {
    return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Draft pick failed'));
  }

  return created(c, { pick, isComplete });
});

// POST /api/draft/league/:leagueId/start — Start the draft (commissioner only)
draftRoutes.post('/league/:leagueId/start', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  try {
    const { league, error } = await service.startDraft(leagueId, userId);
    if (error) {
      return fail(c, AppError.badRequest('Failed to start draft'));
    }
    return ok(c, league);
  } catch (err) {
    return handleError(c, err, 'Failed to start draft');
  }
});

// POST /api/draft/league/:leagueId/initialize-order — Initialize draft order
draftRoutes.post('/league/:leagueId/initialize-order', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, AppError.badRequest('Invalid JSON body'));
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { error, sessionId } = await service.initializeDraftOrder(
    leagueId,
    body.teams as Array<{ id: string }>,
    body.totalRounds as number,
    body.customTeamOrder as string[] | undefined,
    body.draftType as string,
  );

  if (error) {
    return fail(c, AppError.badRequest('Failed to initialize draft order'));
  }

  return ok(c, { sessionId });
});

// POST /api/draft/league/:leagueId/reset — Reset draft (commissioner only)
draftRoutes.post('/league/:leagueId/reset', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { error, newSessionId } = await service.resetDraft(leagueId);
  if (error) {
    return fail(c, AppError.badRequest('Failed to reset draft'));
  }

  return ok(c, { newSessionId });
});

// POST /api/draft/league/:leagueId/undo — Undo last pick
draftRoutes.post('/league/:leagueId/undo', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { undone, error } = await service.undoLastPick(leagueId);
  if (error) {
    return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Undo failed'));
  }

  return ok(c, { undone });
});

// POST /api/draft/league/:leagueId/autopick — Autopick for a team
draftRoutes.post('/league/:leagueId/autopick', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, AppError.badRequest('Invalid JSON body'));
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const result = await service.autopickForTeam(
    leagueId,
    body.teamId as string,
    body.sessionId as string,
    body.roundNumber as number,
    body.pickNumber as number,
  );

  if (result.error) {
    return fail(c, AppError.badRequest(typeof result.error === 'string' ? result.error : 'Autopick failed'));
  }

  return ok(c, result);
});

// POST /api/draft/league/:leagueId/full-autopick — Run full autopick draft
draftRoutes.post('/league/:leagueId/full-autopick', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { picks, error } = await service.runFullAutopickDraft(leagueId);
  if (error) {
    return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Full autopick failed'));
  }

  return ok(c, { picks });
});

// GET /api/draft/league/:leagueId/snapshot — Get draft snapshot
draftRoutes.get('/league/:leagueId/snapshot', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { snapshot, error } = await service.getDraftSnapshot(leagueId);
  if (error) {
    return handleError(c, error, 'Failed to fetch snapshot');
  }

  return ok(c, snapshot);
});

// POST /api/draft/league/:leagueId/snapshot — Save draft snapshot
draftRoutes.post('/league/:leagueId/snapshot', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, AppError.badRequest('Invalid JSON body'));
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { snapshotId, error } = await service.saveDraftSnapshot(
    leagueId,
    body.draftSessionId as string,
    body.snapshotData as unknown,
    userId,
  );

  if (error) {
    return fail(c, AppError.badRequest('Failed to save snapshot'));
  }

  return created(c, { snapshotId });
});

// GET /api/draft/league/:leagueId/rankings — Get autopick rankings
draftRoutes.get('/league/:leagueId/rankings', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.query('teamId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { rankings, error } = await service.getAutopickRankings(leagueId, teamId);
  if (error) {
    return handleError(c, error, 'Failed to fetch rankings');
  }

  return ok(c, rankings);
});

// POST /api/draft/league/:leagueId/rankings — Save autopick rankings
draftRoutes.post('/league/:leagueId/rankings', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, AppError.badRequest('Invalid JSON body'));
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { error } = await service.saveAutopickRankings(leagueId, body.teamId as string, body.rankings as Array<{ playerId: number; rank: number; positionCode: string }>);
  if (error) {
    return fail(c, AppError.badRequest('Failed to save rankings'));
  }

  return ok(c, { success: true });
});

export { draftRoutes };

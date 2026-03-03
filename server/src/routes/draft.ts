import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware, commissionerMiddleware } from '../middleware/membership';
import { validateBody, schemas } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { DraftService } from '../services/DraftService';

const draftRoutes = new Hono<Env>();

draftRoutes.use('*', authMiddleware);

// GET /api/draft/league/:leagueId/session — Get active draft session
draftRoutes.get('/league/:leagueId/session', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { sessionId, error } = await service.getActiveDraftSession(leagueId);
  if (error) {
    return c.json({ error: 'Failed to get draft session' }, 500);
  }

  return c.json({ data: { sessionId } });
});

// GET /api/draft/league/:leagueId/picks — Get draft picks
draftRoutes.get('/league/:leagueId/picks', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const sessionId = c.req.query('sessionId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { picks, error } = await service.getDraftPicks(leagueId, sessionId);
  if (error) {
    return c.json({ error: 'Failed to fetch draft picks' }, 500);
  }

  return c.json({ data: picks });
});

// GET /api/draft/league/:leagueId/order/:roundNumber — Get draft order for a round
draftRoutes.get('/league/:leagueId/order/:roundNumber', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const roundNumber = parseInt(c.req.param('roundNumber'), 10);
  const sessionId = c.req.query('sessionId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { order, error } = await service.getDraftOrder(leagueId, roundNumber, sessionId);
  if (error) {
    return c.json({ error: 'Failed to fetch draft order' }, 500);
  }

  return c.json({ data: order });
});

// DELETE /api/draft/league/:leagueId — Hard delete draft data (commissioner only)
draftRoutes.delete('/league/:leagueId', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { error } = await service.hardDeleteDraft(leagueId);
  if (error) {
    return c.json({ error: 'Failed to delete draft data' }, 500);
  }

  return c.json({ data: { success: true } });
});

// GET /api/draft/league/:leagueId — Get draft state for a league
draftRoutes.get('/league/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { league, picks, order, error } = await service.getDraftState(leagueId);
  if (error) {
    return c.json({ error: 'Failed to fetch draft state' }, 500);
  }

  return c.json({ data: { league, picks, order } });
});

// POST /api/draft/league/:leagueId/pick — Make a draft pick
draftRoutes.post('/league/:leagueId/pick', membershipMiddleware, validateBody(schemas.makeDraftPick), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = (c as any).get('validatedBody');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { playerId, teamId, pickNumber, roundNumber, draftSessionId, teamsCount } = body;

  const { pick, error, isComplete } = await service.makePick(
    leagueId,
    teamId,
    playerId,
    roundNumber,
    pickNumber,
    draftSessionId,
    teamsCount,
  );

  if (error) {
    return c.json({ error }, 400);
  }

  return c.json({ data: { pick, isComplete } }, 201);
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
      return c.json({ error: 'Failed to start draft' }, 400);
    }
    return c.json({ data: league });
  } catch (err: any) {
    return c.json({ error: err.message }, 403);
  }
});

// POST /api/draft/league/:leagueId/initialize-order — Initialize draft order
draftRoutes.post('/league/:leagueId/initialize-order', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { error, sessionId } = await service.initializeDraftOrder(
    leagueId,
    body.teams,
    body.totalRounds,
    body.customTeamOrder,
    body.draftType,
  );

  if (error) {
    return c.json({ error: 'Failed to initialize draft order' }, 400);
  }

  return c.json({ data: { sessionId } });
});

// POST /api/draft/league/:leagueId/reset — Reset draft (commissioner only)
draftRoutes.post('/league/:leagueId/reset', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { error, newSessionId } = await service.resetDraft(leagueId);
  if (error) {
    return c.json({ error: 'Failed to reset draft' }, 400);
  }

  return c.json({ data: { newSessionId } });
});

// POST /api/draft/league/:leagueId/undo — Undo last pick
draftRoutes.post('/league/:leagueId/undo', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { undone, error } = await service.undoLastPick(leagueId);
  if (error) {
    return c.json({ error }, 400);
  }

  return c.json({ data: { undone } });
});

// POST /api/draft/league/:leagueId/autopick — Autopick for a team
draftRoutes.post('/league/:leagueId/autopick', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const result = await service.autopickForTeam(
    leagueId,
    body.teamId,
    body.sessionId,
    body.roundNumber,
    body.pickNumber,
  );

  if (result.error) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ data: result });
});

// POST /api/draft/league/:leagueId/full-autopick — Run full autopick draft
draftRoutes.post('/league/:leagueId/full-autopick', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { picks, error } = await service.runFullAutopickDraft(leagueId);
  if (error) {
    return c.json({ error }, 400);
  }

  return c.json({ data: { picks } });
});

// GET /api/draft/league/:leagueId/snapshot — Get draft snapshot
draftRoutes.get('/league/:leagueId/snapshot', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { snapshot, error } = await service.getDraftSnapshot(leagueId);
  if (error) {
    return c.json({ error: 'Failed to fetch snapshot' }, 500);
  }

  return c.json({ data: snapshot });
});

// POST /api/draft/league/:leagueId/snapshot — Save draft snapshot
draftRoutes.post('/league/:leagueId/snapshot', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { snapshotId, error } = await service.saveDraftSnapshot(
    leagueId,
    body.draftSessionId,
    body.snapshotData,
    userId,
  );

  if (error) {
    return c.json({ error: 'Failed to save snapshot' }, 400);
  }

  return c.json({ data: { snapshotId } }, 201);
});

// GET /api/draft/league/:leagueId/rankings — Get autopick rankings
draftRoutes.get('/league/:leagueId/rankings', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.query('teamId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { rankings, error } = await service.getAutopickRankings(leagueId, teamId);
  if (error) {
    return c.json({ error: 'Failed to fetch rankings' }, 500);
  }

  return c.json({ data: rankings });
});

// POST /api/draft/league/:leagueId/rankings — Save autopick rankings
draftRoutes.post('/league/:leagueId/rankings', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new DraftService(supabase);

  const { error } = await service.saveAutopickRankings(leagueId, body.teamId, body.rankings);
  if (error) {
    return c.json({ error: 'Failed to save rankings' }, 400);
  }

  return c.json({ success: true });
});

export { draftRoutes };

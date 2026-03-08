import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { BestBallService } from '../services/BestBallService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';

const bestballRoutes = new Hono<Env>();
bestballRoutes.use('*', authMiddleware);

// POST /api/bestball/league/:leagueId/optimize
bestballRoutes.post('/league/:leagueId/optimize', membershipMiddleware, validateBody(schemas.bestballOptimize), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.bestballOptimize>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new BestBallService(supabase);
  const result = await service.triggerOptimization(leagueId, body.date);
  if (result.error) return fail(c, AppError.badRequest(result.error));
  return ok(c, result.results);
});

// POST /api/bestball/league/:leagueId/optimize-week
bestballRoutes.post('/league/:leagueId/optimize-week', membershipMiddleware, validateBody(schemas.bestballOptimizeWeek), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.bestballOptimizeWeek>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new BestBallService(supabase);
  const result = await service.triggerWeekOptimization(leagueId, body.weekStartDate, body.weekEndDate);
  return ok(c, { daysOptimized: result.daysOptimized });
});

// POST /api/bestball/league/:leagueId/weekly-data — Get data for weekly best ball calculation
bestballRoutes.post('/league/:leagueId/weekly-data', membershipMiddleware, validateBody(schemas.bestballWeeklyData), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.bestballWeeklyData>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new BestBallService(supabase);
  const result = await service.getWeeklyBestBallData(leagueId, body.teamId, body.weekNumber);
  return ok(c, result);
});

// GET /api/bestball/league/:leagueId/teams — Get team IDs for league-wide best ball
bestballRoutes.get('/league/:leagueId/teams', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new BestBallService(supabase);
  const teams = await service.getLeagueTeamIds(leagueId);
  return ok(c, teams);
});

export { bestballRoutes };

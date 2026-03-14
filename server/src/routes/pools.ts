import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { z } from 'zod';
import { validateBody, getValidatedBody } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { PoolService } from '../services/PoolService';
import { ok, handleError } from '../lib/responses';

const poolRoutes = new Hono<Env>();

poolRoutes.use('*', authMiddleware);

// ── Validation Schemas ───────────────────────────────────────────────

const pickemPicksSchema = z.object({
  leagueId: z.string().min(1),
  weekNumber: z.number().int().min(1),
  picks: z.array(z.object({
    game_id: z.string().min(1),
    picked_team: z.string().min(1),
    spread_value: z.number().optional(),
  })).min(1, 'At least one pick is required'),
});

const survivorPickSchema = z.object({
  leagueId: z.string().min(1),
  weekNumber: z.number().int().min(1),
  pickedTeam: z.string().min(1),
});

const confidencePicksSchema = z.object({
  leagueId: z.string().min(1),
  weekNumber: z.number().int().min(1),
  picks: z.array(z.object({
    game_id: z.string().min(1),
    picked_team: z.string().min(1),
    confidence_points: z.number().int().min(1),
  })).min(1, 'At least one pick is required'),
});

const scorePickemSchema = z.object({
  weekNumber: z.number().int().min(1),
  gameResults: z.array(z.object({
    game_id: z.string().min(1),
    winning_team: z.string().min(1),
  })),
});

const scorePickemATSSchema = z.object({
  weekNumber: z.number().int().min(1),
  gameResults: z.array(z.object({
    game_id: z.string().min(1),
    home_team: z.string().min(1),
    away_team: z.string().min(1),
    home_score: z.number(),
    away_score: z.number(),
    status: z.string(),
  })),
});

const scoreSurvivorSchema = z.object({
  weekNumber: z.number().int().min(1),
  teamResults: z.array(z.object({
    team: z.string().min(1),
    won: z.boolean(),
  })),
});

const scoreConfidenceSchema = z.object({
  weekNumber: z.number().int().min(1),
  gameResults: z.array(z.object({
    game_id: z.string().min(1),
    winning_team: z.string().min(1),
  })),
});

// ── Shared Helper ────────────────────────────────────────────────────

function createPoolService(c: { get(key: 'userToken'): string }) {
  return new PoolService(createUserClient(c.get('userToken')));
}

// ── Week Info ────────────────────────────────────────────────────────

// GET /api/pools/current-week
poolRoutes.get('/current-week', (c) => {
  const service = createPoolService(c);
  return ok(c, { week: service.getCurrentWeek() });
});

// GET /api/pools/week/:weekNumber/games
poolRoutes.get('/week/:weekNumber/games', async (c) => {
  try {
    const weekNumber = parseInt(c.req.param('weekNumber'), 10);
    if (isNaN(weekNumber) || weekNumber < 1) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid week number' } }, 400);
    }
    const service = createPoolService(c);
    const games = await service.getGamesForWeek(weekNumber);
    return ok(c, games);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch week games');
  }
});

// ── Pick'em Routes ───────────────────────────────────────────────────

// POST /api/pools/pickem/picks — Submit/update Pick'em picks
poolRoutes.post('/pickem/picks', validateBody(pickemPicksSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = getValidatedBody<z.infer<typeof pickemPicksSchema>>(c);
    const service = createPoolService(c);
    const result = await service.submitPickemPicks(body.leagueId, userId, body.weekNumber, body.picks as any);
    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to submit picks');
  }
});

// GET /api/pools/pickem/:leagueId/picks?week=N
poolRoutes.get('/pickem/:leagueId/picks', membershipMiddleware, async (c) => {
  try {
    const userId = c.get('userId');
    const leagueId = c.req.param('leagueId');
    const week = parseInt(c.req.query('week') || '0', 10);
    if (!week) return c.json({ error: { code: 'BAD_REQUEST', message: 'week query param required' } }, 400);
    const service = createPoolService(c);
    const picks = await service.getPickemPicks(leagueId, userId, week);
    return ok(c, picks);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch picks');
  }
});

// GET /api/pools/pickem/:leagueId/standings
poolRoutes.get('/pickem/:leagueId/standings', membershipMiddleware, async (c) => {
  try {
    const service = createPoolService(c);
    const leagueId = c.req.param('leagueId');
    const standings = await service.getPickemStandings(leagueId);
    return ok(c, standings);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch standings');
  }
});

// POST /api/pools/pickem/:leagueId/score — Score a week (admin/scoring pipeline)
poolRoutes.post('/pickem/:leagueId/score', membershipMiddleware, validateBody(scorePickemSchema), async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const body = getValidatedBody<z.infer<typeof scorePickemSchema>>(c);
    const service = createPoolService(c);
    const result = await service.scorePickemWeek(leagueId, body.weekNumber, body.gameResults as any);
    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to score picks');
  }
});

// POST /api/pools/pickem/:leagueId/score-ats — Score ATS picks
poolRoutes.post('/pickem/:leagueId/score-ats', membershipMiddleware, validateBody(scorePickemATSSchema), async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const body = getValidatedBody<z.infer<typeof scorePickemATSSchema>>(c);
    const service = createPoolService(c);
    const result = await service.scorePickemWeekATS(leagueId, body.weekNumber, body.gameResults as any);
    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to score ATS picks');
  }
});

// ── Survivor Routes ──────────────────────────────────────────────────

// POST /api/pools/survivor/pick — Submit a survivor pick
poolRoutes.post('/survivor/pick', validateBody(survivorPickSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = getValidatedBody<z.infer<typeof survivorPickSchema>>(c);
    const service = createPoolService(c);
    const result = await service.submitSurvivorPick(body.leagueId, userId, body.weekNumber, body.pickedTeam);
    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to submit survivor pick');
  }
});

// GET /api/pools/survivor/:leagueId/standings
poolRoutes.get('/survivor/:leagueId/standings', membershipMiddleware, async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const service = createPoolService(c);
    const standings = await service.getSurvivorStandings(leagueId);
    return ok(c, standings);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch survivor standings');
  }
});

// GET /api/pools/survivor/:leagueId/history?userId=X
poolRoutes.get('/survivor/:leagueId/history', membershipMiddleware, async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const userId = c.req.query('userId') || c.get('userId');
    const service = createPoolService(c);
    const history = await service.getSurvivorPickHistory(leagueId, userId);
    return ok(c, history);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch survivor history');
  }
});

// GET /api/pools/survivor/:leagueId/used-teams?userId=X
poolRoutes.get('/survivor/:leagueId/used-teams', membershipMiddleware, async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const userId = c.req.query('userId') || c.get('userId');
    const service = createPoolService(c);
    const teams = await service.getSurvivorUsedTeams(leagueId, userId);
    return ok(c, teams);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch used teams');
  }
});

// GET /api/pools/survivor/:leagueId/eliminated?userId=X
poolRoutes.get('/survivor/:leagueId/eliminated', membershipMiddleware, async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const userId = c.req.query('userId') || c.get('userId');
    const service = createPoolService(c);
    const eliminated = await service.checkSurvivorEliminated(leagueId, userId);
    return ok(c, { eliminated });
  } catch (err) {
    return handleError(c, err, 'Failed to check elimination status');
  }
});

// POST /api/pools/survivor/:leagueId/score — Score a week
poolRoutes.post('/survivor/:leagueId/score', membershipMiddleware, validateBody(scoreSurvivorSchema), async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const body = getValidatedBody<z.infer<typeof scoreSurvivorSchema>>(c);
    const service = createPoolService(c);
    const result = await service.scoreSurvivorWeek(leagueId, body.weekNumber, body.teamResults as any);
    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to score survivor picks');
  }
});

// ── Confidence Routes ────────────────────────────────────────────────

// POST /api/pools/confidence/picks — Submit confidence picks
poolRoutes.post('/confidence/picks', validateBody(confidencePicksSchema), async (c) => {
  try {
    const userId = c.get('userId');
    const body = getValidatedBody<z.infer<typeof confidencePicksSchema>>(c);
    const service = createPoolService(c);
    const result = await service.submitConfidencePicks(body.leagueId, userId, body.weekNumber, body.picks as any);
    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to submit confidence picks');
  }
});

// GET /api/pools/confidence/:leagueId/picks?week=N
poolRoutes.get('/confidence/:leagueId/picks', membershipMiddleware, async (c) => {
  try {
    const userId = c.get('userId');
    const leagueId = c.req.param('leagueId');
    const week = parseInt(c.req.query('week') || '0', 10);
    if (!week) return c.json({ error: { code: 'BAD_REQUEST', message: 'week query param required' } }, 400);
    const service = createPoolService(c);
    const picks = await service.getConfidencePicks(leagueId, userId, week);
    return ok(c, picks);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch confidence picks');
  }
});

// GET /api/pools/confidence/:leagueId/standings
poolRoutes.get('/confidence/:leagueId/standings', membershipMiddleware, async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const service = createPoolService(c);
    const standings = await service.getConfidenceStandings(leagueId);
    return ok(c, standings);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch confidence standings');
  }
});

// POST /api/pools/confidence/:leagueId/score — Score a week
poolRoutes.post('/confidence/:leagueId/score', membershipMiddleware, validateBody(scoreConfidenceSchema), async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    const body = getValidatedBody<z.infer<typeof scoreConfidenceSchema>>(c);
    const service = createPoolService(c);
    const result = await service.scoreConfidenceWeek(leagueId, body.weekNumber, body.gameResults as any);
    return ok(c, result);
  } catch (err) {
    return handleError(c, err, 'Failed to score confidence picks');
  }
});

export { poolRoutes };

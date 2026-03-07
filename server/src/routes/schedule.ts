import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { ScheduleService } from '../services/ScheduleService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';

const scheduleRoutes = new Hono<Env>();

// Schedule routes require authentication
scheduleRoutes.use('*', authMiddleware);

// GET /api/schedule/games — Get NHL games
scheduleRoutes.get('/games', async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new ScheduleService(supabase);

  const date = c.req.query('date');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const team = c.req.query('team');

  if (date) {
    if (team) {
      const { games, error } = await service.getGamesForTeam(team, date, date);
      if (error) return handleError(c, error, 'Failed to fetch games');
      return ok(c, games);
    }
    const { games, error } = await service.getGamesForDateRange(date, date);
    if (error) return handleError(c, error, 'Failed to fetch games');
    return ok(c, games);
  }

  if (startDate) {
    if (team) {
      const { games, error } = await service.getGamesForTeam(team, startDate, endDate);
      if (error) return handleError(c, error, 'Failed to fetch games');
      return ok(c, games);
    }
    const { games, error } = await service.getGamesForDateRange(startDate, endDate || startDate);
    if (error) return handleError(c, error, 'Failed to fetch games');
    return ok(c, games);
  }

  if (team) {
    const { games, error } = await service.getGamesForTeam(team);
    if (error) return handleError(c, error, 'Failed to fetch games');
    return ok(c, games);
  }

  return fail(c, AppError.badRequest('Provide date, startDate+endDate, or team query parameter'));
});

// GET /api/schedule/games/teams — Batch get games for multiple teams
scheduleRoutes.get('/games/teams', async (c) => {
  const teams = c.req.query('teams');
  if (!teams) {
    return fail(c, AppError.badRequest('teams query parameter required (comma-separated)'));
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new ScheduleService(supabase);
  const teamAbbrevs = teams.split(',').map((t) => t.trim());
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  const { gamesByTeam, error } = await service.getGamesForTeams(teamAbbrevs, startDate, endDate);
  if (error) return handleError(c, error, 'Failed to fetch games');

  const result: Record<string, any[]> = {};
  gamesByTeam.forEach((games, team) => {
    result[team] = games;
  });

  return ok(c, result);
});

// GET /api/schedule/games/next — Get next game for a team
scheduleRoutes.get('/games/next', async (c) => {
  const team = c.req.query('team');
  if (!team) {
    return fail(c, AppError.badRequest('team query parameter required'));
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new ScheduleService(supabase);

  const { game, error } = await service.getNextGameForTeam(team);
  if (error) return handleError(c, error, 'Failed to fetch next game');
  return ok(c, game);
});

// GET /api/schedule/fantasy-weeks — Get fantasy week definitions
scheduleRoutes.get('/fantasy-weeks', async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new ScheduleService(supabase);

  const { weeks, error } = await service.getFantasyWeeks();
  if (error) return handleError(c, error, 'Failed to fetch fantasy weeks');
  return ok(c, weeks);
});

export { scheduleRoutes };

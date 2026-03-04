import { Hono } from 'hono';
import type { Env } from '../app';
import { optionalAuthMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { ScheduleService } from '../services/ScheduleService';

const scheduleRoutes = new Hono<Env>();

// GET /api/schedule/games — Get NHL games
scheduleRoutes.get('/games', optionalAuthMiddleware, async (c) => {
  const token = c.get('userToken');
  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  const supabase = createUserClient(token);
  const service = new ScheduleService(supabase);

  const date = c.req.query('date');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const team = c.req.query('team');

  if (date) {
    if (team) {
      const { games, error } = await service.getGamesForTeam(team, date, date);
      if (error) return c.json({ error: error.message }, 500);
      return c.json({ data: games });
    }
    const { games, error } = await service.getGamesForDateRange(date, date);
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ data: games });
  }

  if (startDate) {
    if (team) {
      const { games, error } = await service.getGamesForTeam(team, startDate, endDate);
      if (error) return c.json({ error: error.message }, 500);
      return c.json({ data: games });
    }
    const { games, error } = await service.getGamesForDateRange(startDate, endDate || startDate);
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ data: games });
  }

  if (team) {
    const { games, error } = await service.getGamesForTeam(team);
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ data: games });
  }

  return c.json({ error: 'Provide date, startDate+endDate, or team query parameter' }, 400);
});

// GET /api/schedule/games/teams — Batch get games for multiple teams
scheduleRoutes.get('/games/teams', optionalAuthMiddleware, async (c) => {
  const token = c.get('userToken');
  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  const teams = c.req.query('teams');
  if (!teams) {
    return c.json({ error: 'teams query parameter required (comma-separated)' }, 400);
  }

  const supabase = createUserClient(token);
  const service = new ScheduleService(supabase);
  const teamAbbrevs = teams.split(',').map((t) => t.trim());
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  const { gamesByTeam, error } = await service.getGamesForTeams(teamAbbrevs, startDate, endDate);
  if (error) return c.json({ error: error.message }, 500);

  const result: Record<string, any[]> = {};
  gamesByTeam.forEach((games, team) => {
    result[team] = games;
  });

  return c.json({ data: result });
});

// GET /api/schedule/games/next — Get next game for a team
scheduleRoutes.get('/games/next', optionalAuthMiddleware, async (c) => {
  const token = c.get('userToken');
  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  const team = c.req.query('team');
  if (!team) {
    return c.json({ error: 'team query parameter required' }, 400);
  }

  const supabase = createUserClient(token);
  const service = new ScheduleService(supabase);

  const { game, error } = await service.getNextGameForTeam(team);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: game });
});

// GET /api/schedule/fantasy-weeks — Get fantasy week definitions
scheduleRoutes.get('/fantasy-weeks', optionalAuthMiddleware, async (c) => {
  const token = c.get('userToken');
  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  const supabase = createUserClient(token);
  const service = new ScheduleService(supabase);

  const { weeks, error } = await service.getFantasyWeeks();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data: weeks });
});

export { scheduleRoutes };

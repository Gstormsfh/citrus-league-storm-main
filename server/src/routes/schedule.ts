import { Hono } from 'hono';
import type { Env } from '../app';
import { optionalAuthMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { COLUMNS } from '@citrus/shared';

const scheduleRoutes = new Hono<Env>();

// GET /api/schedule/games — Get NHL games for a date range
scheduleRoutes.get('/games', optionalAuthMiddleware, async (c) => {
  const token = c.get('userToken');
  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  const supabase = createUserClient(token);

  const date = c.req.query('date');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const team = c.req.query('team');

  let query = supabase
    .from('nhl_games')
    .select(COLUMNS.NHL_GAME)
    .order('game_date', { ascending: true });

  if (date) {
    query = query.eq('game_date', date);
  } else if (startDate && endDate) {
    query = query.gte('game_date', startDate).lte('game_date', endDate);
  }

  if (team) {
    query = query.or(`home_team.eq.${team},away_team.eq.${team}`);
  }

  const { data, error } = await query;

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ data: data || [] });
});

// GET /api/schedule/fantasy-weeks — Get fantasy week definitions
scheduleRoutes.get('/fantasy-weeks', optionalAuthMiddleware, async (c) => {
  const token = c.get('userToken');
  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  const supabase = createUserClient(token);

  const { data, error } = await supabase
    .from('fantasy_weeks')
    .select('*')
    .order('week_number', { ascending: true });

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ data: data || [] });
});

export { scheduleRoutes };

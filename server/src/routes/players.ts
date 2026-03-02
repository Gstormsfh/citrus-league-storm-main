import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { COLUMNS } from '@citrus/shared';

const playerRoutes = new Hono<Env>();

// GET /api/players — Search/list players (auth optional for public data)
playerRoutes.get('/', optionalAuthMiddleware, async (c) => {
  const token = c.get('userToken');
  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  const supabase = createUserClient(token);

  const search = c.req.query('search');
  const position = c.req.query('position');
  const team = c.req.query('team');
  const limit = parseInt(c.req.query('limit') || '50', 10);

  let query = supabase
    .from('players')
    .select('id, full_name, position, team, jersey_number, status, headshot_url')
    .limit(limit);

  if (search) {
    query = query.ilike('full_name', `%${search}%`);
  }
  if (position) {
    query = query.eq('position', position);
  }
  if (team) {
    query = query.eq('team', team);
  }

  const { data, error } = await query;

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ data: data || [] });
});

// GET /api/players/:playerId — Get a single player
playerRoutes.get('/:playerId', authMiddleware, async (c) => {
  const playerId = c.req.param('playerId');
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .single();

  if (error) {
    return c.json({ error: 'Player not found' }, 404);
  }

  return c.json({ data });
});

// GET /api/players/:playerId/stats — Get player season stats
playerRoutes.get('/:playerId/stats', authMiddleware, async (c) => {
  const playerId = c.req.param('playerId');
  const season = c.req.query('season');
  const supabase = createUserClient(c.get('userToken'));

  let query = supabase
    .from('player_season_stats')
    .select(COLUMNS.PLAYER_STATS)
    .eq('player_id', playerId);

  if (season) {
    query = query.eq('season', parseInt(season, 10));
  }

  const { data, error } = await query;

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ data: data || [] });
});

// GET /api/players/:playerId/projections — Get player projections
playerRoutes.get('/:playerId/projections', authMiddleware, async (c) => {
  const playerId = c.req.param('playerId');
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase
    .from('player_projected_stats')
    .select(COLUMNS.PLAYER_PROJECTED_STATS)
    .eq('player_id', playerId)
    .order('projection_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ data });
});

export { playerRoutes };

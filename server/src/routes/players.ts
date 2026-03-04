import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { PlayerService } from '../services/PlayerService';

const playerRoutes = new Hono<Env>();

// GET /api/players — Get all players with stats (primary endpoint)
playerRoutes.get('/', optionalAuthMiddleware, async (c) => {
  const token = c.get('userToken');
  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  const supabase = createUserClient(token);
  const service = new PlayerService(supabase);

  const search = c.req.query('search');
  const position = c.req.query('position');
  const limit = parseInt(c.req.query('limit') || '0', 10);

  if (search) {
    const { players } = await service.searchPlayers(search);
    return c.json({ data: limit ? players.slice(0, limit) : players });
  }

  const { players, error } = await service.getAllPlayers();
  if (error) {
    return c.json({ error: 'Failed to fetch players' }, 500);
  }

  let filtered = players;
  if (position) {
    filtered = filtered.filter((p: any) =>
      p.position === position || p.eligible_positions?.includes(position)
    );
  }
  if (limit) {
    filtered = filtered.slice(0, limit);
  }

  return c.json({ data: filtered });
});

// GET /api/players/trending — Get trending players (platform-wide)
playerRoutes.get('/trending', authMiddleware, async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new PlayerService(supabase);
  const daysBack = parseInt(c.req.query('days') || '7', 10);

  const { trending, error } = await service.getTrendingPlayers(daysBack);
  if (error) {
    return c.json({ error: 'Failed to fetch trending' }, 500);
  }

  const data = Array.from(trending.entries()).map(([playerId, stats]) => ({
    playerId,
    ...stats,
  }));

  return c.json({ data });
});

// GET /api/players/by-ids — Get players by IDs (batch)
playerRoutes.get('/by-ids', authMiddleware, async (c) => {
  const ids = c.req.query('ids');
  if (!ids) {
    return c.json({ error: 'ids query parameter required' }, 400);
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new PlayerService(supabase);
  const playerIds = ids.split(',').map((id) => id.trim());

  const { players, error } = await service.getPlayersByIds(playerIds);
  if (error) {
    return c.json({ error: 'Failed to fetch players' }, 500);
  }

  return c.json({ data: players });
});

// GET /api/players/:playerId — Get a single player
playerRoutes.get('/:playerId', authMiddleware, async (c) => {
  const playerId = c.req.param('playerId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new PlayerService(supabase);

  const { player, error } = await service.getPlayer(playerId);
  if (error || !player) {
    return c.json({ error: 'Player not found' }, 404);
  }

  return c.json({ data: player });
});

// GET /api/players/:playerId/stats — Get player season stats
playerRoutes.get('/:playerId/stats', authMiddleware, async (c) => {
  const playerId = c.req.param('playerId');
  const season = c.req.query('season');
  const supabase = createUserClient(c.get('userToken'));
  const service = new PlayerService(supabase);

  const { stats, error } = await service.getPlayerStats(
    playerId,
    season ? parseInt(season, 10) : undefined,
  );

  if (error) {
    return c.json({ error: 'Failed to fetch stats' }, 500);
  }

  return c.json({ data: stats });
});

// GET /api/players/:playerId/projections — Get player projections
// ?startDate=YYYY-MM-DD returns all projections from that date onward
playerRoutes.get('/:playerId/projections', authMiddleware, async (c) => {
  const playerId = c.req.param('playerId');
  const startDate = c.req.query('startDate');
  const supabase = createUserClient(c.get('userToken'));

  try {
    // Direct query to bypass any cached COLUMNS import issues
    let query = supabase
      .from('player_projected_stats')
      .select('projection_id, player_id, projection_date, game_id, calculation_method, total_projected_points, projected_goals, projected_assists, projected_sog, projected_blocks, projected_ppp, projected_shp, projected_hits, projected_pim, projected_wins, projected_saves, projected_shutouts, projected_goals_against, projected_gaa, projected_save_pct, shrinkage_weight, opponent_adjustment, confidence_score, dynamic_confidence, likely_low, likely_high, confidence_label, projection_mean, projection_std_dev, created_at, updated_at')
      .eq('player_id', parseInt(String(playerId), 10))
      .order('projection_date', { ascending: true });

    if (startDate) {
      query = query.gte('projection_date', startDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error(`[players/:id/projections] Supabase error for player ${playerId}:`, JSON.stringify({
        message: error.message,
        details: (error as any).details,
        hint: (error as any).hint,
        code: (error as any).code,
      }));
      return c.json({ error: 'Failed to fetch projections', details: error.message }, 500);
    }

    return c.json({ data: data || [] });
  } catch (err: any) {
    console.error(`[players/:id/projections] Unexpected error for player ${playerId}:`, err.message, err.stack);
    return c.json({ error: 'Failed to fetch projections', details: err.message }, 500);
  }
});

export { playerRoutes };

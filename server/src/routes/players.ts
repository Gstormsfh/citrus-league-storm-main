import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { PlayerService } from '../services/PlayerService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';
import { logger, CURRENT_SEASON } from '@citrus/shared';

const playerRoutes = new Hono<Env>();

// GET /api/players — Get all players with stats (primary endpoint)
playerRoutes.get('/', authMiddleware, async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new PlayerService(supabase);

  const search = c.req.query('search');
  const position = c.req.query('position');
  const rawLimit = parseInt(c.req.query('limit') || '0', 10);
  const limit = isNaN(rawLimit) ? 0 : Math.min(rawLimit, 1000);

  if (search) {
    const { players } = await service.searchPlayers(search);
    return ok(c, limit ? players.slice(0, limit) : players);
  }

  const { players, error } = await service.getAllPlayers();
  if (error) {
    return handleError(c, error, 'Failed to fetch players');
  }

  let filtered = players;
  if (position) {
    filtered = filtered.filter((p: { position?: string; eligible_positions?: string[] }) =>
      p.position === position || p.eligible_positions?.includes(position)
    );
  }
  if (limit) {
    filtered = filtered.slice(0, limit);
  }

  return ok(c, filtered);
});

// GET /api/players/trending — Get trending players (platform-wide)
playerRoutes.get('/trending', authMiddleware, async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new PlayerService(supabase);
  const daysBack = parseInt(c.req.query('days') || '7', 10);

  const { trending, error } = await service.getTrendingPlayers(daysBack);
  if (error) {
    return handleError(c, error, 'Failed to fetch trending');
  }

  const data = Array.from(trending.entries()).map(([playerId, stats]) => ({
    playerId,
    ...stats,
  }));

  return ok(c, data);
});

// GET /api/players/by-ids — Get players by IDs (batch)
playerRoutes.get('/by-ids', authMiddleware, async (c) => {
  const ids = c.req.query('ids');
  if (!ids) {
    return fail(c, AppError.badRequest('ids query parameter required'));
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new PlayerService(supabase);
  const playerIds = ids.split(',').map((id) => id.trim());

  const { players, error } = await service.getPlayersByIds(playerIds);
  if (error) {
    return handleError(c, error, 'Failed to fetch players');
  }

  return ok(c, players);
});

// GET /api/players/ros-projections — Get rest-of-season projections (top unrostered)
playerRoutes.get('/ros-projections', authMiddleware, async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const limit = parseInt(c.req.query('limit') || '200', 10);

  const { data, error } = await supabase
    .from('player_ros_projections')
    .select('player_id, player_name, position, team_abbrev, total_projected_points, avg_points_per_game, games_remaining')
    .eq('season', CURRENT_SEASON)
    .gt('total_projected_points', 0)
    .gt('games_remaining', 0)
    .order('total_projected_points', { ascending: false })
    .limit(Math.min(limit, 500));

  if (error) {
    return handleError(c, error, 'Failed to fetch ROS projections');
  }

  return ok(c, data || []);
});

// GET /api/players/projections/batch — Batch player projections
playerRoutes.get('/projections/batch', authMiddleware, async (c) => {
  const ids = c.req.query('ids');
  if (!ids) {
    return fail(c, AppError.badRequest('ids query parameter required'));
  }

  const playerIds = ids.split(',').map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id));
  if (playerIds.length === 0) {
    return fail(c, AppError.badRequest('No valid player IDs provided'));
  }

  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const season = c.req.query('season');
  const supabase = createUserClient(c.get('userToken'));

  try {
    let query = supabase
      .from('player_projected_stats')
      .select('player_id, total_projected_points, projection_date, projected_goals, projected_assists, projected_sog, projected_blocks, projected_hits, projected_pim, projected_wins, projected_saves, projected_goals_against')
      .in('player_id', playerIds);

    if (startDate) {
      query = query.gte('projection_date', startDate);
    }
    if (endDate) {
      query = query.lte('projection_date', endDate);
    }
    if (season) {
      query = query.eq('season', parseInt(season, 10));
    }

    const { data, error } = await query;

    if (error) {
      return handleError(c, error, 'Failed to fetch batch projections');
    }

    return ok(c, data || []);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch batch projections');
  }
});

// GET /api/players/directory — Get player directory entries
playerRoutes.get('/directory', authMiddleware, async (c) => {
  const ids = c.req.query('ids');
  if (!ids) {
    return fail(c, AppError.badRequest('ids query parameter required'));
  }

  const playerIds = ids.split(',').map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id));
  if (playerIds.length === 0) {
    return fail(c, AppError.badRequest('No valid player IDs provided'));
  }

  const season = c.req.query('season');
  const supabase = createUserClient(c.get('userToken'));

  try {
    let query = supabase
      .from('player_directory')
      .select('player_id, position_code')
      .in('player_id', playerIds);

    if (season) {
      query = query.eq('season', parseInt(season, 10));
    }

    const { data, error } = await query;

    if (error) {
      return handleError(c, error, 'Failed to fetch player directory');
    }

    return ok(c, data || []);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch player directory');
  }
});

// GET /api/players/:playerId — Get a single player
playerRoutes.get('/:playerId', authMiddleware, async (c) => {
  const playerId = c.req.param('playerId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new PlayerService(supabase);

  const { player, error } = await service.getPlayer(playerId);
  if (error || !player) {
    return fail(c, AppError.notFound('Player'));
  }

  return ok(c, player);
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
    return handleError(c, error, 'Failed to fetch stats');
  }

  return ok(c, stats);
});

// GET /api/players/:playerId/projections — Get player projections
playerRoutes.get('/:playerId/projections', authMiddleware, async (c) => {
  const playerId = c.req.param('playerId');
  const startDate = c.req.query('startDate');
  const supabase = createUserClient(c.get('userToken'));

  try {
    const coreColumns = [
      'projection_id', 'player_id', 'game_id', 'projection_date', 'season',
      'projected_goals', 'projected_assists', 'projected_sog', 'projected_blocks',
      'projected_ppp', 'projected_shp', 'projected_hits', 'projected_pim',
      'projected_xg', 'total_projected_points',
      'base_ppg', 'shrinkage_weight', 'finishing_multiplier',
      'opponent_adjustment', 'b2b_penalty', 'home_away_adjustment',
      'calculation_method', 'confidence_score',
      'projected_wins', 'projected_saves', 'projected_shutouts',
      'projected_goals_against', 'projected_gaa', 'projected_save_pct',
      'is_goalie', 'starter_confirmed',
      'opponent_abbrev', 'is_home_game', 'matchup_difficulty',
      'created_at', 'updated_at',
    ].join(', ');

    let query = supabase
      .from('player_projected_stats')
      .select(coreColumns)
      .eq('player_id', parseInt(String(playerId), 10))
      .order('projection_date', { ascending: true });

    if (startDate) {
      query = query.gte('projection_date', startDate);
    }

    const { data, error } = await query;

    if (error) {
      const errObj = error as { message: string; details?: string; hint?: string; code?: string };
      logger.error(`[players/:id/projections] Supabase error for player ${playerId}:`, JSON.stringify({
        message: errObj.message,
        details: errObj.details,
        hint: errObj.hint,
        code: errObj.code,
      }));
      return handleError(c, error, 'Failed to fetch projections');
    }

    return ok(c, data || []);
  } catch (err) {
    logger.error(`[players/:id/projections] Unexpected error for player ${playerId}:`, err);
    return handleError(c, err, 'Failed to fetch projections');
  }
});

export { playerRoutes };

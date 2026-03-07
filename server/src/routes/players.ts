import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { PlayerService } from '../services/PlayerService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';
import { logger } from '@citrus/shared';

const playerRoutes = new Hono<Env>();

// GET /api/players — Get all players with stats (primary endpoint)
playerRoutes.get('/', optionalAuthMiddleware, async (c) => {
  const token = c.get('userToken');
  if (!token) {
    return fail(c, AppError.unauthorized());
  }
  const supabase = createUserClient(token);
  const service = new PlayerService(supabase);

  const search = c.req.query('search');
  const position = c.req.query('position');
  const limit = parseInt(c.req.query('limit') || '0', 10);

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
    filtered = filtered.filter((p: any) =>
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
      logger.error(`[players/:id/projections] Supabase error for player ${playerId}:`, JSON.stringify({
        message: error.message,
        details: (error as any).details,
        hint: (error as any).hint,
        code: (error as any).code,
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

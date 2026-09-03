import { Hono } from 'hono';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { createUserClient, getSupabaseAdmin } from '../lib/supabase';
import { PlayerService } from '../services/PlayerService';
import {
  PlayerDashboardService,
  parsePlayerDashboardRequest,
} from '../services/PlayerDashboardService';
import { NhlPlayoffStateService } from '../services/NhlPlayoffStateService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';
import { logger, getCurrentSeason, getProjectionsSeason } from '@citrus/shared';

const playerRoutes = new Hono<Env>();

// GET /api/players — Get all players with stats (primary endpoint)
//
// Query params:
//   search           — text match on player name (overrides the rest)
//   position         — filter by primary or eligible position (F/D/G/etc.)
//   limit            — cap returned rows (max 1000)
//   aliveTeamsOnly   — 'true' to restrict to NHL teams still alive in the
//                      playoff bracket. Used by the playoff-roster-pool
//                      draft so eliminated teams disappear from the
//                      draftable pool dynamically as rounds progress.
//   season           — season for the alive-teams lookup (defaults to
//                      CURRENT_SEASON). Ignored unless aliveTeamsOnly=true.
playerRoutes.get('/', authMiddleware, async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new PlayerService(supabase);

  const search = c.req.query('search');
  const position = c.req.query('position');
  const aliveTeamsOnly = c.req.query('aliveTeamsOnly') === 'true';
  const seasonParam = c.req.query('season');
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

  if (aliveTeamsOnly) {
    const season = seasonParam ? parseInt(seasonParam, 10) : getCurrentSeason();
    const playoffSvc = new NhlPlayoffStateService(supabase);
    const aliveAbbrevs = await playoffSvc.getAliveTeamAbbreviations(season);
    // If the bracket isn't populated yet (pre-playoffs), aliveAbbrevs is
    // empty — leave the list unfiltered rather than returning zero rows,
    // since "no bracket" shouldn't mean "no players draftable".
    if (aliveAbbrevs.length > 0) {
      const aliveSet = new Set(aliveAbbrevs);
      filtered = filtered.filter((p: { team?: string }) =>
        p.team ? aliveSet.has(p.team) : false
      );
    }
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
// GOALIE-PROJ SANITY (2026-09-01): also serves ?playerId= for a single
// player's ROS row — the player card's goalie totals read start-aware
// numbers from here instead of summing every TEAM game.
playerRoutes.get('/ros-projections', authMiddleware, async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const limit = parseInt(c.req.query('limit') || '200', 10);
  const playerIdRaw = c.req.query('playerId');
  const playerId = playerIdRaw !== undefined ? parseInt(playerIdRaw, 10) : null;

  let query = supabase
    .from('player_ros_projections')
    // projected_ga_ros (2026-09-01): goalie goals-against over remaining
    // starts — clients that rescore ROS rows under league settings must
    // include it, or every goalie is overstated by |GA weight| × GA.
    .select('player_id, player_name, position, team_abbrev, is_goalie, total_projected_points, avg_points_per_game, games_remaining, projected_goals, projected_assists, projected_sog, projected_blocks, projected_ppp, projected_shp, projected_hits, projected_pim, projected_wins_ros, projected_saves_ros, projected_shutouts_ros, projected_ga_ros')
    // Projections are keyed to the season they DESCRIBE (offseason ⇒
    // upcoming season) — getCurrentSeason() here read zero rows all summer.
    .eq('season', getProjectionsSeason());
  if (playerId !== null && Number.isFinite(playerId)) {
    query = query.eq('player_id', playerId);
  }
  const { data, error } = await query
    .order('total_projected_points', { ascending: false })
    .limit(playerId !== null && Number.isFinite(playerId) ? 1 : Math.min(limit, 500));

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
    // Default to current season so missing param doesn't return all
    // historical projections (multiple rows per player × 82 games).
    query = query.eq('season', season ? parseInt(season, 10) : getCurrentSeason());

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

// GET /api/players/dashboard-index — league-wide Players section browse
// index: every directory player for the current season with season
// actuals + GAR/60 split + xG talent + rolled-forward projections
// merged into one row each. Powers /players. Registered BEFORE
// /:playerId (Hono matches in registration order — 'dashboard-index'
// would otherwise be captured as a playerId).
//
// Query params:
//   team     — filter by NHL team abbrev (e.g. TOR)
//   position — filter by position_code (C/LW/RW/D/G)
//   search   — case-insensitive substring match on name
playerRoutes.get('/dashboard-index', authMiddleware, async (c) => {
  const supabase = createUserClient(c.get('userToken'));
  const service = new PlayerDashboardService(supabase);

  try {
    const { players, error } = await service.getDashboardIndex();
    if (error) {
      return handleError(c, error, 'Failed to fetch player dashboard index');
    }

    const team = c.req.query('team');
    const position = c.req.query('position');
    const search = c.req.query('search')?.toLowerCase();

    let filtered = players;
    if (team) filtered = filtered.filter((p) => p.team === team);
    if (position) filtered = filtered.filter((p) => p.position === position);
    if (search) filtered = filtered.filter((p) => p.name.toLowerCase().includes(search));

    return ok(c, filtered);
  } catch (err) {
    logger.error('[players/dashboard-index] Unexpected error:', err);
    return handleError(c, err, 'Failed to fetch player dashboard index');
  }
});

// GET /api/players/:playerId/dashboard — COMPONENT 6.5. Everything the
// player dashboard page (the locked Concept 3 "Spatial Hero" composition,
// apps/web/docs/PLAYER_DASHBOARD_DESIGN_SPEC.md) needs for ONE player, in
// one round trip: his shots for the requested season with our model's xG
// on each, his whole `player_xg_season` career arc, GSAx if he is a
// goalie, his talent-metric row, and a real `as_of` timestamp.
//
// Query params:
//   season   — four-digit season year, 2017..current. Defaults to current.
//   gameType — 'regular' | 'playoff'. Defaults to 'regular'.
//
// Registered ABOVE `/:playerId` for the same reason `/dashboard-index` is:
// Hono matches in registration order. Two segments cannot collide with the
// one-segment `/:playerId`, but keeping every literal above the wildcard
// is the rule that survives the next person adding a route.
//
// THE SERVICE-ROLE CLIENT IS DELIBERATE. `nhl_shots` is deny-all to
// end-user roles by design (RLS on, no policy, SELECT revoked — see the
// table's own COMMENT and the long note in PlayerDashboardService), so the
// shot read cannot run on the caller's client. `getSupabaseAdmin()` is
// passed as the service's SECOND argument, where it is used for that one
// table and nothing else; every other read on this endpoint stays on the
// caller's RLS-scoped client. The route itself is `authMiddleware`-gated
// exactly like `/dashboard-index`, and the elevated query is pinned to the
// validated `:playerId`, so there is no id a caller can supply that reads
// anything but one player's public shot events.
//
// `getSupabaseAdmin()` THROWS when SUPABASE_SERVICE_ROLE_KEY is unset. That
// must not 500 an endpoint whose other four reads are fine, so it is caught
// and the dashboard degrades to `shots_available: false`.
playerRoutes.get('/:playerId/dashboard', authMiddleware, async (c) => {
  const parsed = parsePlayerDashboardRequest(
    c.req.param('playerId'),
    c.req.query('season'),
    c.req.query('gameType'),
  );
  if (!parsed.value) {
    return fail(c, AppError.badRequest(parsed.message || 'Invalid player dashboard request'));
  }

  const supabase = createUserClient(c.get('userToken'));

  let elevated: SupabaseClient | undefined;
  try {
    elevated = getSupabaseAdmin();
  } catch (err) {
    logger.warn('[players/:id/dashboard] no service-role client; shot map unavailable:', err);
  }

  const service = new PlayerDashboardService(supabase, elevated);

  try {
    const { payload, error } = await service.getPlayerDashboard(parsed.value);
    if (error || !payload) {
      return handleError(c, error, 'Failed to fetch player dashboard');
    }
    return ok(c, payload);
  } catch (err) {
    logger.error('[players/:id/dashboard] Unexpected error:', err);
    return handleError(c, err, 'Failed to fetch player dashboard');
  }
});

// GET /api/players/:playerId/xg-history (2026-09-03). One player's whole
// `player_xg_season` career arc, merged per season, for the condensed
// card's sparkline. Everything `/:playerId/dashboard` carries EXCEPT the
// shots: the card opens inside PlayerStatsModal on ten host surfaces
// (one of them a live draft room), and reading up to SHOT_CAP shot rows
// through the service-role client to draw a nine-point line is the wrong
// trade. No elevated client here at all; `player_xg_season` has an
// authenticated read policy and the request stays on the caller's own.
//
// Same validator as the dashboard route, so the same junk playerIds are
// refused before a query is built; season and gameType are not inputs
// here (the arc is every season on record, both game types, and the
// client picks what to plot).
//
// Registered ABOVE `/:playerId` with the other literal-suffixed routes.
playerRoutes.get('/:playerId/xg-history', authMiddleware, async (c) => {
  const parsed = parsePlayerDashboardRequest(c.req.param('playerId'), undefined, undefined);
  if (!parsed.value) {
    return fail(c, AppError.badRequest(parsed.message || 'Invalid player id'));
  }

  const supabase = createUserClient(c.get('userToken'));
  const service = new PlayerDashboardService(supabase);

  try {
    const { payload, error } = await service.getXgHistory(parsed.value.playerId);
    if (error || !payload) {
      return handleError(c, error, 'Failed to fetch player xG history');
    }
    return ok(c, payload);
  } catch (err) {
    logger.error('[players/:id/xg-history] Unexpected error:', err);
    return handleError(c, err, 'Failed to fetch player xG history');
  }
});

// POST /api/players/transaction — record an add/drop for platform-wide
// trending analytics.
//
// 2026-08-18 launch audit: the frontend has called this endpoint on every
// free-agent add since the feature shipped (FreeAgents.tsx → PlayerService
// .recordPlayerTransaction → api/players.ts), but the route never existed
// — this router had ZERO POST handlers. Every call 404'd, and
// PlayerService's try/catch swallowed it, so nothing ever surfaced.
// Confirmed against prod: public.player_transactions has 0 rows, lifetime.
// GET /trending reads get_trending_players() over that table, so the
// Trending feature has been rendering an empty set forever.
//
// Registered BEFORE /:playerId for consistency with the other literals,
// though as a POST it could not actually collide with that GET.
//
// SECURITY: user_id is taken from the verified JWT, never from the body.
// The table's INSERT policy is `auth.uid() = user_id`, so a client-supplied
// user_id would be rejected by RLS anyway — but not sending it at all is
// the correct posture, and it keeps the failure mode honest.
playerRoutes.post('/transaction', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, AppError.badRequest('Invalid JSON body'));
  }

  const playerId = Number(body.playerId);
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : null;
  const teamId = typeof body.teamId === 'string' ? body.teamId : null;
  const transactionType = body.transactionType;

  if (!Number.isFinite(playerId) || playerId <= 0) {
    return fail(c, AppError.badRequest('playerId must be a positive number'));
  }
  if (!leagueId || !teamId) {
    return fail(c, AppError.badRequest('leagueId and teamId are required'));
  }
  if (transactionType !== 'add' && transactionType !== 'drop') {
    return fail(c, AppError.badRequest("transactionType must be 'add' or 'drop'"));
  }

  const asText = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

  const { error } = await supabase.from('player_transactions').insert({
    player_id: playerId,
    league_id: leagueId,
    team_id: teamId,
    user_id: userId,
    transaction_type: transactionType,
    source: asText(body.source),
    player_name: asText(body.playerName),
    player_team: asText(body.playerTeam),
    player_position: asText(body.playerPosition),
  });

  if (error) {
    return handleError(c, error, 'Failed to record player transaction');
  }

  return ok(c, { recorded: true });
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
      // PGRST116 = "no rows returned" — normal for players without projections.
      // Only log actual errors to avoid flooding logs during draft room player opens.
      const errObj = error as { message: string; code?: string };
      if (errObj.code !== 'PGRST116') {
        logger.error(`[players/:id/projections] Supabase error for player ${playerId}:`, errObj.message);
      }
      return handleError(c, error, 'Failed to fetch projections');
    }

    return ok(c, data || []);
  } catch (err) {
    logger.error(`[players/:id/projections] Unexpected error for player ${playerId}:`, err);
    return handleError(c, err, 'Failed to fetch projections');
  }
});

export { playerRoutes };

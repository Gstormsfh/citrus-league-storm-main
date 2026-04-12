import { Hono } from 'hono';
import type { Env } from '../app';
import { getSupabaseAdmin } from '../lib/supabase';
import { MatchupService } from '../services/MatchupService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';
import { logger, COLUMNS } from '@citrus/shared';

/**
 * Public routes — no authentication required.
 * Restricted to read-only access on the demo league only.
 *
 * These endpoints allow guest users to view the demo matchup page
 * without signing in. All queries use the admin client (bypasses RLS)
 * but are hard-gated to the DEMO_LEAGUE_ID.
 */

const DEMO_LEAGUE_ID = '750f4e1a-92ae-44cf-a798-2f3e06d0d5c9';

const publicRoutes = new Hono<Env>();

function isDemoLeague(leagueId: string): boolean {
  return leagueId === DEMO_LEAGUE_ID;
}

// GET /api/public/matchups/league/:leagueId — Demo league matchups
publicRoutes.get('/matchups/league/:leagueId', async (c) => {
  const leagueId = c.req.param('leagueId');
  if (!isDemoLeague(leagueId)) {
    return fail(c, AppError.forbidden('Public access is only available for the demo league'));
  }

  const week = c.req.query('week');
  const supabase = getSupabaseAdmin();
  const service = new MatchupService(supabase);

  const { matchups, error } = await service.getLeagueMatchups(
    leagueId,
    week ? parseInt(week, 10) : undefined,
  );

  if (error) {
    return handleError(c, error, 'Failed to fetch demo matchups');
  }

  return ok(c, matchups);
});

// GET /api/public/leagues/:leagueId — Demo league info
publicRoutes.get('/leagues/:leagueId', async (c) => {
  const leagueId = c.req.param('leagueId');
  if (!isDemoLeague(leagueId)) {
    return fail(c, AppError.forbidden('Public access is only available for the demo league'));
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('leagues')
    .select(COLUMNS.LEAGUE)
    .eq('id', leagueId)
    .single();

  if (error) {
    return handleError(c, error, 'Failed to fetch demo league');
  }

  return ok(c, data);
});

// GET /api/public/leagues/:leagueId/teams — Demo league teams
publicRoutes.get('/leagues/:leagueId/teams', async (c) => {
  const leagueId = c.req.param('leagueId');
  if (!isDemoLeague(leagueId)) {
    return fail(c, AppError.forbidden('Public access is only available for the demo league'));
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('teams')
    .select(COLUMNS.TEAM)
    .eq('league_id', leagueId);

  if (error) {
    return handleError(c, error, 'Failed to fetch demo teams');
  }

  return ok(c, data || []);
});

// GET /api/public/leagues/:leagueId/teams/:teamId/player-ids — Demo team roster player IDs
publicRoutes.get('/leagues/:leagueId/teams/:teamId/player-ids', async (c) => {
  try {
    const leagueId = c.req.param('leagueId');
    if (!isDemoLeague(leagueId)) {
      return fail(c, AppError.forbidden('Public access is only available for the demo league'));
    }

    const teamId = c.req.param('teamId');
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('roster_assignments')
      .select('player_id')
      .eq('league_id', leagueId)
      .eq('team_id', teamId);

    if (error) {
      return handleError(c, error, 'Failed to fetch demo roster');
    }

    const playerIds = (data || []).map((r: { player_id: string }) => r.player_id);
    return ok(c, playerIds);
  } catch (err) {
    logger.error('[public] player-ids error:', err);
    return handleError(c, err, 'Failed to fetch player IDs');
  }
});

// GET /api/public/matchups/:matchupId/daily-scores — Demo matchup daily scores
publicRoutes.get('/matchups/:matchupId/daily-scores', async (c) => {
  const matchupId = c.req.param('matchupId');
  const supabase = getSupabaseAdmin();
  const service = new MatchupService(supabase);

  // Verify this matchup belongs to the demo league
  const { matchup, error: matchupError } = await service.getMatchup(matchupId);
  if (matchupError || !matchup) {
    return fail(c, AppError.notFound('Matchup'));
  }
  if (!isDemoLeague((matchup as any).league_id)) {
    return fail(c, AppError.forbidden('Public access is only available for the demo league'));
  }

  // Auto-ensure rosters for AI teams
  try {
    await service.ensureMatchupRosters(matchupId);
  } catch (err) {
    logger.debug('[public] ensureMatchupRosters non-fatal error:', err);
  }

  const { data, error } = await service.calculateDailyMatchupScores(matchupId);
  if (error) {
    return handleError(c, error, 'Failed to calculate demo scores');
  }

  return ok(c, data);
});

// GET /api/public/matchups/:matchupId — Demo matchup with lines
publicRoutes.get('/matchups/:matchupId', async (c) => {
  const matchupId = c.req.param('matchupId');
  const supabase = getSupabaseAdmin();
  const service = new MatchupService(supabase);

  const { matchup, lines, error } = await service.getMatchupWithLines(matchupId);
  if (error || !matchup) {
    return fail(c, AppError.notFound('Matchup'));
  }
  if (!isDemoLeague((matchup as any).league_id)) {
    return fail(c, AppError.forbidden('Public access is only available for the demo league'));
  }

  return ok(c, { ...matchup, lines });
});

// POST /api/public/matchups/matchup-stats — Get weekly matchup stats (demo league only)
publicRoutes.post('/matchups/matchup-stats', async (c) => {
  let body: { playerIds?: number[]; startDate?: string; endDate?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  if (!body.playerIds?.length || !body.startDate || !body.endDate) {
    return fail(c, AppError.badRequest('playerIds, startDate, and endDate are required'));
  }

  const supabase = getSupabaseAdmin();
  const service = new MatchupService(supabase);

  const { statsMap, error } = await service.getMatchupStats(body.playerIds, body.startDate, body.endDate);
  if (error) {
    return handleError(c, error, 'Failed to fetch matchup stats');
  }

  const stats: Record<string, unknown> = {};
  statsMap.forEach((value, key) => {
    stats[String(key)] = value;
  });

  return ok(c, stats);
});

// POST /api/public/waitlist — Add email to waitlist (no auth required)
publicRoutes.post('/waitlist', async (c) => {
  let body: { email?: string; source?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400);
  }

  const email = body.email?.toLowerCase().trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail(c, AppError.badRequest('Please enter a valid email address'));
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('waitlist')
    .insert({ email, source: body.source || 'landing_page' });

  if (error) {
    if (error.code === '23505' || error.message?.includes('duplicate')) {
      return c.json({ data: { success: false, message: 'This email is already on the waitlist!' } });
    }
    return handleError(c, error, 'Failed to add to waitlist');
  }

  return ok(c, { success: true, message: "Successfully added to waitlist! We'll notify you when we launch." });
});

// GET /api/public/schedule/games — Public game schedule (for GameLockService)
publicRoutes.get('/schedule/games', async (c) => {
  const date = c.req.query('date');
  const teams = c.req.query('teams');
  if (!date) {
    return fail(c, AppError.badRequest('date query parameter required'));
  }

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('nhl_games')
    .select('game_time, status, home_team, away_team, game_date')
    .eq('game_date', date)
    .in('status', ['scheduled', 'live', 'final']);

  if (teams) {
    const teamList = teams.split(',');
    const orConditions = teamList
      .map(team => `home_team.eq.${team},away_team.eq.${team}`)
      .join(',');
    query = query.or(orConditions);
  }

  const { data, error } = await query;
  if (error) {
    return handleError(c, error, 'Failed to fetch games');
  }

  return ok(c, data || []);
});

export { publicRoutes };

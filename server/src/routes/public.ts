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

export { publicRoutes };

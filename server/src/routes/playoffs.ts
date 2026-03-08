import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { createUserClient } from '../lib/supabase';
import { PlayoffService } from '../services/PlayoffService';
import { LeagueMembershipService } from '../services/LeagueMembershipService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';

const playoffRoutes = new Hono<Env>();
playoffRoutes.use('*', authMiddleware);

// GET /api/playoffs/league/:leagueId/bracket
playoffRoutes.get('/league/:leagueId/bracket', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new PlayoffService(supabase);
  const result = await service.getBracket(leagueId);
  if (result.error) return handleError(c, result.error, 'Failed to fetch bracket');
  return ok(c, { bracket: result.bracket, seeds: result.seeds, series: result.series });
});

// POST /api/playoffs/league/:leagueId/generate
playoffRoutes.post('/league/:leagueId/generate', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new PlayoffService(supabase);
  const result = await service.generateBracket(leagueId, body);
  if (result.error) return handleError(c, result.error, 'Failed to generate bracket');
  return ok(c, result.result);
});

// POST /api/playoffs/bracket/:bracketId/advance
playoffRoutes.post('/bracket/:bracketId/advance', async (c) => {
  const bracketId = c.req.param('bracketId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));

  // Look up the bracket's league and verify membership
  const { data: bracket } = await supabase
    .from('playoff_brackets')
    .select('league_id')
    .eq('id', bracketId)
    .single();

  if (!bracket) return fail(c, AppError.notFound('Bracket'));

  const membership = new LeagueMembershipService(supabase);
  const isMember = await membership.verifyMembership(bracket.league_id, userId);
  if (!isMember) return fail(c, AppError.forbidden('Not a member of this league'));

  const service = new PlayoffService(supabase);
  const result = await service.advanceRound(bracketId);
  if (result.error) return handleError(c, result.error, 'Failed to advance round');
  return ok(c, result.result);
});

// POST /api/playoffs/league/:leagueId/reset
playoffRoutes.post('/league/:leagueId/reset', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new PlayoffService(supabase);
  const result = await service.resetBracket(leagueId);
  if (result.error) return handleError(c, result.error, 'Failed to reset bracket');
  return ok(c, { success: true });
});

// GET /api/playoffs/league/:leagueId/picture
playoffRoutes.get('/league/:leagueId/picture', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new PlayoffService(supabase);
  const result = await service.getPlayoffPicture(leagueId);
  if (result.error) return handleError(c, result.error, 'Failed to fetch playoff picture');
  return ok(c, result.picture);
});

export { playoffRoutes };

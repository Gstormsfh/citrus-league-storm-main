import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { MatchupService } from '../services/MatchupService';
import { AppError } from '../lib/errors';
import { ok, fail, handleError } from '../lib/responses';
import { COLUMNS } from '@citrus/shared';

const rosterRoutes = new Hono<Env>();

rosterRoutes.use('*', authMiddleware);

// GET /api/rosters/league/:leagueId/team/:teamId — Get roster for a team
rosterRoutes.get('/league/:leagueId/team/:teamId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.param('teamId');
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase
    .from('roster_assignments')
    .select(COLUMNS.ROSTER_ASSIGNMENT)
    .eq('league_id', leagueId)
    .eq('team_id', teamId);

  if (error) {
    return handleError(c, error, 'Failed to fetch roster');
  }

  return ok(c, data || []);
});

// GET /api/rosters/league/:leagueId/team/:teamId/player-ids — Get roster player IDs
rosterRoutes.get('/league/:leagueId/team/:teamId/player-ids', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.param('teamId');
  const supabase = createUserClient(c.get('userToken'));
  const matchupService = new MatchupService(supabase);

  const playerIds = await matchupService.getRosterPlayerIds(teamId, leagueId);
  return ok(c, playerIds);
});

// GET /api/rosters/league/:leagueId — Get all rosters in a league
rosterRoutes.get('/league/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase
    .from('roster_assignments')
    .select(COLUMNS.ROSTER_ASSIGNMENT)
    .eq('league_id', leagueId);

  if (error) {
    return handleError(c, error, 'Failed to fetch rosters');
  }

  return ok(c, data || []);
});

// PUT /api/rosters/league/:leagueId/team/:teamId/lineup — Update lineup
rosterRoutes.put('/league/:leagueId/team/:teamId/lineup', membershipMiddleware, validateBody(schemas.rosterLineup), async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.param('teamId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.rosterLineup>>(c);

  const parsedTeamId = parseInt(teamId, 10);
  if (isNaN(parsedTeamId)) {
    return fail(c, AppError.badRequest('Invalid team ID'));
  }

  const supabase = createUserClient(c.get('userToken'));

  // Verify user owns this team
  const { data: team } = await supabase
    .from('teams')
    .select('id, owner_id')
    .eq('id', teamId)
    .eq('league_id', leagueId)
    .single();

  if (!team || team.owner_id !== userId) {
    return fail(c, AppError.forbidden('You can only edit your own lineup'));
  }

  const { data, error } = await supabase
    .from('team_lineups')
    .upsert({
      team_id: parsedTeamId,
      league_id: leagueId,
      starters: body.starters,
      bench: body.bench,
      ir: body.ir,
      slot_assignments: body.slot_assignments,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return handleError(c, error, 'Failed to update lineup');
  }

  return ok(c, data);
});

// GET /api/rosters/league/:leagueId/team/:teamId/lineup — Get team lineup
rosterRoutes.get('/league/:leagueId/team/:teamId/lineup', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.param('teamId');
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase
    .from('team_lineups')
    .select(COLUMNS.TEAM_LINEUP)
    .eq('team_id', teamId)
    .eq('league_id', leagueId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return handleError(c, error, 'Failed to fetch lineup');
  }

  return ok(c, data);
});

export { rosterRoutes };

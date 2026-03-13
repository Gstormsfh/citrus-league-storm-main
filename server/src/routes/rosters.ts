import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { MatchupService } from '../services/MatchupService';
import { LineupService } from '../services/LineupService';
import { AuditService } from '../services/AuditService';
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

// GET /api/rosters/league/:leagueId/team/:teamId/roster-count — Get roster count
rosterRoutes.get('/league/:leagueId/team/:teamId/roster-count', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.param('teamId');
  const supabase = createUserClient(c.get('userToken'));

  const { count, error } = await supabase
    .from('roster_assignments')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('team_id', teamId);

  if (error) {
    return handleError(c, error, 'Failed to fetch roster count');
  }

  return ok(c, { count: count ?? 0 });
});

// PUT /api/rosters/league/:leagueId/team/:teamId/lineup — Save lineup with validation + snapshots
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

  const lineupService = new LineupService(supabase);
  const result = await lineupService.saveLineup(
    teamId,
    leagueId,
    {
      starters: (body.starters || []) as string[],
      bench: (body.bench || []) as string[],
      ir: (body.ir || []) as string[],
      slot_assignments: (body.slot_assignments || {}) as Record<string, string>,
    },
    body.target_date as string | undefined,
    (body.allow_player_removal as boolean) || false,
  );

  if (!result.success) {
    return fail(c, AppError.badRequest(result.error || 'Failed to save lineup'));
  }

  const audit = new AuditService(supabase);
  audit.logRosterMove(leagueId, { teamId });

  return ok(c, result.data);
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

// GET /api/rosters/daily-roster — Get daily roster entries (auth-only, no league membership required)
rosterRoutes.get('/daily-roster', async (c) => {
  const teamId = c.req.query('team_id');
  const matchupId = c.req.query('matchup_id');
  const rosterDate = c.req.query('roster_date');

  if (!teamId || !matchupId || !rosterDate) {
    return fail(c, AppError.badRequest('team_id, matchup_id, and roster_date query params are required'));
  }

  const supabase = createUserClient(c.get('userToken'));
  const lineupService = new LineupService(supabase);
  const result = await lineupService.getDailyRoster(teamId, matchupId, rosterDate);

  if (result.error) {
    return c.json({ error: { code: 'INTERNAL', message: result.error } }, 500);
  }

  return ok(c, result.data);
});

// GET /api/rosters/can-update — Check if roster can be updated for a date (auth-only)
rosterRoutes.get('/can-update', async (c) => {
  const date = c.req.query('date');
  const playerIdsParam = c.req.query('player_ids');

  if (!date) {
    return fail(c, AppError.badRequest('date query param is required'));
  }

  const playerIds = playerIdsParam
    ? playerIdsParam.split(',').map(id => parseInt(id)).filter(id => !isNaN(id))
    : [];

  const supabase = createUserClient(c.get('userToken'));
  const lineupService = new LineupService(supabase);
  const canUpdate = await lineupService.canUpdateRosterForDate(date, playerIds);

  return ok(c, { canUpdate });
});

// POST /api/rosters/league/:leagueId/team/:teamId/backfill — Backfill daily rosters for a matchup
rosterRoutes.post('/league/:leagueId/team/:teamId/backfill', membershipMiddleware, async (c) => {
  let body: { matchup_id?: string };
  try {
    body = await c.req.json();
  } catch {
    return fail(c, AppError.badRequest('Invalid JSON body'));
  }

  if (!body.matchup_id) {
    return fail(c, AppError.badRequest('matchup_id is required'));
  }

  const leagueId = c.req.param('leagueId');
  const teamId = c.req.param('teamId');
  const supabase = createUserClient(c.get('userToken'));
  const lineupService = new LineupService(supabase);
  const result = await lineupService.backfillMissingDailyRosters(teamId, leagueId, body.matchup_id);

  return ok(c, result);
});

// POST /api/rosters/league/:leagueId/backfill-all — Backfill daily rosters for all matchups
rosterRoutes.post('/league/:leagueId/backfill-all', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const lineupService = new LineupService(supabase);
  const result = await lineupService.backfillAllMatchups(leagueId);

  return ok(c, result);
});

// POST /api/rosters/league/:leagueId/team/:teamId/initialize — Initialize lineup from roster assignments
rosterRoutes.post('/league/:leagueId/team/:teamId/initialize', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.param('teamId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));

  // Verify user owns this team
  const { data: team } = await supabase
    .from('teams')
    .select('id, owner_id')
    .eq('id', teamId)
    .eq('league_id', leagueId)
    .single();

  if (!team || team.owner_id !== userId) {
    return fail(c, AppError.forbidden('You can only initialize your own lineup'));
  }

  const lineupService = new LineupService(supabase);
  const result = await lineupService.initializeLineup(teamId, leagueId);

  if (result.error) {
    return c.json({ error: { code: 'INTERNAL', message: result.error } }, 500);
  }

  return ok(c, result.lineup);
});

// POST /api/rosters/league/:leagueId/sync — Sync roster_assignments from draft_picks (commissioner only)
rosterRoutes.post('/league/:leagueId/sync', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await (supabase.rpc as any)('sync_roster_assignments_for_league', { p_league_id: leagueId });

  if (error) {
    return handleError(c, error, 'Failed to sync rosters');
  }

  return ok(c, data);
});

export { rosterRoutes };

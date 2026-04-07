import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware, commissionerMiddleware } from '../middleware/membership';
import { z } from 'zod';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { LeagueService } from '../services/LeagueService';
import { SeasonStateService } from '../services/SeasonStateService';
import { AuditService } from '../services/AuditService';
import { AppError } from '../lib/errors';
import { ok, created, fail, handleError } from '../lib/responses';

const leagueRoutes = new Hono<Env>();

leagueRoutes.use('*', authMiddleware);

// GET /api/leagues — Get all leagues for the authenticated user
leagueRoutes.get('/', async (c) => {
  try {
    const userId = c.get('userId');
    const supabase = createUserClient(c.get('userToken'));
    const service = new LeagueService(supabase);

    const { leagues, error } = await service.getUserLeagues(userId);
    if (error) {
      return handleError(c, error, 'Failed to fetch leagues');
    }

    return ok(c, leagues);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch leagues');
  }
});

// GET /api/leagues/:leagueId — Get a specific league
leagueRoutes.get('/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { league, error } = await service.getLeague(leagueId, userId);
    if (error || !league) {
      return fail(c, AppError.notFound('League'));
    }
    return ok(c, league);
  } catch (err) {
    return handleError(c, err, 'Failed to fetch league');
  }
});

// GET /api/leagues/:leagueId/season-state — Is the fantasy season complete?
leagueRoutes.get('/:leagueId/season-state', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new SeasonStateService(supabase);
  const state = await service.isSeasonComplete(leagueId);
  return ok(c, state);
});

// POST /api/leagues — Create a new league
leagueRoutes.post('/', validateBody(schemas.createLeague), async (c) => {
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.createLeague>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  const { league, team, error } = await service.createLeague(
    body.name,
    userId,
    body.roster_size,
    body.draft_rounds,
    body.settings as Record<string, unknown> | undefined,
    body.scoring_settings as Record<string, number> | undefined,
    body.waiver_settings as Record<string, unknown> | undefined,
  );

  if (error || !league) {
    return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to create league'));
  }

  const audit = new AuditService(supabase);
  audit.logLeagueEvent('LEAGUE_CREATE', league.id, { name: body.name });

  return created(c, { league, team });
});

// POST /api/leagues/join — Join a league by invite code
leagueRoutes.post('/join', validateBody(schemas.joinLeague), async (c) => {
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.joinLeague>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  const { league, team, error } = await service.joinLeagueByCode(
    body.joinCode,
    userId,
    body.teamName,
  );

  if (error) {
    return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to join league'));
  }

  if (league) {
    const audit = new AuditService(supabase);
    audit.logLeagueEvent('LEAGUE_JOIN', league.id, { joinCode: body.joinCode });
  }

  return created(c, { league, team });
});

// PUT /api/leagues/:leagueId/settings — Update league settings (commissioner only)
leagueRoutes.put('/:leagueId/settings', commissionerMiddleware, validateBody(schemas.leagueSettings), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.leagueSettings>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { league, error } = await service.updateSettings(
      leagueId,
      userId,
      body.settings as Record<string, unknown>,
      body.scoring_settings as Record<string, number> | undefined,
    );

    if (error) {
      return handleError(c, error, 'Failed to update settings');
    }

    const audit = new AuditService(supabase);
    audit.log('ADMIN_ACTION', leagueId, { action: 'update_settings', changedBy: userId });

    return ok(c, league);
  } catch (err) {
    return handleError(c, err, 'Failed to update settings');
  }
});

// PUT /api/leagues/:leagueId/waiver-settings — Update waiver settings
leagueRoutes.put('/:leagueId/waiver-settings', commissionerMiddleware, validateBody(schemas.waiverSettings), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.waiverSettings>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.updateWaiverSettings(leagueId, userId, body);
    if (!success) {
      return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to update waiver settings'));
    }
    return ok(c, { success: true });
  } catch (err) {
    return handleError(c, err, 'Failed to update waiver settings');
  }
});

// PUT /api/leagues/:leagueId/scoring-settings — Update scoring settings
leagueRoutes.put('/:leagueId/scoring-settings', commissionerMiddleware, validateBody(schemas.scoringSettings), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.scoringSettings>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.updateScoringSettings(leagueId, userId, body);
    if (!success) {
      return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to update scoring settings'));
    }
    return ok(c, { success: true });
  } catch (err) {
    return handleError(c, err, 'Failed to update scoring settings');
  }
});

// PUT /api/leagues/:leagueId/draft-settings — Update draft settings
leagueRoutes.put('/:leagueId/draft-settings', commissionerMiddleware, validateBody(schemas.draftSettings), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.draftSettings>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.updateDraftSettings(leagueId, userId, body);
    if (!success) {
      return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to update draft settings'));
    }
    return ok(c, { success: true });
  } catch (err) {
    return handleError(c, err, 'Failed to update draft settings');
  }
});

// PUT /api/leagues/:leagueId/roster-slots — Update roster slot settings
leagueRoutes.put('/:leagueId/roster-slots', commissionerMiddleware, validateBody(schemas.rosterSlots), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.rosterSlots>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.updateRosterSlotSettings(leagueId, userId, body.rosterSlots);
    if (!success) {
      return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to update roster slots'));
    }
    return ok(c, { success: true });
  } catch (err) {
    return handleError(c, err, 'Failed to update roster slots');
  }
});

// PUT /api/leagues/:leagueId/keeper-settings — Update keeper settings
leagueRoutes.put('/:leagueId/keeper-settings', commissionerMiddleware, validateBody(schemas.keeperSettings), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.keeperSettings>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.updateKeeperSettings(leagueId, userId, body as any);
    if (!success) {
      return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to update keeper settings'));
    }
    return ok(c, { success: true });
  } catch (err) {
    return handleError(c, err, 'Failed to update keeper settings');
  }
});

// PUT /api/leagues/:leagueId/category-settings — Update category settings
leagueRoutes.put('/:leagueId/category-settings', commissionerMiddleware, validateBody(z.object({
  categories: z.array(z.string()).min(2, 'At least 2 categories are required'),
})), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<{ categories: string[] }>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.updateCategorySettings(leagueId, userId, body.categories);
    if (!success) {
      return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to update category settings'));
    }
    return ok(c, { success: true });
  } catch (err) {
    return handleError(c, err, 'Failed to update category settings');
  }
});

// GET /api/leagues/:leagueId/teams — Get all teams in a league
leagueRoutes.get('/:leagueId/teams', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const withOwners = c.req.query('withOwners') === 'true';
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  if (withOwners) {
    const { teams, error } = await service.getLeagueTeamsWithOwners(leagueId);
    if (error) return handleError(c, error, 'Failed to fetch teams');
    return ok(c, teams);
  }

  const { teams, error } = await service.getLeagueTeams(leagueId);
  if (error) return handleError(c, error, 'Failed to fetch teams');
  return ok(c, teams);
});

// GET /api/leagues/:leagueId/standings — Get league standings
leagueRoutes.get('/:leagueId/standings', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  const { standings, error } = await service.getStandings(leagueId);
  if (error) return handleError(c, error, 'Failed to fetch standings');
  return ok(c, standings);
});

// GET /api/leagues/:leagueId/my-team — Get user's team in a league
leagueRoutes.get('/:leagueId/my-team', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  const { team, error } = await service.getUserTeam(leagueId, userId);
  if (error) return handleError(c, error, 'Failed to fetch team');
  return ok(c, team);
});

// DELETE /api/leagues/:leagueId/teams/:teamId — Delete a team (commissioner only)
leagueRoutes.delete('/:leagueId/teams/:teamId', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.param('teamId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.deleteTeam(teamId, leagueId, userId);
    if (!success) {
      return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to delete team'));
    }

    const audit = new AuditService(supabase);
    audit.log('ADMIN_ACTION', leagueId, { action: 'delete_team', teamId, deletedBy: userId });

    return ok(c, { success: true });
  } catch (err) {
    return handleError(c, err, 'Failed to delete team');
  }
});

// GET /api/leagues/:leagueId/transactions — Get transaction history
leagueRoutes.get('/:leagueId/transactions', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  const { transactions, error } = await service.fetchTransactions(leagueId);
  if (error) return handleError(c, error, 'Failed to fetch transactions');
  return ok(c, transactions);
});

export { leagueRoutes };

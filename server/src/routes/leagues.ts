import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware, commissionerMiddleware } from '../middleware/membership';
import { createUserClient } from '../lib/supabase';
import { LeagueService } from '../services/LeagueService';

const leagueRoutes = new Hono<Env>();

// All league routes require authentication
leagueRoutes.use('*', authMiddleware);

// GET /api/leagues — Get all leagues for the authenticated user
leagueRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  const { leagues, error } = await service.getUserLeagues(userId);
  if (error) {
    return c.json({ error: 'Failed to fetch leagues' }, 500);
  }

  return c.json({ data: leagues });
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
      return c.json({ error: 'League not found' }, 404);
    }
    return c.json({ data: league });
  } catch (err: any) {
    return c.json({ error: err.message }, 403);
  }
});

// POST /api/leagues — Create a new league
leagueRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  const { league, team, error } = await service.createLeague(
    body.name,
    userId,
    body.roster_size,
    body.draft_rounds,
    body.settings,
    body.scoring_settings,
    body.waiver_settings,
  );

  if (error || !league) {
    return c.json({ error: error || 'Failed to create league' }, 400);
  }

  return c.json({ data: { league, team } }, 201);
});

// POST /api/leagues/join — Join a league by invite code
leagueRoutes.post('/join', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  const { league, team, error } = await service.joinLeagueByCode(
    body.joinCode,
    userId,
    body.teamName,
  );

  if (error) {
    return c.json({ error }, 400);
  }

  return c.json({ data: { league, team } }, 201);
});

// PUT /api/leagues/:leagueId/settings — Update league settings (commissioner only)
leagueRoutes.put('/:leagueId/settings', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { league, error } = await service.updateSettings(
      leagueId,
      userId,
      body.settings,
      body.scoring_settings,
    );

    if (error) {
      return c.json({ error: error.message || error }, 400);
    }
    return c.json({ data: league });
  } catch (err: any) {
    return c.json({ error: err.message }, 403);
  }
});

// PUT /api/leagues/:leagueId/waiver-settings — Update waiver settings
leagueRoutes.put('/:leagueId/waiver-settings', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.updateWaiverSettings(leagueId, userId, body);
    if (!success) {
      return c.json({ error: error || 'Failed to update waiver settings' }, 400);
    }
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 403);
  }
});

// PUT /api/leagues/:leagueId/scoring-settings — Update scoring settings
leagueRoutes.put('/:leagueId/scoring-settings', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.updateScoringSettings(leagueId, userId, body);
    if (!success) {
      return c.json({ error: error || 'Failed to update scoring settings' }, 400);
    }
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 403);
  }
});

// PUT /api/leagues/:leagueId/draft-settings — Update draft settings
leagueRoutes.put('/:leagueId/draft-settings', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.updateDraftSettings(leagueId, userId, body);
    if (!success) {
      return c.json({ error: error || 'Failed to update draft settings' }, 400);
    }
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 403);
  }
});

// PUT /api/leagues/:leagueId/roster-slots — Update roster slot settings
leagueRoutes.put('/:leagueId/roster-slots', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  try {
    const { success, error } = await service.updateRosterSlotSettings(leagueId, userId, body.rosterSlots);
    if (!success) {
      return c.json({ error: error || 'Failed to update roster slots' }, 400);
    }
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 403);
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
    if (error) return c.json({ error }, 500);
    return c.json({ data: teams });
  }

  const { teams, error } = await service.getLeagueTeams(leagueId);
  if (error) return c.json({ error }, 500);
  return c.json({ data: teams });
});

// GET /api/leagues/:leagueId/standings — Get league standings
leagueRoutes.get('/:leagueId/standings', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  const { standings, error } = await service.getStandings(leagueId);
  if (error) return c.json({ error }, 500);
  return c.json({ data: standings });
});

// GET /api/leagues/:leagueId/my-team — Get user's team in a league
leagueRoutes.get('/:leagueId/my-team', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  const { team, error } = await service.getUserTeam(leagueId, userId);
  if (error) return c.json({ error }, 500);
  return c.json({ data: team });
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
    if (!success) return c.json({ error: error || 'Failed to delete team' }, 400);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 403);
  }
});

// GET /api/leagues/:leagueId/transactions — Get transaction history
leagueRoutes.get('/:leagueId/transactions', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new LeagueService(supabase);

  const { transactions, error } = await service.fetchTransactions(leagueId);
  if (error) return c.json({ error }, 500);
  return c.json({ data: transactions });
});

export { leagueRoutes };

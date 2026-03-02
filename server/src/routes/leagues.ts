import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware, commissionerMiddleware } from '../middleware/membership';
import { createUserClient } from '../lib/supabase';
import { COLUMNS } from '@citrus/shared';

const leagueRoutes = new Hono<Env>();

// All league routes require authentication
leagueRoutes.use('*', authMiddleware);

// GET /api/leagues — Get all leagues for the authenticated user
leagueRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));

  // Get leagues where user is commissioner
  const { data: commissionerLeagues } = await supabase
    .from('leagues')
    .select(COLUMNS.LEAGUE)
    .eq('commissioner_id', userId);

  // Get leagues where user owns a team
  const { data: teamData } = await supabase
    .from('teams')
    .select('league_id')
    .eq('owner_id', userId);

  const teamLeagueIds = (teamData || []).map((t: any) => t.league_id);

  let memberLeagues: any[] = [];
  if (teamLeagueIds.length > 0) {
    const { data } = await supabase
      .from('leagues')
      .select(COLUMNS.LEAGUE)
      .in('id', teamLeagueIds);
    memberLeagues = data || [];
  }

  // Merge and deduplicate
  const allLeagues = [...(commissionerLeagues || []), ...memberLeagues];
  const unique = Array.from(new Map(allLeagues.map((l: any) => [l.id, l])).values());

  return c.json({ data: unique });
});

// GET /api/leagues/:leagueId — Get a specific league
leagueRoutes.get('/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase
    .from('leagues')
    .select(COLUMNS.LEAGUE)
    .eq('id', leagueId)
    .single();

  if (error) {
    return c.json({ error: 'League not found' }, 404);
  }

  return c.json({ data });
});

// POST /api/leagues — Create a new league
leagueRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase
    .from('leagues')
    .insert({
      name: body.name,
      commissioner_id: userId,
      settings: body.settings || {},
      scoring_settings: body.scoring_settings || null,
      roster_size: body.roster_size || 21,
      draft_rounds: body.draft_rounds || 21,
    })
    .select(COLUMNS.LEAGUE)
    .single();

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  return c.json({ data }, 201);
});

// PUT /api/leagues/:leagueId/settings — Update league settings (commissioner only)
leagueRoutes.put('/:leagueId/settings', commissionerMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase
    .from('leagues')
    .update({
      settings: body.settings,
      scoring_settings: body.scoring_settings,
      updated_at: new Date().toISOString(),
    })
    .eq('id', leagueId)
    .select(COLUMNS.LEAGUE)
    .single();

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  return c.json({ data });
});

// GET /api/leagues/:leagueId/teams — Get all teams in a league
leagueRoutes.get('/:leagueId/teams', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase
    .from('teams')
    .select(COLUMNS.TEAM)
    .eq('league_id', leagueId);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ data: data || [] });
});

// GET /api/leagues/:leagueId/standings — Get league standings
leagueRoutes.get('/:leagueId/standings', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));

  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('id, team_name, owner_id, wins, losses, ties, points_for, points_against')
    .eq('league_id', leagueId)
    .order('wins', { ascending: false });

  if (teamsError) {
    return c.json({ error: teamsError.message }, 500);
  }

  return c.json({ data: teams || [] });
});

export { leagueRoutes };

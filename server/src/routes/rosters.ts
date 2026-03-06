import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { createUserClient } from '../lib/supabase';
import { MatchupService } from '../services/MatchupService';
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
    return c.json({ error: error.message }, 500);
  }

  return c.json({ data: data || [] });
});

// GET /api/rosters/league/:leagueId/team/:teamId/player-ids — Get roster player IDs
// Uses admin client internally to bypass RLS (AI teams have owner_id = NULL)
rosterRoutes.get('/league/:leagueId/team/:teamId/player-ids', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.param('teamId');
  const supabase = createUserClient(c.get('userToken'));
  const matchupService = new MatchupService(supabase);

  const playerIds = await matchupService.getRosterPlayerIds(teamId, leagueId);
  return c.json({ data: playerIds });
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
    return c.json({ error: error.message }, 500);
  }

  return c.json({ data: data || [] });
});

// PUT /api/rosters/league/:leagueId/team/:teamId/lineup — Update lineup
rosterRoutes.put('/league/:leagueId/team/:teamId/lineup', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.param('teamId');
  const userId = c.get('userId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));

  // Verify user owns this team
  const { data: team } = await supabase
    .from('teams')
    .select('id, owner_id')
    .eq('id', teamId)
    .eq('league_id', leagueId)
    .single();

  if (!team || team.owner_id !== userId) {
    return c.json({ error: 'You can only edit your own lineup' }, 403);
  }

  const { data, error } = await supabase
    .from('team_lineups')
    .upsert({
      team_id: parseInt(teamId, 10),
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
    return c.json({ error: error.message }, 400);
  }

  return c.json({ data });
});

// GET /api/rosters/league/:leagueId/team/:teamId/lineup — Get team lineup
rosterRoutes.get('/league/:leagueId/team/:teamId/lineup', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const teamId = c.req.param('teamId');
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase
    .from('team_lineups')
    .select('*')
    .eq('team_id', parseInt(teamId, 10))
    .eq('league_id', leagueId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ data });
});

export { rosterRoutes };

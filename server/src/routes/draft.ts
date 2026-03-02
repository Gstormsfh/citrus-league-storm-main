import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { createUserClient } from '../lib/supabase';
import { COLUMNS } from '@citrus/shared';

const draftRoutes = new Hono<Env>();

draftRoutes.use('*', authMiddleware);

// GET /api/draft/league/:leagueId — Get draft state for a league
draftRoutes.get('/league/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));

  const { data: league } = await supabase
    .from('leagues')
    .select('id, draft_status, settings, scheduled_draft_time')
    .eq('id', leagueId)
    .single();

  const { data: picks } = await supabase
    .from('draft_picks')
    .select(COLUMNS.DRAFT_PICK)
    .eq('league_id', leagueId)
    .is('deleted_at', null)
    .order('pick_number', { ascending: true });

  const { data: order } = await supabase
    .from('draft_order')
    .select(COLUMNS.DRAFT_ORDER)
    .eq('league_id', leagueId)
    .order('round_number', { ascending: true });

  return c.json({
    data: {
      league,
      picks: picks || [],
      order: order || [],
    },
  });
});

// POST /api/draft/league/:leagueId/pick — Make a draft pick
draftRoutes.post('/league/:leagueId/pick', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));

  const { playerId, teamId, pickNumber, roundNumber, draftSessionId } = body;

  if (!playerId || !teamId) {
    return c.json({ error: 'playerId and teamId are required' }, 400);
  }

  const { data, error } = await supabase
    .from('draft_picks')
    .insert({
      league_id: leagueId,
      team_id: teamId,
      player_id: playerId,
      pick_number: pickNumber,
      round_number: roundNumber,
      draft_session_id: draftSessionId,
    })
    .select(COLUMNS.DRAFT_PICK)
    .single();

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  return c.json({ data }, 201);
});

// POST /api/draft/league/:leagueId/start — Start the draft (commissioner only)
draftRoutes.post('/league/:leagueId/start', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase
    .from('leagues')
    .update({ draft_status: 'in_progress' })
    .eq('id', leagueId)
    .select('id, draft_status')
    .single();

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  return c.json({ data });
});

export { draftRoutes };

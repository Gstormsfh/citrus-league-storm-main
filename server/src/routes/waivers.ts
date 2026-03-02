import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { createUserClient } from '../lib/supabase';
import { COLUMNS } from '@citrus/shared';

const waiverRoutes = new Hono<Env>();

waiverRoutes.use('*', authMiddleware);

// GET /api/waivers/league/:leagueId — Get waiver claims for a league
waiverRoutes.get('/league/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const status = c.req.query('status');
  const supabase = createUserClient(c.get('userToken'));

  let query = supabase
    .from('waiver_claims')
    .select(COLUMNS.WAIVER)
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ data: data || [] });
});

// POST /api/waivers/league/:leagueId — Submit a waiver claim
waiverRoutes.post('/league/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase
    .from('waiver_claims')
    .insert({
      league_id: leagueId,
      team_id: body.teamId,
      player_id: body.playerId,
      drop_player_id: body.dropPlayerId || null,
      bid_amount: body.bidAmount || 0,
      is_conditional_drop: body.isConditionalDrop || false,
      status: 'pending',
    })
    .select(COLUMNS.WAIVER)
    .single();

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  return c.json({ data }, 201);
});

// DELETE /api/waivers/:claimId — Cancel a waiver claim
waiverRoutes.delete('/:claimId', async (c) => {
  const claimId = c.req.param('claimId');
  const supabase = createUserClient(c.get('userToken'));

  const { error } = await supabase
    .from('waiver_claims')
    .update({ status: 'cancelled' })
    .eq('id', claimId)
    .eq('status', 'pending');

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  return c.json({ success: true });
});

export { waiverRoutes };

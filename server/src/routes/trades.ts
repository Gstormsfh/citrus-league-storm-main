import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { createUserClient } from '../lib/supabase';
import { COLUMNS } from '@citrus/shared';

const tradeRoutes = new Hono<Env>();

tradeRoutes.use('*', authMiddleware);

// GET /api/trades/league/:leagueId — Get all trades for a league
tradeRoutes.get('/league/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const status = c.req.query('status');
  const supabase = createUserClient(c.get('userToken'));

  let query = supabase
    .from('trade_offers')
    .select(COLUMNS.TRADE)
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

// POST /api/trades/league/:leagueId — Create a trade offer
tradeRoutes.post('/league/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));

  const { data, error } = await supabase
    .from('trade_offers')
    .insert({
      league_id: leagueId,
      from_team_id: body.fromTeamId,
      to_team_id: body.toTeamId,
      offered_player_ids: body.offeredPlayerIds,
      requested_player_ids: body.requestedPlayerIds,
      message: body.message,
      status: 'pending',
    })
    .select(COLUMNS.TRADE)
    .single();

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  return c.json({ data }, 201);
});

// PUT /api/trades/:tradeId/respond — Accept, reject, or counter a trade
tradeRoutes.put('/:tradeId/respond', async (c) => {
  const tradeId = c.req.param('tradeId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));

  const { action } = body; // 'accept', 'reject', 'counter'

  if (!['accept', 'reject', 'counter'].includes(action)) {
    return c.json({ error: 'Invalid action. Must be accept, reject, or counter' }, 400);
  }

  const status = action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'countered';

  const { data, error } = await supabase
    .from('trade_offers')
    .update({
      status,
      processed_at: new Date().toISOString(),
    })
    .eq('id', tradeId)
    .select(COLUMNS.TRADE)
    .single();

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  return c.json({ data });
});

export { tradeRoutes };

import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { validateBody, schemas } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { TradeService } from '../services/TradeService';

const tradeRoutes = new Hono<Env>();

tradeRoutes.use('*', authMiddleware);

// GET /api/trades/league/:leagueId — Get all trades for a league
tradeRoutes.get('/league/:leagueId', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const status = c.req.query('status');
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const { trades, error } = await service.getLeagueTrades(leagueId, status);
  if (error) {
    return c.json({ error: 'Failed to fetch trades' }, 500);
  }

  return c.json({ data: trades });
});

// GET /api/trades/league/:leagueId/review-settings — Get trade review settings
tradeRoutes.get('/league/:leagueId/review-settings', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const result = await service.getTradeReviewSettings(leagueId);
  return c.json({ data: result });
});

// POST /api/trades/league/:leagueId — Create a trade offer
tradeRoutes.post('/league/:leagueId', membershipMiddleware, validateBody(schemas.createTrade), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = (c as any).get('validatedBody');
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const { success, error, tradeId } = await service.createTradeOffer(
    leagueId,
    body.fromTeamId,
    body.toTeamId,
    body.offeredPlayerIds,
    body.requestedPlayerIds,
    userId,
    body.message,
  );

  if (!success) {
    return c.json({ error: error || 'Failed to create trade' }, 400);
  }

  return c.json({ data: { tradeId } }, 201);
});

// PUT /api/trades/:tradeId/accept — Accept a trade offer
tradeRoutes.put('/:tradeId/accept', async (c) => {
  const tradeId = c.req.param('tradeId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const { success, error } = await service.acceptTradeOffer(tradeId, userId);
  if (!success) {
    return c.json({ error: error || 'Failed to accept trade' }, 400);
  }

  return c.json({ success: true });
});

// PUT /api/trades/:tradeId/reject — Reject a trade offer
tradeRoutes.put('/:tradeId/reject', async (c) => {
  const tradeId = c.req.param('tradeId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const { success, error } = await service.rejectTradeOffer(tradeId, userId);
  if (!success) {
    return c.json({ error: error || 'Failed to reject trade' }, 400);
  }

  return c.json({ success: true });
});

// PUT /api/trades/:tradeId/cancel — Cancel a trade offer
tradeRoutes.put('/:tradeId/cancel', async (c) => {
  const tradeId = c.req.param('tradeId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const { success, error } = await service.cancelTradeOffer(tradeId, userId);
  if (!success) {
    return c.json({ error: error || 'Failed to cancel trade' }, 400);
  }

  return c.json({ success: true });
});

// PUT /api/trades/:tradeId/respond — Legacy respond endpoint (accept/reject/counter)
tradeRoutes.put('/:tradeId/respond', async (c) => {
  const tradeId = c.req.param('tradeId');
  const userId = c.get('userId');
  const body = await c.req.json();
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const { action } = body;

  if (!['accept', 'reject', 'counter'].includes(action)) {
    return c.json({ error: 'Invalid action. Must be accept, reject, or counter' }, 400);
  }

  let result;
  if (action === 'accept') {
    result = await service.acceptTradeOffer(tradeId, userId);
  } else if (action === 'reject') {
    result = await service.rejectTradeOffer(tradeId, userId);
  } else {
    result = await service.cancelTradeOffer(tradeId, userId);
  }

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ success: true });
});

// POST /api/trades/:tradeId/vote — Submit a trade vote
tradeRoutes.post('/:tradeId/vote', validateBody(schemas.tradeVote), async (c) => {
  const tradeId = c.req.param('tradeId');
  const body = (c as any).get('validatedBody');
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const result = await service.submitTradeVote(tradeId, body.voterTeamId, body.vote);
  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ data: result });
});

// GET /api/trades/:tradeId/votes — Get trade votes
tradeRoutes.get('/:tradeId/votes', async (c) => {
  const tradeId = c.req.param('tradeId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const { votes, error } = await service.getTradeVotes(tradeId);
  if (error) {
    return c.json({ error: 'Failed to fetch votes' }, 500);
  }

  return c.json({ data: votes });
});

// PUT /api/trades/:tradeId/commissioner-decision — Commissioner approve/veto
tradeRoutes.put('/:tradeId/commissioner-decision', validateBody(schemas.commissionerDecision), async (c) => {
  const tradeId = c.req.param('tradeId');
  const userId = c.get('userId');
  const body = (c as any).get('validatedBody');
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  try {
    const { success, error } = await service.commissionerDecision(
      tradeId,
      body.leagueId,
      body.decision,
      userId,
    );

    if (!success) {
      return c.json({ error: error || 'Commissioner decision failed' }, 400);
    }

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 403);
  }
});

export { tradeRoutes };

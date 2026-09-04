import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { z } from 'zod';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { TradeService } from '../services/TradeService';
import { LeagueMembershipService } from '../services/LeagueMembershipService';
import { SeasonStateService } from '../services/SeasonStateService';
import { AuditService } from '../services/AuditService';
import { AppError } from '../lib/errors';
import { ok, created, fail, handleError } from '../lib/responses';
import { logger } from '@citrus/shared';

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
    return handleError(c, error, 'Failed to fetch trades');
  }

  return ok(c, trades);
});

// GET /api/trades/league/:leagueId/review-settings — Get trade review settings
tradeRoutes.get('/league/:leagueId/review-settings', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const result = await service.getTradeReviewSettings(leagueId);
  return ok(c, result);
});

// PUT /api/trades/league/:leagueId/review-settings — Update trade review settings (commissioner only)
tradeRoutes.put(
  '/league/:leagueId/review-settings',
  membershipMiddleware,
  validateBody(schemas.tradeReviewSettings),
  async (c) => {
    const leagueId = c.req.param('leagueId');
    const userId = c.get('userId');
    // zod 3.23 infers fields as optional for some compound schemas, but
    // validateBody guarantees required fields at runtime — safe to assert.
    const body = getValidatedBody<{
      trade_review_type: 'none' | 'commissioner' | 'league_vote';
      trade_review_period_hours: number;
      trade_veto_threshold: number;
    }>(c);
    const supabase = createUserClient(c.get('userToken'));
    const service = new TradeService(supabase);

    try {
      const { success, error } = await service.updateTradeReviewSettings(leagueId, userId, body);
      if (!success) {
        return fail(
          c,
          AppError.badRequest(typeof error === 'string' ? error : (error as Error)?.message || 'Failed to update trade review settings'),
        );
      }

      const audit = new AuditService(supabase);
      audit.log('ADMIN_ACTION', leagueId, {
        action: 'update_trade_review_settings',
        settings: body,
      });

      return ok(c, { success: true });
    } catch (err) {
      return handleError(c, err, 'Failed to update trade review settings');
    }
  },
);

// POST /api/trades/league/:leagueId — Create a trade offer
tradeRoutes.post('/league/:leagueId', membershipMiddleware, validateBody(schemas.createTrade), async (c) => {
  const leagueId = c.req.param('leagueId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.createTrade>>(c);
  const supabase = createUserClient(c.get('userToken'));

  // Season-complete guard: no new trades after the season ends.
  const seasonState = await new SeasonStateService(supabase).isSeasonComplete(leagueId);
  if (seasonState.complete) {
    logger.info('[trades] create blocked — season complete', { leagueId });
    return fail(c, AppError.forbidden('Season is complete; rosters are locked'));
  }

  const service = new TradeService(supabase);

  const { success, error, tradeId } = await service.createTradeOffer(
    leagueId,
    String(body.fromTeamId),
    String(body.toTeamId),
    body.offeredPlayerIds.map(Number),
    body.requestedPlayerIds.map(Number),
    userId,
    body.message,
  );

  if (!success) {
    return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to create trade'));
  }

  const audit = new AuditService(supabase);
  audit.log('TRADE_OFFER', leagueId, { tradeId, fromTeamId: body.fromTeamId, toTeamId: body.toTeamId });

  return created(c, { tradeId });
});

// PUT /api/trades/:tradeId/accept — Accept a trade offer
tradeRoutes.put('/:tradeId/accept', async (c) => {
  const tradeId = c.req.param('tradeId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const access = await service.verifyTradeAccess(tradeId, userId);
  if (access.error) return fail(c, AppError.forbidden(access.error));

  if (access.leagueId) {
    const seasonState = await new SeasonStateService(supabase).isSeasonComplete(access.leagueId);
    if (seasonState.complete) {
      logger.info('[trades] accept blocked — season complete', { leagueId: access.leagueId, tradeId });
      return fail(c, AppError.forbidden('Season is complete; rosters are locked'));
    }
  }

  const { success, error } = await service.acceptTradeOffer(tradeId, userId);
  if (!success) {
    return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to accept trade'));
  }

  const audit = new AuditService(supabase);
  audit.log('TRADE_ACCEPT', null, { tradeId });

  return ok(c, { success: true });
});

// PUT /api/trades/:tradeId/reject — Reject a trade offer
tradeRoutes.put('/:tradeId/reject', async (c) => {
  const tradeId = c.req.param('tradeId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const access = await service.verifyTradeAccess(tradeId, userId);
  if (access.error) return fail(c, AppError.forbidden(access.error));

  const { success, error } = await service.rejectTradeOffer(tradeId, userId);
  if (!success) {
    return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to reject trade'));
  }

  const audit = new AuditService(supabase);
  audit.log('TRADE_REJECT', null, { tradeId });

  return ok(c, { success: true });
});

// PUT /api/trades/:tradeId/cancel — Cancel a trade offer
tradeRoutes.put('/:tradeId/cancel', async (c) => {
  const tradeId = c.req.param('tradeId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const access = await service.verifyTradeAccess(tradeId, userId);
  if (access.error) return fail(c, AppError.forbidden(access.error));

  const { success, error } = await service.cancelTradeOffer(tradeId, userId);
  if (!success) {
    return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Failed to cancel trade'));
  }

  return ok(c, { success: true });
});

// PUT /api/trades/:tradeId/respond — Legacy respond endpoint (accept/reject/counter)
tradeRoutes.put('/:tradeId/respond', validateBody(schemas.tradeRespond), async (c) => {
  const tradeId = c.req.param('tradeId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.tradeRespond>>(c);

  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const access = await service.verifyTradeAccess(tradeId, userId);
  if (access.error) return fail(c, AppError.forbidden(access.error));

  let result;
  if (body.action === 'accept') {
    result = await service.acceptTradeOffer(tradeId, userId);
  } else if (body.action === 'reject') {
    result = await service.rejectTradeOffer(tradeId, userId);
  } else {
    result = await service.cancelTradeOffer(tradeId, userId);
  }

  if (!result.success) {
    return fail(c, AppError.badRequest(typeof result.error === 'string' ? result.error : 'Trade action failed'));
  }

  return ok(c, { success: true });
});

// POST /api/trades/:tradeId/vote — Submit a trade vote
tradeRoutes.post('/:tradeId/vote', validateBody(schemas.tradeVote), async (c) => {
  const tradeId = c.req.param('tradeId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.tradeVote>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const access = await service.verifyTradeAccess(tradeId, userId);
  if (access.error || !access.leagueId) {
    return fail(c, AppError.forbidden(access.error || 'Trade not found'));
  }

  // T3 (2026-09-03) - TRADE VOTE SPOOFING.
  //
  // body.voterTeamId used to be handed straight to submit_trade_vote. That RPC
  // is SECURITY DEFINER, so the trade_votes_insert RLS policy (voter_team_id
  // must be a team the caller owns) never ran against its INSERT, and the
  // INSERT is ON CONFLICT (trade_offer_id, voter_team_id) DO UPDATE. Any league
  // member could therefore cast a vote as every other team, and overwrite votes
  // those managers had already cast - enough to veto any trade single-handed.
  //
  // The RPC now enforces ownership itself (migration 20260903232000), which is
  // the check that matters, because EXECUTE is granted to `authenticated` and a
  // browser can call the RPC directly without ever reaching this handler. This
  // check is the second layer: it turns a silent refusal into a 403 that says
  // what went wrong, and it means the server never forwards a team id it has
  // not verified.
  //
  // getUserTeamIdFresh is the F14 canonical resolver: it always issues a direct
  // teams query and never touches the membership cache, because team ownership
  // is identity-critical.
  const membership = new LeagueMembershipService(supabase);
  const ownTeamId = await membership.getUserTeamIdFresh(access.leagueId, userId);
  if (!ownTeamId) {
    return fail(c, AppError.forbidden('You do not own a team in this league'));
  }
  if (String(body.voterTeamId) !== ownTeamId) {
    logger.warn('[trades] vote rejected - voterTeamId is not the caller team', {
      tradeId,
      leagueId: access.leagueId,
      requestedTeamId: String(body.voterTeamId),
    });
    return fail(c, AppError.forbidden('You can only vote as a team you own'));
  }

  // Deliberately the resolved id, not the body value: the two are now known to
  // be equal, and passing the verified one means a future edit to the check
  // cannot leave an unverified id flowing to the RPC.
  const result = await service.submitTradeVote(tradeId, ownTeamId, body.vote);
  if (!result.success) {
    return fail(c, AppError.badRequest(typeof result.error === 'string' ? result.error : 'Vote failed'));
  }

  return ok(c, result);
});

// GET /api/trades/:tradeId/votes — Get trade votes
tradeRoutes.get('/:tradeId/votes', async (c) => {
  const tradeId = c.req.param('tradeId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const access = await service.verifyTradeAccess(tradeId, userId);
  if (access.error) return fail(c, AppError.forbidden(access.error));

  const { votes, error } = await service.getTradeVotes(tradeId);
  if (error) {
    return handleError(c, error, 'Failed to fetch votes');
  }

  return ok(c, votes);
});

// PUT /api/trades/:tradeId/commissioner-decision — Commissioner approve/veto
tradeRoutes.put('/:tradeId/commissioner-decision', validateBody(schemas.commissionerDecision), async (c) => {
  const tradeId = c.req.param('tradeId');
  const userId = c.get('userId');
  const body = getValidatedBody<z.infer<typeof schemas.commissionerDecision>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new TradeService(supabase);

  const access = await service.verifyTradeAccess(tradeId, userId);
  if (access.error) return fail(c, AppError.forbidden(access.error));

  try {
    const { success, error } = await service.commissionerDecision(
      tradeId,
      body.leagueId,
      body.decision,
      userId,
    );

    if (!success) {
      return fail(c, AppError.badRequest(typeof error === 'string' ? error : 'Commissioner decision failed'));
    }

    const audit = new AuditService(supabase);
    audit.log('ADMIN_ACTION', body.leagueId, { action: 'commissioner_trade_decision', tradeId, decision: body.decision });

    return ok(c, { success: true });
  } catch (err) {
    return handleError(c, err, 'Commissioner decision failed');
  }
});

export { tradeRoutes };

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { validateBody, schemas, getValidatedBody } from '../middleware/validate';
import { createUserClient } from '../lib/supabase';
import { AuctionService } from '../services/AuctionService';
import { LeagueMembershipService } from '../services/LeagueMembershipService';
import { AppError } from '../lib/errors';
import { ok, created, fail, handleError } from '../lib/responses';

const auctionRoutes = new Hono<Env>();
auctionRoutes.use('*', authMiddleware);

// GET /api/auction/league/:leagueId/state/:sessionId
auctionRoutes.get('/league/:leagueId/state/:sessionId', membershipMiddleware, async (c) => {
  const { leagueId, sessionId } = c.req.param();
  const supabase = createUserClient(c.get('userToken'));
  const service = new AuctionService(supabase);
  const state = await service.getAuctionState(leagueId, sessionId);
  return ok(c, state);
});

// POST /api/auction/league/:leagueId/initialize
auctionRoutes.post('/league/:leagueId/initialize', membershipMiddleware, validateBody(schemas.auctionInitialize), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.auctionInitialize>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new AuctionService(supabase);
  const result = await service.initializeAuction(leagueId, body.sessionId, body.teamIds, body.budget, body.minBid);
  if (!result.success) return fail(c, AppError.badRequest(result.error || 'Failed to initialize auction'));
  return ok(c, result);
});

// POST /api/auction/league/:leagueId/nominate
auctionRoutes.post('/league/:leagueId/nominate', membershipMiddleware, validateBody(schemas.auctionNominate), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.auctionNominate>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new AuctionService(supabase);
  const result = await service.nominatePlayer(leagueId, body.sessionId, body.teamId, body.playerId, body.playerName, body.openingBid, body.timerSeconds);
  if (!result.success) return fail(c, AppError.badRequest(result.error || 'Failed to nominate'));
  return ok(c, result);
});

// POST /api/auction/league/:leagueId/bid
auctionRoutes.post('/league/:leagueId/bid', membershipMiddleware, validateBody(schemas.auctionBid), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.auctionBid>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new AuctionService(supabase);
  const result = await service.placeBid(leagueId, body.nominationId, body.teamId, body.bidAmount);
  if (!result.success) return fail(c, AppError.badRequest(result.error || 'Failed to place bid'));
  return ok(c, result);
});

// POST /api/auction/league/:leagueId/close-nomination
auctionRoutes.post('/league/:leagueId/close-nomination', membershipMiddleware, validateBody(schemas.auctionCloseNomination), async (c) => {
  const leagueId = c.req.param('leagueId');
  const body = getValidatedBody<z.infer<typeof schemas.auctionCloseNomination>>(c);
  const supabase = createUserClient(c.get('userToken'));
  const service = new AuctionService(supabase);
  const result = await service.closeNomination(leagueId, body.sessionId, body.nominationId);
  if (!result.success) return fail(c, AppError.badRequest(result.error || 'Failed to close nomination'));
  return ok(c, result);
});

// GET /api/auction/league/:leagueId/budgets
auctionRoutes.get('/league/:leagueId/budgets', membershipMiddleware, async (c) => {
  const leagueId = c.req.param('leagueId');
  const supabase = createUserClient(c.get('userToken'));
  const service = new AuctionService(supabase);
  const result = await service.getAuctionBudgets(leagueId);
  if (result.error) return handleError(c, result.error, 'Failed to fetch budgets');
  return ok(c, result.budgets);
});

// GET /api/auction/bids/:nominationId
auctionRoutes.get('/bids/:nominationId', async (c) => {
  const nominationId = c.req.param('nominationId');
  const userId = c.get('userId');
  const supabase = createUserClient(c.get('userToken'));

  // Look up nomination's league and verify membership
  const { data: nomination } = await supabase
    .from('auction_nominations')
    .select('league_id')
    .eq('id', nominationId)
    .single();

  if (!nomination) return fail(c, AppError.notFound('Nomination'));

  const membership = new LeagueMembershipService(supabase);
  const isMember = await membership.verifyMembership(nomination.league_id, userId);
  if (!isMember) return fail(c, AppError.forbidden('Not a member of this league'));

  const service = new AuctionService(supabase);
  const result = await service.getBidHistory(nominationId);
  if (result.error) return handleError(c, result.error, 'Failed to fetch bids');
  return ok(c, result.bids);
});

export { auctionRoutes };

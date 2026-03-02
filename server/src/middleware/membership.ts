import { Context, Next } from 'hono';
import type { Env } from '../app';
import { createUserClient } from '../lib/supabase';
import { LeagueMembershipService } from '../services/LeagueMembershipService';

/**
 * League membership middleware — verifies the authenticated user
 * is a member of the league specified in the route params.
 *
 * Must be used AFTER authMiddleware.
 * Expects :leagueId in the route path.
 *
 * Usage:
 *   app.get('/api/leagues/:leagueId/matchups', authMiddleware, membershipMiddleware, handler);
 */
export async function membershipMiddleware(c: Context<Env>, next: Next) {
  const userId = c.get('userId');
  const userToken = c.get('userToken');
  const leagueId = c.req.param('leagueId');

  if (!userId || !userToken) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  if (!leagueId) {
    return c.json({ error: 'League ID is required' }, 400);
  }

  const supabase = createUserClient(userToken);
  const membership = new LeagueMembershipService(supabase);
  const result = await membership.checkMembership(leagueId, userId);

  if (!result.isMember) {
    return c.json({ error: 'Access denied: You are not a member of this league' }, 403);
  }

  await next();
}

/**
 * Commissioner-only middleware — verifies user is the league commissioner.
 * Must be used AFTER authMiddleware.
 */
export async function commissionerMiddleware(c: Context<Env>, next: Next) {
  const userId = c.get('userId');
  const userToken = c.get('userToken');
  const leagueId = c.req.param('leagueId');

  if (!userId || !userToken) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  if (!leagueId) {
    return c.json({ error: 'League ID is required' }, 400);
  }

  const supabase = createUserClient(userToken);
  const membership = new LeagueMembershipService(supabase);
  const result = await membership.checkMembership(leagueId, userId);

  if (!result.isCommissioner) {
    return c.json({ error: 'Access denied: Commissioner privileges required' }, 403);
  }

  await next();
}

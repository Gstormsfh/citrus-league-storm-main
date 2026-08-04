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
    return c.json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required' } }, 401);
  }

  if (!leagueId) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'League ID is required' } }, 400);
  }

  const supabase = createUserClient(userToken);
  const membership = new LeagueMembershipService(supabase);
  const result = await membership.checkMembership(leagueId, userId);

  // DR-2 diagnostic (2026-07-29) — temporary logging to isolate the
  // "discovery returns 200 but my-team returns 403" divergence for
  // the same user+league. Remove after ship-report prep per ledger
  // rule. Logs to API-server stdout: the launcher's window shows
  // these lines.
  //
  // F14(a) (2026-08-03): teamId field removed from this log — the
  // cache no longer holds teamId (identity-critical values must be
  // resolved fresh via getUserTeamIdFresh). What remains is the
  // boolean surface: the isMember gate this middleware enforces.
  // eslint-disable-next-line no-console
  console.log(
    `[DR-2 diag membershipMiddleware] path=${c.req.path} userId=${userId} ` +
      `leagueId=${leagueId} isMember=${result.isMember} isCommissioner=${result.isCommissioner}`,
  );

  if (!result.isMember) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied: You are not a member of this league' } }, 403);
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
    return c.json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required' } }, 401);
  }

  if (!leagueId) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'League ID is required' } }, 400);
  }

  const supabase = createUserClient(userToken);
  const membership = new LeagueMembershipService(supabase);
  const result = await membership.checkMembership(leagueId, userId);

  if (!result.isCommissioner) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied: Commissioner privileges required' } }, 403);
  }

  await next();
}

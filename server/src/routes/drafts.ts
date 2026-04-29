/**
 * Phase 4.5 chunk 11g.1 — Discovery endpoint for the live draft engine.
 *
 * GET /api/drafts/:draftId/server returns `{ host, port, token }` where:
 *   - `host` and `port` address the WebSocket-serving Node process for
 *     this draft. Day 1 returns env-driven constants (single-process,
 *     no sharding); the protocol shape supports future multi-process
 *     transition without client or server changes (KI-011).
 *   - `token` is a 5-minute draft-scoped JWT (see `lib/draftToken.ts`).
 *
 * Auth: existing `authMiddleware` + `membershipMiddleware`. The
 * membership middleware reads `:leagueId` from the path; this route
 * uses `:draftId` instead, so we resolve the league from the draft and
 * call the membership service directly. (Chunk 11g.0 audit § 4 flagged
 * the middleware Hono-coupling; this route stays inside Hono so that
 * coupling is fine here.)
 */

import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { LeagueMembershipService } from '../services/LeagueMembershipService';
import { issueDraftToken } from '../lib/draftToken';
import { logger } from '@citrus/shared';

const draftsRoutes = new Hono<Env>();

draftsRoutes.use('*', authMiddleware);

/**
 * GET /api/drafts/:draftId/server
 *
 * Validates the caller is a member of the draft's league and returns
 * the WebSocket connection address + a short-lived JWT.
 */
draftsRoutes.get('/:draftId/server', async (c) => {
  const draftId = c.req.param('draftId');
  const userId = c.get('userId');
  const userToken = c.get('userToken');

  if (!draftId || !/^[0-9a-f-]{36}$/i.test(draftId)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid draftId' } }, 400);
  }

  const supabase = createUserClient(userToken);

  // Resolve the draft's league. The drafts table's league_id is the
  // single source of truth for which league this draft belongs to.
  const { data: draft, error: draftErr } = await supabase
    .from('drafts')
    .select('id, league_id')
    .eq('id', draftId)
    .maybeSingle();

  if (draftErr) {
    logger.error('[drafts/server] draft lookup failed', { draftId, error: draftErr });
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Draft lookup failed' } }, 500);
  }
  if (!draft) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Draft not found' } }, 404);
  }

  const leagueId = draft.league_id as string;
  const membership = new LeagueMembershipService(supabase);
  const memberCheck = await membership.checkMembership(leagueId, userId);
  if (!memberCheck.isMember) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Not a member of this league' } }, 403);
  }

  // Day 1: single-process, env-driven address. Future sharding (KI-011)
  // turns these into per-shard lookups without changing the response shape.
  const host = process.env.DRAFT_WS_HOST || 'localhost';
  const port = parseInt(process.env.DRAFT_WS_PORT || '3002', 10);

  let token: string;
  try {
    token = await issueDraftToken({ userId, draftId, leagueId });
  } catch (err: unknown) {
    logger.error('[drafts/server] token issuance failed', { error: err instanceof Error ? err.message : err });
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Token issuance unavailable' } }, 503);
  }

  return c.json({ host, port, token });
});

export { draftsRoutes };

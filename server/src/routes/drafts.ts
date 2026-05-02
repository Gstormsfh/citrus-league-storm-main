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
 * In Citrus's data model the "draft" is not a separate entity — it's the
 * league's drafting phase, identified by `league_id` and tracked via the
 * `leagues.draft_status` enum. The `:draftId` URL parameter and the JWT's
 * `draftId` claim are therefore the league's UUID; the "draftId" naming
 * is preserved at the API surface because it's more semantic for clients
 * than "leagueId in drafting phase." See `docs/DRAFT_ENGINE_V2_SPEC.md`
 * §0 and `lib/draftToken.ts` for the canonical model.
 *
 * Auth: existing `authMiddleware` + direct `LeagueMembershipService`
 * call (the standard `membershipMiddleware` reads `:leagueId` from the
 * path, but this route uses `:draftId`). Chunk 11g.0 audit § 4 flagged
 * the helper-extraction work for chunk 11g.2; until then this route
 * calls the service directly.
 */

import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { createUserClient } from '../lib/supabase';
import { LeagueMembershipService } from '../services/LeagueMembershipService';
import { issueDraftToken } from '../lib/draftToken';
import { CONNECTABLE_DRAFT_STATUSES, type DraftStatus } from '@citrus/shared';
import { logger } from '@citrus/shared';

const draftsRoutes = new Hono<Env>();

draftsRoutes.use('*', authMiddleware);

/**
 * GET /api/drafts/:draftId/server
 *
 * Validates the caller is a member of the league (= draft) and that
 * the league's `draft_status` is in a connectable state, then returns
 * the WebSocket connection address + a short-lived JWT.
 *
 * Status codes:
 *   - 200: league found, user is member, draft connectable.
 *   - 401: unauthenticated (handled by `authMiddleware`).
 *   - 403: user is not a member of the league.
 *   - 404: no league with this id.
 *   - 409: league exists, user is member, but draft is in a non-
 *     connectable state (`not_started` or `completed`). The 409 carries
 *     the current status so the client can render the right UI.
 *   - 503: server JWT secret unavailable, or unexpected lookup error.
 */
draftsRoutes.get('/:draftId/server', async (c) => {
  const draftId = c.req.param('draftId');
  const userId = c.get('userId');
  const userToken = c.get('userToken');

  if (!draftId || !/^[0-9a-f-]{36}$/i.test(draftId)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid draftId' } }, 400);
  }

  const supabase = createUserClient(userToken);

  // The "draft" is the league's drafting phase. Look up the league,
  // confirm it exists, and read its `draft_status` to gate connection.
  const { data: league, error: leagueErr } = await supabase
    .from('leagues')
    .select('id, draft_status')
    .eq('id', draftId)
    .maybeSingle();

  if (leagueErr) {
    logger.error('[drafts/server] league lookup failed', { draftId, error: leagueErr });
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Draft lookup failed' } }, 500);
  }
  if (!league) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Draft not found' } }, 404);
  }

  const leagueId = league.id as string;
  const draftStatus = league.draft_status as DraftStatus;

  // Membership before status — leak as little league existence as possible
  // to non-members. (A non-member gets 403 regardless of whether the
  // draft happens to be in a connectable state.)
  const membership = new LeagueMembershipService(supabase);
  const memberCheck = await membership.checkMembership(leagueId, userId);
  if (!memberCheck.isMember) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Not a member of this league' } }, 403);
  }

  if (!CONNECTABLE_DRAFT_STATUSES.includes(draftStatus)) {
    return c.json(
      {
        error: {
          code: 'DRAFT_NOT_CONNECTABLE',
          message: `Draft is not active. Current status: ${draftStatus}`,
          status: draftStatus,
        },
      },
      409,
    );
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

/**
 * Draft Engine v2 — pick endpoint.
 * Spec §7.1, §7.3.
 *
 *   POST /api/draft/v2/league/:leagueId/pick
 *
 * Headers:
 *   X-Idempotency-Key: <uuid>           (required)
 *   X-Correlation-Id:  <uuid>           (optional; server generates if absent)
 *
 * Body:
 *   { team_id: uuid, player_id: int, round: int, pick_number: int }
 *
 * Response (200):
 *   { event_id: bigint, seq: bigint,
 *     pick_deadline: iso8601 | null, was_duplicate: bool }
 *
 * Errors (per spec §11.1, mapped by DraftServiceV2.mapRpcError):
 *   400 invalid_event_payload     — body validation failed
 *   401 AUTHENTICATION_REQUIRED   — auth middleware
 *   403 unauthorized              — caller not on team
 *   403 FORBIDDEN                 — membership middleware
 *   409 idempotency_conflict      — same key, different intent
 *   409 pick_out_of_order
 *   409 not_on_clock
 *   409 player_taken
 *   422 illegal_state             — draft not active
 *   500 illegal_state_transition / shadow_guard_violated
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { createUserClient, supabaseAdmin } from '../lib/supabase';
import { DraftServiceV2 } from '../services/DraftServiceV2';
import { ok, handleError } from '../lib/responses';
import { AppError } from '../lib/errors';

const draftV2PickRoutes = new Hono<Env>();

draftV2PickRoutes.use('*', authMiddleware);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PickBodySchema = z.object({
  team_id:     z.string().regex(UUID_RE, 'team_id must be a UUID'),
  player_id:   z.number().int().positive(),
  round:       z.number().int().positive(),
  pick_number: z.number().int().positive(),
});

draftV2PickRoutes.post(
  '/league/:leagueId/pick',
  membershipMiddleware,
  async (c) => {
    const leagueId   = c.req.param('leagueId');
    const userId     = c.get('userId');
    const userToken  = c.get('userToken');

    // ── Headers ─────────────────────────────────────────────────────
    const idempotencyKey = c.req.header('X-Idempotency-Key');
    const correlationId  = c.req.header('X-Correlation-Id') ?? null;

    if (!idempotencyKey || !UUID_RE.test(idempotencyKey)) {
      return handleError(
        c,
        new AppError(
          'X-Idempotency-Key header is required and must be a UUID',
          400,
          'BAD_REQUEST',
        ),
        'Missing or invalid X-Idempotency-Key',
      );
    }
    if (correlationId !== null && !UUID_RE.test(correlationId)) {
      return handleError(
        c,
        new AppError(
          'X-Correlation-Id, when present, must be a UUID',
          400,
          'BAD_REQUEST',
        ),
        'Invalid X-Correlation-Id',
      );
    }

    // ── Body ───────────────────────────────────────────────────────
    let body: z.infer<typeof PickBodySchema>;
    try {
      const raw = await c.req.json();
      body = PickBodySchema.parse(raw);
    } catch (err) {
      return handleError(
        c,
        new AppError(
          'invalid_event_payload: body validation failed',
          400,
          'VALIDATION_ERROR',
          err instanceof Error ? err.message : String(err),
        ),
        'Pick body validation failed',
      );
    }

    // ── Submit pick + post-commit broadcast ─────────────────────────
    // submitPick uses the user-scoped client (preserves the JWT for
    // auth.uid() inside the SECURITY DEFINER RPC). broadcastEvent uses
    // the admin client (service role); broadcasting is not user-auth
    // gated and the channel is not access-controlled (spec §6.14).
    //
    // Session ID propagation: spec §4.1 says p_session_id is written
    // into payload.session_id for tracing. We use the request ID from
    // requestContext middleware as the session ID — stable per request,
    // unique per call, ties pick events to their HTTP request log line.
    const userClient = createUserClient(userToken);
    const service    = new DraftServiceV2(userClient);
    const sessionId  = c.get('requestId');

    try {
      const result = await service.submitPick({
        leagueId,
        teamId:         body.team_id,
        playerId:       body.player_id,
        round:          body.round,
        pickNumber:     body.pick_number,
        sessionId,
        idempotencyKey,
        actor:          { kind: 'user', id: userId, session_id: sessionId },
        correlationId,
      });

      // Broadcast happens after the RPC commits. Errors here are
      // logged and counted inside broadcastEvent, never thrown.
      await service.broadcastEvent({
        admin:        supabaseAdmin,
        leagueId,
        eventId:      result.event_id,
        wasDuplicate: result.was_duplicate,
      });

      // Pick-event responses are NEVER cacheable (state-changing).
      c.header('Cache-Control', 'no-store');

      return ok(c, result);
    } catch (e) {
      return handleError(c, e, 'Failed to submit pick');
    }
  },
);

export { draftV2PickRoutes };

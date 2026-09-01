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

    // ── Format gate (2026-09-01) ────────────────────────────────────
    // AUCTION INCIDENT (league a1a125c8, seq 2): the engine's WS path
    // rejects picks in auction lobbies (wrong_format_for_action), but
    // THIS HTTP path went straight to submit_pick_v2 with no format
    // check — a Draft press in an auction room recorded a $0 snake
    // pick, the auto-nominator then put the same player on the block,
    // and the lot close failed against the duplicate. Manual snake
    // picks are snake/linear-only; auction rosters fill exclusively
    // through close_nomination_v2. (A matching guard inside the RPC
    // itself is the follow-up ADR — the RPC surface is ADR-bound.)
    {
      const { data: leagueRow } = await supabaseAdmin
        .from('leagues')
        .select('settings')
        .eq('id', leagueId)
        .maybeSingle();
      const draftType =
        (leagueRow?.settings as Record<string, unknown> | null)?.draftType;
      if (draftType === 'auction') {
        return handleError(
          c,
          new AppError(
            'wrong_format_for_action: auction rosters fill through bids, not picks',
            409,
            'CONFLICT',
          ),
          'Manual pick rejected for auction-format league',
        );
      }
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
      //
      // ARCHITECT 2026-08-12 (PICK-LATENCY / inbox E145) — NOT AWAITED.
      // This await was costing every human pick a flat ~4 extra seconds,
      // measured twice on staging: click -> durable ledger row took 1,837ms
      // and 2,123ms, while the POST returned at 5,710ms and 5,966ms. Both
      // response times sit just above BROADCAST_TIMEOUT_MS (5_000), which is
      // the timeout firing, not the work taking that long.
      //
      // WHY THE SUBSCRIBE NEVER SUCCEEDS, AND WHY THAT IS FINE: the channel
      // `draft_events_v2:<leagueId>` has ZERO subscribers. Grepping the web
      // app for it returns only this publisher and its own unit test — the v2
      // client receives events over the ENGINE's uWS WebSocket, never over
      // Supabase Realtime. With nobody connected, the Realtime tenant shuts
      // down between uses ("Stop tenant ... because of no connected users" in
      // the realtime logs), so each publish cold-starts a tenant, fails to
      // reach SUBSCRIBED inside 5s, and times out. Every human pick paid for
      // a message no client was ever going to receive.
      //
      // Dropping the await returns the response as soon as the pick is
      // durable. This cannot affect correctness: the RPC has already
      // committed above, broadcastEvent returns void, swallows every error
      // internally (see its three catch blocks), and nothing reads its
      // result. The .catch is belt-and-braces against an unhandled rejection
      // taking down the process — it should be unreachable.
      //
      // The broadcast itself looks vestigial and may be worth deleting
      // outright, but that is a design decision, not a latency fix, and it
      // is left for Garrett.
      void service
        .broadcastEvent({
          admin:        supabaseAdmin,
          leagueId,
          eventId:      result.event_id,
          wasDuplicate: result.was_duplicate,
        })
        .catch(() => { /* broadcastEvent never throws; see above */ });

      // Pick-event responses are NEVER cacheable (state-changing).
      c.header('Cache-Control', 'no-store');

      return ok(c, result);
    } catch (e) {
      return handleError(c, e, 'Failed to submit pick');
    }
  },
);

export { draftV2PickRoutes };

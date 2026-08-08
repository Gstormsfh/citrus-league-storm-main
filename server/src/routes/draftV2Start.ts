/**
 * Draft Engine v2 — commissioner start endpoint (T7 URGENT, 2026-08-08).
 *
 * POST /api/draft/v2/league/:leagueId/start
 *
 * Purpose. Wire THE TWELVE's commissioner Start Draft button through to
 * the F27 `start_draft_v2` RPC (migration `20260807000000_start_draft_v2.sql`).
 * Pre-T7, the only client-side start-draft paths (v1 `handleStartDraft` in
 * DraftRoom.tsx + `startDraft(leagueId)` in api/draft.ts + server
 * `POST /api/draft/league/:leagueId/start`) used the flip-era pattern
 * `UPDATE leagues SET draft_status = 'in_progress'` — bypassing F27's
 * ignition path entirely. THE TWELVE cannot draft without this endpoint
 * (per architect T7 ruling).
 *
 * Request:
 *   POST body: { idempotency_key?: string (uuid) }
 *   (idempotency_key optional — client generates via randomUUID() if
 *    absent; enables retry-safe double-click semantics per start_draft_v2's
 *    Step 0 idempotency short-circuit)
 *
 * Response (success — matches F27 Rider 4 assert C):
 *   200 { event_id: number, seq: number, first_pick_deadline: ISO 8601,
 *         was_duplicate: boolean }
 *
 * Response (failure — Rider 1 preflight taxonomy):
 *   400 { error: 'illegal_state', reason: '<discriminator>' }
 *   403 { error: 'unauthorized' } (via commissionerMiddleware)
 *   500 { error: 'internal' } (unexpected)
 *
 * Rider 1 discriminators (from start_draft_v2 migration):
 *   - 'already_completed' → draft is already completed
 *   - 'already_in_progress' → draft is already in_progress
 *   - 'illegal_combo' → draft_state ↔ draft_status combination not startable
 *   - 'not_startable' → league config prevents start (e.g., team count)
 *   - 'unexpected' → catch-all
 *
 * Auth: commissionerMiddleware (via app.ts mount) verifies caller is
 * league commissioner. Supabase's SECURITY DEFINER + start_draft_v2's
 * own actor.kind check provides defense-in-depth.
 */
import { Hono } from 'hono';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { createUserClient } from '../lib/supabase';
import { ok, fail, handleError } from '../lib/responses';
import { AppError } from '../lib/errors';

const draftV2StartRoutes = new Hono<Env>();

draftV2StartRoutes.use('*', authMiddleware);

draftV2StartRoutes.post(
  '/league/:leagueId/start',
  membershipMiddleware,
  async (c) => {
    const leagueId = c.req.param('leagueId');
    const userId = c.get('userId') as string | undefined;
    const supabase = createUserClient(c.get('userToken'));

    if (!userId) {
      return fail(c, AppError.unauthorized('Missing user context'));
    }

    // Parse body — idempotency_key optional; client-generated
    // preferred so double-clicks fold into one RPC call.
    let body: { idempotency_key?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      // Empty body is OK — we'll generate a server-side key below.
    }

    const idempotencyKey =
      body.idempotency_key ??
      // Fallback: generate server-side. Client SHOULD supply its own
      // for retry-safe semantics across network partitions.
      crypto.randomUUID();

    // Construct actor JSONB per F27 contract (start_draft_v2's p_actor).
    // actor.kind='user' identifies commissioner-initiated ignition;
    // start_draft_v2's Step 2 authorization checks (SECURITY DEFINER
    // context) mirror submit_pick_v2's user-branch guard —
    // commissionerMiddleware above provides the primary check.
    const actor = {
      kind: 'user',
      id: userId,
    };

    try {
      const { data, error } = await supabase.rpc('start_draft_v2', {
        p_league_id: leagueId,
        p_actor: actor,
        p_idempotency_key: idempotencyKey,
      });

      if (error) {
        // Map Rider 1 preflight taxonomy → user-facing HTTP error.
        // start_draft_v2 raises with SQLSTATE + message containing
        // 'illegal_state:' prefix; the message discriminator is
        // preserved for client to display specific taxonomy.
        const msg = error.message ?? String(error);
        const reason =
          msg.includes('already_completed') ? 'already_completed'
          : msg.includes('already_in_progress') ? 'already_in_progress'
          : msg.includes('illegal_combo') ? 'illegal_combo'
          : msg.includes('not_startable') ? 'not_startable'
          : 'unexpected';
        // AppError.badRequest signature is (message, details?: string) —
        // pass discriminator via the message body so client can grep it
        // out (`error.message.includes('reason:xxx')`). Additional
        // details string carries the original SQLSTATE message for
        // server-log correlation.
        return fail(
          c,
          AppError.badRequest(`illegal_state reason:${reason}`, msg),
        );
      }

      // Success shape from start_draft_v2 RPC (per migration §6.4 return):
      // { event_id, seq, first_pick_deadline, was_duplicate }
      // The RPC returns a JSONB object; supabase-js unwraps to `data`.
      return ok(c, data);
    } catch (err) {
      return handleError(c, err, 'Failed to start draft (v2)');
    }
  },
);

export { draftV2StartRoutes };

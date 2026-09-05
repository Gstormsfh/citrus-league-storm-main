/**
 * Draft Engine v2 — offline draft import endpoint (2026-08-24 launch build).
 *
 *   POST /api/draft/v2/league/:leagueId/offline-import
 *
 * Offline leagues (settings.draftType === 'offline') draft in person;
 * the commissioner enters the results here in one shot. The
 * `offline_import_draft_v2` RPC writes a REAL v2 event stream —
 * draft_started → one 'pick' per selection → draft_completed — in a
 * single transaction, so the existing triggers do everything else:
 * `tg_draft_events_project_pick` fills draft_picks_v2 and
 * `tg_draft_events_sync_roster` builds rosters + finalizes the league
 * to draft_status='completed'.
 *
 * ENGINE SAFETY. The live draft engine must never build a lobby for an
 * offline league (its format gate only speaks snake/linear/auction —
 * an offline lobby would crash-loop the WS the way the pre-fix autopick
 * league did). Three layers keep it out:
 *   1. This import never passes through 'in_progress' — the league goes
 *      not_started → completed inside one transaction, and pg NOTIFYs
 *      deliver only after commit, when the engine's NOTIFY-creates-lobby
 *      gate (draft_status === 'in_progress') already skips the league.
 *   2. draftV2Start refuses to ignite offline leagues (guard added in
 *      the same build).
 *   3. The web draft room renders the offline entry UI instead of
 *      connecting a WS client for offline leagues.
 *
 * Auth: authMiddleware + membershipMiddleware + an explicit
 * commissioner check here (the RPC re-checks actor.id against
 * leagues.commissioner_id as defense-in-depth).
 *
 * Request:
 *   Headers: X-Idempotency-Key: <uuid>   (required — whole-import key)
 *   Body: {
 *     picks: [{ pick_number: number, team_id: uuid, player_id: number }],
 *     allow_partial?: boolean   // uneven/short in-person results
 *   }
 *
 * Response 200: { success, was_duplicate, total_picks, total_rounds,
 *                 total_teams, first_seq, last_seq, draft_status,
 *                 roster_sync }
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../app';
import { authMiddleware } from '../middleware/auth';
import { membershipMiddleware } from '../middleware/membership';
import { supabaseAdmin } from '../lib/supabase';
import { ok, fail, handleError } from '../lib/responses';
import { AppError } from '../lib/errors';
import { AuditService } from '../services/AuditService';
import { createUserClient } from '../lib/supabase';

const draftV2OfflineRoutes = new Hono<Env>();

draftV2OfflineRoutes.use('*', authMiddleware);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OfflineImportBodySchema = z.object({
  picks: z
    .array(
      z.object({
        pick_number: z.number().int().positive(),
        team_id: z.string().regex(UUID_RE, 'team_id must be a UUID'),
        player_id: z.number().int().positive(),
      }),
    )
    .min(1)
    // 30 rounds × 20 teams is far beyond any real league; the cap keeps
    // a hostile payload from turning the RPC loop into a DoS vector.
    .max(600),
  allow_partial: z.boolean().optional(),
});

draftV2OfflineRoutes.post(
  '/league/:leagueId/offline-import',
  membershipMiddleware,
  async (c) => {
    const leagueId = c.req.param('leagueId');
    const userId = c.get('userId') as string | undefined;
    if (!userId) {
      return fail(c, AppError.unauthorized('Missing user context'));
    }

    const idempotencyKey = c.req.header('X-Idempotency-Key');
    if (!idempotencyKey || !UUID_RE.test(idempotencyKey)) {
      return fail(
        c,
        AppError.badRequest('X-Idempotency-Key header (UUID) is required'),
      );
    }

    let body: z.infer<typeof OfflineImportBodySchema>;
    try {
      body = OfflineImportBodySchema.parse(await c.req.json());
    } catch (err) {
      const detail =
        err instanceof z.ZodError
          ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
          : 'invalid JSON body';
      return fail(c, AppError.badRequest(`invalid_picks: ${detail}`));
    }

    // Commissioner gate (route-owned; RPC re-verifies actor.id).
    const { data: league, error: leagueErr } = await supabaseAdmin
      .from('leagues')
      .select('commissioner_id, settings, draft_status')
      .eq('id', leagueId)
      .single();
    if (leagueErr || !league) {
      return fail(c, AppError.notFound('League not found'));
    }
    if (league.commissioner_id !== userId) {
      return fail(
        c,
        AppError.forbidden('unauthorized: only the commissioner can import draft results'),
      );
    }
    const draftType = ((league.settings ?? {}) as { draftType?: string }).draftType;
    if (draftType !== 'offline') {
      return fail(
        c,
        AppError.badRequest(
          `offline_only: this league drafts ${draftType ?? 'live'}. Import is only for offline drafts`,
        ),
      );
    }

    try {
      const { data, error } = await supabaseAdmin.rpc('offline_import_draft_v2', {
        p_league_id: leagueId,
        p_picks: body.picks,
        p_actor: { kind: 'commissioner', id: userId },
        p_idempotency_key: idempotencyKey,
        p_correlation_id: null,
        p_allow_partial: body.allow_partial ?? false,
      });

      if (error) {
        const msg = error.message ?? String(error);
        const reason =
          msg.includes('already_imported') || msg.includes('draft_already_completed')
            ? 'already_imported'
            : msg.includes('offline_only') ? 'offline_only'
            : msg.includes('non_contiguous_picks') ? 'non_contiguous_picks'
            : msg.includes('duplicate_player') ? 'duplicate_player'
            : msg.includes('team_not_in_league') ? 'team_not_in_league'
            : msg.includes('not_rectangular') ? 'not_rectangular'
            : msg.includes('invalid_picks') ? 'invalid_picks'
            : msg.includes('unauthorized') ? 'unauthorized'
            : msg.includes('draft_not_configured') ? 'draft_not_configured'
            : 'unexpected';
        if (reason === 'unauthorized') {
          return fail(c, AppError.forbidden(msg));
        }
        return fail(c, AppError.badRequest(`offline_import_failed reason:${reason}`, msg));
      }

      // Audit truth, not attempts (same contract as draftV2Start).
      try {
        const audit = new AuditService(createUserClient(c.get('userToken')));
        const result = (data ?? {}) as {
          total_picks?: number;
          was_duplicate?: boolean;
          first_seq?: number;
          last_seq?: number;
        };
        audit.logDraftEvent('DRAFT_OFFLINE_IMPORT', leagueId, {
          importedBy: userId,
          totalPicks: result.total_picks ?? null,
          wasDuplicate: result.was_duplicate ?? false,
          firstSeq: result.first_seq ?? null,
          lastSeq: result.last_seq ?? null,
        });
      } catch {
        // Audit failure never blocks the import response.
      }

      return ok(c, data);
    } catch (err) {
      return handleError(c, err, 'Failed to import offline draft results');
    }
  },
);

export { draftV2OfflineRoutes };

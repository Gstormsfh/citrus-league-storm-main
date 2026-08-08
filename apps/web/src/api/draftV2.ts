// T7 URGENT (2026-08-08) — client API for F27 start_draft_v2 ignition.
//
// Pre-T7: the only client startDraft path was v1's flip-era mechanism
// (leagueApi.updateSettings({draft_status:'in_progress'})) — this
// bypassed F27's ignition RPC entirely, meaning THE TWELVE could not
// draft through the F27-native path.
//
// Post-T7: this module wraps the new server endpoint at
// POST /api/draft/v2/league/:leagueId/start (draftV2Start.ts) which in
// turn invokes the start_draft_v2 RPC. Additive to existing api/draft.ts —
// v1 startDraft() is unchanged.

import { apiClient } from './client';

/**
 * F27 Rider 4 assert C success shape.
 */
export interface StartDraftV2Success {
  event_id: number;
  seq: number;
  first_pick_deadline: string; // ISO 8601
  was_duplicate: boolean;
}

/**
 * F27 Rider 1 preflight taxonomy discriminators (see server
 * draftV2Start.ts mapping table).
 */
export type StartDraftV2Reason =
  | 'already_completed'
  | 'already_in_progress'
  | 'illegal_combo'
  | 'not_startable'
  | 'unexpected';

export interface StartDraftV2Failure {
  reason: StartDraftV2Reason;
  message: string;
}

export const draftV2Api = {
  /**
   * Start the draft via F27 `start_draft_v2` RPC (commissioner only).
   *
   * @param leagueId — target league UUID
   * @param idempotencyKey — client-generated UUID for retry-safe
   *   semantics. Highly recommended: pass a randomUUID() and reuse
   *   the same value if the client needs to retry a network failure.
   *   Without this, a network-race retry could double-fire the RPC
   *   (though start_draft_v2's own Step 0 idempotency short-circuit
   *   catches server-side duplicates via key comparison).
   *
   * @returns Success shape (event_id / seq / first_pick_deadline /
   *   was_duplicate) OR throws with `.response.data.error` containing
   *   Rider 1 taxonomy reason discriminator. Consumers should catch +
   *   inspect the error shape to render user-facing messages per
   *   taxonomy.
   */
  startDraftV2(leagueId: string, idempotencyKey: string) {
    return apiClient.post(
      `/api/draft/v2/league/${leagueId}/start`,
      { idempotency_key: idempotencyKey },
    );
  },
};

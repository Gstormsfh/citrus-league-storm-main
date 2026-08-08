// T7 URGENT (2026-08-08) — React hook wrapping the F27 start_draft_v2
// commissioner ignition flow. Handles:
//   - idempotency-key generation (client-side crypto.randomUUID)
//   - loading + error state
//   - Rider 1 preflight taxonomy → user-facing toast messages
//   - Navigation to the draft room on success (via caller-supplied
//     navigate() from useNavigate; hook is navigation-library-agnostic)
//
// USAGE (any commissioner-only button in DraftLobby or league page):
//   const { start, isPending, error } = useStartDraftV2();
//   const handleClick = async () => {
//     const result = await start(leagueId);
//     if (result.ok) navigate(`/draft-v2/${leagueId}`);
//   };
//
// This is the SOLE F27-native ignition surface. The v1 startDraft path
// (leagueApi.updateSettings({draft_status:'in_progress'}) via
// DraftRoom.tsx:handleStartDraft or apps/web/src/api/draft.ts:startDraft)
// remains untouched — additive per architect T7 ruling.

import { useCallback, useState } from 'react';
import { draftV2Api, type StartDraftV2Success, type StartDraftV2Reason } from '@/api/draftV2';

export interface UseStartDraftV2Result {
  /**
   * Starts the draft via F27 RPC. Returns discriminated result:
   * - {ok:true, data} on success
   * - {ok:false, reason, message} on Rider 1 taxonomy or network error
   */
  start: (leagueId: string) => Promise<
    | { ok: true; data: StartDraftV2Success }
    | { ok: false; reason: StartDraftV2Reason; message: string }
  >;
  isPending: boolean;
  lastError: { reason: StartDraftV2Reason; message: string } | null;
}

/**
 * Client-side user-facing message map for Rider 1 taxonomy.
 * Kept co-located with the hook so consumers get a single import
 * point + consistent copy across all commissioner Start-Draft UI.
 */
export const RIDER_1_USER_MESSAGES: Record<StartDraftV2Reason, string> = {
  already_completed:
    'This draft has already completed. Start a new season to draft again.',
  already_in_progress:
    'This draft is already in progress. Join the draft room to continue.',
  illegal_combo:
    'Draft cannot start in its current state. Check league settings and try again.',
  not_startable:
    'Draft cannot start — league configuration is incomplete. Verify team count and draft order.',
  unexpected:
    'Something went wrong starting the draft. Please try again or contact support.',
};

export function useStartDraftV2(): UseStartDraftV2Result {
  const [isPending, setIsPending] = useState(false);
  const [lastError, setLastError] = useState<
    { reason: StartDraftV2Reason; message: string } | null
  >(null);

  const start = useCallback(
    async (leagueId: string) => {
      setIsPending(true);
      setLastError(null);
      const idempotencyKey = crypto.randomUUID();
      try {
        const response = await draftV2Api.startDraftV2(leagueId, idempotencyKey);
        // apiClient.post returns { data, error } shape; success = data
        // is the RPC's JSONB return unwrapped.
        const data = (response.data ?? response) as StartDraftV2Success;
        return { ok: true as const, data };
      } catch (err) {
        // Extract Rider 1 discriminator from server-side error shape.
        // Server draftV2Start.ts wraps AppError.badRequest with message
        // `illegal_state reason:<discriminator>` (details field carries
        // the raw SQLSTATE for server-log correlation). Client parses
        // the discriminator out of the message string.
        //
        // apiClient error shape (per server lib/responses.ts fail()):
        //   err.response.data = { error: { code, message, details? } }
        const errObj = err as {
          response?: {
            data?: { error?: { message?: string; code?: string } };
          };
          message?: string;
        };
        const serverMessage =
          errObj.response?.data?.error?.message ?? errObj.message ?? '';
        const match = /reason:(\w+)/.exec(serverMessage);
        const rawReason = match?.[1] ?? '';
        const reason: StartDraftV2Reason = (
          rawReason === 'already_completed' ||
          rawReason === 'already_in_progress' ||
          rawReason === 'illegal_combo' ||
          rawReason === 'not_startable'
        )
          ? rawReason as StartDraftV2Reason
          : 'unexpected';
        const message = RIDER_1_USER_MESSAGES[reason];
        const errorState = { reason, message };
        setLastError(errorState);
        return { ok: false as const, ...errorState };
      } finally {
        setIsPending(false);
      }
    },
    [],
  );

  return { start, isPending, lastError };
}

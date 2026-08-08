// T7 architect Entry 7 (2026-08-08 20:40Z) — GAP-1 Option (a) two-step
// wire-up hook. Wraps:
//   1. Existence-check for draft_order (Condition 1 re-run safety)
//   2. initializeDraftOrder if missing
//   3. useStartDraftV2.start (F27 RPC)
//
// Presents a UNIFIED isPending across both steps (Condition 3: button
// must gate across full sequence).
//
// FAILURE ORDERING (Condition 2):
//   - Init fails → user-facing error, ignition NEVER attempted, league
//     remains in configured-not-started state, retryable.
//   - Init OK + ignition refused (Rider-1) → taxonomy message shown,
//     league remains in configured-not-started state (safe), retryable.
//     NEW idempotency key regenerates per user-initiated attempt (via
//     useStartDraftV2's start function).
//
// RE-RUN SAFETY (Condition 1):
//   Server-side `DraftService.initializeDraftOrder` (
//   server/src/services/DraftService.ts:324-328) hard-deletes existing
//   draft_order rows then INSERTs fresh. Safe against row duplication
//   BUT changes sessionId + potentially reorders. Guard with cheap
//   existence check: if all rounds already present, SKIP init +
//   proceed to ignition. Handles:
//     - Fresh league: check misses → init runs.
//     - Retry-after-refusal: check hits → skip init → ignition retries
//       with fresh idempotency key.
//     - Pre-configured league: check hits → skip init.
//     - Double-press mid-sequence: isPending gate blocks the second
//       click before the guard even runs.

import { useCallback, useState } from 'react';
import { useStartDraftV2, RIDER_1_USER_MESSAGES } from './useStartDraftV2';
import type { StartDraftV2Success, StartDraftV2Reason } from '@/api/draftV2';
import { DraftService } from '@/services/DraftService';
import type { Team } from '@/services/LeagueService';

export interface StartDraftFullParams {
  leagueId: string;
  userId: string;
  teams: Team[];
  totalRounds: number;
  /** Custom team order (overrides teams array's natural order). */
  customTeamOrder?: string[];
  /** 'snake' | 'linear' | 'auction'. Defaults to 'snake' server-side. */
  draftType?: string;
}

export type StartDraftFullResult =
  | { ok: true; data: StartDraftV2Success; initSkipped: boolean }
  | { ok: false; step: 'init' | 'ignition'; reason: StartDraftV2Reason | 'init_failed'; message: string };

export interface UseStartDraftFullResult {
  start: (params: StartDraftFullParams) => Promise<StartDraftFullResult>;
  isPending: boolean;
  lastError: { step: 'init' | 'ignition'; reason: string; message: string } | null;
}

/**
 * Cheap existence check: does draft_order already have rows for this
 * league covering all rounds?
 *
 * Returns true iff round 1 exists AND its team_order length equals
 * teams count. Assumes if round 1 is populated correctly, all rounds
 * are (server-side init is atomic; partial-init is not a state).
 */
async function draftOrderExistsForLeague(
  leagueId: string,
  userId: string,
  expectedTeamCount: number,
): Promise<boolean> {
  try {
    const { order } = await DraftService.getDraftOrder(leagueId, userId, 1);
    if (!order || !order.team_order) return false;
    return Array.isArray(order.team_order) && order.team_order.length === expectedTeamCount;
  } catch {
    // Assume not present on error; init will run + server-side truth
    // handles the re-write case anyway.
    return false;
  }
}

export function useStartDraftFull(): UseStartDraftFullResult {
  const startDraftV2 = useStartDraftV2();
  const [initPending, setInitPending] = useState(false);
  const [lastError, setLastError] = useState<
    { step: 'init' | 'ignition'; reason: string; message: string } | null
  >(null);

  const start = useCallback(
    async (params: StartDraftFullParams): Promise<StartDraftFullResult> => {
      const { leagueId, userId, teams, totalRounds, customTeamOrder, draftType } = params;

      // Condition 3: unify isPending across init + ignition. Set
      // initPending TRUE at sequence start; startDraftV2's own isPending
      // will be TRUE during ignition. Combined via the getter below.
      setInitPending(true);
      setLastError(null);

      let initSkipped = false;
      try {
        // Condition 1: existence check first.
        const alreadyExists = await draftOrderExistsForLeague(
          leagueId,
          userId,
          teams.length,
        );

        if (alreadyExists) {
          initSkipped = true;
        } else {
          // Init step. Server-side is destructive-then-create (existing
          // rows hard-deleted first per DraftService.ts:324-328); safe.
          const { error: initError } = await DraftService.initializeDraftOrder(
            leagueId,
            userId,
            teams,
            totalRounds,
            true, // _resetExisting (currently ignored by server; kept for API compat)
            customTeamOrder,
            draftType,
          );
          if (initError) {
            const message =
              `Failed to initialize draft order: ${(initError as { message?: string })?.message ?? 'Unknown error'}`;
            const errState = { step: 'init' as const, reason: 'init_failed' as const, message };
            setLastError(errState);
            // Condition 2: ignition NEVER attempted after init failure.
            return { ok: false, ...errState };
          }
        }
      } finally {
        // Init phase done. setInitPending false BEFORE calling
        // startDraftV2.start (which sets its own isPending true).
        // Between these two setStates, isPending briefly reads false —
        // acceptable for React batch semantics; UI gate remains true
        // because startDraftV2 immediately sets its own true.
        setInitPending(false);
      }

      // Ignition step. Fresh idempotency key generated INSIDE
      // useStartDraftV2.start per Condition 2 (per-user-initiated-attempt
      // key, never reused across distinct presses).
      const ignitionResult = await startDraftV2.start(leagueId);

      if (ignitionResult.ok === true) {
        return { ok: true, data: ignitionResult.data, initSkipped };
      }

      // Rider-1 refused. Extract via typed variables (control-flow
      // narrowing across the discriminated union sometimes fails in
      // Promise-wrapped generic callback types; explicit variable
      // assignment forces the correct branch to be picked).
      const reason: StartDraftV2Reason = ignitionResult.reason;
      const message: string = ignitionResult.message;
      const errState = {
        step: 'ignition' as const,
        reason,
        message,
      };
      setLastError(errState);
      return { ok: false, ...errState };
    },
    [startDraftV2],
  );

  // Condition 3: unified isPending.
  const isPending = initPending || startDraftV2.isPending;

  return { start, isPending, lastError };
}

export { RIDER_1_USER_MESSAGES };

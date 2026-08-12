// Phase 4.5 chunk 11g.5b — optimistic action reconciliation.
//
// Pure functions for tracking and reconciling client-side
// optimistic pick submissions. The store consumes these to update
// its `pendingActions` map.
//
// Four-path reconciliation:
//   1. Broadcast match — server's `event` message arrives with the
//      same correlationId we submitted. Remove from pending; UI
//      transitions from optimistic-render to confirmed.
//   2. Resync match — after a reconnect, the server's resync events
//      include our pick (it was committed before the disconnect).
//      Remove from pending. Same UX path as broadcast.
//   3. Rejection — submit_pick RPC returned `{ ok: false, reason }`
//      synchronously. Transition entry to `rolled_back`; UI
//      flashes-out and surfaces a toast.
//   4. Network-failure-then-resync — submit_pick promise rejected
//      with a network error AND the subsequent resync's events do
//      NOT contain the correlationId. The server never received
//      the action; treat as a rejection (mark rolled_back).
//
// Paths (1) and (2) collapse to "remove correlationId from map";
// paths (3) and (4) collapse to "mark correlationId rolled_back".
// The store's reducers expose both shapes.

import type { BufferedDraftEvent } from '@citrus/shared';

/**
 * Optimistic state of a pick submission. `pending` is the initial
 * state when the user clicks "Submit"; `rolled_back` is set when
 * the action was rejected (server said no, or network failure
 * couldn't reach the server). `rolled_back` entries linger briefly
 * for the UI to render a flash-out animation, then get removed
 * from the map by `removeRolledBack`.
 */
export type OptimisticState = 'pending' | 'rolled_back';

export interface PendingAction {
  correlationId: string;
  teamId: string;
  playerId: number;
  submittedAt: number;
  optimisticState: OptimisticState;
  /** Set when `optimisticState === 'rolled_back'`. */
  rejectionReason?: string;
  /**
   * PICK-LATENCY (2026-08-12) — the pick slot this submission is for,
   * captured at CLICK time so `overlayPendingPicks` can place the
   * optimistic entry on the board at the right coordinates.
   *
   * Optional for backwards compatibility with existing callers and
   * tests; the overlay falls back to derived `currentPickNumber` /
   * `currentRoundNumber` when absent. Capturing at click time is
   * strictly better than reading the live value at render time: the
   * instant the server confirms, derived state advances, and a pending
   * entry that outlives that frame by one tick would otherwise render
   * at the NEXT pick's coordinates.
   */
  pickNumber?: number;
  roundNumber?: number;
}

export interface PendingActionInput {
  correlationId: string;
  teamId: string;
  playerId: number;
  submittedAt: number;
  /** See `PendingAction.pickNumber`. */
  pickNumber?: number;
  roundNumber?: number;
}

/**
 * Add a new pending action to the map. Returns a NEW map (immutable)
 * so Zustand state-equality checks notice the change.
 */
export function recordPendingAction(
  current: Map<string, PendingAction>,
  input: PendingActionInput,
): Map<string, PendingAction> {
  const next = new Map(current);
  next.set(input.correlationId, {
    correlationId: input.correlationId,
    teamId: input.teamId,
    playerId: input.playerId,
    submittedAt: input.submittedAt,
    optimisticState: 'pending',
    pickNumber: input.pickNumber,
    roundNumber: input.roundNumber,
  });
  return next;
}

/**
 * Path 1: server broadcast arrived with matching correlationId.
 * Remove from pending — pick is confirmed.
 *
 * If the correlationId isn't in the map, return the same map
 * (referential equality preserved so React doesn't re-render).
 */
export function reconcileOnBroadcast(
  current: Map<string, PendingAction>,
  correlationId: string,
): Map<string, PendingAction> {
  if (!current.has(correlationId)) {
    return current;
  }
  const next = new Map(current);
  next.delete(correlationId);
  return next;
}

/**
 * Path 2: resync events delivered after reconnect. Remove any pending
 * action whose correlationId appears in the events array. Pure pass
 * over the events; O(events × map) but both are small (~tens at
 * most), so plain iteration is cleaner than building a Set.
 */
export function reconcileOnResync(
  current: Map<string, PendingAction>,
  events: ReadonlyArray<BufferedDraftEvent>,
): Map<string, PendingAction> {
  if (current.size === 0 || events.length === 0) {
    return current;
  }
  let next: Map<string, PendingAction> | null = null;
  for (const event of events) {
    // Only `pick_submitted` and `commissioner_override` carry a
    // correlationId we'd have submitted. Other variants (auction,
    // pick_undone) never originated client-side as user picks for
    // this reconciliation purpose.
    if (
      event.kind === 'pick_submitted' ||
      event.kind === 'commissioner_override'
    ) {
      if (current.has(event.correlationId)) {
        if (next === null) next = new Map(current);
        next.delete(event.correlationId);
      }
    }
  }
  return next ?? current;
}

/**
 * Paths 3 & 4: rejection (RPC said no) or network failure where
 * the subsequent resync proves the action never landed. Mark the
 * entry `rolled_back`; the UI renders a flash-out animation and the
 * caller subsequently calls `removeRolledBack` after the animation
 * completes (typically ~500ms).
 *
 * If the correlationId isn't in the map, return the same map.
 */
export function reconcileOnRejection(
  current: Map<string, PendingAction>,
  correlationId: string,
  rejectionReason: string,
): Map<string, PendingAction> {
  const existing = current.get(correlationId);
  if (!existing || existing.optimisticState === 'rolled_back') {
    // Either not in map, or already rolled back — return unchanged.
    return current;
  }
  const next = new Map(current);
  next.set(correlationId, {
    ...existing,
    optimisticState: 'rolled_back',
    rejectionReason,
  });
  return next;
}

/**
 * After the rolled-back animation completes, remove the entry from
 * the map. Caller schedules this via `setTimeout` after the rejection
 * animation duration (default 500ms — matches Tailwind's longest
 * `transition-duration` in the shadcn theme).
 */
export function removeRolledBack(
  current: Map<string, PendingAction>,
  correlationId: string,
): Map<string, PendingAction> {
  if (!current.has(correlationId)) {
    return current;
  }
  const next = new Map(current);
  next.delete(correlationId);
  return next;
}

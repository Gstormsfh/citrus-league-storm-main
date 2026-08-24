// Phase 4.5 chunk 11g.5b — Zustand store for the chunk-11g.5a state
// machine + UX layer.
//
// Mirrors the runner's `DraftClientState` (so React subscribes to
// connection state via Zustand selectors) plus UX-layer state that
// the runner doesn't own:
//   - `snapshot`: latest server snapshot (or null pre-connect)
//   - `pendingActions`: optimistic-action map (chunk 11g.5b's
//     `optimistic.ts` reconciliation)
//   - `presentUserIds`: presence list from `presence` server messages
//   - `lastError`: last error payload from `error` server messages
//
// Convention follows `notificationStore.ts` (chunk 11g.5b recon
// confirmed this as the existing Zustand pattern).
//
// Hook selectors are exported so components can subscribe to a
// single slice without re-rendering on unrelated changes.

import { create } from 'zustand';
import type {
  BufferedDraftEvent,
  DraftSnapshot,
} from '@citrus/shared';
import type { DraftClientState } from '@/lib/draftClient/types';
import {
  recordPendingAction,
  reconcileOnBroadcast,
  reconcileOnRejection,
  reconcileOnResync,
  removeRolledBack,
  type PendingAction,
  type PendingActionInput,
} from '@/lib/draftClient/optimistic';
// DR-1b (2026-07-28): the store owns derivation orchestration —
// components read ONLY derived state; the snapshot's convenience
// fields become seed-only (F4 fix).
import {
  deriveFromSnapshot,
  foldEvents,
  type DerivedDraftState,
} from '@/lib/draftClient/deriveDraftState';
// Auction launch build (2026-08-24): parallel auction derivation —
// seeded from snapshot.auctionState, folded with live auction events.
import {
  seedAuctionState,
  foldAuctionEvents,
  type DerivedAuctionState,
} from '@/lib/draftClient/deriveAuctionState';
import type { DraftOrderSlot } from '@/lib/draftClient/fetchDraftOrderMatrix';

// ── Store state ────────────────────────────────────────────────────

interface PresencePayload {
  kind: 'joined' | 'left';
  userId: string;
  presentUserIds: ReadonlyArray<string>;
}

interface ErrorPayload {
  code: string;
  message: string;
}

interface DraftClientStoreState {
  // Mirror of `runner.getState()` — kept in sync via runner.subscribe.
  connectionState: DraftClientState;
  /**
   * DR-2 (2026-07-29) — the caller's teamId in this league. Fetched by
   * the page on room mount via `GET /api/leagues/:leagueId/my-team`.
   * Consumed by the submit-pick control's on-clock gating (control
   * renders iff `derived.onClockTeamId === myTeamId`).
   *
   * `null` before the fetch resolves and stays `null` if the caller
   * isn't a team owner in this league (spectator flow — control never
   * renders).
   */
  myTeamId: string | null;
  /**
   * Latest server snapshot, or null if none received yet.
   *
   * DR-1b (2026-07-28) note: `stateSnapshot.currentPickNumber`,
   * `currentRoundNumber`, `onClockTeamId`, `picksMade`, `draftStatus`
   * on this object are SEED-ONLY per the F4 fix. Components MUST NOT
   * read them for the running state — use `derivedState` instead.
   * `stateSnapshot.totalPicks` and `stateSnapshot.currentPickDeadline`
   * are still trustworthy and consumed by seed + DraftTimerV2
   * respectively. `recentEvents` is used by the Recent-events pane
   * unchanged.
   */
  snapshot: DraftSnapshot | null;
  /**
   * DR-1b (2026-07-28) — the derived state components render. Folded
   * from `snapshot.recentEvents` + subsequent `applyEvent`/
   * `applyEvents` calls onto the fetched `matrix`. Null before the
   * first snapshot lands.
   */
  derivedState: DerivedDraftState | null;
  /**
   * DR-1b (2026-07-28) — the fetched draft-order matrix. Null before
   * `fetchDraftOrderMatrix` completes (or if it failed — matrix
   * unavailable is non-fatal per F1 ratification; `derivedState`
   * still folds picks + rosters and leaves on-clock null).
   */
  matrix: ReadonlyArray<DraftOrderSlot> | null;
  /**
   * DR-1b (2026-07-28) F3 — most recent fold's gap list. Reset to
   * empty on any successful contiguous fold. Non-empty means the
   * caller should invoke `runner.requestResyncForGap(sinceSeq)` with
   * `sinceSeq = derivedState.foldedThroughSeq` — the store surfaces
   * the signal; the page dispatches. Empty after a snapshot receipt
   * (full replay reset).
   */
  lastFoldGaps: ReadonlyArray<number>;
  /** Optimistic pick submissions; keyed by correlationId. */
  pendingActions: Map<string, PendingAction>;
  /** Distinct userIds currently connected (server-deduped per ADR-005). */
  presentUserIds: Set<string>;
  /**
   * DR-4 (2026-07-30) — userIds observed leaving during THIS session
   * (a positive `presence.left` event received). Distinct from "never
   * joined": we only claim a user is AWAY when we witnessed their
   * departure. On a fresh page load, users not in `presentUserIds`
   * are neutral "not connected" — we do not infer AWAY from absence.
   * Architect ruling 2026-07-30: honesty over inference.
   */
  observedLeftUserIds: Set<string>;
  /** Last error from the server's `error` wire message. */
  lastError: ErrorPayload | null;
  /**
   * Entry 87 Fix C (CLOCK-DISPLAY-35) — the per-pick countdown window
   * in seconds, extracted from the `draft_started` event's
   * `pickTimeLimitSeconds` payload. Authoritative upper bound on the
   * timer render — clock skew, sniper drift, or a stale
   * `currentPickDeadline` cannot cause the UI to display a value
   * exceeding this cap. Null until a `draft_started` event has been
   * observed (either in the initial snapshot's recentEvents or via a
   * subsequent applyEvent call).
   */
  pickTimeLimitSec: number | null;

  /**
   * F14(b) (2026-08-03) — client-side identity-resolution failure state.
   * Set when the cross-check `myTeamId ∈ matrix.teamIds` fails during
   * an ACTIVE draft, AFTER a re-resolve attempt.
   *
   * When non-null, the draft room MUST fail loudly (visible banner +
   * refuse to render draft controls) rather than silently degrade to
   * a working-looking room with dead buttons. The F14 incident (dead
   * cache serving a stale teamId not in the draft) reached this exact
   * failure mode; the pre-fix UI had no indication the user could not
   * draft, they only discovered it by clicking Draft and seeing
   * "It's not your turn."
   *
   *   'my_team_not_in_matrix' — myTeamId resolved but does not appear
   *     in the draft-order matrix. Membership cache is likely stale
   *     (F14 mechanism) OR the user's team was removed from the draft.
   *
   * Set to null when the cross-check subsequently passes (e.g., a
   * fresh matrix arrives with the expected team, or myTeamId is
   * re-resolved to a team that IS in the matrix).
   */
  identityFailure:
    | { reason: 'my_team_not_in_matrix' }
    | { reason: 'my_team_unverifiable' }
    | null;

  /**
   * Auction launch build (2026-08-24) — derived auction view for
   * `format === 'auction'` lobbies. Null for snake/linear lobbies and
   * before the first snapshot. Seeded from `snapshot.auctionState`
   * (authoritative budgets survive ring-buffer eviction), folded
   * forward in applyEvent/applyEvents alongside the pick fold.
   */
  auctionDerived: DerivedAuctionState | null;

  // ── Setters / reducers ─────────────────────────────────────────
  setConnectionState: (state: DraftClientState) => void;
  /** DR-2 (2026-07-29) — set the caller's teamId in this league. */
  setMyTeamId: (teamId: string | null) => void;
  /**
   * F14(b) (2026-08-03) — set the client-side identity-resolution
   * failure state. Called by the cross-check effect in DraftRoomV2
   * when myTeamId does not appear in the draft-order matrix AND a
   * re-resolve attempt did not fix it. Pass null to clear.
   */
  // 2026-08-18 launch audit: this signature accepted only
  // 'my_team_not_in_matrix', while the `identityFailure` STATE above
  // declares both reasons — and useMyTeamIdCrossCheck.ts:147 has been
  // passing 'my_team_unverifiable' since F14(b). That call has never
  // typechecked; it only survives because Vite/esbuild strip types
  // without checking them. Widened to match the state it writes.
  setIdentityFailure: (
    failure:
      | { reason: 'my_team_not_in_matrix' }
      | { reason: 'my_team_unverifiable' }
      | null,
  ) => void;
  setSnapshot: (snapshot: DraftSnapshot) => void;
  applyEvent: (event: BufferedDraftEvent) => void;
  applyEvents: (events: ReadonlyArray<BufferedDraftEvent>) => void;
  applyPresence: (payload: PresencePayload) => void;
  setError: (error: ErrorPayload) => void;

  /**
   * DR-1b (2026-07-28) — install the fetched matrix and re-derive
   * from the current snapshot + all folded events. Called by the
   * page after `fetchDraftOrderMatrix` resolves (both on first
   * snapshot receipt and on any not_started → in_progress transition
   * per F1 ratification's refetch condition).
   *
   * Idempotent: calling with the same matrix is a no-op fold (the
   * derivation is deterministic in matrix + events). Calling with
   * null (fetch failed) leaves derivedState.onClockTeamId null.
   */
  setMatrix: (matrix: ReadonlyArray<DraftOrderSlot> | null) => void;

  // Optimistic-action reducers (chunk 11g.5b 4-path reconciliation).
  recordPending: (input: PendingActionInput) => void;
  rollBackPending: (correlationId: string, rejectionReason: string) => void;
  removeRolledBack: (correlationId: string) => void;

  /** Test/teardown helper — restore initial state. */
  reset: () => void;
}

const initialState: Omit<
  DraftClientStoreState,
  | 'setConnectionState'
  | 'setMyTeamId'
  | 'setIdentityFailure'
  | 'setSnapshot'
  | 'applyEvent'
  | 'applyEvents'
  | 'applyPresence'
  | 'setError'
  | 'setMatrix'
  | 'recordPending'
  | 'rollBackPending'
  | 'removeRolledBack'
  | 'reset'
> = {
  connectionState: { kind: 'idle' },
  myTeamId: null,
  snapshot: null,
  derivedState: null,
  matrix: null,
  lastFoldGaps: [],
  pendingActions: new Map(),
  presentUserIds: new Set(),
  observedLeftUserIds: new Set(),
  lastError: null,
  identityFailure: null,
  pickTimeLimitSec: null,
  auctionDerived: null,
};

// Entry 87 Fix C — pull pickTimeLimitSeconds out of a draft_started
// event if one exists in the given event buffer. Returns null when
// none present. The event is emitted exactly once per draft
// lifecycle; scanning the buffer is O(n) but n is bounded by the
// server-side ring buffer size.
function extractPickTimeLimitSec(
  events: ReadonlyArray<BufferedDraftEvent>,
): number | null {
  for (const evt of events) {
    if (evt.kind === 'draft_started') {
      return evt.pickTimeLimitSeconds;
    }
  }
  return null;
}

export const useDraftClientStore = create<DraftClientStoreState>((set) => ({
  ...initialState,

  setConnectionState: (state) => set({ connectionState: state }),

  setMyTeamId: (teamId) => set({ myTeamId: teamId }),

  setIdentityFailure: (failure) => set({ identityFailure: failure }),

  setSnapshot: (snapshot) =>
    set((prev) => {
      // DR-1b (2026-07-28): full-replay reset from the seed. A fresh
      // snapshot is always the authoritative starting point — we
      // re-fold from empty. `matrix` is preserved (the fetched
      // draft-order doesn't change between snapshots for the same
      // league / draft session); if it's null, on-clock stays null
      // until `setMatrix` lands.
      const foldResult = deriveFromSnapshot(snapshot, prev.matrix);
      // DR-4 (2026-07-30) — seed presentUserIds from the snapshot.
      // Pre-DR-4 servers omit the field; treat that as empty and
      // let subsequent presence events populate (legacy behavior).
      // Post-DR-4 servers guarantee the connecting user is included.
      const seededPresence =
        snapshot.presentUserIds !== undefined
          ? new Set<string>(snapshot.presentUserIds)
          : prev.presentUserIds;
      // Entry 87 Fix C — seed pickTimeLimitSec from the snapshot's
      // draft_started event if present. If the draft hasn't started
      // yet (not_started snapshot) there won't be one; the applyEvent
      // path picks it up when the event lands.
      const nextPickTimeLimitSec =
        extractPickTimeLimitSec(snapshot.recentEvents) ??
        prev.pickTimeLimitSec;
      return {
        snapshot,
        derivedState: foldResult.state,
        lastFoldGaps: foldResult.gaps,
        presentUserIds: seededPresence,
        pickTimeLimitSec: nextPickTimeLimitSec,
        // Auction launch build (2026-08-24): re-seed the auction view
        // from the fresh snapshot (null for snake/linear lobbies).
        auctionDerived: seedAuctionState(snapshot),
        // Reconcile any pending actions whose correlationIds appear
        // in the snapshot's recent events (path 2 / path 4 of the
        // reconciliation contract per `optimistic.ts`).
        pendingActions: reconcileOnResync(
          prev.pendingActions,
          snapshot.recentEvents,
        ),
      };
    }),

  applyEvent: (event) =>
    set((prev) => {
      const next: Partial<DraftClientStoreState> = {};
      // Entry 87 Fix C — capture pickTimeLimitSec from draft_started.
      // Only overwrites when the event actually carries it (draft_started).
      if (event.kind === 'draft_started') {
        next.pickTimeLimitSec = event.pickTimeLimitSeconds;
      }
      // Reconcile via broadcast match (path 1).
      if (
        event.kind === 'pick_submitted' ||
        event.kind === 'commissioner_override'
      ) {
        next.pendingActions = reconcileOnBroadcast(
          prev.pendingActions,
          event.correlationId,
        );
      }
      // DR-1b (2026-07-28): fold the event onto the derived state.
      // Bootstrap derivedState from the current snapshot if a snapshot
      // has arrived but derivedState is somehow null (shouldn't happen
      // in normal flow — setSnapshot always sets both — but stays
      // defensive against reset races).
      if (prev.derivedState !== null) {
        const foldResult = foldEvents(prev.derivedState, [event], prev.matrix);
        next.derivedState = foldResult.state;
        next.lastFoldGaps = foldResult.gaps;
      }
      // Auction launch build (2026-08-24): fold auction events too.
      if (prev.auctionDerived !== null) {
        next.auctionDerived = foldAuctionEvents(prev.auctionDerived, [event]);
      }
      // Append the event to the snapshot's recentEvents if a
      // snapshot is loaded — keeps the in-memory view fresh for the
      // Recent-events pane (unchanged from pre-DR-1b behavior).
      //
      // Chunk 10c-2 batch 3 C2 (2026-07-28): also re-arm the
      // countdown UI's authoritative deadline. `pick_submitted`
      // events post-batch-2 carry `pickDeadline` (the next pick's
      // deadline computed by the RPC); mirror that into
      // `stateSnapshot.currentPickDeadline` so consumers of the
      // snapshot see the fresh value without needing a resync.
      // Guard on presence for backwards compat with pre-batch-2 rows.
      if (prev.snapshot !== null) {
        const patchedSnapshot = {
          ...prev.snapshot,
          recentEvents: [...prev.snapshot.recentEvents, event],
        };
        if (
          event.kind === 'pick_submitted' &&
          typeof event.pickDeadline === 'string' &&
          event.pickDeadline.length > 0
        ) {
          patchedSnapshot.stateSnapshot = {
            ...prev.snapshot.stateSnapshot,
            currentPickDeadline: event.pickDeadline,
          };
        }
        next.snapshot = patchedSnapshot;
      }
      return next;
    }),

  applyEvents: (events) =>
    set((prev) => {
      const next: Partial<DraftClientStoreState> = {};
      // Entry 87 Fix C — capture pickTimeLimitSec if the resync batch
      // contains the draft_started event (e.g., first-connect batch).
      const timeLimitFromBatch = extractPickTimeLimitSec(events);
      if (timeLimitFromBatch !== null) {
        next.pickTimeLimitSec = timeLimitFromBatch;
      }
      // DR-1b (2026-07-28): fold the batch onto the derived state.
      if (prev.derivedState !== null && events.length > 0) {
        const foldResult = foldEvents(prev.derivedState, events, prev.matrix);
        next.derivedState = foldResult.state;
        next.lastFoldGaps = foldResult.gaps;
      }
      // Auction launch build (2026-08-24): fold auction events too.
      if (prev.auctionDerived !== null && events.length > 0) {
        next.auctionDerived = foldAuctionEvents(prev.auctionDerived, events);
      }
      next.pendingActions = reconcileOnResync(prev.pendingActions, events);
      next.snapshot =
        prev.snapshot === null
          ? null
          : {
              ...prev.snapshot,
              recentEvents: [...prev.snapshot.recentEvents, ...events],
            };
      return next;
    }),

  setMatrix: (matrix) =>
    set((prev) => {
      // 2026-08-18 launch audit: fetchDraftOrderMatrix returns null on
      // ANY failure, and both call sites piped that straight in here.
      // A failed refetch could therefore CLOBBER a perfectly good matrix
      // and leave the room with nobody on the clock mid-draft. A null
      // means "this fetch failed", never "the draft order is now empty",
      // so it must not destroy known-good state.
      if (matrix === null && prev.matrix !== null) {
        return prev;
      }
      // DR-1b (2026-07-28) — install the fetched matrix and re-derive
      // from the current snapshot + all previously-folded events.
      // Idempotent for a given (snapshot, matrix, events) triple.
      if (prev.snapshot === null) {
        // No snapshot yet — just stash the matrix; setSnapshot will
        // pick it up on the next call.
        return { matrix };
      }
      // Full re-fold from the snapshot's baseline. This works because
      // the snapshot's recentEvents represent the authoritative seed
      // event stream at connect time; the store also accumulates
      // subsequent events into snapshot.recentEvents (see applyEvent /
      // applyEvents above), so the snapshot's current recentEvents
      // array represents ALL events observed so far. Full replay
      // from empty is safe + deterministic.
      const foldResult = deriveFromSnapshot(prev.snapshot, matrix);
      return {
        matrix,
        derivedState: foldResult.state,
        lastFoldGaps: foldResult.gaps,
      };
    }),

  applyPresence: (payload) =>
    set((prev) => {
      // DR-4 (2026-07-30) — replace the Set from the server's payload.
      // The server sends the FULL current set on every presence event
      // (join or leave) so the client's local state is authoritative
      // from any single message. If the incoming set is identical to
      // ours (same members, same size), skip the presentUserIds
      // mutation so React doesn't rerender on a no-op.
      //
      // ALSO track observedLeftUserIds — a positive record of users
      // observed leaving this session. Feeds PresenceDot's three-
      // state rendering: connected (in presentUserIds), away (in
      // observedLeftUserIds AND NOT in presentUserIds), not-connected
      // (in neither — we never claim someone is AWAY based purely
      // on absence at load time).
      const incoming = new Set<string>(payload.presentUserIds);
      const prevSet = prev.presentUserIds;
      const setUnchanged =
        prevSet.size === incoming.size &&
        [...incoming].every((id) => prevSet.has(id));
      const changes: Partial<DraftClientStoreState> = {};
      if (!setUnchanged) changes.presentUserIds = incoming;
      if (payload.kind === 'left') {
        // Record the positive observation. If the same user later
        // rejoins, we leave them in observedLeftUserIds — the "away"
        // state only shows when they're currently absent, so a
        // rejoin flips them back to "connected" via presentUserIds.has().
        const nextObserved = new Set(prev.observedLeftUserIds);
        nextObserved.add(payload.userId);
        changes.observedLeftUserIds = nextObserved;
      }
      return changes;
    }),

  setError: (error) => set({ lastError: error }),

  recordPending: (input) =>
    set((prev) => ({
      pendingActions: recordPendingAction(prev.pendingActions, input),
    })),

  rollBackPending: (correlationId, rejectionReason) =>
    set((prev) => ({
      pendingActions: reconcileOnRejection(
        prev.pendingActions,
        correlationId,
        rejectionReason,
      ),
    })),

  removeRolledBack: (correlationId) =>
    set((prev) => ({
      pendingActions: removeRolledBack(prev.pendingActions, correlationId),
    })),

  reset: () =>
    set({
      connectionState: { kind: 'idle' },
      myTeamId: null,
      snapshot: null,
      derivedState: null,
      matrix: null,
      lastFoldGaps: [],
      pendingActions: new Map(),
      presentUserIds: new Set(),
      observedLeftUserIds: new Set(),
      lastError: null,
      identityFailure: null,
      pickTimeLimitSec: null,
    }),
}));

// ── Hook selectors ─────────────────────────────────────────────────
//
// Components subscribe via these to avoid re-rendering on unrelated
// state changes. Each selector reads exactly one slice.

export const useDraftConnectionState = () =>
  useDraftClientStore((s) => s.connectionState);

export const useDraftSnapshot = () => useDraftClientStore((s) => s.snapshot);

export const usePendingActions = () =>
  useDraftClientStore((s) => s.pendingActions);

export const usePresence = () =>
  useDraftClientStore((s) => s.presentUserIds);

/**
 * DR-4 (2026-07-30) — session-observed leaves. See store state
 * definition for the honesty contract.
 */
export const useObservedLeftUserIds = () =>
  useDraftClientStore((s) => s.observedLeftUserIds);

export const useDraftError = () => useDraftClientStore((s) => s.lastError);

// DR-1b (2026-07-28) — derived-state selectors. Components render
// FROM these, not from `snapshot.stateSnapshot`. `useDerivedDraftState`
// returns null until the first snapshot has landed; consumers guard
// on null the same way they guard on `useDraftSnapshot() === null`.

export const useDerivedDraftState = () =>
  useDraftClientStore((s) => s.derivedState);

export const useDraftMatrix = () => useDraftClientStore((s) => s.matrix);

/**
 * DR-1b (2026-07-28) F3 — most recent fold's gap list. Empty on a
 * successful contiguous fold. Non-empty means the caller should
 * invoke `runner.requestResyncForGap(derivedState.foldedThroughSeq)`
 * to fill the missing seqs. The page wires this up in a useEffect;
 * see DraftRoomV2.tsx.
 */
export const useDraftLastFoldGaps = () =>
  useDraftClientStore((s) => s.lastFoldGaps);

/**
 * DR-2 (2026-07-29) — the caller's teamId in this league (null before
 * fetch resolves or if the caller is a spectator).
 */
export const useMyTeamId = () => useDraftClientStore((s) => s.myTeamId);
/** F14(b) — expose identity-failure state to banner + control gates. */
export const useIdentityFailure = () =>
  useDraftClientStore((s) => s.identityFailure);

/**
 * Entry 87 Fix C (CLOCK-DISPLAY-35) — per-pick countdown window
 * (seconds) extracted from `draft_started`. Used by DraftTimerV2 and
 * OnClockActionBar to clamp the rendered countdown so a stale
 * deadline can never display a value exceeding the true window.
 */
export const usePickTimeLimitSec = () =>
  useDraftClientStore((s) => s.pickTimeLimitSec);


/**
 * Auction launch build (2026-08-24) — the derived auction view for
 * auction-format lobbies. Null for snake/linear lobbies and before the
 * first snapshot lands. Components render the auction room FROM this
 * (current nomination, budgets, rotation progress, history feed).
 */
export const useAuctionDerived = () =>
  useDraftClientStore((s) => s.auctionDerived);

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
  /** Latest server snapshot, or null if none received yet. */
  snapshot: DraftSnapshot | null;
  /** Optimistic pick submissions; keyed by correlationId. */
  pendingActions: Map<string, PendingAction>;
  /** Distinct userIds currently connected (server-deduped per ADR-005). */
  presentUserIds: Set<string>;
  /** Last error from the server's `error` wire message. */
  lastError: ErrorPayload | null;

  // ── Setters / reducers ─────────────────────────────────────────
  setConnectionState: (state: DraftClientState) => void;
  setSnapshot: (snapshot: DraftSnapshot) => void;
  applyEvent: (event: BufferedDraftEvent) => void;
  applyEvents: (events: ReadonlyArray<BufferedDraftEvent>) => void;
  applyPresence: (payload: PresencePayload) => void;
  setError: (error: ErrorPayload) => void;

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
  | 'setSnapshot'
  | 'applyEvent'
  | 'applyEvents'
  | 'applyPresence'
  | 'setError'
  | 'recordPending'
  | 'rollBackPending'
  | 'removeRolledBack'
  | 'reset'
> = {
  connectionState: { kind: 'idle' },
  snapshot: null,
  pendingActions: new Map(),
  presentUserIds: new Set(),
  lastError: null,
};

export const useDraftClientStore = create<DraftClientStoreState>((set) => ({
  ...initialState,

  setConnectionState: (state) => set({ connectionState: state }),

  setSnapshot: (snapshot) =>
    set((prev) => ({
      snapshot,
      // Reconcile any pending actions whose correlationIds appear in
      // the snapshot's recent events (path 2 / path 4 of the
      // reconciliation contract per `optimistic.ts`).
      pendingActions: reconcileOnResync(prev.pendingActions, snapshot.recentEvents),
    })),

  applyEvent: (event) =>
    set((prev) => {
      const next: Partial<DraftClientStoreState> = {};
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
      // Append the event to the snapshot's recentEvents if a
      // snapshot is loaded — keeps the in-memory view fresh.
      if (prev.snapshot !== null) {
        next.snapshot = {
          ...prev.snapshot,
          recentEvents: [...prev.snapshot.recentEvents, event],
        };
      }
      return next;
    }),

  applyEvents: (events) =>
    set((prev) => ({
      pendingActions: reconcileOnResync(prev.pendingActions, events),
      snapshot:
        prev.snapshot === null
          ? null
          : {
              ...prev.snapshot,
              recentEvents: [...prev.snapshot.recentEvents, ...events],
            },
    })),

  applyPresence: (payload) =>
    set(() => ({
      presentUserIds: new Set(payload.presentUserIds),
    })),

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
      snapshot: null,
      pendingActions: new Map(),
      presentUserIds: new Set(),
      lastError: null,
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

export const useDraftError = () => useDraftClientStore((s) => s.lastError);

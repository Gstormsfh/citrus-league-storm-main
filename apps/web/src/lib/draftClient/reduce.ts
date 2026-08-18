// Phase 4.5 chunk 11g.5a — pure state-machine transition function.
//
// `reduce(state, event): { state, sideEffects[] }` is the brain of
// the client. It is intentionally I/O-free: every effect is described
// as a typed `SideEffect` value and returned for the runner to
// execute. This makes the entire state machine trivially unit-
// testable — assert on the returned `state` and `sideEffects` array
// without spinning up a WebSocket or mocking timers.
//
// The top-level shape is `switch (event.type)` then per-event
// branching on `state.kind`. Most state transitions only fire from
// specific source states; everything else is a no-op (event ignored).
// The exhaustiveness pattern uses a `_exhaustive: never` assertion
// at the bottom of each branch so TypeScript catches a missing case
// at compile time.

import type {
  DraftClientEvent,
  DraftClientState,
  ReduceResult,
  SideEffect,
} from './types';
import { classifyCloseCode } from './closeCodes';
import {
  computeBackoffMs,
  JITTER_FACTOR,
  NOT_STARTED_POLL_MS,
} from './backoff';

/**
 * Random function used by `reduce` to compute backoff delays. Default
 * is `Math.random`; tests pass a seeded RNG to assert deterministic
 * delays without mocking modules.
 */
export type RandomFn = () => number;

/**
 * Pure state-machine transition. Given a current state and an
 * incoming event, return the next state plus a list of side effects
 * for the runner to execute. NO I/O — all asynchronous work is
 * described in the side-effect list.
 *
 * Unhandled (state, event) combinations return the state unchanged
 * with no side effects — the state machine is silent on irrelevant
 * events rather than throwing. This is by design: events like
 * `network_changed` arrive at any time and we shouldn't
 * over-constrain when they're acceptable.
 */
export function reduce(
  state: DraftClientState,
  event: DraftClientEvent,
  randomFn: RandomFn = Math.random,
): ReduceResult {
  switch (event.type) {
    case 'connect_requested':
      return handleConnectRequested(state);
    case 'disconnect_requested':
      return handleDisconnectRequested(state);
    case 'token_fetched':
      return handleTokenFetched(state, event);
    case 'token_fetch_failed':
      return handleTokenFetchFailed(state, event, randomFn);
    case 'discovery_refused_terminal':
      return handleDiscoveryRefusedTerminal(state, event);
    case 'ws_opened':
      return handleWsOpened(state, event);
    case 'ws_message':
      return handleWsMessage(state, event);
    case 'ws_closed':
      return handleWsClosed(state, event, randomFn);
    case 'ws_error':
      return handleWsError(state, event);
    case 'snapshot_fetched':
      return handleSnapshotFetched(state, event);
    case 'snapshot_fetch_failed':
      return handleSnapshotFetchFailed(state, event, randomFn);
    case 'backoff_timer_fired':
      return handleBackoffTimerFired(state);
    case 'visibility_changed':
      return handleVisibilityChanged(state, event);
    case 'network_changed':
      return handleNetworkChanged(state, event, randomFn);
  }
}

// ── Event handlers ─────────────────────────────────────────────────

/**
 * `connect_requested` is valid from `idle` (initial connect) or
 * `fatal` (caller is explicitly retrying after a fatal — e.g. user
 * re-logged-in and is reattempting). Other states ignore.
 *
 * Real reconnects (post-disconnect) flow through `backoff_timer_fired`
 * after the timer expires, NOT through caller-initiated
 * `connect_requested`.
 */
function handleConnectRequested(state: DraftClientState): ReduceResult {
  if (
    state.kind === 'idle' ||
    state.kind === 'fatal' ||
    state.kind === 'terminal_completed'
  ) {
    // Entry 87 Fix A truth-table item 3 — explicit `connect_requested`
    // from `terminal_completed` is permitted single re-discovery. The
    // discovery route will 409 again and dispatch
    // `discovery_refused_terminal` right back into this state (harmless
    // re-entry). Enables an explicit user "Try Again" affordance
    // without automated retries.
    return {
      state: { kind: 'fetching_token', attempt: 0 },
      sideEffects: [{ kind: 'fetch_token', draftId: '' }],
    };
  }
  return noTransition(state);
}

/**
 * `disconnect_requested` is valid from any active state. Cleanly
 * tears down: cancels timers, closes the WS if open, returns to
 * `idle`. Any future event is ignored until the next
 * `connect_requested`.
 */
function handleDisconnectRequested(state: DraftClientState): ReduceResult {
  const sideEffects: SideEffect[] = [];
  if (
    state.kind === 'connecting' ||
    state.kind === 'connected' ||
    state.kind === 'resyncing' ||
    state.kind === 'snapshot_required'
  ) {
    sideEffects.push({ kind: 'close_websocket', code: 1000, reason: 'disconnect_requested' });
  }
  if (state.kind === 'reconnecting') {
    sideEffects.push({ kind: 'cancel_backoff_timer' });
  }
  return {
    state: { kind: 'idle' },
    sideEffects,
  };
}

function handleTokenFetched(
  state: DraftClientState,
  event: Extract<DraftClientEvent, { type: 'token_fetched' }>,
): ReduceResult {
  if (state.kind !== 'fetching_token') {
    return noTransition(state);
  }
  return {
    state: { kind: 'connecting', wsUrl: event.wsUrl, attempt: state.attempt },
    sideEffects: [
      {
        kind: 'open_websocket',
        url: event.wsUrl,
        subprotocol: event.token,
      },
    ],
  };
}

function handleTokenFetchFailed(
  state: DraftClientState,
  event: Extract<DraftClientEvent, { type: 'token_fetch_failed' }>,
  randomFn: RandomFn,
): ReduceResult {
  if (state.kind !== 'fetching_token') {
    return noTransition(state);
  }
  // 401/403 from the discovery endpoint = user not authorized for
  // this league. Terminal — no retry.
  if (event.statusCode === 401 || event.statusCode === 403) {
    return {
      state: {
        kind: 'fatal',
        reason: 'auth_failure',
        errorMessage: event.error,
      },
      sideEffects: [],
    };
  }
  // ARCHITECT 2026-08-12 (LOBBY-WAIT / inbox E124) — branch A:
  // `not_started` is NOT an error. Discovery is correctly refusing
  // because the commissioner has not pressed START. Hold a flat,
  // jittered 3s poll and flag the state so the UI can say so in
  // words, instead of escalating a backoff curve against an event
  // that will arrive on a human's schedule. See NOT_STARTED_POLL_MS
  // for why this one case must not escalate.
  if (
    event.statusCode === 409 &&
    event.draftStatus === 'not_started'
  ) {
    const jitter = (randomFn() * 2 - 1) * JITTER_FACTOR;
    const delayMs = Math.max(
      500,
      Math.round(NOT_STARTED_POLL_MS * (1 + jitter)),
    );
    return {
      state: {
        kind: 'reconnecting',
        // Reset the error-escalation counter, don't carry it. Reaching
        // this branch required a COMPLETED round trip whose body we
        // parsed — 409 DRAFT_NOT_CONNECTABLE with status not_started.
        // That is positive proof the API is healthy and only the draft
        // hasn't begun, which is the same thing a successful connect
        // proves and which `currentAttempt` already resets on. Without
        // the reset, a client that had climbed to a 30s backoff during
        // an earlier outage would carry that penalty into its first
        // real error AFTER recovery, for no reason.
        attempt: 0,
        nextAttemptAt: Date.now() + delayMs,
        lastError: null,
        waitingForStart: true,
      },
      sideEffects: [{ kind: 'schedule_backoff_timer', delayMs }],
    };
  }
  // Branch B — a real transient failure (5xx, network, unclassified).
  // ARCHITECT 2026-08-12 (LOBBY-WAIT / inbox E124): this line used to
  // read `scheduleReconnect(state.attempt, ...)`. `attempt` is
  // PRESERVED (not incremented) by `handleBackoffTimerFired` on the
  // way back into `fetching_token`, so passing it through unchanged
  // here pinned the counter forever and the exponential curve in
  // `backoff.ts` never started: measured live on staging at a flat
  // ~1s (computeBackoffMs(0), jitter 832-1138ms observed) for as long
  // as the client was left open. Every discovery-path failure —
  // including a genuine API outage — therefore retried at ~1Hz per
  // client with no escalation, which is precisely the thundering herd
  // the module's own header says it exists to prevent. `ws_closed`
  // has always incremented correctly (`currentAttempt(state) + 1`);
  // only this path was missing it. The `Math.min(..., 10)` cap
  // mirrors the existing idiom at the network_changed site.
  //
  // A successful connect resets the counter for free: `currentAttempt`
  // returns 0 for any state outside fetching_token/connecting/
  // reconnecting, so one blip never leaves a client permanently slow.
  return scheduleReconnect(
    Math.min(state.attempt + 1, 10),
    event.error,
    randomFn,
  );
}

/**
 * Entry 87 Fix A (COMPLETED-ROOM-1) — truth-table items 1 + 4.
 * Discovery returned 409 DRAFT_NOT_CONNECTABLE with a terminal
 * (completed/cancelled) draft status. Transition to the dedicated
 * `terminal_completed` state and fetch the snapshot so the room
 * renders the frozen board rather than "Waiting for draft state…".
 * No backoff scheduled.
 *
 * Only valid from `fetching_token` — other discovery states
 * (idle/connecting/etc.) shouldn't receive this event, but the
 * defensive no-op keeps the state machine silent on unexpected
 * ordering.
 */
function handleDiscoveryRefusedTerminal(
  state: DraftClientState,
  event: Extract<DraftClientEvent, { type: 'discovery_refused_terminal' }>,
): ReduceResult {
  if (state.kind !== 'fetching_token') {
    return noTransition(state);
  }
  return {
    state: {
      kind: 'terminal_completed',
      draftStatus: event.draftStatus,
    },
    sideEffects: [{ kind: 'fetch_snapshot', leagueId: '' }],
  };
}

function handleWsOpened(
  state: DraftClientState,
  event: Extract<DraftClientEvent, { type: 'ws_opened' }>,
): ReduceResult {
  if (state.kind !== 'connecting') {
    return noTransition(state);
  }
  // Two paths from `connecting → ws_opened`:
  //   - First connection (attempt 0): no prior `lastSeenSeq`, so
  //     just transition to `connected`. The server's first
  //     `snapshot` message will populate state.
  //   - Reconnection (attempt > 0): we have a `lastSeenSeq` from
  //     before — but `connecting` doesn't carry it. The runner
  //     stores `lastSeenSeq` separately and includes it in the
  //     resync request via the `send_message` side effect that
  //     fires on `ws_opened`.
  //
  // For 5a's design, we transition straight to `connected` with
  // lastSeenSeq=0 and let the runner decide whether to issue a
  // resync (it tracks the prior `lastSeenSeq` across reconnects).
  // The resync flow is driven by an explicit caller decision in
  // the runner, not by the state machine — keeps `reduce` simple.
  return {
    state: {
      kind: 'connected',
      wsUrl: state.wsUrl,
      lastSeenSeq: 0,
      sessionId: event.sessionId,
    },
    sideEffects: [],
  };
}

function handleWsMessage(
  state: DraftClientState,
  event: Extract<DraftClientEvent, { type: 'ws_message' }>,
): ReduceResult {
  const message = event.message;

  // `event` server message: live broadcast of a draft action.
  // Update lastSeenSeq, deliver to caller. Valid from `connected`
  // and `resyncing` (live events can arrive concurrently with the
  // resync response).
  if (message.type === 'event') {
    if (state.kind === 'connected') {
      return {
        state: { ...state, lastSeenSeq: Math.max(state.lastSeenSeq, message.seq) },
        sideEffects: [{ kind: 'deliver_event', event: message.payload }],
      };
    }
    if (state.kind === 'resyncing') {
      return {
        state,
        sideEffects: [{ kind: 'deliver_event', event: message.payload }],
      };
    }
    return noTransition(state);
  }

  // `snapshot` server message: typically arrives on first connect.
  // Replace state with the snapshot's `lastSeenSeq` (= the highest
  // event seq in the snapshot). Valid from `connected` and from
  // first-connect (server may push a snapshot before any resync).
  if (message.type === 'snapshot') {
    const snapshotSeq = computeSnapshotSeq(message.payload);
    if (state.kind === 'connected') {
      return {
        state: { ...state, lastSeenSeq: Math.max(state.lastSeenSeq, snapshotSeq) },
        sideEffects: [{ kind: 'deliver_snapshot', snapshot: message.payload }],
      };
    }
    return {
      state,
      sideEffects: [{ kind: 'deliver_snapshot', snapshot: message.payload }],
    };
  }

  // `presence` server message: someone joined / left.
  if (message.type === 'presence') {
    return {
      state,
      sideEffects: [
        {
          kind: 'deliver_presence',
          payload: {
            kind: message.payload.kind,
            userId: message.payload.userId,
            presentUserIds: message.payload.presentUserIds,
          },
        },
      ],
    };
  }

  // `resync_response`: result of our resync request.
  if (message.type === 'resync_response') {
    if (state.kind !== 'resyncing') {
      return noTransition(state);
    }
    if (message.payload.ok) {
      // Server returned events strictly after our `sinceSeq`.
      // Deliver them, advance lastSeenSeq, transition to connected.
      const newLastSeq = message.payload.events.reduce(
        (max, ev) => Math.max(max, ev.seq),
        state.sinceSeq,
      );
      return {
        state: {
          kind: 'connected',
          wsUrl: state.wsUrl,
          lastSeenSeq: newLastSeq,
          sessionId: state.sessionId,
        },
        sideEffects: [{ kind: 'deliver_events', events: message.payload.events }],
      };
    }
    // Server's ring buffer evicted past our cursor — full snapshot needed.
    return {
      state: {
        kind: 'snapshot_required',
        wsUrl: state.wsUrl,
        sessionId: state.sessionId,
      },
      // The runner attaches the leagueId when it receives this
      // side effect; the state machine doesn't carry it here.
      sideEffects: [{ kind: 'fetch_snapshot', leagueId: '' }],
    };
  }

  // `error`: server-initiated error notification. Deliver to caller.
  if (message.type === 'error') {
    return {
      state,
      sideEffects: [{ kind: 'deliver_error', payload: message.payload }],
    };
  }

  return noTransition(state);
}

function handleWsClosed(
  state: DraftClientState,
  event: Extract<DraftClientEvent, { type: 'ws_closed' }>,
  randomFn: RandomFn,
): ReduceResult {
  // Caller-initiated close (idle state) — already torn down; no-op.
  if (state.kind === 'idle') {
    return noTransition(state);
  }
  // Terminal state — no more transitions from close events.
  if (state.kind === 'terminal_completed' || state.kind === 'fatal') {
    return noTransition(state);
  }
  // Entry 87 Fix A (COMPLETED-ROOM-1) — truth-table item 2. If the
  // runner observed completion during this connection's lifetime
  // (annotated on the close event), route directly to
  // `terminal_completed` instead of scheduling backoff. This is the
  // exact bug Garrett watched on Run 3: post-completion engine
  // eviction → ws_closed → backoff → discovery-409-loop. The
  // annotation makes the transition possible without additional
  // state carried in the reduce union.
  if (event.lastKnownTerminalStatus !== undefined) {
    return {
      state: {
        kind: 'terminal_completed',
        draftStatus: event.lastKnownTerminalStatus,
      },
      sideEffects: [{ kind: 'fetch_snapshot', leagueId: '' }],
    };
  }

  const disposition = classifyCloseCode(event.code, event.reason);

  if (disposition === 'normal') {
    return { state: { kind: 'idle' }, sideEffects: [] };
  }
  if (disposition === 'permanent_auth') {
    return {
      state: {
        kind: 'fatal',
        reason: 'auth_failure',
        errorMessage: `WebSocket closed with auth code ${event.code}: ${event.reason}`,
      },
      sideEffects: [],
    };
  }
  if (disposition === 'permanent_lobby') {
    return {
      state: {
        kind: 'fatal',
        reason: 'invalid_lobby',
        errorMessage: `WebSocket closed with lobby code ${event.code}: ${event.reason}`,
      },
      sideEffects: [],
    };
  }
  if (disposition === 'permanent_server') {
    return {
      state: {
        kind: 'fatal',
        reason: 'permanent_server_error',
        errorMessage: `WebSocket closed with server code ${event.code}: ${event.reason}`,
      },
      sideEffects: [],
    };
  }
  if (disposition === 'permanent_not_initialized') {
    // Chunk 11g.10 sub-step 10c-2 gate (b). No auto-reconnect; the
    // banner explains the state and the UX layer offers a manual
    // RETRY NOW affordance for the "commissioner just finished" case.
    return {
      state: {
        kind: 'fatal',
        reason: 'draft_not_initialized',
        errorMessage: `Draft not yet configured (code ${event.code}: ${event.reason})`,
      },
      sideEffects: [],
    };
  }

  // Transient — schedule backoff + retry.
  const attempt = currentAttempt(state) + 1;
  // Chunk 11g.10 client-liveness watchdog: close code 4010 signals the
  // watchdog self-closed after N missed application-level pongs. Flag
  // the resulting reconnecting state so the banner can render distinct
  // "Connection appears stale…" copy. classifyCloseCode already routed
  // 4010 to 'transient'; this branch only annotates.
  const staleTriggered = event.code === 4010;
  return scheduleReconnect(
    attempt,
    `WebSocket closed: code=${event.code} reason=${event.reason}`,
    randomFn,
    staleTriggered,
  );
}

function handleWsError(
  state: DraftClientState,
  event: Extract<DraftClientEvent, { type: 'ws_error' }>,
): ReduceResult {
  // WS errors typically precede a `ws_closed`. Don't transition on
  // the error alone — let the close handle the reconnect logic so
  // we don't double-schedule. Just record the last-error string for
  // diagnostic.
  if (state.kind === 'reconnecting') {
    return {
      state: { ...state, lastError: event.error },
      sideEffects: [],
    };
  }
  return noTransition(state);
}

function handleSnapshotFetched(
  state: DraftClientState,
  event: Extract<DraftClientEvent, { type: 'snapshot_fetched' }>,
): ReduceResult {
  // Entry 99 COMPLETED-ROOM-2 (2026-08-11) — client-side companion
  // to the server route decoration. The Fix A path (E87) fetches a
  // snapshot on entry to `terminal_completed`, but this handler
  // previously no-op'd from every state except `snapshot_required` —
  // so the delivered snapshot never reached the store and
  // DraftRoomV2 sat on "Loading final board…" indefinitely.
  //
  // Fix: `terminal_completed` also accepts the arrival. State stays
  // terminal (no transition to `connected` — there is no live socket
  // for a completed draft). Snapshot is delivered with
  // `stateSnapshot.draftStatus` overridden to the runner's known
  // terminal value, so DraftRoomV2's derived state trusts the
  // route-level terminality even if the payload's own status field
  // still lies (engine serializer fix (a) lands on ENGINE-EAR deploy;
  // this is the belt to that server-side fix's suspenders).
  if (state.kind === 'terminal_completed') {
    const patched: import('@citrus/shared').DraftSnapshot = {
      ...event.snapshot,
      stateSnapshot: {
        ...event.snapshot.stateSnapshot,
        draftStatus: state.draftStatus,
      },
    };
    return {
      state,
      sideEffects: [{ kind: 'deliver_snapshot', snapshot: patched }],
    };
  }
  if (state.kind !== 'snapshot_required') {
    return noTransition(state);
  }
  const newLastSeq = computeSnapshotSeq(event.snapshot);
  return {
    state: {
      kind: 'connected',
      wsUrl: state.wsUrl,
      lastSeenSeq: newLastSeq,
      sessionId: state.sessionId,
    },
    sideEffects: [{ kind: 'deliver_snapshot', snapshot: event.snapshot }],
  };
}

function handleSnapshotFetchFailed(
  state: DraftClientState,
  event: Extract<DraftClientEvent, { type: 'snapshot_fetch_failed' }>,
  randomFn: RandomFn,
): ReduceResult {
  if (state.kind !== 'snapshot_required') {
    return noTransition(state);
  }
  // Snapshot fetch failed. The endpoint exists (chunk 11g.7 sub-step
  // 7b — `GET /api/drafts/:draftId/snapshot` at server/src/routes/drafts.ts:192,
  // client wire in runner.ts `defaultFetchSnapshot`), so failure here
  // means a transient HTTP error, not a missing route. Treat as
  // transient and retry the whole reconnect cycle — a fresh WS open
  // will re-issue resync from lastSeenSeq; if still `too_old` the
  // fetch retries from a fresh HTTP request. Chunk 11g.10 verified
  // the too_old → snapshot fallback end-to-end in reduce.test.ts.
  return scheduleReconnect(1, event.error, randomFn);
}

function handleBackoffTimerFired(state: DraftClientState): ReduceResult {
  // Entry 87 Fix A truth-table item 3 — `backoff_timer_fired` is a
  // no-op in terminal_completed. Defensive: the state machine
  // cancels the backoff timer on entry to terminal_completed via the
  // absence of a `schedule_backoff_timer` side effect, but a stray
  // timer callback that already fired before cancellation could still
  // land here.
  if (state.kind !== 'reconnecting') {
    return noTransition(state);
  }
  return {
    state: { kind: 'fetching_token', attempt: state.attempt },
    sideEffects: [{ kind: 'fetch_token', draftId: '' }],
  };
}

function handleVisibilityChanged(
  state: DraftClientState,
  _event: Extract<DraftClientEvent, { type: 'visibility_changed' }>,
): ReduceResult {
  // Step-5a behavior: pure state-machine doesn't need to do
  // anything on visibility change. The runner's
  // visibilitychange listener may issue a manual resync (sent as
  // `send_message` with a resync action), but that's an
  // imperative call from the runner, not a state transition.
  // Forward-compat hook for chunk 11g.7's heartbeat / liveness
  // detection.
  //
  // Entry 87 Fix A truth-table item 3 confirms this: no-op in
  // terminal_completed too (falls through here — no transition).
  return noTransition(state);
}

function handleNetworkChanged(
  state: DraftClientState,
  event: Extract<DraftClientEvent, { type: 'network_changed' }>,
  randomFn: RandomFn,
): ReduceResult {
  // Entry 87 Fix A truth-table item 3 — no-op in terminal_completed
  // (network changes don't matter for a finished draft; no
  // reconnect to schedule or extend).
  if (state.kind === 'terminal_completed') {
    return noTransition(state);
  }
  if (event.isOnline) {
    // Network came back. If we're reconnecting, fire the timer
    // immediately to retry; if connected, no-op (the WS will
    // detect dead-connection on its own via close events).
    if (state.kind === 'reconnecting') {
      return {
        state: { kind: 'fetching_token', attempt: state.attempt },
        sideEffects: [
          { kind: 'cancel_backoff_timer' },
          { kind: 'fetch_token', draftId: '' },
        ],
      };
    }
    return noTransition(state);
  }
  // Network went offline. If we're connected, we'll eventually
  // see a `ws_closed`; for now just record the state and let the
  // close handler do its thing. If we're already reconnecting,
  // extend the backoff window — no point retrying on a known-dead
  // network.
  if (state.kind === 'reconnecting') {
    // Extended delay; will be replaced when network comes back.
    const attempt = state.attempt;
    const delayMs = computeBackoffMs(Math.min(attempt + 1, 10), randomFn);
    return {
      state: {
        ...state,
        nextAttemptAt: Date.now() + delayMs,
        lastError: 'network_offline',
      },
      sideEffects: [
        { kind: 'cancel_backoff_timer' },
        { kind: 'schedule_backoff_timer', delayMs },
      ],
    };
  }
  return noTransition(state);
}

// ── Helpers ────────────────────────────────────────────────────────

function noTransition(state: DraftClientState): ReduceResult {
  return { state, sideEffects: [] };
}

function currentAttempt(state: DraftClientState): number {
  if (state.kind === 'fetching_token' || state.kind === 'connecting') {
    return state.attempt;
  }
  if (state.kind === 'reconnecting') {
    return state.attempt;
  }
  return 0;
}

function scheduleReconnect(
  attempt: number,
  errorMessage: string,
  randomFn: RandomFn,
  staleTriggered?: boolean,
): ReduceResult {
  const delayMs = computeBackoffMs(attempt, randomFn);
  return {
    state: {
      kind: 'reconnecting',
      attempt,
      nextAttemptAt: Date.now() + delayMs,
      lastError: errorMessage,
      ...(staleTriggered ? { staleTriggered: true } : {}),
    },
    sideEffects: [{ kind: 'schedule_backoff_timer', delayMs }],
  };
}

/**
 * The lastSeenSeq derivable from a `DraftSnapshot`: the max `seq`
 * across all events in `recentEvents`. If the buffer is empty
 * (fresh draft, no picks yet), 0 is the sentinel cursor.
 */
function computeSnapshotSeq(snapshot: import('@citrus/shared').DraftSnapshot): number {
  if (snapshot.recentEvents.length === 0) {
    return 0;
  }
  return snapshot.recentEvents.reduce(
    (max, ev) => Math.max(max, ev.seq),
    0,
  );
}

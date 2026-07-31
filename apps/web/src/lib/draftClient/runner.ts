// Phase 4.5 chunk 11g.5a — DraftClientRunner: side-effect executor.
//
// The runner is the impure outer layer that consumes side effects
// from the pure `reduce` function. It owns:
//   - The active WebSocket instance + its event listeners
//   - The exponential-backoff timer handle
//   - In-flight fetch promises (token, snapshot)
//   - Browser environment listeners (visibilitychange, online/offline)
//
// Public surface:
//   - `connect(leagueId, draftId, callbacks?)` — start the
//     state machine; transitions through fetching_token →
//     connecting → connected.
//   - `disconnect()` — stop and clean up.
//   - `getState()` — current `DraftClientState` for read-only access.
//   - `subscribe(listener)` — observe state changes; chunk 11g.5b's
//     UX layer subscribes via this.
//
// The split between `reduce` and `Runner` is deliberate:
//   - `reduce` is the brain (pure, trivially testable, no I/O).
//   - `Runner` is the body (impure, owns I/O, swallows transient
//     errors that the brain doesn't need to know about).
//
// **Token refresh contract (industry-standard "reconnect doubles
// as re-authorization" pattern):** the 5-minute draft token TTL
// means the runner re-fetches on every reconnect rather than caching.
// Two reasons: (1) the previous token may have expired during the
// disconnect window, (2) re-fetching exercises the league-membership
// check at the discovery endpoint, naturally handling "user removed
// from league mid-draft" scenarios. A 401/403 from the discovery
// endpoint propagates to `fatal` state via the `token_fetch_failed`
// event with `statusCode`.

import type {
  DraftClientMessage,
  DraftServerMessage,
  DraftSnapshot,
} from '@citrus/shared';
import type {
  DraftClientCallbacks,
  DraftClientEvent,
  DraftClientState,
  SideEffect,
} from './types';
import { reduce, type RandomFn } from './reduce';

// `apiClient` is lazy-imported only when the default
// `fetchDiscovery` runs — keeps test paths from pulling in the
// Supabase client at module load time (which throws in test
// environments without the VITE_SUPABASE_* env vars set).

// ── Chunk 11g.10 client-liveness watchdog: exported constants ──────
//
// Named constants so tests + any future config layer reference one
// source (architect ratification, chunk 11g.10 checkpoint 2). No env
// plumbing today — the values are locked at build time. Numbers were
// chosen to sit comfortably inside the smallest legal pick clock (30s)
// with 2.5x headroom AND inside the largest (300s) with wide margin.
export const WATCHDOG_PING_INTERVAL_MS = 12_000;
export const WATCHDOG_MISS_THRESHOLD_MS = 36_000;

// ── Public API ─────────────────────────────────────────────────────

export interface ConnectParams {
  leagueId: string;
  draftId: string;
}

/**
 * Discovery endpoint response shape per
 * `server/src/routes/drafts.ts:121`.
 */
interface DraftServerDiscovery {
  host: string;
  port: number;
  token: string;
}

/**
 * Constructor option overrides — primarily for tests.
 */
export interface DraftClientRunnerOptions {
  /** Random function for backoff jitter. Tests pass a seeded RNG. */
  randomFn?: RandomFn;
  /**
   * Override the discovery-endpoint fetcher. Tests pass a stub;
   * production uses the default `apiClient` path.
   */
  fetchDiscovery?: (draftId: string) => Promise<DraftServerDiscovery>;
  /**
   * Override the snapshot-endpoint fetcher. Tests pass a stub.
   * Production fetches `GET /api/drafts/:draftId/snapshot` (chunk
   * 11g.7 sub-step 7b). The parameter is the draftId (= leagueId
   * per Citrus's data model).
   */
  fetchSnapshot?: (draftId: string) => Promise<DraftSnapshot>;
  /**
   * Override the WebSocket constructor. Tests substitute a
   * `MockWebSocket`; production uses `globalThis.WebSocket`.
   */
  webSocketCtor?: WebSocketLike;
  /**
   * Override the WS protocol scheme. Defaults to `'wss:'` if
   * `window.location.protocol === 'https:'`, else `'ws:'` for
   * dev (HTTP page on localhost).
   *
   * **Note for future readers:** the localhost branch is
   * dev-only — in production the page is always HTTPS, and
   * mixed-content security forces `wss:`. If you find yourself
   * tempted to use `ws:` in production "for performance" or
   * similar, don't — modern browsers will block it.
   */
  wsProtocolOverride?: 'ws:' | 'wss:';
}

interface WebSocketLike {
  new (url: string | URL, protocols?: string | string[]): WebSocket;
}

export class DraftClientRunner {
  private state: DraftClientState = { kind: 'idle' };
  private callbacks: DraftClientCallbacks = {};
  private params: ConnectParams | null = null;

  private ws: WebSocket | null = null;
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Chunk 11g.10 client-liveness watchdog ────────────────────────
  //
  // Mirrors the engine-side heartbeat scanner (server/src/draft/uws-
  // server.ts) but on the client. Motivation: browsers cannot observe
  // uWS's protocol-level ping/pong (RFC 6455 §5.5.2 — the JS layer
  // never sees them), so an idle-TCP-death that leaves both ends in
  // ESTABLISHED with no traffic looks identical to "quiet moment"
  // from the client's perspective. The engine's watchdog fires
  // server-side; the client watchdog fires client-side; together
  // they close the pincer.
  //
  // Design (architect ruling, checkpoint 1):
  //   - Application-level ping every WATCHDOG_PING_INTERVAL_MS (12s).
  //     The server (uws-helpers.handleClientMessage 'ping' branch)
  //     responds with a pong echoing the client's `t`.
  //   - `lastPongAt` refreshed on every pong received in onmessage.
  //   - Check timer runs on the same cadence; if
  //     `now - lastPongAt > WATCHDOG_MISS_THRESHOLD_MS` (36s ~= 3
  //     missed cycles), close the WS with custom code 4010 →
  //     reduce.handleWsClosed flags `staleTriggered` on the
  //     reconnecting state, existing backoff-reconnect path runs.
  //   - Only ACTIVE when `setDraftActive(true)` has been called.
  //     Draft-paused / pre-draft lobbies are legitimately silent;
  //     firing the watchdog then would false-positive. The caller
  //     (DraftRoomV2) observes derived draftStatus and toggles.
  //   - Timers cleared on WS open (fresh window), ws close, and
  //     disconnect().
  private watchdogActive = false;
  private watchdogPingTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogCheckTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogLastPongAt = 0;
  /**
   * Chunk 11g.10 checkpoint-2 amendment — background-tab suspension.
   *
   * Browsers throttle background-tab timers to roughly one per minute
   * (WHATWG HTML spec §Timers: "the setTimeout() / setInterval() timer
   * nesting level is greater than 5 and the associated document is
   * fully hidden"). A backgrounded room would (a) send pings late and
   * (b) fire the check timer late — the check reads `Date.now()`,
   * which is not throttled, so it sees a huge age and self-closes with
   * 4010 SPURIOUSLY on legitimate alt-tab users, defeating the whole
   * point of the alarm for exactly the audience we built it for.
   *
   * Fix: while `document.visibilityState === 'hidden'`, mark the
   * watchdog SUSPENDED. Timers keep running (cheaper than
   * cancel/recreate on every tab switch) but the check callback
   * short-circuits and the ping callback still sends (harmless — the
   * server just echoes). On visibility → visible, reset `lastPongAt`
   * to now (grace period so the first post-visible check doesn't fire
   * against a stale-clock delta) AND issue an immediate ping to
   * shorten the "am I still connected" round-trip below the check
   * cadence.
   */
  private watchdogSuspended = false;

  /**
   * Persists across reconnects so the runner can issue resync
   * requests on `ws_opened` when there's a prior cursor. Reset to
   * 0 on `disconnect_requested` / new `connect()`.
   */
  private lastSeenSeq = 0;

  /**
   * DR-1 chunk (2026-07-28) F3 — loop guard for gap-triggered resync
   * requests. Tracks the `sinceSeq` of the most recent
   * `requestResyncForGap` call. When a second call arrives for the
   * SAME `sinceSeq`, the previous resync failed to fill the gap;
   * runner escalates to a full close-and-reconnect. Cleared on any
   * successful contiguous fold (store re-invokes `requestResyncForGap`
   * with a different, newer `lastContiguousSeq` — the reset happens
   * implicitly via the equality check).
   *
   * Also cleared on `disconnect()` / new `connect()` so a stale value
   * from a prior session never survives.
   */
  private lastGapResyncSinceSeq: number | null = null;

  private readonly randomFn: RandomFn;
  private readonly fetchDiscovery: (draftId: string) => Promise<DraftServerDiscovery>;
  private readonly fetchSnapshot: (draftId: string) => Promise<DraftSnapshot>;
  private readonly webSocketCtor: WebSocketLike;
  private readonly wsProtocolOverride: 'ws:' | 'wss:' | undefined;

  private readonly stateListeners = new Set<(s: DraftClientState) => void>();

  private readonly visibilityListener = () => {
    const isVisible = document.visibilityState === 'visible';
    // Chunk 11g.10 checkpoint-2: background-tab throttling defense.
    // On hidden → suspend the watchdog's staleness check (timers keep
    // running; the check callback short-circuits). On visible → resume
    // via `resumeWatchdog`, which resets the pong clock + sends an
    // immediate ping. Prevents alt-tabbed users from getting kicked by
    // their own watchdog once the browser stops throttling and Date.now
    // deltas balloon.
    if (isVisible) {
      this.resumeWatchdog();
    } else {
      this.watchdogSuspended = true;
    }
    // Keep the reduce dispatch AFTER the watchdog control so the state
    // machine (which today no-ops on visibility) has the same event
    // ordering it did before this amendment.
    this.dispatch({
      type: 'visibility_changed',
      isVisible,
    });
  };
  private readonly onlineListener = () => {
    this.dispatch({ type: 'network_changed', isOnline: true });
  };
  private readonly offlineListener = () => {
    this.dispatch({ type: 'network_changed', isOnline: false });
  };

  constructor(opts: DraftClientRunnerOptions = {}) {
    this.randomFn = opts.randomFn ?? Math.random;
    this.fetchDiscovery = opts.fetchDiscovery ?? defaultFetchDiscovery;
    this.fetchSnapshot = opts.fetchSnapshot ?? defaultFetchSnapshot;
    this.webSocketCtor =
      opts.webSocketCtor ?? (globalThis.WebSocket as WebSocketLike);
    this.wsProtocolOverride = opts.wsProtocolOverride;
  }

  /**
   * Start the connection lifecycle. If the runner is already
   * connected, this is a no-op (the existing connection is reused).
   * If the runner is in `fatal` state, the caller is explicitly
   * retrying after a fatal — the state machine handles the
   * `connect_requested → fetching_token` transition.
   */
  connect(params: ConnectParams, callbacks: DraftClientCallbacks = {}): void {
    this.params = params;
    this.callbacks = callbacks;
    this.lastSeenSeq = 0;
    this.lastGapResyncSinceSeq = null;
    this.attachBrowserListeners();
    this.dispatch({ type: 'connect_requested' });
  }

  /**
   * Tear down: close the WS, cancel timers, detach listeners,
   * return to `idle`. Idempotent.
   */
  disconnect(): void {
    this.dispatch({ type: 'disconnect_requested' });
    this.detachBrowserListeners();
    this.stopWatchdog();
    this.watchdogActive = false;
    this.params = null;
    this.lastSeenSeq = 0;
    this.lastGapResyncSinceSeq = null;
  }

  /**
   * Chunk 11g.10 client-liveness watchdog — enable/disable the
   * application-level ping/pong probe. Called by the consuming
   * component (DraftRoomV2) as `draftStatus` transitions:
   *
   *   - `in_progress`  → `setDraftActive(true)` — start watching
   *   - anything else  → `setDraftActive(false)` — a paused / not-
   *     started / completed draft is legitimately silent for arbitrary
   *     durations; firing the watchdog would false-positive.
   *
   * Idempotent — same active-state call is a no-op. Safe to call
   * before or after `connect()` (the watchdog respects ws.readyState).
   */
  setDraftActive(active: boolean): void {
    if (this.watchdogActive === active) return;
    this.watchdogActive = active;
    if (active) {
      // Kick off the watchdog if a WS is already open; otherwise
      // it starts inside ws.onopen after the next connect completes.
      if (this.ws !== null && this.ws.readyState === this.ws.OPEN) {
        this.startWatchdog();
      }
    } else {
      this.stopWatchdog();
    }
  }

  /**
   * DR-1 chunk (2026-07-28) F3 — gap-triggered resync request. Called
   * by the store when `deriveDraftState.foldEvents` returns a
   * non-empty `foldResult.gaps` list. `lastContiguousSeq` is the seq
   * the derivation folded THROUGH cleanly — the resync's `sinceSeq`.
   *
   * Loop guard: if the SAME `sinceSeq` is requested twice in a row,
   * the resync didn't fill the gap (server side-effect lost, or the
   * gap represents a durable break in the stream). Escalate to a
   * full close-and-reconnect via the existing 1006 → backoff path
   * rather than dispatching resync-in-a-loop. Never emits > 1 resync
   * per unique `sinceSeq` value in a row.
   *
   * Silent no-op if the runner is not in a state that can send
   * messages (e.g. `idle`, `fetching_token`) — the dispatch itself
   * would be dropped by the reducer and the store's next event
   * arrival will re-trigger detection anyway.
   */
  requestResyncForGap(lastContiguousSeq: number): void {
    if (this.state.kind !== 'connected' && this.state.kind !== 'resyncing') {
      return;
    }
    if (this.lastGapResyncSinceSeq === lastContiguousSeq) {
      // Repeat request for the same gap → resync didn't help.
      // Escalate to reconnect. `close(1006)` mimics an abnormal
      // network drop; the existing `handleWsClose` path schedules
      // backoff + re-opens.
      this.lastGapResyncSinceSeq = null;
      this.runCloseWebSocket(1006, 'gap_resync_exhausted');
      return;
    }
    this.lastGapResyncSinceSeq = lastContiguousSeq;
    this.runSendMessage({
      type: 'resync',
      payload: { sinceSeq: lastContiguousSeq },
    });
  }

  /** Read-only view of the current state. */
  getState(): DraftClientState {
    return this.state;
  }

  /** Subscribe to state-change notifications. Returns an unsubscribe fn. */
  subscribe(listener: (state: DraftClientState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  // ── Internals ────────────────────────────────────────────────────

  /**
   * Feed an event to the pure `reduce` function, apply the new
   * state, and execute side effects. The single entry point for
   * every state mutation.
   */
  private dispatch(event: DraftClientEvent): void {
    const result = reduce(this.state, event, this.randomFn);
    this.state = result.state;
    this.notifyStateChange();
    for (const effect of result.sideEffects) {
      this.executeSideEffect(effect);
    }
  }

  private notifyStateChange(): void {
    if (this.callbacks.onStateChange) {
      this.callbacks.onStateChange(this.state);
    }
    for (const listener of this.stateListeners) {
      listener(this.state);
    }
  }

  private executeSideEffect(effect: SideEffect): void {
    switch (effect.kind) {
      case 'fetch_token':
        void this.runFetchToken();
        return;
      case 'open_websocket':
        this.runOpenWebSocket(effect.url, effect.subprotocol);
        return;
      case 'close_websocket':
        this.runCloseWebSocket(effect.code, effect.reason);
        return;
      case 'send_message':
        this.runSendMessage(effect.message);
        return;
      case 'schedule_backoff_timer':
        this.runScheduleBackoffTimer(effect.delayMs);
        return;
      case 'cancel_backoff_timer':
        this.runCancelBackoffTimer();
        return;
      case 'fetch_snapshot':
        void this.runFetchSnapshot();
        return;
      case 'deliver_event':
        this.callbacks.onEvent?.(effect.event);
        return;
      case 'deliver_events':
        this.callbacks.onEvents?.(effect.events);
        return;
      case 'deliver_snapshot':
        this.callbacks.onSnapshot?.(effect.snapshot);
        return;
      case 'deliver_presence':
        this.callbacks.onPresence?.(effect.payload);
        return;
      case 'deliver_error':
        this.callbacks.onError?.(effect.payload);
        return;
    }
  }

  // ── Side-effect runners ──────────────────────────────────────────

  /**
   * Fetch a draft token from the discovery endpoint. Re-fetches on
   * every reconnect (5-min TTL + re-validate league membership per
   * the trusted-executor + reconnect-doubles-as-reauth pattern
   * documented in this file's header).
   */
  private async runFetchToken(): Promise<void> {
    if (!this.params) {
      this.dispatch({
        type: 'token_fetch_failed',
        error: 'connect() not called',
      });
      return;
    }
    try {
      const discovery = await this.fetchDiscovery(this.params.draftId);
      const wsUrl = this.computeWsUrl(discovery, this.params.draftId);
      this.dispatch({ type: 'token_fetched', token: discovery.token, wsUrl });
    } catch (err) {
      const errorObj = err as { message?: string; statusCode?: number };
      this.dispatch({
        type: 'token_fetch_failed',
        error: errorObj.message ?? String(err),
        statusCode: errorObj.statusCode,
      });
    }
  }

  private runOpenWebSocket(url: string, subprotocol: string): void {
    if (this.ws !== null) {
      // Stale ws — clean up first.
      this.detachWsListeners();
      try {
        this.ws.close();
      } catch {
        /* swallow */
      }
      this.ws = null;
    }
    let ws: WebSocket;
    try {
      ws = new this.webSocketCtor(url, [subprotocol]);
    } catch (err) {
      this.dispatch({
        type: 'ws_error',
        error: err instanceof Error ? err.message : String(err),
      });
      this.dispatch({ type: 'ws_closed', code: 1006, reason: 'open_failed' });
      return;
    }
    this.ws = ws;

    const sessionId = generateSessionId();
    ws.onopen = () => {
      this.dispatch({ type: 'ws_opened', sessionId });
      // After the open, if we have a prior `lastSeenSeq`, issue a
      // resync request so the server delivers events that arrived
      // during the disconnect window. Reduces to a no-op if
      // lastSeenSeq=0 (initial connect — server pushes a snapshot).
      if (this.lastSeenSeq > 0) {
        this.runSendMessage({
          type: 'resync',
          payload: { sinceSeq: this.lastSeenSeq },
        });
      }
      // Chunk 11g.10: (re)start the watchdog if the draft is active.
      // Fresh-connection window: lastPongAt seeded to `now` so the
      // first check-tick doesn't false-positive before the first
      // pong can arrive.
      if (this.watchdogActive) {
        this.startWatchdog();
      }
    };
    ws.onmessage = (msgEvent) => {
      const raw = typeof msgEvent.data === 'string' ? msgEvent.data : '';
      let parsed: DraftServerMessage;
      try {
        parsed = JSON.parse(raw) as DraftServerMessage;
      } catch {
        // Malformed wire data — ignore. Real production telemetry
        // (chunk 11g.7) would log this at warn.
        return;
      }
      // Chunk 11g.10 client-watchdog: pong messages feed the liveness
      // check directly and are NOT routed through reduce. Purely
      // transport-layer signals; the state machine has nothing to
      // decide about them.
      if (parsed.type === 'pong') {
        this.watchdogLastPongAt = Date.now();
        return;
      }
      this.dispatch({ type: 'ws_message', message: parsed });
      // Track the highest seq we've seen across reconnects.
      if (parsed.type === 'event' && parsed.seq > this.lastSeenSeq) {
        this.lastSeenSeq = parsed.seq;
      }
    };
    ws.onerror = () => {
      this.dispatch({ type: 'ws_error', error: 'ws_error_event' });
    };
    ws.onclose = (closeEvent) => {
      this.detachWsListeners();
      this.ws = null;
      // Chunk 11g.10: kill the watchdog timers on WS close. They'll
      // be re-started inside the next ws.onopen if setDraftActive is
      // still true. Prevents timers targeting a stale WS reference.
      this.stopWatchdog();
      this.dispatch({
        type: 'ws_closed',
        code: closeEvent.code,
        reason: closeEvent.reason,
      });
    };
  }

  private runCloseWebSocket(code = 1000, reason = ''): void {
    if (this.ws === null) {
      return;
    }
    try {
      this.ws.close(code, reason);
    } catch {
      /* swallow */
    }
  }

  private runSendMessage(message: DraftClientMessage): void {
    if (this.ws === null || this.ws.readyState !== this.ws.OPEN) {
      return;
    }
    try {
      this.ws.send(JSON.stringify(message));
    } catch {
      /* swallow — the next ws_closed will trigger reconnect */
    }
  }

  private runScheduleBackoffTimer(delayMs: number): void {
    this.runCancelBackoffTimer();
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      this.dispatch({ type: 'backoff_timer_fired' });
    }, delayMs);
  }

  private runCancelBackoffTimer(): void {
    if (this.backoffTimer !== null) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
  }

  private async runFetchSnapshot(): Promise<void> {
    if (!this.params) {
      this.dispatch({
        type: 'snapshot_fetch_failed',
        error: 'connect() not called',
      });
      return;
    }
    try {
      // Pass draftId (= leagueId per Citrus's data model — see
      // server/src/routes/drafts.ts header comment). Chunk 11g.7
      // sub-step 7b renamed the parameter for naming hygiene.
      const snapshot = await this.fetchSnapshot(this.params.draftId);
      this.dispatch({ type: 'snapshot_fetched', snapshot });
    } catch (err) {
      this.dispatch({
        type: 'snapshot_fetch_failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Chunk 11g.10 client-liveness watchdog internals ─────────────

  /**
   * (Re)start the ping + check timers. Idempotent — restarting when
   * already running clears the prior timers first so we never end up
   * with two concurrent scanners. Called from ws.onopen when
   * `watchdogActive === true` and from `setDraftActive(true)` when a
   * WS is already open.
   */
  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdogLastPongAt = Date.now();
    // Reflect current visibility state so a tab that starts hidden
    // does not judge staleness on its first check tick. `document`
    // may be undefined in node/SSR test environments — treat missing
    // document as visible (tests bypass this path anyway).
    this.watchdogSuspended =
      typeof document !== 'undefined' && document.visibilityState === 'hidden';
    this.watchdogPingTimer = setInterval(() => {
      // Send a ping only if the WS is still OPEN. `runSendMessage`
      // already guards on readyState so a race with close is safe,
      // but the extra check here avoids the DEBUG-noise of the guard.
      // Suspended tabs still send pings (browsers deliver whatever
      // the throttled timer resolves to) — the server just echoes;
      // no harm done.
      if (this.ws !== null && this.ws.readyState === this.ws.OPEN) {
        this.runSendMessage({
          type: 'ping',
          payload: { t: Date.now() },
        });
      }
    }, WATCHDOG_PING_INTERVAL_MS);
    this.watchdogCheckTimer = setInterval(() => {
      // Background-tab short-circuit: while the tab is hidden the check
      // MUST NOT judge staleness. Date.now() is not throttled; if we
      // read it under a delayed-fire callback we'd see an artificially
      // large age and spuriously self-close 4010 on legitimate alt-tabs.
      if (this.watchdogSuspended) return;
      const age = Date.now() - this.watchdogLastPongAt;
      if (age <= WATCHDOG_MISS_THRESHOLD_MS) {
        return;
      }
      // Stale: N consecutive missed pongs. Self-close with code 4010
      // (transient per closeCodes.ts carve-out) so the standard
      // reduce.handleWsClosed → backoff → reconnect path runs. Stops
      // the timers as a side effect of the close handler firing.
      // No re-entry — stopWatchdog is called in ws.onclose.
      this.runCloseWebSocket(4010, 'client_watchdog_stale');
    }, WATCHDOG_PING_INTERVAL_MS);
  }

  /**
   * Chunk 11g.10 checkpoint-2: called from the visibilitychange handler
   * when the tab becomes visible again. Restores watchdog observation
   * from a clean baseline:
   *   1. Clears the suspended flag.
   *   2. Resets `lastPongAt = now` — grace window so the first
   *      post-visible check doesn't compare against a Date.now() that
   *      moved during hidden throttle.
   *   3. Sends an immediate ping so the round-trip resolves BEFORE the
   *      next check-timer tick, further reducing the chance of a
   *      spurious self-close.
   *
   * No-op if the watchdog is not running (draft inactive, WS not open,
   * or setDraftActive(false)).
   */
  private resumeWatchdog(): void {
    this.watchdogSuspended = false;
    if (this.watchdogPingTimer === null && this.watchdogCheckTimer === null) {
      return;
    }
    this.watchdogLastPongAt = Date.now();
    if (this.ws !== null && this.ws.readyState === this.ws.OPEN) {
      this.runSendMessage({
        type: 'ping',
        payload: { t: Date.now() },
      });
    }
  }

  /**
   * Cancel any active watchdog timers. Idempotent — safe to call
   * multiple times, safe to call when timers are already null. Does
   * NOT touch `watchdogActive` (that flag reflects caller intent;
   * timers reflect runtime state).
   */
  private stopWatchdog(): void {
    if (this.watchdogPingTimer !== null) {
      clearInterval(this.watchdogPingTimer);
      this.watchdogPingTimer = null;
    }
    if (this.watchdogCheckTimer !== null) {
      clearInterval(this.watchdogCheckTimer);
      this.watchdogCheckTimer = null;
    }
  }

  // ── Browser event listeners ──────────────────────────────────────

  private attachBrowserListeners(): void {
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.visibilityListener);
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', this.onlineListener);
      window.addEventListener('offline', this.offlineListener);
    }
  }

  private detachBrowserListeners(): void {
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.visibilityListener);
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('online', this.onlineListener);
      window.removeEventListener('offline', this.offlineListener);
    }
  }

  private detachWsListeners(): void {
    if (this.ws === null) {
      return;
    }
    this.ws.onopen = null;
    this.ws.onmessage = null;
    this.ws.onerror = null;
    this.ws.onclose = null;
  }

  private computeWsUrl(discovery: DraftServerDiscovery, draftId: string): string {
    let proto: 'ws:' | 'wss:';
    if (this.wsProtocolOverride) {
      proto = this.wsProtocolOverride;
    } else if (typeof window !== 'undefined' && window.location?.protocol === 'https:') {
      // Production / staging: always wss: when the page is HTTPS
      // (mixed-content security forces this).
      proto = 'wss:';
    } else if (
      discovery.host === 'localhost' ||
      discovery.host === '127.0.0.1'
    ) {
      // Dev only: HTTP page on localhost — ws: is acceptable.
      proto = 'ws:';
    } else {
      // Default to wss: for any non-localhost host.
      proto = 'wss:';
    }
    return `${proto}//${discovery.host}:${discovery.port}/ws/draft/${draftId}`;
  }
}

// ── Default fetchers ─────────────────────────────────────────────────

export async function defaultFetchDiscovery(draftId: string): Promise<DraftServerDiscovery> {
  // Dynamic import — keeps test paths that pass their own
  // `fetchDiscovery` override from triggering the apiClient module
  // load (and its top-level Supabase env-var check).
  const { apiClient } = await import('@/api/client');
  const response = await apiClient.get<DraftServerDiscovery>(
    `/api/drafts/${encodeURIComponent(draftId)}/server`,
  );
  // 2026-07-28 (first live-browser walk of the join path): the chunk-11g.1
  // discovery endpoint returns `{ host, port, token }` at the TOP LEVEL of
  // the response body — NOT wrapped in apiClient's `{ data }` envelope.
  // The old `!response.data` check therefore threw 'Discovery fetch failed'
  // on every successful 200, meaning the real browser join path had never
  // once worked (harness bypasses discovery; unit tests stub this fetcher).
  // Accept both shapes so a future server-side envelope migration is safe.
  const payload =
    response.data ?? (response as unknown as DraftServerDiscovery);
  if (
    response.error ||
    typeof payload?.host !== 'string' ||
    typeof payload?.token !== 'string'
  ) {
    const err = new Error(
      typeof response.error === 'string' ? response.error : 'Discovery fetch failed',
    ) as Error & {
      statusCode?: number;
    };
    // apiClient doesn't surface status codes today; if it did,
    // we'd attach here for the 401/403 → fatal routing in `reduce`.
    // For now any error is treated as transient.
    throw err;
  }
  return payload;
}

/**
 * Default snapshot fetcher (chunk 11g.7 sub-step 7b). Calls
 * `GET /api/drafts/:draftId/snapshot` via the apiClient pattern.
 * On success, returns the parsed `DraftSnapshot`. On failure,
 * throws an Error whose `message` is propagated to
 * `snapshot_fetch_failed` event for the reduce function to
 * classify. The current `apiClient` doesn't surface `statusCode`
 * — 4xx vs 5xx classification falls through to the reduce
 * function's existing error-message-pattern handling. If real
 * production data shows 4xx/5xx mis-routing, enhance apiClient
 * at that point (Decision Log 2026-05-07).
 */
export async function defaultFetchSnapshot(draftId: string): Promise<DraftSnapshot> {
  const { apiClient } = await import('@/api/client');
  const response = await apiClient.get<DraftSnapshot>(
    `/api/drafts/${encodeURIComponent(draftId)}/snapshot`,
  );
  // Same top-level-vs-envelope mismatch as defaultFetchDiscovery above:
  // the chunk-11g.7-7b snapshot endpoint returns the DraftSnapshot at the
  // top level (`c.json(snapshot)`), not wrapped in `{ data }`. Accept both.
  const payload = response.data ?? (response as unknown as DraftSnapshot);
  if (
    response.error ||
    typeof (payload as { format?: unknown })?.format !== 'string'
  ) {
    const err = new Error(
      typeof response.error === 'string' ? response.error : 'Snapshot fetch failed',
    ) as Error & {
      statusCode?: number;
    };
    throw err;
  }
  return payload;
}

function generateSessionId(): string {
  // Browser-native `crypto.randomUUID()` is widely supported (all
  // modern browsers + Node 19+). The runner targets browsers only,
  // so this is safe.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older test environments.
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

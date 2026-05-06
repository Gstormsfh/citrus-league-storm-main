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
   * Production: the endpoint doesn't exist yet (Decision Log
   * followup); the default throws so the state machine routes
   * through `reconnecting`.
   */
  fetchSnapshot?: (leagueId: string) => Promise<DraftSnapshot>;
  /**
   * Override the WebSocket constructor. Tests substitute a
   * `MockWebSocket`; production uses `globalThis.WebSocket`.
   */
  webSocketCtor?: WebSocketLike;
  /**
   * Override the WS protocol scheme. Defaults to `'wss:'` if
   * `window.location.protocol === 'https:'`, else `'ws:'` for
   * dev (HTTP page on localhost). The `VITE_DRAFT_WS_PROTOCOL`
   * env var is the explicit production override path.
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
  /**
   * Persists across reconnects so the runner can issue resync
   * requests on `ws_opened` when there's a prior cursor. Reset to
   * 0 on `disconnect_requested` / new `connect()`.
   */
  private lastSeenSeq = 0;

  private readonly randomFn: RandomFn;
  private readonly fetchDiscovery: (draftId: string) => Promise<DraftServerDiscovery>;
  private readonly fetchSnapshot: (leagueId: string) => Promise<DraftSnapshot>;
  private readonly webSocketCtor: WebSocketLike;
  private readonly wsProtocolOverride: 'ws:' | 'wss:' | undefined;

  private readonly stateListeners = new Set<(s: DraftClientState) => void>();

  private readonly visibilityListener = () => {
    this.dispatch({
      type: 'visibility_changed',
      isVisible: document.visibilityState === 'visible',
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
    this.params = null;
    this.lastSeenSeq = 0;
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
      const snapshot = await this.fetchSnapshot(this.params.leagueId);
      this.dispatch({ type: 'snapshot_fetched', snapshot });
    } catch (err) {
      this.dispatch({
        type: 'snapshot_fetch_failed',
        error: err instanceof Error ? err.message : String(err),
      });
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

async function defaultFetchDiscovery(draftId: string): Promise<DraftServerDiscovery> {
  // Dynamic import — keeps test paths that pass their own
  // `fetchDiscovery` override from triggering the apiClient module
  // load (and its top-level Supabase env-var check).
  const { apiClient } = await import('@/api/client');
  const response = await apiClient.get<DraftServerDiscovery>(
    `/api/drafts/${encodeURIComponent(draftId)}/server`,
  );
  if (response.error || !response.data) {
    const err = new Error(response.error ?? 'Discovery fetch failed') as Error & {
      statusCode?: number;
    };
    // apiClient doesn't surface status codes today; if it did,
    // we'd attach here for the 401/403 → fatal routing in `reduce`.
    // For now any error is treated as transient.
    throw err;
  }
  return response.data;
}

/**
 * Default snapshot fetcher. **Endpoint not implemented yet**
 * (Decision Log followup 2026-05-05). Throws `not_implemented`;
 * the state machine handles `snapshot_fetch_failed` by routing
 * through `reconnecting`. Once the endpoint exists, replace this
 * body with the real fetch — no state-machine change needed.
 */
async function defaultFetchSnapshot(_leagueId: string): Promise<DraftSnapshot> {
  throw new Error(
    'snapshot_fetch_not_implemented: HTTP snapshot endpoint for the chunk-11g.4 ' +
      'in-memory DraftSnapshot shape is deferred (Decision Log followup ' +
      '2026-05-05)',
  );
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

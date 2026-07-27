// Phase 4.5 chunk 11g.7 sub-step 7e — live event subscription via LISTEN/NOTIFY.
// Phase 4.5 chunk 11g.10 sub-step 10c-1d — listener hardening:
//   - TCP keepalive on the pg.Client (short initial delay) so a silently
//     half-dead connection surfaces as a proper `error` / `end` event
//     rather than sitting forever in "connected but deaf" state.
//   - Periodic watchdog probe (self-NOTIFY with a per-probe id + timeout);
//     failure logs AND destroys the client + reconnects with backoff.
//   - `client.on('end', ...)` handler so clean FIN closes also trigger
//     reconnect (prior code only wired `client.on('error', ...)`).
//   - Health surface (`getHealth()`) exposing `startedAt`,
//     `lastSelfTestOkAt`, `lastNotifyReceivedAt`, `reconnectAttempt`,
//     and `connectionLostAt` for external monitoring via the engine's
//     Hono `/health/subscription` endpoint.
// Motivation: post-mortem of the 2026-07-22 → 2026-07-27 window showed
// the LISTEN backend dying silently after minutes-scale idle with zero
// reconnect activity and only one uncorrelated `self_test_succeeded`
// at +500s. Both endpoints of the TCP looked healthy while the channel
// was deaf. See PROJECT_PLAN.md Decision Log for full forensics.
//
// Dedicated `pg.Client` connection that runs `LISTEN draft_events`
// permanently. When Postgres delivers a notification, the parsed
// payload `{leagueId, seq}` is dispatched to a callback supplied by
// the engine startup wiring. The callback looks up the LobbyManager
// via `LobbyRegistry.get(leagueId)` and enqueues a queue-routed
// `processExternalEvent(seq)` call — the canonical-replay handlers
// from chunk 11g.6 sub-step 6b apply the event.
//
// **Why a separate `pg.Client` rather than the Supabase admin client.**
// `@supabase/supabase-js` exposes PostgREST + Realtime, not raw
// LISTEN/NOTIFY. The Realtime websocket-based pub/sub is a viable
// alternative but is semantically a client-facing wire primitive;
// using it for engine-to-engine state sync overloads its purpose. Raw
// `pg` is the more architecturally honest choice for cross-process
// engine coordination. `pg` v8.19.0 is already a transitive dependency,
// so no package additions are required.
//
// **Connection string source.** `SUPABASE_DB_URL` env var (matches the
// convention established in `scripts/maintenance/archive_to_csv.py`).
// MUST be a DIRECT connection, not pooled — PgBouncer / Supabase
// pooled connections do not support LISTEN. The startup self-test
// (see `startEventSubscription`) is a deliberate operational diagnostic
// that fires a synthetic notification within 5 seconds of LISTEN; if
// it doesn't arrive, the engine logs ERROR with the misconfiguration
// hint. Catches "pooled URL ships to production" before the engine
// silently runs with a broken cross-process notification path.
//
// **Belt-and-suspenders correctness.** LISTEN/NOTIFY is a runtime
// optimization, not the correctness foundation. Events missed during
// engine downtime or reconnect windows are caught at the next WS
// reconnect when bootstrap reads snapshot + delta events (chunk
// 11g.7 sub-step 7c). Reconnect logic uses exponential backoff
// (3/6/12/24/48/60s cap); during the backoff window, runtime
// notifications are missed but bootstrap restores correctness on the
// next client connect.
//
// See PHASE_4_5_PROJECT_PLAN.md Decision Log entries 2026-05-07 for
// the architecture rationale: trigger-vs-per-RPC, single-channel-with-
// JS-filter, minimal payload, dedup via `lastAppliedSeq`, lobby-load-
// forbidden, reconnect boundary.

import { Client as PgClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { structuredLogger } from '@citrus/shared';

/**
 * Wire shape of NOTIFY payloads emitted by `draft_events_notify_trigger`
 * (chunk 11g.7 sub-step 7e migration). Migration source:
 * `supabase/migrations/20260511000000_draft_events_notify.sql`.
 */
export interface DraftEventNotification {
  leagueId: string;
  seq: number;
}

/**
 * Parse a raw NOTIFY payload string (Postgres-delivered text) into a
 * typed notification object. Returns `null` on any parse failure or
 * shape mismatch — pure function, no side effects.
 *
 * Filters out the startup self-test payload (`{"_test": true}`) by
 * returning `null`; the self-test mechanism uses a separate sentinel
 * map keyed off the raw text to verify receipt.
 */
export function parseNotificationPayload(raw: string): DraftEventNotification | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  // Self-test payload — silently filter out; receipt is tracked by
  // the startup self-test via a separate raw-text match.
  if (obj._test === true) {
    return null;
  }
  if (typeof obj.league_id !== 'string') {
    return null;
  }
  if (typeof obj.seq !== 'number' || !Number.isFinite(obj.seq)) {
    return null;
  }
  return {
    leagueId: obj.league_id,
    seq: obj.seq,
  };
}

/**
 * Dedup decision: should the engine apply this event, given its
 * current `lastAppliedSeq` cursor?
 *
 * Strict inequality: `seq > lastAppliedSeq` means "engine has not yet
 * applied this event." Equal seq means "already applied" (the engine
 * itself emitted it just now and the NOTIFY is bouncing back); engine
 * short-circuits the apply.
 *
 * Pure function. The engine's runtime emission paths
 * (`processSubmitPick`, `processNominate`, etc.) update
 * `lastAppliedSeq` to the seq returned by the RPC, so own-engine
 * notification bounces deterministically dedup.
 */
export function shouldApplyEvent(seq: number, lastAppliedSeq: number): boolean {
  return seq > lastAppliedSeq;
}

/**
 * Exponential backoff schedule for LISTEN reconnect attempts. Returns
 * the delay (in milliseconds) before the next reconnect attempt.
 *
 * Schedule: 3s, 6s, 12s, 24s, 48s, 60s (cap). After the 6th attempt,
 * stays at the 60s cap indefinitely. Caller drives the schedule by
 * incrementing the attempt counter.
 *
 * Pure function — no side effects, no random jitter. Jitter is not
 * applied because the typical deployment has only one engine process
 * connecting to Postgres; the "thundering herd" concern that motivates
 * jitter (many clients all retrying at once) does not apply.
 */
export function computeReconnectDelayMs(attemptNumber: number): number {
  // attemptNumber: 1 → 3s, 2 → 6s, 3 → 12s, 4 → 24s, 5 → 48s, 6+ → 60s.
  if (attemptNumber <= 0) return 3_000;
  const delay = 3_000 * Math.pow(2, attemptNumber - 1);
  return Math.min(delay, 60_000);
}

/**
 * Callback signature for the dispatcher passed into
 * `startEventSubscription`. Engine startup supplies an implementation
 * that looks up the LobbyManager via `LobbyRegistry.get(leagueId)`
 * and enqueues the external event through the lobby's single-writer
 * queue. Returns a Promise so the dispatcher can wait for the queue
 * to acknowledge the enqueue (not the apply — that runs async).
 *
 * **Unknown leagueId is silently ignored** to prevent the resource-
 * exhaustion attack vector (every external event firing a lobby load).
 * Lobbies load lazily on WS connect; bootstrap catches up via
 * snapshot+delta from chunk 11g.7 sub-step 7c.
 */
export type DispatchExternalEvent = (
  notification: DraftEventNotification,
  notificationReceivedAtMs?: number,
) => Promise<void>;

export interface StartEventSubscriptionOptions {
  /**
   * Postgres connection string. MUST be a direct connection (not
   * pooled — pgbouncer drops LISTEN frames). Source: `SUPABASE_DB_URL`
   * env var in production; supplied directly by tests for mock pg
   * clients.
   */
  connectionString: string;
  /**
   * Dispatcher invoked for each parsed notification. Engine wires
   * this to a function that resolves the leagueId to a LobbyManager
   * via LobbyRegistry and enqueues `processExternalEvent(seq)`.
   */
  dispatch: DispatchExternalEvent;
  /**
   * Optional client factory — defaults to `new PgClient`. Tests
   * override this to inject a mock with controllable behaviour
   * (notifications, errors, end events).
   */
  clientFactory?: (connectionString: string) => PgClient;
  /**
   * Self-test timeout in milliseconds. Default 5000ms (5 seconds).
   * After LISTEN registers, the subscription emits a synthetic
   * notification with `{"_test": true}` and waits for receipt. If
   * the notification doesn't arrive within `selfTestTimeoutMs`, the
   * subscription logs an ERROR (`event_subscription.self_test_failed`)
   * with operator-facing remediation text — typically "verify
   * SUPABASE_DB_URL is a direct connection (not pooled)."
   *
   * `0` disables the self-test (used in tests).
   */
  selfTestTimeoutMs?: number;
  /**
   * Watchdog probe interval in milliseconds. Chunk 11g.10 sub-step
   * 10c-1d hardening: periodically issues a self-NOTIFY with a
   * per-probe id and waits `watchdogTimeoutMs` for it to arrive.
   * Failure = the pg-side LISTEN registration is silently broken;
   * destroy the client, reconnect via backoff, re-LISTEN.
   *
   * Default `60000` (60s). `0` disables the watchdog (used in tests
   * that assert the subscription doesn't fire background probes).
   */
  watchdogIntervalMs?: number;
  /**
   * Watchdog probe timeout in milliseconds. If the sentinel round-trip
   * doesn't complete within this window, the client is destroyed and
   * reconnect scheduled. Default `5000` (5s). Must be smaller than
   * `watchdogIntervalMs` so probes don't overlap; the code guards
   * against overlap defensively but the semantics assume no overlap.
   */
  watchdogTimeoutMs?: number;
}

/**
 * Point-in-time health view of the subscription. Consumed by the engine's
 * Hono `/health/subscription` route so external monitors can distinguish
 * "connected and receiving traffic" from "connected but silent" from
 * "reconnecting" without reading logs.
 *
 * Timestamps are ISO 8601 strings (not epoch ms) so the JSON response is
 * human-readable at a glance in a curl.
 */
export interface EventSubscriptionHealth {
  /** True while the pg client is connected AND LISTEN is registered. */
  connected: boolean;
  /** ISO timestamp when the current live connection began; null before first connect. */
  startedAt: string | null;
  /** ISO timestamp of most-recent self-test / watchdog ack. null before first ack. */
  lastSelfTestOkAt: string | null;
  /** ISO timestamp of most-recent NOTIFY payload received (any kind — real or sentinel). null before first receipt. */
  lastNotifyReceivedAt: string | null;
  /** Current reconnect attempt counter; 0 while connected + healthy. */
  reconnectAttempt: number;
  /** ISO timestamp of most-recent observed connection loss; null if never seen loss since boot. */
  connectionLostAt: string | null;
}

export interface EventSubscriptionHandle {
  /**
   * Gracefully stop the subscription. Cancels any pending reconnect
   * timer, cancels watchdog probes, ends the active pg client, resolves
   * once teardown is complete. Idempotent — second call is a no-op.
   */
  stop: () => Promise<void>;
  /**
   * Return a point-in-time health snapshot. Cheap read of module-local
   * state; never throws. Consumed by the `/health/subscription` route.
   */
  getHealth: () => EventSubscriptionHealth;
}

/**
 * Start the LISTEN subscription. Connects to Postgres, registers
 * `LISTEN draft_events`, dispatches received notifications via the
 * supplied callback. Handles reconnect on connection drop with
 * exponential backoff. Returns a handle whose `stop()` shuts the
 * subscription down cleanly.
 *
 * Lifecycle:
 *   1. `new PgClient(connectionString)` → `client.connect()`
 *   2. `client.on('notification', handler)` → forward to dispatch
 *   3. `client.on('error', handler)` → log + schedule reconnect
 *   4. `client.query('LISTEN draft_events')`
 *   5. Fire startup self-test via `SELECT pg_notify(...)`
 *   6. On `stop()`: cancel reconnect timer, await client.end()
 */
export function startEventSubscription(
  opts: StartEventSubscriptionOptions,
): EventSubscriptionHandle {
  const {
    connectionString,
    dispatch,
    // Chunk 11g.10 sub-step 10c-1d: TCP keepAlive on the pg client.
    // Without this, silently-half-dead TCPs (NAT idle, load-balancer
    // reap, Supabase-side proxy timeout) sit in ESTABLISHED forever
    // and pg.Client never emits `error` or `end`. keepAliveInitial-
    // DelayMillis is set short (10s) so a break surfaces within one
    // watchdog cycle rather than the OS default (~2 hours on Linux).
    clientFactory = (cs: string) =>
      new PgClient({
        connectionString: cs,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
      }),
    selfTestTimeoutMs = 5_000,
    watchdogIntervalMs = 60_000,
    watchdogTimeoutMs = 5_000,
  } = opts;

  let stopped = false;
  let client: PgClient | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempt = 0;
  let connectionLostAt: number | null = null;
  let selfTestTimer: NodeJS.Timeout | null = null;
  let selfTestReceived = false;

  // ── Chunk 11g.10 sub-step 10c-1d hardening state ─────────────────
  // `startedAt`, `lastSelfTestOkAt`, `lastNotifyReceivedAt` feed
  // `getHealth()` and the `/health/subscription` route. `watchdog*`
  // state drives the periodic probe. `pendingWatchdogId` correlates
  // an outbound probe's random id with an inbound `_test` payload —
  // ensures a straggler probe from a prior connection can't falsely
  // clear a current-connection timer.
  let startedAt: number | null = null;
  let lastSelfTestOkAt: number | null = null;
  let lastNotifyReceivedAt: number | null = null;
  let watchdogInterval: NodeJS.Timeout | null = null;
  let watchdogTimer: NodeJS.Timeout | null = null;
  let pendingWatchdogId: string | null = null;
  let pendingWatchdogStartedAt: number | null = null;
  let watchdogReconnectInFlight = false;

  const handleNotification = (msg: { channel: string; payload?: string }): void => {
    // Chunk 11g.10 sub-step 10c-1b: stamp receipt time at the earliest
    // observable moment (pg client's notification event → this handler).
    // Passed into `dispatch` so downstream (LobbyManager) can compute
    // notify→broadcast latency for the Mandate fanout metric.
    const notificationReceivedAtMs = Date.now();
    if (msg.channel !== 'draft_events') return;
    const raw = msg.payload ?? '';
    // Chunk 11g.10 sub-step 10c-1d: any inbound frame on this channel
    // is proof the LISTEN registration is alive — feed the health surface
    // BEFORE branching on sentinel-vs-real so `/health/subscription`
    // reflects reality regardless of payload class.
    lastNotifyReceivedAt = notificationReceivedAtMs;
    // Self-test sentinel: any payload containing `"_test":true` (with
    // or without spaces) marks the self-test as received. We check
    // before parseNotificationPayload because parse returns null for
    // self-test (intentional filter).
    if (raw.includes('"_test"')) {
      selfTestReceived = true;
      if (selfTestTimer) {
        clearTimeout(selfTestTimer);
        selfTestTimer = null;
      }
      lastSelfTestOkAt = notificationReceivedAtMs;
      // Chunk 11g.10 sub-step 10c-1d: correlate with watchdog probe.
      // The payload may carry `_watchdog_id` — a per-probe uuid we
      // set at `fireWatchdogProbe` time. Match against `pendingWatchdogId`
      // to distinguish "watchdog ack" from "boot-time self-test ack"
      // for logging clarity.
      let watchdogId: string | null = null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          typeof (parsed as Record<string, unknown>)._watchdog_id === 'string'
        ) {
          watchdogId = (parsed as Record<string, unknown>)._watchdog_id as string;
        }
      } catch {
        // Malformed sentinel — treat as non-watchdog self-test.
      }
      if (watchdogId !== null && watchdogId === pendingWatchdogId) {
        const elapsedMs =
          pendingWatchdogStartedAt !== null
            ? notificationReceivedAtMs - pendingWatchdogStartedAt
            : -1;
        pendingWatchdogId = null;
        pendingWatchdogStartedAt = null;
        if (watchdogTimer) {
          clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }
        structuredLogger.info('event_subscription.watchdog_ok', {
          probeId: watchdogId,
          elapsedMs,
        });
      } else {
        structuredLogger.info('event_subscription.self_test_succeeded', {});
      }
      return;
    }
    const parsed = parseNotificationPayload(raw);
    if (parsed === null) {
      structuredLogger.warn('event_subscription.payload_parse_failed', {
        rawPreview: raw.slice(0, 200),
      });
      return;
    }
    structuredLogger.debug('event_subscription.notification_received', {
      leagueId: parsed.leagueId,
      seq: parsed.seq,
    });
    // Chunk 11g.10 sub-step 10c-1b: event_subscription.dispatched
    // DEBUG-level (fires per external event; INFO would be too hot
    // on a busy draft). `dispatchMs` bounds the callback overhead
    // between notification receipt and the LobbyManager enqueue —
    // combined with `external_event.applied.notifyToBroadcastMs` on
    // the LobbyManager side, this gives the full NOTIFY→broadcast
    // decomposition for the Mandate fanout metric.
    const dispatchStart = Date.now();
    void dispatch(parsed, notificationReceivedAtMs)
      .then(() => {
        structuredLogger.debug('event_subscription.dispatched', {
          leagueId: parsed.leagueId,
          seq: parsed.seq,
          dispatchMs: Date.now() - dispatchStart,
        });
      })
      .catch((err: unknown) => {
        structuredLogger.error(
          'event_subscription.dispatch_failed',
          { leagueId: parsed.leagueId, seq: parsed.seq },
          err,
        );
      });
  };

  const scheduleReconnect = (): void => {
    if (stopped) return;
    // Chunk 11g.10 sub-step 10c-1d (R1 review fix): idempotency guard.
    // If a reconnect is already pending, do not schedule a second one.
    // Without this, concurrent triggers (watchdog failure + error event
    // + end event from the same dead connection, or the R1 stale-client
    // race with the identity guard) could each call setTimeout, each
    // overwriting `reconnectTimer` while the prior setTimeout is still
    // active — resulting in multiple concurrent `connect()` calls, each
    // creating a fresh pg.Client. The oldest timer would still fire
    // even after `reconnectTimer` is rebound. Idempotency here means at
    // most one reconnect in flight; whichever caller wins races first
    // arms the backoff and subsequent callers no-op.
    if (reconnectTimer !== null) return;
    reconnectAttempt += 1;
    const delayMs = computeReconnectDelayMs(reconnectAttempt);
    structuredLogger.warn('event_subscription.connection_lost', {
      attemptNumber: reconnectAttempt,
      reconnectDelayMs: delayMs,
    });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delayMs);
    if (typeof reconnectTimer.unref === 'function') {
      reconnectTimer.unref();
    }
  };

  const fireSelfTest = (): void => {
    if (selfTestTimeoutMs <= 0 || client === null) return;
    selfTestReceived = false;
    // Use a quoted-cast to keep the payload literal exactly
    // `{"_test": true}` — Postgres preserves the literal as-is.
    void client
      .query("SELECT pg_notify('draft_events', '{\"_test\":true}')")
      .catch((err: unknown) => {
        structuredLogger.error(
          'event_subscription.self_test_emit_failed',
          {},
          err,
        );
      });
    selfTestTimer = setTimeout(() => {
      if (selfTestReceived) return;
      structuredLogger.error(
        'event_subscription.self_test_failed',
        {
          timeoutMs: selfTestTimeoutMs,
          remediation:
            'LISTEN subscription appears non-functional within 5s of startup. ' +
            'Verify SUPABASE_DB_URL is a direct connection (not pooled — ' +
            'pgbouncer / Supabase pooled connections drop LISTEN frames).',
        },
      );
    }, selfTestTimeoutMs);
    if (typeof selfTestTimer.unref === 'function') {
      selfTestTimer.unref();
    }
  };

  // ── Chunk 11g.10 sub-step 10c-1d: watchdog helpers ───────────────
  //
  // The 10c-1c post-mortem showed the LISTEN backend can die silently
  // with no `error`/`end` event on the pg client. The watchdog is the
  // sole active liveness signal: every `watchdogIntervalMs` we fire a
  // self-NOTIFY carrying a per-probe id, and if the id doesn't come
  // back within `watchdogTimeoutMs`, we declare the connection dead,
  // destroy it, and reconnect via the existing backoff schedule. All
  // transitions log at INFO/WARN/ERROR so the deafness that has bitten
  // us historically becomes visible in Cloud Logging without any
  // human intervention.

  const stopWatchdog = (): void => {
    if (watchdogInterval) {
      clearInterval(watchdogInterval);
      watchdogInterval = null;
    }
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
    pendingWatchdogId = null;
    pendingWatchdogStartedAt = null;
  };

  const handleWatchdogFailure = (probeId: string, elapsedMs: number): void => {
    if (stopped || watchdogReconnectInFlight) return;
    watchdogReconnectInFlight = true;
    structuredLogger.error(
      'event_subscription.watchdog_failed',
      {
        probeId,
        elapsedMs,
        remediation:
          'Watchdog self-NOTIFY did not round-trip within timeout. ' +
          'Destroying pg.Client and scheduling reconnect. If this fires ' +
          'repeatedly on a fresh connection, verify SUPABASE_DB_URL is a ' +
          'direct connection (not pooled) and that no network intermediary ' +
          'is silently reaping idle TCPs.',
      },
    );
    // Tear down the current client + watchdog state; scheduleReconnect
    // will drive a fresh `connect()` after the backoff delay. Doing this
    // in fire-and-forget mode lets the current setTimeout callback return
    // promptly; the async .end() runs in the background.
    stopWatchdog();
    const dying = client;
    client = null;
    connectionLostAt = Date.now();
    if (dying) {
      void dying
        .end()
        .catch((err: unknown) => {
          // Minor cleanup failure — we already logged the primary
          // watchdog_failed above; a .end() error on an already-broken
          // client is expected. Embed the message inline rather than
          // using the 3-arg `error` form.
          structuredLogger.debug(
            'event_subscription.watchdog_client_end_threw',
            {
              endErrorMessage:
                err instanceof Error ? err.message : String(err),
            },
          );
        });
    }
    structuredLogger.warn('event_subscription.watchdog_forcing_reconnect', {
      probeId,
    });
    scheduleReconnect();
    watchdogReconnectInFlight = false;
  };

  const fireWatchdogProbe = (): void => {
    if (stopped || client === null) return;
    // Defensive: if a probe is still outstanding when the next interval
    // fires, the timeout should have already tripped and cleaned up. If
    // we're still holding a pending id here, treat it as a fault and
    // skip this cycle rather than overlapping probes.
    if (pendingWatchdogId !== null) {
      structuredLogger.warn('event_subscription.watchdog_overlap', {
        pendingProbeId: pendingWatchdogId,
      });
      return;
    }
    const probeId = randomUUID();
    pendingWatchdogId = probeId;
    pendingWatchdogStartedAt = Date.now();
    // Payload contains both `"_test":true` (so the existing sentinel
    // filter path fires) AND `_watchdog_id` (so the handler can
    // correlate this specific probe with its ack). The probeId is a
    // UUID → safe to embed in the JSON literal without escaping.
    const payload = `{"_test":true,"_watchdog_id":"${probeId}"}`;
    structuredLogger.debug('event_subscription.watchdog_probe_fired', {
      probeId,
      timeoutMs: watchdogTimeoutMs,
    });
    // Fire-and-forget: any query error surfaces via the client-error
    // handler which schedules a reconnect. We don't await here because
    // the setInterval callback shouldn't block the event loop.
    if (client) {
      void client
        .query(`SELECT pg_notify('draft_events', $1)`, [payload])
        .catch((err: unknown) => {
          structuredLogger.warn(
            'event_subscription.watchdog_query_failed',
            { probeId },
          );
          // Don't call handleWatchdogFailure here — the client's error
          // event will fire (or already has) and drive scheduleReconnect
          // through the normal path. But do drop the pending id so a
          // late-arriving unrelated frame doesn't accidentally clear it.
          if (pendingWatchdogId === probeId) {
            pendingWatchdogId = null;
            pendingWatchdogStartedAt = null;
          }
          if (watchdogTimer) {
            clearTimeout(watchdogTimer);
            watchdogTimer = null;
          }
          void err;
        });
    }
    watchdogTimer = setTimeout(() => {
      if (pendingWatchdogId !== probeId) return;
      // Timeout tripped without the ack arriving. This is the deafness
      // signal we didn't have historically. Fire the failure path.
      const elapsedMs =
        pendingWatchdogStartedAt !== null
          ? Date.now() - pendingWatchdogStartedAt
          : watchdogTimeoutMs;
      pendingWatchdogId = null;
      pendingWatchdogStartedAt = null;
      watchdogTimer = null;
      handleWatchdogFailure(probeId, elapsedMs);
    }, watchdogTimeoutMs);
    if (typeof watchdogTimer.unref === 'function') {
      watchdogTimer.unref();
    }
  };

  const startWatchdog = (): void => {
    if (watchdogIntervalMs <= 0) return;
    // Defensive: if a previous connect() left an interval alive, clear
    // it before starting a new one. (Shouldn't happen given stopWatchdog
    // in the error/end paths, but cheap safety.)
    stopWatchdog();
    watchdogInterval = setInterval(fireWatchdogProbe, watchdogIntervalMs);
    if (typeof watchdogInterval.unref === 'function') {
      watchdogInterval.unref();
    }
    structuredLogger.info('event_subscription.watchdog_started', {
      intervalMs: watchdogIntervalMs,
      timeoutMs: watchdogTimeoutMs,
    });
  };

  const connect = async (): Promise<void> => {
    if (stopped) return;
    let nextClient: PgClient;
    try {
      nextClient = clientFactory(connectionString);
    } catch (err) {
      structuredLogger.error(
        'event_subscription.client_factory_failed',
        {},
        err,
      );
      scheduleReconnect();
      return;
    }
    nextClient.on('notification', handleNotification);
    nextClient.on('error', (err: Error) => {
      // pg.Client emits error on connection drop. Schedule reconnect
      // unless we're shutting down.
      if (stopped) return;
      // Chunk 11g.10 sub-step 10c-1d (R1 review fix): identity guard.
      // If this handler fires for a client we've already replaced
      // (e.g., watchdog declared death, we reconnected, then the OLD
      // socket's keepalive finally trips ~30s later and emits `error`),
      // acting on it would null out our LIVE client, stop the watchdog
      // running against the new connection, and schedule a second
      // reconnect — orphaning the live LISTEN backend. Only mutate
      // module state if the erroring client is still the one we
      // consider live. Mirrors the same guard on the `end` handler.
      if (client !== nextClient) {
        structuredLogger.debug('event_subscription.stale_client_error_ignored', {
          message: err.message,
        });
        return;
      }
      structuredLogger.warn('event_subscription.client_error', {
        message: err.message,
      });
      // The client is now dead; null out our reference so subsequent
      // stop() doesn't try to .end() a broken client.
      client = null;
      connectionLostAt = Date.now();
      // Chunk 11g.10 sub-step 10c-1d: stop the watchdog interval so it
      // doesn't fire against the dead client mid-reconnect.
      stopWatchdog();
      scheduleReconnect();
    });
    // Chunk 11g.10 sub-step 10c-1d: `end` handler.
    // pg.Client emits `end` on a clean FIN close (server-initiated
    // shutdown, some intermediary reap paths) — prior code only listened
    // for `error`, so a clean close left the module in "connected"
    // state forever with no reconnect. Symmetric with the error path.
    nextClient.on('end', () => {
      if (stopped) return;
      // Distinguish an operator-initiated `stop()` (which already
      // nulled `client` before calling `.end()`) from an unsolicited
      // FIN: only treat as connection loss if we still consider the
      // client live.
      if (client !== nextClient) return;
      structuredLogger.warn('event_subscription.client_ended', {
        remediation:
          'pg.Client emitted `end` without prior `error`. Likely a clean ' +
          'FIN from the DB or an intermediary (idle-reap, deploy, migration). ' +
          'Scheduling reconnect.',
      });
      client = null;
      connectionLostAt = Date.now();
      stopWatchdog();
      scheduleReconnect();
    });
    try {
      await nextClient.connect();
      await nextClient.query('LISTEN draft_events');
    } catch (err) {
      structuredLogger.error(
        'event_subscription.connect_failed',
        {},
        err,
      );
      scheduleReconnect();
      return;
    }
    client = nextClient;
    startedAt = Date.now();
    if (connectionLostAt !== null) {
      const downtimeMs = Date.now() - connectionLostAt;
      structuredLogger.info('event_subscription.connection_restored', {
        downtimeMs,
        attemptsTaken: reconnectAttempt,
      });
      connectionLostAt = null;
    } else {
      structuredLogger.info('event_subscription.started', {});
    }
    reconnectAttempt = 0;
    fireSelfTest();
    // Chunk 11g.10 sub-step 10c-1d: start the watchdog probe cycle so
    // deafness of this fresh connection becomes visible within one
    // `watchdogIntervalMs` window (default 60s).
    startWatchdog();
  };

  // Kick off the initial connection. Don't await — startEventSubscription
  // returns the handle synchronously; first-connect errors flow through
  // reconnect logic.
  void connect();

  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (selfTestTimer) {
        clearTimeout(selfTestTimer);
        selfTestTimer = null;
      }
      // Chunk 11g.10 sub-step 10c-1d: stop the watchdog interval + any
      // pending probe timeout so a late fire during shutdown doesn't
      // trigger `handleWatchdogFailure` against a nulled client.
      stopWatchdog();
      if (client) {
        try {
          await client.end();
        } catch (err) {
          structuredLogger.debug('event_subscription.stop_end_threw', {});
          void err;
        }
        client = null;
      }
      structuredLogger.info('event_subscription.stopped', {});
    },
    // Chunk 11g.10 sub-step 10c-1d: cheap health accessor for the Hono
    // `/health/subscription` endpoint. Reads module-local state only —
    // no I/O, no throws. `connected` is true iff we have a live client
    // AND no reconnect is pending.
    getHealth: (): EventSubscriptionHealth => {
      const isoOrNull = (ms: number | null): string | null =>
        ms === null ? null : new Date(ms).toISOString();
      return {
        connected: client !== null && reconnectTimer === null,
        startedAt: isoOrNull(startedAt),
        lastSelfTestOkAt: isoOrNull(lastSelfTestOkAt),
        lastNotifyReceivedAt: isoOrNull(lastNotifyReceivedAt),
        reconnectAttempt,
        connectionLostAt: isoOrNull(connectionLostAt),
      };
    },
  };
}

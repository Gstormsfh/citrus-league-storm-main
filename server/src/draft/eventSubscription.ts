// Phase 4.5 chunk 11g.7 sub-step 7e — live event subscription via LISTEN/NOTIFY.
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
}

export interface EventSubscriptionHandle {
  /**
   * Gracefully stop the subscription. Cancels any pending reconnect
   * timer, ends the active pg client, resolves once teardown is
   * complete. Idempotent — second call is a no-op.
   */
  stop: () => Promise<void>;
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
    clientFactory = (cs: string) => new PgClient({ connectionString: cs }),
    selfTestTimeoutMs = 5_000,
  } = opts;

  let stopped = false;
  let client: PgClient | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempt = 0;
  let connectionLostAt: number | null = null;
  let selfTestTimer: NodeJS.Timeout | null = null;
  let selfTestReceived = false;

  const handleNotification = (msg: { channel: string; payload?: string }): void => {
    // Chunk 11g.10 sub-step 10c-1b: stamp receipt time at the earliest
    // observable moment (pg client's notification event → this handler).
    // Passed into `dispatch` so downstream (LobbyManager) can compute
    // notify→broadcast latency for the Mandate fanout metric.
    const notificationReceivedAtMs = Date.now();
    if (msg.channel !== 'draft_events') return;
    const raw = msg.payload ?? '';
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
      structuredLogger.info('event_subscription.self_test_succeeded', {});
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
      structuredLogger.warn('event_subscription.client_error', {
        message: err.message,
      });
      // The client is now dead; null out our reference so subsequent
      // stop() doesn't try to .end() a broken client.
      client = null;
      connectionLostAt = Date.now();
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
  };
}

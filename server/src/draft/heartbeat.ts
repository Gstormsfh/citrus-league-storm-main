// Phase 4.5 chunk 11g.7 sub-step 7d — WebSocket heartbeat helpers.
//
// Pure functions extracted from `uws-server.ts` so the zombie-
// connection-cleanup logic is unit-testable without spinning up real
// uWS. The helpers operate on the per-connection `lastPongAt`
// timestamp threaded through `DraftSocketUserData` and decide which
// connections to force-close.
//
// **Architecture (hybrid uWS native + application-level custom close
// code).** uWS handles ping emission internally via
// `sendPingsAutomatically: true` + the configured `idleTimeout`. The
// application layer only adds:
//
//   1. `initializeHeartbeat`: sets `lastPongAt` on WS open.
//   2. `recordPong`: updates `lastPongAt` from the uWS `pong:` handler.
//   3. `findTimedOutConnections`: scans the registry's connection
//      snapshot, returns the WSes whose `lastPongAt` is older than
//      `pongTimeoutMs`. Caller then force-closes with code 4002.
//
// The application-level soft-check pre-empts uWS's idle-timeout for
// the common case so we get structured logs + a custom close code
// (4002 → `transient` client-side per
// `apps/web/src/lib/draftClient/closeCodes.ts`). uWS's idle-timeout
// remains as defense-in-depth: if our timer ever fails to fire, uWS
// still kills genuine zombies on its own.
//
// **Why pure functions, not a class:** mirrors the
// `lobbyTimerReducer` / `lobbyClockRunner` separation from chunk
// 11g.5a — testable logic separate from side-effect-bound runtime.
// Tests pass mock WS objects with `getUserData()`; no uWS dependency.
//
// **Defaults.** 30s ping interval (uWS-managed) + 30s pong timeout
// (application-managed) is mobile-friendly: long enough that mid-
// network-blip pongs aren't classified as zombies, short enough to
// reclaim genuinely dead sockets within ~1 minute. uWS's
// `idleTimeout: 60` (= 2× the application timeout) is the backstop.
//
// Soft-check cadence: every `min(pongTimeoutMs / 3, 10000)` ms — fast
// enough that timeouts surface within ~10s of breaching, slow enough
// to keep CPU overhead negligible.
//
// See chunk 11g.7 sub-step 7d Decision Log entries in
// `docs/PHASE_4_5_PROJECT_PLAN.md` for the hybrid-architecture
// rationale and the close-code 4002 carve-out.

import type { DraftSocketUserData } from './types';

/**
 * Subset of the uWS `WebSocket<DraftSocketUserData>` API the heartbeat
 * logic needs. Minimal surface so tests can supply a plain object
 * rather than a full uWS mock.
 */
export interface HeartbeatWebSocket {
  getUserData(): DraftSocketUserData;
  /** Force-close with code + reason. Mirrors uWS's `ws.end(code, reason)`. */
  end(code: number, reason: string): void;
}

/**
 * Result row returned by `findTimedOutConnections` for each connection
 * that needs to be force-closed. The caller drains this list, calls
 * `end(4002, ...)` on each `ws`, and emits structured logs using the
 * carried context (`lobbyId`, `userId`, `lastPongAgeMs`).
 */
export interface TimedOutConnection<W extends HeartbeatWebSocket = HeartbeatWebSocket> {
  ws: W;
  lobbyId: string;
  userId: string;
  lastPongAgeMs: number;
}

export interface HeartbeatConfig {
  /**
   * Maximum allowed milliseconds between successive pongs from a
   * connection. A connection whose `lastPongAt < now - pongTimeoutMs`
   * is classified as a zombie and force-closed with code 4002.
   *
   * Sourced from `HEARTBEAT_PONG_TIMEOUT_MS` env (default 30000).
   * `0` disables the heartbeat entirely (used in tests via the
   * vitest setup file).
   */
  pongTimeoutMs: number;
}

/**
 * Custom WebSocket close code reserved for heartbeat pong-timeout
 * disconnects. Classified as `transient` client-side per the
 * `classifyCloseCode` carve-out in
 * `apps/web/src/lib/draftClient/closeCodes.ts` — the connection drops
 * but the client reconnects with backoff (no token re-auth needed).
 *
 * Reserved-codes header in `closeCodes.ts` documents this allocation
 * to prevent collisions if future close-code work adds new 4xxx codes.
 *
 * ── Reserved custom close codes (allocation table) ──────────────────
 *
 * Any new 4xxx close code MUST be added to BOTH this table and the
 * mirrored table in `apps/web/src/lib/draftClient/closeCodes.ts`.
 *
 *   - 4002 — heartbeat pong-timeout (this file, chunk 11g.7 sub-step
 *            7d). Client disposition: transient. Reconnect with backoff.
 *   - 4300 — chunk 11g.10 sub-step 10c-2 gate (a) unauthorized_bad_shape.
 *            `claims.sub` failed the UUIDv4 shape check inside the uWS
 *            upgrade handler (`uws-server.ts`); emitted via the
 *            `closeAfterUpgrade` marker in `DraftSocketUserData`.
 *            Client disposition: `permanent_auth` (fresh auth flow —
 *            not a retryable server condition).
 *   - 4400 — chunk 11g.10 sub-step 10c-2 gate (b) draft_not_initialized.
 *            The awaited `SELECT 1 FROM draft_order ... LIMIT 1` from
 *            `isDraftInitialized` returned zero rows (KNOWN not
 *            configured). Client disposition:
 *            `permanent_not_initialized` — no auto-reconnect, distinct
 *            banner; manual RETRY NOW affordance stays. Never emitted
 *            from an error path (see 1011 fallback below).
 *
 * Standard codes also emitted by the engine:
 *
 *   - 1011 — server_error / gate (b) precheck error (`'error'` return
 *            from `isDraftInitialized` — DB timeout, query error, pool
 *            unavailable). Retained as defense-in-depth per the
 *            architect's TOCTOU stance (Decision Log 2026-07-28
 *            "join-path-robustness chunk — architect pre-ratification
 *            conditions folded in"). Client disposition: transient.
 */
export const HEARTBEAT_PONG_TIMEOUT_CLOSE_CODE = 4002;

/**
 * Initialize the per-connection heartbeat state. Called in the uWS
 * `open` handler immediately after the WS upgrade resolves. Stamps
 * `lastPongAt` to `now` so the first soft-check window is measured
 * from connection-open rather than from epoch (which would produce
 * an instant false-positive timeout).
 */
export function initializeHeartbeat(ws: HeartbeatWebSocket, now: number): void {
  ws.getUserData().lastPongAt = now;
}

/**
 * Update `lastPongAt` to `now`. Called from the uWS `pong:` handler
 * on every received pong control frame. Browsers automatically pong
 * any incoming server ping per the WebSocket spec, so this fires on
 * whatever cadence uWS's `sendPingsAutomatically` ping schedule emits.
 */
export function recordPong(ws: HeartbeatWebSocket, now: number): void {
  ws.getUserData().lastPongAt = now;
}

/**
 * Scan a snapshot of active connections, return those whose last-pong
 * timestamp is older than `pongTimeoutMs` relative to `now`. Pure
 * function — does NOT call `ws.end()` itself; the caller drives the
 * disconnect so the surrounding code can also emit logs and update
 * any per-server bookkeeping.
 *
 * **Boundary semantics:** a connection is timed-out when
 * `now - lastPongAt > pongTimeoutMs` (strictly greater). At exactly
 * `pongTimeoutMs` the connection is still considered alive — small
 * leniency for clock jitter between the JS event loop's `Date.now()`
 * and the timer firing.
 *
 * **Disable semantics:** if `pongTimeoutMs <= 0`, returns `[]`. The
 * vitest setup file defaults `HEARTBEAT_PONG_TIMEOUT_MS=0` so the
 * scanner is a no-op under tests.
 */
export function findTimedOutConnections<W extends HeartbeatWebSocket>(
  connections: Iterable<W>,
  now: number,
  config: HeartbeatConfig,
): Array<TimedOutConnection<W>> {
  if (config.pongTimeoutMs <= 0) {
    return [];
  }
  const out: Array<TimedOutConnection<W>> = [];
  for (const ws of connections) {
    const userData = ws.getUserData();
    const ageMs = now - userData.lastPongAt;
    if (ageMs > config.pongTimeoutMs) {
      out.push({
        ws,
        lobbyId: userData.lobbyId,
        userId: userData.userId,
        lastPongAgeMs: ageMs,
      });
    }
  }
  return out;
}

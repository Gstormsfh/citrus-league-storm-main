// Phase 4.5 chunk 11g.5a — WebSocket close-code disposition.
// Phase 4.5 chunk 11g.7 sub-step 7d — added 4002 carve-out for
// heartbeat pong-timeout (transient — clients reconnect with backoff).
//
// Translates the numeric close codes the browser surfaces on
// `ws.onclose(code, reason)` into a state-machine decision:
// reconnect with backoff (transient), drop to a terminal `fatal`
// state (permanent), or treat as caller-initiated normal closure.
//
// The chunk 11g.2 step 2 server rejects auth failures via HTTP
// 401/403 BEFORE the upgrade — those don't surface as close codes
// to the client (they appear as a failed connection / open event
// that never fires). The custom 4xxx ranges below are reserved
// for the post-upgrade keepalive layer (chunk 11g.7) and any
// future server-initiated close paths.
//
// ── Reserved custom close codes ────────────────────────────────────
//
// Custom 4xxx code allocation (engine convention). Future code adding
// new 4xxx codes MUST update this list to avoid collision and MUST
// either fall within the disposition range its semantics imply OR
// add an explicit carve-out before the range checks in
// `classifyCloseCode` (mirroring 4002's pattern).
//
//   - 4002        — pong timeout (chunk 11g.7 sub-step 7d). TRANSIENT
//                   despite living in the 4001-4099 auth range; carved
//                   out explicitly because it represents a network /
//                   keepalive failure rather than a token problem.
//   - 4001-4099   — token / auth failures (token expired mid-session,
//                   token revoked, etc.). DEFAULT permanent_auth.
//                   Reserve 4001 specifically for "token expired",
//                   future codes 4003-4099 for other auth subtypes.
//   - 4100-4199   — lobby gone (draft completed, lobby evicted).
//                   permanent_lobby — no retry.
//   - 4200-4999   — other permanent server-side rejections.
//                   permanent_server — no retry.

/** Disposition decision driven by the WS close code + reason. */
export type CloseCodeDisposition =
  /** Treat as caller-initiated; do not reconnect. */
  | 'normal'
  /** Reconnect with exponential backoff. */
  | 'transient'
  /** Token verification failed; user must re-authenticate. */
  | 'permanent_auth'
  /** Lobby gone or draft completed; no retry. */
  | 'permanent_lobby'
  /** Server-side rejection that won't recover with retry. */
  | 'permanent_server';

/**
 * Classify a WebSocket close code into a state-machine disposition.
 *
 * Standard codes per RFC 6455:
 *   - 1000: Normal closure (caller called `ws.close()`).
 *   - 1001: Going away (browser navigated away). Treat as normal.
 *   - 1006: Abnormal closure (network drop, no close frame). The
 *     most common transient case.
 *   - 1011: Server error (engine threw). Transient — retry with
 *     backoff.
 *   - 1013: Try Again Later (chunk 11g.4 step 5's backpressure
 *     disconnect path). Transient with extra-deferential delay.
 *
 * Custom 4xxx ranges (see "Reserved custom close codes" header
 * comment for the full allocation table):
 *   - 4002: pong timeout (chunk 11g.7 sub-step 7d). Carved out as
 *     `transient` BEFORE the 4001-4099 range check — the connection
 *     dropped because of a network / keepalive failure, not because
 *     auth went bad. Client reconnects with backoff.
 *   - 4001-4099: auth failures (token expired mid-session, etc.).
 *   - 4100-4199: lobby gone (draft completed, lobby removed).
 *   - 4200+: other permanent server-side rejections.
 *
 * `reason` is currently unused but kept in the signature for
 * forward-compat — a future close code may carry structured info
 * in the reason string that warrants a different disposition.
 */
export function classifyCloseCode(code: number, _reason: string): CloseCodeDisposition {
  if (code === 1000 || code === 1001) {
    return 'normal';
  }
  // Chunk 11g.7 sub-step 7d: heartbeat pong-timeout carve-out. MUST
  // run before the 4001-4099 range check; 4002 is a network failure,
  // not an auth failure, so the client reconnects with backoff
  // instead of falling into a fatal `permanent_auth` state.
  if (code === 4002) {
    return 'transient';
  }
  if (code >= 4001 && code <= 4099) {
    return 'permanent_auth';
  }
  if (code >= 4100 && code <= 4199) {
    return 'permanent_lobby';
  }
  if (code >= 4200 && code < 5000) {
    return 'permanent_server';
  }
  // 1006 (network drop), 1011 (server error), 1013 (backpressure /
  // try again later), and anything else not explicitly classified —
  // treat as transient. Reconnect with backoff.
  return 'transient';
}

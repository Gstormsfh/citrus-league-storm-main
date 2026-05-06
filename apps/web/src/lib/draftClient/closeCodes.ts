// Phase 4.5 chunk 11g.5a — WebSocket close-code disposition.
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
// for a future ping/keepalive layer (chunk 11g.7) that may
// terminate post-upgrade auth-failure connections via close codes.

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
 * Custom 4xxx ranges (engine convention; not yet emitted by chunk
 * 11g.2 step 2 since that path returns HTTP 401/403 pre-upgrade,
 * but chunk 11g.7's heartbeat path may emit these):
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

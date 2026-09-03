// Phase 4.5 chunk 11g.4 step 5 — pure helpers for the uWS message
// handler.
//
// Lives in its own file so it can be unit-tested without spinning
// up a real uWS server. The uws-server.ts `message:` handler
// becomes a one-line glue call into `handleClientMessage`.
//
// Design: the helper takes uWS's WebSocket as a structural-typed
// argument (we only rely on `send`) so tests can pass a plain mock
// object with a `send` vi.fn() and assert against it. The
// LobbyRegistry is also injected — tests pass a stub.

import { structuredLogger } from '@citrus/shared';
import {
  parseClientMessage,
  serializeServerMessage,
  WIRE_PROTOCOL_VERSION,
  type DraftServerMessage,
  type DraftSocketUserData,
} from './types';
import type { LobbyRegistry } from './LobbyRegistry';

/**
 * Minimal structural type covering the WebSocket methods this
 * helper actually uses. Lets tests pass a plain `{ send: vi.fn() }`
 * without needing to satisfy the full `uWS.WebSocket<UserData>`
 * surface.
 */
export interface SendableWebSocket {
  send(message: string): unknown;
}

/**
 * Handle one inbound message from a connected client.
 *
 * Steps:
 *   1. Parse + validate the raw string (`parseClientMessage`)
 *   2. Dispatch on `type`
 *   3. For `resync`: look up the lobby via `lobbyRegistry.get` and
 *      call `handleResyncRequest`; send the response back via
 *      `ws.send`. If the lobby is missing (race-with-disconnect or
 *      teardown), reply with an `error` server message rather than
 *      silently dropping — gives the client a clear retry signal.
 *
 * On parse failure: log at debug and ignore. Malformed input from
 * the wire is not actionable client-side; raising would just spam
 * logs without helping.
 */
export function handleClientMessage(
  ws: SendableWebSocket,
  lobbyRegistry: LobbyRegistry,
  raw: string,
  userData: DraftSocketUserData,
): void {
  const parsed = parseClientMessage(raw);
  if (!parsed) {
    structuredLogger.debug('uws.message.malformed_dropped', {
      lobbyId: userData.lobbyId,
      userId: userData.userId,
      rawLength: raw.length,
    });
    return;
  }

  if (parsed.type === 'resync') {
    const lobby = lobbyRegistry.get(userData.lobbyId);
    if (!lobby) {
      // Lobby not in registry — could be the open-handler race
      // (getOrCreate hasn't completed) or a teardown that already
      // ran. Reply with structured error so the client can retry
      // rather than infer from a dropped packet.
      const errorMessage: DraftServerMessage = {
        v: WIRE_PROTOCOL_VERSION,
        type: 'error',
        timestamp: new Date().toISOString(),
        payload: {
          code: 'lobby_not_ready',
          message: `Lobby ${userData.lobbyId} is not registered yet. Retry shortly.`,
        },
      };
      try {
        ws.send(serializeServerMessage(errorMessage));
      } catch (err) {
        structuredLogger.debug(
          'uws.send.lobby_not_ready_error_threw',
          {
            lobbyId: userData.lobbyId,
            userId: userData.userId,
          },
        );
        // err intentionally not threaded — debug-level + send-throws
        // are noisy + non-actionable; engine drops the message.
        void err;
      }
      return;
    }

    const response = lobby.handleResyncRequest(userData, parsed.payload.sinceSeq);
    try {
      ws.send(serializeServerMessage(response));
    } catch (err) {
      structuredLogger.debug('uws.send.resync_response_threw', {
        lobbyId: userData.lobbyId,
        userId: userData.userId,
      });
      void err;
    }
    return;
  }

  if (parsed.type === 'ping') {
    // Chunk 11g.10 client-liveness watchdog. Server responds with a
    // pong echoing the client's `t` so the client can compute RTT and
    // detect missed responses. No lobby lookup — the ping path is
    // pure round-trip on the connection; if the ws is up, we can
    // respond. Logs at DEBUG so healthy pings don't spam INFO.
    const pong: DraftServerMessage = {
      v: WIRE_PROTOCOL_VERSION,
      type: 'pong',
      timestamp: new Date().toISOString(),
      payload: { t: parsed.payload.t },
    };
    try {
      ws.send(serializeServerMessage(pong));
    } catch (err) {
      structuredLogger.debug('uws.send.pong_threw', {
        lobbyId: userData.lobbyId,
        userId: userData.userId,
      });
      void err;
    }
    return;
  }

  // Unreachable under normal operation — `parseClientMessage` only
  // returns 'resync' or 'ping' shapes today. A bug in the parser (new
  // variant added without a case here) surfaces as a DEBUG log.
  // NOTE: the previous `const _exhaustive: never` guard broke under
  // server/tsconfig.json's `strict: false` — `never.type` doesn't
  // resolve to `never` there, so the exhaustive assertion fires a
  // spurious TS2339. Runtime log is the substitute.
  structuredLogger.debug('uws.message.unknown_type_dropped', {
    lobbyId: userData.lobbyId,
    userId: userData.userId,
    type: (parsed as { type?: string }).type,
  });
}

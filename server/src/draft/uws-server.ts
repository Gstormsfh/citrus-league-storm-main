// Phase 4.5 chunk 11g.2 step 2 — JWT validation on uWS upgrade.
// Phase 4.5 chunk 11g.4 step 4 — LobbyRegistry wiring on open/close.
// Phase 4.5 chunk 11g.4 step 5 — JSON-aware message handler routes
// resync requests through `uws-helpers.handleClientMessage`. App is
// constructed in `index.ts` (not here) so its `publish` callback
// can also feed the LobbyRegistry — see uws-helpers.ts and
// LobbyManager.ts step-5 broadcast wiring.
//
// Authenticates incoming WebSocket clients before allowing the upgrade.
// Tokens are issued by the discovery endpoint (chunk 11g.1) and carried
// on the WS handshake via `Sec-WebSocket-Protocol` per the locked design
// decision in lib/draftToken.ts §4 (subprotocol header keeps the token
// out of URLs / logs / referrers).
//
// Step 4 of chunk 11g.4 wires the LobbyRegistry into open/close:
// the open handler `getOrCreate`s the LobbyManager and calls
// `addConnection`; the close handler calls `removeConnection`. If
// the format lookup fails (e.g. league has draftType=offline), the
// open handler closes the ws with code 1011 (server_error). Lobby
// eviction on last-disconnect is intentionally deferred to chunk
// 11g.7's snapshot-and-bootstrap flow.
//
// Rejection model: HTTP 401/403 returned during the upgrade handshake
// (pre-upgrade), not WS close codes (post-upgrade). No half-established
// connection on auth failure; cleaner client-side semantics. See the
// chunk 11g.2 step 2 brief for the explicit decision.
//
// See docs/PHASE_4_5_ARCHITECTURE.md (Stack Decision; Day 1 Topology),
// docs/adr/ADR-001-persistent-node-draft-engine.md, and
// server/src/lib/draftToken.ts for the token-format contract.

import uWS from 'uWebSockets.js';
import { structuredLogger } from '@citrus/shared';
import { verifyDraftToken } from '../lib/draftToken';
import type { LobbyRegistry } from './LobbyRegistry';
import { handleClientMessage } from './uws-helpers';
import type { DraftSocketUserData } from './types';

export interface UwsServerHandle {
  port: number;
  close: () => void;
}

export interface StartUwsServerOptions {
  port: number;
  /**
   * uWS application instance. Constructed in `index.ts` so its
   * `publish` callback can also feed the `LobbyRegistry` — keeping
   * the broadcast plumbing in one place avoids the temporal coupling
   * a setter-based late-bind would introduce.
   */
  app: uWS.TemplatedApp;
  /**
   * Process-singleton registry of LobbyManager instances. Injected
   * (rather than module-imported) so tests can pass a mock and
   * `index.ts` can construct the real one with admin-client-backed
   * `DraftServiceV2` + a real Supabase `formatLookup`.
   */
  lobbyRegistry: LobbyRegistry;
}

export function startUwsServer(opts: StartUwsServerOptions): Promise<UwsServerHandle> {
  const { port, app, lobbyRegistry } = opts;
  return new Promise((resolve, reject) => {
    let listenSocket: unknown = null;

    app.ws<DraftSocketUserData>('/ws/draft/:lobbyId', {
      upgrade: (res, req, context) => {
        // ── Sync: capture all req values BEFORE any await ──
        // uWS invalidates `req` after the upgrade handler returns; any
        // post-await read of req.* will throw or return garbage. Standard
        // uWS async-upgrade pattern.
        const lobbyId = req.getParameter(0);
        const secKey = req.getHeader('sec-websocket-key');
        const secProto = req.getHeader('sec-websocket-protocol');
        const secExt = req.getHeader('sec-websocket-extensions');

        let aborted = false;
        res.onAborted(() => {
          aborted = true;
        });

        // No subprotocol == no token. Fail fast, no async work needed.
        if (!secProto) {
          structuredLogger.info('uws.upgrade.rejected', {
            lobbyId,
            reason: 'no_token',
          });
          res.cork(() => {
            res.writeStatus('401 Unauthorized').end();
          });
          return;
        }

        // Verify the token (async — local HMAC, sub-millisecond in
        // practice but still returns a Promise via hono/utils/jwt's
        // WebCrypto path). The lobbyId-vs-draftId mismatch check is
        // built into verifyDraftToken; we just pass the URL param as
        // expectedDraftId.
        verifyDraftToken(secProto, lobbyId)
          .then((result) => {
            if (aborted) return;

            // Narrow via property-existence (`'claims' in result`) rather
            // than via the `ok` discriminator — narrowing on `result.ok`
            // is unreliable under server/tsconfig.json's `strict: false`
            // setting; `in`-based narrowing works in either mode.
            if ('claims' in result) {
              const { claims } = result;
              structuredLogger.debug('uws.upgrade.accepted', {
                lobbyId,
                userId: claims.sub,
              });
              res.cork(() => {
                res.upgrade(
                  {
                    lobbyId,
                    userId: claims.sub,
                    leagueId: claims.leagueId,
                    draftId: claims.draftId,
                    expiresAt: claims.exp,
                  },
                  secKey,
                  secProto,
                  secExt,
                  context,
                );
              });
            } else {
              const status =
                result.reason === 'draft_mismatch' ? '403 Forbidden' : '401 Unauthorized';
              structuredLogger.info('uws.upgrade.rejected', {
                lobbyId,
                reason: result.reason,
              });
              res.cork(() => {
                res.writeStatus(status).end();
              });
            }
          })
          .catch((err: unknown) => {
            if (aborted) return;
            // Defensive: verifyDraftToken returns typed errors, never
            // throws under normal operation. If we get here, treat as 401.
            structuredLogger.error(
              'uws.upgrade.verify_token_threw',
              { lobbyId },
              err,
            );
            res.cork(() => {
              res.writeStatus('401 Unauthorized').end();
            });
          });
      },

      open: (ws) => {
        const userData = ws.getUserData();
        const { lobbyId, userId, leagueId } = userData;
        structuredLogger.info('uws.connection.opened', {
          lobbyId,
          userId,
          leagueId,
        });

        // Lazy-construct or look up the LobbyManager for this lobby
        // and attach the WS. The registry's Promise-placeholder map
        // collapses concurrent same-lobby openings onto one
        // construction.
        //
        // uWS does not await async open handlers — the .catch path
        // logs + closes the WS if format lookup fails (e.g. league
        // configured with draftType=offline). Code 1011 = "server
        // error" so the client retry path differs from auth-rejected
        // (401/403 pre-upgrade) and from intentional logout.
        //
        // Race note: if the user disconnects before getOrCreate
        // resolves, addConnection still runs and inserts an orphan
        // ws into the connections set. Step 5's broadcast-and-
        // backpressure work will introduce a more careful protocol;
        // for step 4 the orphan is harmless (the WS is closed and
        // the next removeConnection / lobby teardown will purge it).
        lobbyRegistry
          .getOrCreate(lobbyId, leagueId)
          .then((lobby) => {
            lobby.addConnection(ws, userData);
          })
          .catch((err: unknown) => {
            structuredLogger.error(
              'uws.lobby_get_or_create_failed',
              { lobbyId, leagueId },
              err,
            );
            try {
              ws.end(1011, 'server_error');
            } catch (closeErr) {
              // ws may already be closed if the user disconnected
              // in the same tick; swallow.
              structuredLogger.debug(
                'uws.ws_end_threw_after_failed_get_or_create',
                { lobbyId },
              );
              void closeErr;
            }
          });
      },

      message: (ws, message) => {
        // Step-5 wiring: parse incoming JSON via the pure helper
        // (uws-helpers.ts handleClientMessage), dispatch to the
        // appropriate LobbyManager method, send the response back.
        // The pure-function extraction lets us unit-test the message
        // path without spinning up real uWS in tests.
        const text = Buffer.from(message).toString('utf8');
        const userData = ws.getUserData();
        try {
          handleClientMessage(ws, lobbyRegistry, text, userData);
        } catch (err) {
          // Defensive: handleClientMessage swallows expected errors
          // internally. Anything bubbling here is an unexpected bug;
          // log + continue rather than crash the entire WS thread.
          structuredLogger.error(
            'uws.message_handler_threw',
            {
              lobbyId: userData.lobbyId,
              userId: userData.userId,
            },
            err,
          );
        }
      },

      close: (ws, code) => {
        const { lobbyId, userId } = ws.getUserData();
        const lobby = lobbyRegistry.get(lobbyId);
        if (lobby) {
          lobby.removeConnection(ws);
        }
        structuredLogger.info('uws.connection.closed', {
          lobbyId,
          userId,
          code,
          remainingConnections: lobby?.connectionCount() ?? 0,
        });
      },
    });

    app.listen(port, (token) => {
      if (token) {
        listenSocket = token;
        structuredLogger.info('uws.listening', { port });
        resolve({
          port,
          close: () => {
            if (listenSocket) {
              uWS.us_listen_socket_close(listenSocket);
              listenSocket = null;
              structuredLogger.info('uws.listen_socket_closed', { port });
            }
          },
        });
      } else {
        const err = new Error(`[uws] FAILED to listen on port ${port}`);
        structuredLogger.error('uws.listen_failed', { port }, err);
        reject(err);
      }
    });
  });
}

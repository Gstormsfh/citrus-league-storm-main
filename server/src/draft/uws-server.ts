// Phase 4.5 chunk 11g.2 step 2 — JWT validation on uWS upgrade.
//
// Authenticates incoming WebSocket clients before allowing the upgrade.
// Tokens are issued by the discovery endpoint (chunk 11g.1) and carried
// on the WS handshake via `Sec-WebSocket-Protocol` per the locked design
// decision in lib/draftToken.ts §4 (subprotocol header keeps the token
// out of URLs / logs / referrers).
//
// Step 2 of chunk 11g.2: auth only. No LobbyManager, no event sourcing,
// no DB calls — those land in chunks 11g.3 / 11g.4. Verified claims
// are attached to the WebSocket's userData so chunk 11g.4 message
// handlers can read them off `ws.getUserData()`.
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
import { logger } from '@citrus/shared';
import { verifyDraftToken } from '../lib/draftToken';

interface DraftSocketUserData {
  lobbyId: string;
  userId: string;
  leagueId: string;
  draftId: string;
  expiresAt: number;
}

export interface UwsServerHandle {
  port: number;
  close: () => void;
}

export function startUwsServer(port: number): Promise<UwsServerHandle> {
  return new Promise((resolve, reject) => {
    const app = uWS.App();
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
          logger.info(`[uws] upgrade rejected lobbyId=${lobbyId} reason=no_token`);
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
              logger.debug(
                `[uws] upgrade accepted lobbyId=${lobbyId} userId=${claims.sub}`,
              );
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
              logger.info(
                `[uws] upgrade rejected lobbyId=${lobbyId} reason=${result.reason}`,
              );
              res.cork(() => {
                res.writeStatus(status).end();
              });
            }
          })
          .catch((err: unknown) => {
            if (aborted) return;
            // Defensive: verifyDraftToken returns typed errors, never
            // throws under normal operation. If we get here, treat as 401.
            logger.error('[uws] verifyDraftToken threw unexpectedly:', err);
            res.cork(() => {
              res.writeStatus('401 Unauthorized').end();
            });
          });
      },

      open: (ws) => {
        const { lobbyId, userId } = ws.getUserData();
        logger.info(`[uws] connection opened lobbyId=${lobbyId} userId=${userId}`);
      },

      message: (ws, message, isBinary) => {
        const text = Buffer.from(message).toString('utf8');
        ws.send(`echo: ${text}`, isBinary);
      },

      close: (ws, code) => {
        const { lobbyId, userId } = ws.getUserData();
        logger.info(
          `[uws] connection closed lobbyId=${lobbyId} userId=${userId} code=${code}`,
        );
      },
    });

    app.listen(port, (token) => {
      if (token) {
        listenSocket = token;
        logger.info(`[uws] listening on port ${port}`);
        resolve({
          port,
          close: () => {
            if (listenSocket) {
              uWS.us_listen_socket_close(listenSocket);
              listenSocket = null;
              logger.info('[uws] listen socket closed');
            }
          },
        });
      } else {
        const err = new Error(`[uws] FAILED to listen on port ${port}`);
        logger.error(err.message);
        reject(err);
      }
    });
  });
}

// Phase 4.5 chunk 11g.2 step 1 — uWebSockets.js scaffold.
//
// Hello-world echo server. No LobbyManager, no event sourcing, no JWT
// validation yet — those land in chunks 11g.3 / 11g.4. This file exists
// to validate the architectural primitive (Hono + uWS in one Node
// process) inside the real Citrus monorepo.
//
// See docs/PHASE_4_5_ARCHITECTURE.md (Stack Decision; Day 1 Topology)
// and docs/adr/ADR-001-persistent-node-draft-engine.md.

import uWS from 'uWebSockets.js';
import { logger } from '@citrus/shared';

interface DraftSocketUserData {
  lobbyId: string;
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
        const lobbyId = req.getParameter(0);
        res.upgrade(
          { lobbyId },
          req.getHeader('sec-websocket-key'),
          req.getHeader('sec-websocket-protocol'),
          req.getHeader('sec-websocket-extensions'),
          context,
        );
      },

      open: (ws) => {
        const { lobbyId } = ws.getUserData();
        logger.info(`[uws] connection opened lobbyId=${lobbyId}`);
      },

      message: (ws, message, isBinary) => {
        const text = Buffer.from(message).toString('utf8');
        ws.send(`echo: ${text}`, isBinary);
      },

      close: (ws, code) => {
        const { lobbyId } = ws.getUserData();
        logger.info(`[uws] connection closed lobbyId=${lobbyId} code=${code}`);
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

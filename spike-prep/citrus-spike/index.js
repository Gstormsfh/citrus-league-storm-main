// Phase 4.5 chunk 11g.2.0 — GCE platform spike hello-world.
// Two ports, one process: Hono on ${PORT}, uWebSockets.js on ${DRAFT_WS_PORT}.
// Single SIGTERM handler closes both within 10s. Throwaway code.
// See docs/PHASE_4_5_GCE_SPIKE_RUNBOOK.md for execution.

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import uWS from 'uWebSockets.js';

const PORT = Number(process.env.PORT || 3001);
const DRAFT_WS_PORT = Number(process.env.DRAFT_WS_PORT || 3002);
const SHUTDOWN_TIMEOUT_MS = 10_000;

// --- Hono HTTP server -------------------------------------------------------

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, server: 'hono' }));

const honoServer = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[hono] listening on port ${info.port}`);
});

// --- uWebSockets.js server --------------------------------------------------

const uwsApp = uWS.App();
let uwsListenSocket = null;

uwsApp.ws('/ws/draft/:lobbyId', {
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
    console.log(`[uws] connection opened lobbyId=${lobbyId}`);
  },

  message: (ws, message, isBinary) => {
    const text = Buffer.from(message).toString('utf8');
    ws.send(`echo: ${text}`, isBinary);
  },

  close: (ws, code) => {
    const { lobbyId } = ws.getUserData();
    console.log(`[uws] connection closed lobbyId=${lobbyId} code=${code}`);
  },
});

uwsApp.listen(DRAFT_WS_PORT, (token) => {
  if (token) {
    uwsListenSocket = token;
    console.log(`[uws] listening on port ${DRAFT_WS_PORT}`);
  } else {
    console.error(`[uws] FAILED to listen on port ${DRAFT_WS_PORT}`);
    process.exit(1);
  }
});

// --- Single SIGTERM handler for both servers --------------------------------

let shuttingDown = false;

const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${signal}; stopping both servers...`);

  if (uwsListenSocket) {
    uWS.us_listen_socket_close(uwsListenSocket);
    uwsListenSocket = null;
    console.log('[shutdown] uWS listen socket closed');
  }

  honoServer.close((err) => {
    if (err) {
      console.error('[shutdown] hono close error:', err);
    } else {
      console.log('[shutdown] hono server closed');
    }
    console.log('[shutdown] clean exit');
    process.exit(0);
  });

  setTimeout(() => {
    console.error(`[shutdown] ${SHUTDOWN_TIMEOUT_MS}ms timeout exceeded; forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/**
 * Phase 4.5 chunk 11g.0 — uWS + Hono coexistence POC
 *
 * NOT DEPLOYABLE CODE. This file exists on the scratch branch
 * `chunk-11g-0-compat-evidence` only, as evidence that:
 *   1. uWebSockets.js installs into the existing server workspace
 *   2. Hono (port 3001) and uWS (port 3002) coexist in one Node process
 *   3. uWS WebSocket upgrade works against a typed handler
 *   4. TypeScript builds without configuration changes
 *
 * The real chunk 11g.1+ code lives in `server/src/draft/` per ADR-001.
 * This POC will be deleted (or renamed for use as test fixture) before
 * any of that lands.
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import uWS from 'uWebSockets.js';

// ── Hono on port 3001 — same shape as the real server uses ────────────
const honoApp = new Hono();
honoApp.get('/health', (c) => c.json({ ok: true, transport: 'http', port: 3001 }));

const honoServer = serve({ fetch: honoApp.fetch, port: 3001 }, (info) => {
  console.log(`[poc] hono listening on http://localhost:${info.port}`);
});

// ── uWS on port 3002 — separate uWS.App() with /health + /ws/echo ─────
const uwsApp = uWS.App();

uwsApp.get('/health', (res, _req) => {
  res.writeHeader('Content-Type', 'application/json').end(
    JSON.stringify({ ok: true, transport: 'http', port: 3002, server: 'uws' })
  );
});

interface EchoSocketUserData {
  connectedAt: number;
}

uwsApp.ws<EchoSocketUserData>('/ws/echo', {
  // Upgrade handler — runs before the WebSocket connection is accepted.
  // In the real engine this is where verifyDraftToken() will be called
  // (chunk 11g.2) — see audit doc § 4 for the middleware-coupling note.
  upgrade: (res, req, context) => {
    const secWebSocketKey = req.getHeader('sec-websocket-key');
    const secWebSocketProtocol = req.getHeader('sec-websocket-protocol');
    const secWebSocketExtensions = req.getHeader('sec-websocket-extensions');

    res.upgrade<EchoSocketUserData>(
      { connectedAt: Date.now() },
      secWebSocketKey,
      secWebSocketProtocol,
      secWebSocketExtensions,
      context,
    );
  },

  open: (ws) => {
    console.log('[poc][uws] client connected');
    ws.send(JSON.stringify({ type: 'hello', connectedAt: ws.getUserData().connectedAt }));
  },

  message: (ws, message, isBinary) => {
    // Echo back. The cork() call is uWS's batching hint per docs.
    ws.cork(() => ws.send(message, isBinary));
  },

  close: (_ws, code, _message) => {
    console.log(`[poc][uws] client disconnected (code=${code})`);
  },
});

uwsApp.listen(3002, (token) => {
  if (token) {
    console.log('[poc] uws listening on http://localhost:3002 (ws://localhost:3002/ws/echo)');
  } else {
    console.error('[poc] uws failed to listen on port 3002');
    process.exit(1);
  }
});

// ── Graceful shutdown on signals (matches existing server pattern) ────
function shutdown(signal: string) {
  console.log(`[poc][${signal}] shutting down`);
  honoServer.close();
  // uWS doesn't expose a shutdown call on uWS.App(); process.exit handles it.
  setTimeout(() => process.exit(0), 200).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

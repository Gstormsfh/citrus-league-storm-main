// scripts/proof/lib/ws-client.mjs
//
// Shared heartbeat-compliant WebSocket client for the proof + harness
// tooling (chunk 11g.10 sub-step 10c-2). Used by both `live-proof.mjs`
// and `draft-harness.mjs`.
//
// ── Heartbeat contract ───────────────────────────────────────────────
//
// The engine's reaper (`server/src/draft/heartbeat.ts` +
// `server/src/draft/uws-server.ts:344-388`) culls any connection with
// `now - lastPongAt > HEARTBEAT_PONG_TIMEOUT_MS` (default 30 s). The
// `lastPongAt` timestamp is updated exclusively by the server's
// `pong:` handler (`uws-server.ts:312-316`) firing on inbound WS
// protocol pong control frames. In production the browser client
// carries no heartbeat code — it relies on the server's own
// `sendPingsAutomatically: true` to fire pings, to which the browser
// auto-pongs (per RFC 6455). That mechanism was verifiably NOT firing
// during the 10c-1c/1d proof runs (see PROJECT_PLAN.md Decision Log
// 2026-07-27 "10c-1d incident closure" for evidence): the client saw
// zero `ping` events across 30+ seconds of idle, and the reaper culled
// with code 4002 at 39.3 s.
//
// This library uses a client-driven approach that does NOT depend on
// the server sending pings first: every `heartbeatIntervalMs` (default
// 10 s → 3× headroom vs the 30 s reaper), send an **unsolicited WS
// protocol pong** via `ws.pong()`. RFC 6455 §5.5.3 explicitly permits
// this as a unidirectional heartbeat, and the engine's `pong:` handler
// will call `recordPong(ws, Date.now())` on receipt regardless of
// whether the pong was solicited. Also send an application-level JSON
// `{type:"ping", ...}` message alongside — inert on the current engine
// (message handler warns on unknown types and moves on) but future-
// proof if the engine ever grows a message-driven liveness hook.
//
// ── ♥ telemetry ──────────────────────────────────────────────────────
//
// Every heartbeat action prints a dim one-line log so an operator
// parked at an interactive prompt (`live-proof.mjs`'s ARMED prompt)
// or reading harness output can visually confirm the connection is
// alive. Sent pongs, received pings, received pongs, and app-level
// heartbeats are all logged distinctly.

import { WebSocket } from 'ws';
import { randomUUID, createHmac } from 'node:crypto';

// ── Mint a draft-token JWT matching smoke-tokens-gen.js pattern ─────
// Claims: `sub` (userId), `draftId`/`leagueId` (both = the lobby id
// from the engine's WS URL), `iat`, `exp` (default +5 min), `iss`
// (`citrus-discovery`), `aud` (`citrus-draft-engine`). Signed HS256
// with `SUPABASE_JWT_SECRET`. Header + payload base64url-encoded per
// JWT spec.

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function mintDraftJwt({ leagueId, userId, jwtSecret, ttlSeconds = 300 }) {
  if (!leagueId) throw new Error('mintDraftJwt: leagueId required');
  if (!userId) throw new Error('mintDraftJwt: userId required');
  if (!jwtSecret) throw new Error('mintDraftJwt: jwtSecret required');
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: userId,
    draftId: leagueId,
    leagueId,
    iat: nowSec,
    exp: nowSec + ttlSeconds,
    iss: 'citrus-discovery',
    aud: 'citrus-draft-engine',
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', jwtSecret).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

// ── Heartbeat log formatting ─────────────────────────────────────────

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function heartbeatLog(label, extra = '') {
  const ts = new Date().toISOString();
  const line = extra
    ? `${DIM}♥ ${label} @ ${ts} ${extra}${RESET}`
    : `${DIM}♥ ${label} @ ${ts}${RESET}`;
  process.stdout.write(line + '\n');
}

// ── Connect a heartbeat-compliant client ─────────────────────────────
//
// Returns a Promise<DraftClient>. `DraftClient` exposes:
//   .ws                     — the underlying `ws` WebSocket instance
//   .clientLabel            — human-readable label for logs / results
//   .userId                 — JWT sub (deterministic per-client)
//   .snapshotReceivedAt     — epoch ms when snapshot-on-connect arrived
//   .frames                 — array of {ts, iso, raw, parsed} for every
//                             inbound frame after the initial snapshot
//   .close()                — clean shutdown; stops heartbeat + closes ws
//   .onEvent(cb)            — register a callback for `event`-type frames
//                             (cb receives {seq, frame, receivedAt})
//   .onError(cb)            — register a callback for ws errors
//   .waitForSnapshot()      — resolves when snapshot-on-connect arrives
//                             (or rejects on timeout / error)
//
// The heartbeat loop is client-driven and starts as soon as the WS
// `open` event fires; it stops on `close` or on `.close()`.

export function connectDraftClient({
  host,
  port,
  leagueId,
  userId,
  jwtSecret,
  clientLabel,
  heartbeatIntervalMs = 10_000,
  connectTimeoutMs = 10_000,
  silentHeartbeat = false, // set true in harness for many-client cases
  onEvent = null,
  onError = null,
  // F1 chunk (2026-07-28): scheme override so callers can hit the
  // TLS-terminating Caddy sidecar at wss://<domain>:443 instead of
  // plain ws://<vm-ip>:3002. Default stays 'ws' — plain ws remains
  // open through the tooling transition.
  scheme = 'ws',
}) {
  if (!host) throw new Error('connectDraftClient: host required');
  if (!port) throw new Error('connectDraftClient: port required');
  if (!leagueId) throw new Error('connectDraftClient: leagueId required');
  if (!userId) throw new Error('connectDraftClient: userId required');
  if (!jwtSecret) throw new Error('connectDraftClient: jwtSecret required');
  const label = clientLabel ?? `client-${userId.slice(0, 8)}`;

  const url = `${scheme}://${host}:${port}/ws/draft/${leagueId}`;
  const jwt = mintDraftJwt({ leagueId, userId, jwtSecret });

  const state = {
    ws: null,
    clientLabel: label,
    userId,
    snapshotReceivedAt: null,
    snapshotFrame: null,
    frames: [],
    heartbeatTimer: null,
    heartbeatCount: 0,
    closed: false,
    onEventCb: onEvent,
    onErrorCb: onError,
  };

  const startHeartbeat = () => {
    // Fire immediately on open so the very first heartbeat happens
    // within one WS round-trip of connection establishment — the
    // reaper's 30 s clock is running from initializeHeartbeat's stamp
    // at `open`, so getting our first pong in fast is defensive.
    const beat = () => {
      if (state.closed || state.ws.readyState !== WebSocket.OPEN) return;
      try {
        // (1) Unsolicited WS protocol pong — RFC 6455 §5.5.3. This
        //     is the primary heartbeat: the engine's pong: handler
        //     will call recordPong and refresh lastPongAt.
        state.ws.pong();
        // (2) Application-level JSON ping — inert on the current
        //     engine (handleClientMessage will warn on unknown type
        //     and move on), but future-proof if the engine grows a
        //     message-driven liveness hook without changing this lib.
        state.ws.send(
          JSON.stringify({ type: 'ping', t: Date.now(), src: label }),
        );
        state.heartbeatCount += 1;
        if (!silentHeartbeat) {
          heartbeatLog(`${label} pong+ping sent`, `#${state.heartbeatCount}`);
        }
      } catch (err) {
        heartbeatLog(`${label} heartbeat send threw`, err.message ?? String(err));
      }
    };
    beat(); // first heartbeat immediately
    state.heartbeatTimer = setInterval(beat, heartbeatIntervalMs);
    if (typeof state.heartbeatTimer.unref === 'function') {
      state.heartbeatTimer.unref();
    }
  };

  const stopHeartbeat = () => {
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
  };

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, jwt); // second arg = subprotocol per uws-server.ts:120+
    state.ws = ws;

    let snapshotResolved = false;
    const connectTimer = setTimeout(() => {
      if (snapshotResolved) return;
      snapshotResolved = true;
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error(
        `${label}: no snapshot-on-connect received within ${connectTimeoutMs} ms; ` +
        `check ${url} reachability and JWT validity`,
      ));
    }, connectTimeoutMs);

    ws.on('open', () => {
      startHeartbeat();
    });

    // Observability: any inbound protocol control frames get a ♥ line
    // so operators can see whether the server IS sending pings (the
    // sendPingsAutomatically path) or not. If ping events start firing
    // during a run, that's evidence the server-driven path is alive
    // and our client-driven heartbeat is belt-and-suspenders.
    ws.on('ping', () => {
      if (!silentHeartbeat) {
        heartbeatLog(`${label} received server ping (server-driven path IS firing)`);
      }
    });
    ws.on('pong', () => {
      if (!silentHeartbeat) {
        heartbeatLog(`${label} received pong (auto-response to our ping OR unsolicited)`);
      }
    });

    ws.on('message', (data) => {
      const receivedAt = Date.now();
      const iso = new Date(receivedAt).toISOString();
      const text = data.toString('utf8');
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* leave null */ }
      const frame = { ts: receivedAt, iso, raw: text, parsed };
      state.frames.push(frame);

      // Snapshot-on-connect gate: first frame with type='snapshot'
      // resolves the connect Promise.
      if (!snapshotResolved && parsed && parsed.type === 'snapshot') {
        snapshotResolved = true;
        clearTimeout(connectTimer);
        state.snapshotReceivedAt = receivedAt;
        state.snapshotFrame = frame;
        // Build the client-facing handle. Exposed API is intentionally
        // small; the underlying `ws` + `frames` array are also available
        // for tools that need low-level access (e.g. live-proof.mjs
        // prints raw frames in its capture output).
        const handle = {
          ws,
          clientLabel: label,
          userId,
          get snapshotReceivedAt() { return state.snapshotReceivedAt; },
          get snapshotFrame() { return state.snapshotFrame; },
          get frames() { return state.frames; },
          get heartbeatCount() { return state.heartbeatCount; },
          onEvent(cb) { state.onEventCb = cb; },
          onError(cb) { state.onErrorCb = cb; },
          close() {
            if (state.closed) return;
            state.closed = true;
            stopHeartbeat();
            try { ws.close(); } catch { /* ignore */ }
          },
        };
        resolve(handle);
        return;
      }

      // Post-snapshot: dispatch event frames to the registered callback.
      if (parsed && parsed.type === 'event' && state.onEventCb) {
        try {
          state.onEventCb({ seq: parsed.seq, frame, receivedAt });
        } catch (err) {
          heartbeatLog(`${label} onEvent callback threw`, err.message ?? String(err));
        }
      }
    });

    ws.on('error', (err) => {
      if (state.onErrorCb) {
        try { state.onErrorCb(err); } catch { /* ignore */ }
      }
      if (!snapshotResolved) {
        snapshotResolved = true;
        clearTimeout(connectTimer);
        reject(err);
      }
    });

    ws.on('close', (code, reason) => {
      state.closed = true;
      stopHeartbeat();
      if (!silentHeartbeat) {
        heartbeatLog(
          `${label} ws closed`,
          `code=${code} reason=${reason?.toString() || '<empty>'}`,
        );
      }
    });
  });
}

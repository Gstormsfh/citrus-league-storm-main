// Phase 4.5 chunk 11g.2 step 2 — JWT validation on uWS upgrade.
// Phase 4.5 chunk 11g.4 step 4 — LobbyRegistry wiring on open/close.
// Phase 4.5 chunk 11g.4 step 5 — JSON-aware message handler routes
// resync requests through `uws-helpers.handleClientMessage`. App is
// constructed in `index.ts` (not here) so its `publish` callback
// can also feed the LobbyRegistry — see uws-helpers.ts and
// LobbyManager.ts step-5 broadcast wiring.
// Phase 4.5 chunk 11g.7 sub-step 7d — WebSocket heartbeat for zombie
// connection cleanup. Hybrid uWS-native pings + application-level
// pong tracking + custom close code 4002. uWS handles ping emission
// (sendPingsAutomatically + idleTimeout=60 as defense-in-depth
// backstop); a server-wide soft-check timer scans
// `lobbyRegistry.forEachConnection` and force-closes anything whose
// last pong is older than HEARTBEAT_PONG_TIMEOUT_MS. See
// `heartbeat.ts` for the pure helpers and the architecture rationale.
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
import {
  HEARTBEAT_PONG_TIMEOUT_CLOSE_CODE,
  findTimedOutConnections,
  initializeHeartbeat,
  recordPong,
} from './heartbeat';

export interface UwsServerHandle {
  port: number;
  close: () => void;
  /**
   * Cancel the heartbeat soft-check timer (chunk 11g.7 sub-step 7d).
   * Called from the graceful-shutdown path in `index.ts` so the
   * scanner doesn't fire mid-shutdown and add noise to the SIGTERM
   * window. Idempotent — second call is a no-op.
   */
  stopHeartbeat: () => void;
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
  /**
   * Chunk 11g.10 sub-step 10c-2 join-path-robustness — gate (b)
   * predicate. Called after gate (a) shape-check passes and after
   * `verifyDraftToken` succeeds. Returns `'ready' | 'empty' | 'error'`
   * with three-way disambiguation MANDATORY per the Tuesday architect
   * ruling: `'empty'` closes 4400 (KNOWN not-configured), `'error'`
   * closes 1011 (retained defense-in-depth — DB blip, timeout, or
   * pool unavailable). Dependency-injected so this file stays
   * DB-agnostic; production implementation lives in `index.ts`.
   */
  isDraftInitialized: (leagueId: string) => Promise<'ready' | 'empty' | 'error'>;
}

// ── Pre-upgrade gates (chunk 11g.10 sub-step 10c-2) ──────────────────
//
// Custom close codes emitted after a `res.upgrade(...)` succeeds so
// the client's `onclose(code, reason)` observes the specific gate
// rejection. Client-side disposition mapping lives in
// `apps/web/src/lib/draftClient/closeCodes.ts`; regression tests in
// the sibling `__tests__/closeCodes.test.ts`.
//
//   - 4300 unauthorized_bad_shape — gate (a): `claims.sub` failed
//     UUIDv4 shape check. Should never fire for real browsers; exists
//     for probes + defense-in-depth against future token-issuer bugs.
//     Client disposition: `permanent_auth` (fresh auth is the only
//     legitimate remediation).
//   - 4400 draft_not_initialized — gate (b): `SELECT 1 FROM
//     draft_order WHERE league_id = $1 LIMIT 1` returned zero rows,
//     i.e. commissioner hasn't set up the draft yet. Client
//     disposition: `permanent_not_initialized` (no auto-reconnect,
//     distinct banner; manual RETRY NOW affordance stays).
//
// The pre-existing 1011 catch is retained (not replaced) as the
// defense-in-depth fallback for gate (b) 'error' returns, for
// `LobbyManager` construction failures downstream, and for any
// future race the gates don't anticipate.
const GATE_A_BAD_SHAPE_CLOSE_CODE = 4300;
const GATE_B_DRAFT_NOT_INITIALIZED_CLOSE_CODE = 4400;
const GATE_B_PRECHECK_ERROR_CLOSE_CODE = 1011;

// UUID v4 canonical shape. `claims.sub` is minted by `signDraftToken`
// (server/src/lib/draftToken.ts) from the authenticated user's
// Supabase `auth.uid()`, which is always a UUIDv4 in this project.
// Anything else in `sub` means either a probe / attacker, or a
// future token-issuer bug — either way, a UUIDv4 is the shape
// contract of every downstream consumer (`teams.owner_id`,
// `LobbyManager.userId`, RPC `p_actor.user_id`).
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Heartbeat configuration (chunk 11g.7 sub-step 7d) ────────────────
//
// Defaults: 30s ping interval (uWS-managed via sendPingsAutomatically
// + idleTimeout=60s backstop), 30s pong timeout (application-managed
// via the soft-check timer below). Both are env-overridable;
// vitest setup sets them to 0 to disable the timer entirely under
// tests. uWS rounds idleTimeout to 4s granularity (per uWS
// documentation), so 60 is the wall-clock backstop value.
const HEARTBEAT_PING_INTERVAL_MS = parseInt(
  process.env.HEARTBEAT_PING_INTERVAL_MS ?? '30000',
  10,
);
const HEARTBEAT_PONG_TIMEOUT_MS = parseInt(
  process.env.HEARTBEAT_PONG_TIMEOUT_MS ?? '30000',
  10,
);
// uWS idleTimeout in SECONDS (not ms) — twice the application-level
// ping interval so uWS only kills a connection if our soft-check
// timer has somehow failed to fire. Floor 4s (uWS minimum).
const UWS_IDLE_TIMEOUT_SECONDS = Math.max(
  4,
  Math.ceil((HEARTBEAT_PING_INTERVAL_MS * 2) / 1000),
);
// Soft-check cadence: every min(pongTimeoutMs/3, 10s). At default
// 30s pong timeout this fires every 10s — a zombie surfaces within
// ~10s of breaching, while CPU overhead stays negligible.
const HEARTBEAT_SCAN_INTERVAL_MS = Math.min(
  Math.max(1, Math.floor(HEARTBEAT_PONG_TIMEOUT_MS / 3)),
  10_000,
);

export function startUwsServer(opts: StartUwsServerOptions): Promise<UwsServerHandle> {
  const { port, app, lobbyRegistry, isDraftInitialized } = opts;
  return new Promise((resolve, reject) => {
    let listenSocket: unknown = null;
    let heartbeatTimer: NodeJS.Timeout | null = null;

    app.ws<DraftSocketUserData>('/ws/draft/:lobbyId', {
      // Chunk 11g.7 sub-step 7d: uWS handles ping emission internally
      // when sendPingsAutomatically=true; idleTimeout=60s is the
      // defense-in-depth backstop in case the application-level soft-
      // check timer somehow fails to fire. Browsers automatically pong
      // any incoming ping per the WebSocket spec, so the `pong` handler
      // below fires on whatever cadence uWS's internal scheduler emits.
      idleTimeout: UWS_IDLE_TIMEOUT_SECONDS,
      sendPingsAutomatically: true,

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
          .then(async (result) => {
            if (aborted) return;

            // Narrow via property-existence (`'claims' in result`) rather
            // than via the `ok` discriminator — narrowing on `result.ok`
            // is unreliable under server/tsconfig.json's `strict: false`
            // setting; `in`-based narrowing works in either mode.
            if ('claims' in result) {
              const { claims } = result;

              // ── Gate (a) shape check (chunk 11g.10 sub-step 10c-2) ──
              // Cheap sync check runs BEFORE the DB precheck so garbage
              // subs eat zero DB cost. `claims.sub` is a UUIDv4 in the
              // production issuer path; anything else is a probe /
              // attacker / future-issuer-bug — close with 4300.
              let closeAfterUpgrade: DraftSocketUserData['closeAfterUpgrade'];
              if (!UUID_V4_REGEX.test(claims.sub)) {
                structuredLogger.info('uws.upgrade.gate_a_bad_shape', {
                  lobbyId,
                  subLen: claims.sub.length,
                });
                closeAfterUpgrade = {
                  code: GATE_A_BAD_SHAPE_CLOSE_CODE,
                  reason: 'unauthorized_bad_shape',
                };
              } else {
                // ── Gate (b) DB precheck (chunk 11g.10 sub-step 10c-2) ─
                // Awaited predicate — the new abort window. `isDraftInitialized`
                // internally enforces the 1500ms overall timeout via
                // Promise.race and returns 'error' on timeout / query
                // failure. Three-way disambiguation is MANDATORY: only
                // 'empty' produces 4400; 'error' falls through to 1011
                // (retained defense-in-depth) so DB blips never tell
                // real users the draft "isn't set up."
                const precheck = await isDraftInitialized(claims.leagueId);

                // ── ABORT RE-CHECK (mirrors line 164 / 210 pattern) ────
                // The predicate await is the ONLY new abort window
                // introduced by this chunk. If the client disconnected
                // while the SELECT was in flight, `res` may have been
                // recycled by uWS; every downstream `res.cork(...)` or
                // `res.upgrade(...)` would be a use-after-free.
                if (aborted) return;

                if (precheck === 'empty') {
                  structuredLogger.info('uws.upgrade.gate_b_not_initialized', {
                    lobbyId,
                    leagueId: claims.leagueId,
                  });
                  closeAfterUpgrade = {
                    code: GATE_B_DRAFT_NOT_INITIALIZED_CLOSE_CODE,
                    reason: 'draft_not_initialized',
                  };
                } else if (precheck === 'error') {
                  structuredLogger.warn('uws.upgrade.gate_b_precheck_error', {
                    lobbyId,
                    leagueId: claims.leagueId,
                  });
                  closeAfterUpgrade = {
                    code: GATE_B_PRECHECK_ERROR_CLOSE_CODE,
                    reason: 'draft_precheck_error',
                  };
                }
              }

              structuredLogger.debug('uws.upgrade.accepted', {
                lobbyId,
                userId: claims.sub,
                closeAfterUpgradeCode: closeAfterUpgrade?.code,
              });
              res.cork(() => {
                res.upgrade(
                  {
                    lobbyId,
                    userId: claims.sub,
                    leagueId: claims.leagueId,
                    draftId: claims.draftId,
                    expiresAt: claims.exp,
                    // Chunk 11g.7 sub-step 7d: lastPongAt is stamped
                    // properly in the open handler (`Date.now()` is
                    // not safely callable from inside a uWS upgrade
                    // cork). Initialized to 0 here as a placeholder;
                    // overwritten before any soft-check scan can see it.
                    lastPongAt: 0,
                    // Chunk 11g.10 sub-step 10c-2: if either gate
                    // failed, `open` reads this marker and closes the
                    // WS immediately with the specific code. Absent
                    // (undefined) means proceed normally.
                    closeAfterUpgrade,
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
        const { lobbyId, userId, leagueId, closeAfterUpgrade } = userData;

        // Chunk 11g.10 sub-step 10c-2 join-path-robustness — if either
        // pre-upgrade gate failed, the upgrade succeeded ONLY so we
        // could deliver a distinguishable close code to the client
        // (`ws.onclose` observes 4300 / 4400 / 1011). Close the WS
        // immediately without touching heartbeat state or the
        // LobbyRegistry — this connection is not a real participant.
        if (closeAfterUpgrade) {
          structuredLogger.info('uws.connection.rejected_post_upgrade', {
            lobbyId,
            userId,
            leagueId,
            code: closeAfterUpgrade.code,
            reason: closeAfterUpgrade.reason,
          });
          try {
            ws.end(closeAfterUpgrade.code, closeAfterUpgrade.reason);
          } catch (closeErr) {
            structuredLogger.debug(
              'uws.ws_end_threw_after_gate_rejection',
              { lobbyId, code: closeAfterUpgrade.code },
            );
            void closeErr;
          }
          return;
        }

        // Chunk 11g.7 sub-step 7d: stamp lastPongAt before any
        // soft-check scan can observe this connection. Initialization
        // happens here (post-upgrade) rather than in the upgrade
        // handler because Date.now() inside the upgrade cork can race
        // against scan cadence — initialization in `open` runs on the
        // uWS event loop thread that also drives the scan timer.
        initializeHeartbeat(ws, Date.now());
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

      // Chunk 11g.7 sub-step 7d: pong handler updates lastPongAt so
      // the soft-check scanner can recognize this connection as alive.
      // DEBUG-level logging only (production noise floor is INFO+);
      // healthy connections pong on uWS's internal cadence and we
      // don't need an info-level entry per pong.
      pong: (ws) => {
        recordPong(ws, Date.now());
        const { lobbyId, userId } = ws.getUserData();
        structuredLogger.debug('heartbeat.pong_received', { lobbyId, userId });
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

    // ── Heartbeat soft-check timer (chunk 11g.7 sub-step 7d) ──
    //
    // Runs every HEARTBEAT_SCAN_INTERVAL_MS, snapshots all connections
    // across all lobbies, and force-closes anything whose lastPongAt
    // is older than HEARTBEAT_PONG_TIMEOUT_MS. Setting either env to 0
    // disables the timer entirely (vitest setup default — tests don't
    // want a setInterval running under fake timers).
    //
    // Logging volume: pong_timeout is the only INFO+ event (warn
    // level — alert-worthy if frequency spikes). Scan start/complete
    // are debug-only and suppressed at production INFO+.
    if (HEARTBEAT_PONG_TIMEOUT_MS > 0 && HEARTBEAT_SCAN_INTERVAL_MS > 0) {
      heartbeatTimer = setInterval(() => {
        const now = Date.now();
        // Snapshot all WSes from the registry. forEachConnection
        // snapshots each lobby's connection map at iteration-start,
        // so force-closing a connection mid-scan (which triggers a
        // synchronous removeConnection on the close handler) is safe.
        const candidates: Array<uWS.WebSocket<DraftSocketUserData>> = [];
        lobbyRegistry.forEachConnection((ws) => {
          candidates.push(ws);
        });
        // ── Chunk 10c-2 batch 3 C1 — server-initiated ping floor ──
        //
        // The scanner now BOTH pings every connection AND culls timeouts
        // in a single pass. Prior state: `sendPingsAutomatically: true`
        // was set on the app.ws config (line 128) as a backstop, but
        // uWS's built-in scheduler fired inconsistently under our
        // observed workload (evidence: the S5 proof debugging window
        // saw zero server-initiated pings for minutes at a time; the
        // client shim in `scripts/proof/lib/ws-client.mjs` was added
        // to work around it). Explicit `ws.ping()` at the scan cadence
        // gives us a hard ≤10s ping guarantee independent of uWS's
        // internal timer.
        //
        // Browsers auto-respond to protocol pings with pongs per RFC
        // 6455 §5.5.2; the `pong:` handler at line 312 refreshes
        // `lastPongAt`; the cull below still runs on the >30s stale
        // window. Combined effect: healthy connections stay
        // continuously alive without the client having to do anything
        // (matches the "no app-level heartbeat needed in browsers"
        // production reality); genuinely dead connections still cull.
        //
        // Errors from `ws.ping()` (connection closing race) are
        // swallowed at DEBUG — the pong-timeout scanner will cull
        // whatever's left.
        for (const ws of candidates) {
          try {
            ws.ping();
          } catch (err) {
            structuredLogger.debug('heartbeat.ping_threw', {});
            void err;
          }
        }
        const timedOut = findTimedOutConnections(candidates, now, {
          pongTimeoutMs: HEARTBEAT_PONG_TIMEOUT_MS,
        });
        if (timedOut.length === 0) {
          structuredLogger.debug('heartbeat.scan_completed', {
            connectionsScanned: candidates.length,
            timedOut: 0,
            pingsSent: candidates.length,
          });
          return;
        }
        for (const entry of timedOut) {
          structuredLogger.warn('heartbeat.pong_timeout', {
            lobbyId: entry.lobbyId,
            userId: entry.userId,
            lastPongAgeMs: entry.lastPongAgeMs,
            pongTimeoutMs: HEARTBEAT_PONG_TIMEOUT_MS,
          });
          try {
            entry.ws.end(HEARTBEAT_PONG_TIMEOUT_CLOSE_CODE, 'pong_timeout');
          } catch (err) {
            // ws may already be closed if the close happened
            // concurrently with the scan; swallow + log.
            structuredLogger.debug('heartbeat.ws_end_threw', {
              lobbyId: entry.lobbyId,
              userId: entry.userId,
            });
            void err;
          }
        }
        structuredLogger.debug('heartbeat.scan_completed', {
          connectionsScanned: candidates.length,
          timedOut: timedOut.length,
          pingsSent: candidates.length,
        });
      }, HEARTBEAT_SCAN_INTERVAL_MS);
      // unref() so the timer doesn't keep the Node event loop alive
      // on its own (e.g., during graceful shutdown after listenSocket
      // is closed but before stopHeartbeat fires).
      heartbeatTimer.unref();
      structuredLogger.info('heartbeat.timer_started', {
        scanIntervalMs: HEARTBEAT_SCAN_INTERVAL_MS,
        pongTimeoutMs: HEARTBEAT_PONG_TIMEOUT_MS,
        uwsIdleTimeoutSeconds: UWS_IDLE_TIMEOUT_SECONDS,
      });
    } else {
      structuredLogger.info('heartbeat.timer_disabled', {
        pongTimeoutMs: HEARTBEAT_PONG_TIMEOUT_MS,
        scanIntervalMs: HEARTBEAT_SCAN_INTERVAL_MS,
      });
    }

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        structuredLogger.info('heartbeat.timer_stopped', {});
      }
    };

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
          stopHeartbeat,
        });
      } else {
        const err = new Error(`[uws] FAILED to listen on port ${port}`);
        structuredLogger.error('uws.listen_failed', { port }, err);
        // Failed to bind — cancel the heartbeat we just started so
        // it doesn't keep firing for a never-listening server.
        stopHeartbeat();
        reject(err);
      }
    });
  });
}

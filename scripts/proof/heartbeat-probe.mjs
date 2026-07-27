#!/usr/bin/env node
// scripts/proof/heartbeat-probe.mjs
//
// Chunk 10c-2 batch 3 C1 acceptance tooling — verifies the engine's
// B-floor heartbeat behavior end-to-end.
//
// Two modes exercise the two ends of the design contract:
//
//   --mode=browser-sim  (default)
//     ws default autoPong=true, NO app-level pings/pongs sent by the
//     probe. The engine's server-initiated ping floor MUST keep the
//     connection alive indefinitely. Success criteria: probe survives
//     for >120 s of pure idle without close-code 4002 (or any close).
//     This mimics real browsers: they auto-pong protocol pings but
//     never send app-level heartbeats.
//
//   --mode=dead-sim
//     autoPong disabled AND no app-level pings. The engine's server
//     pings arrive but nobody responds; the engine's cull path
//     (`heartbeat.pong_timeout` scanner in `uws-server.ts:344+`) MUST
//     force-close with code 4002 within ~30-40 s. Proves the cull
//     mechanism still fires post-C1 change (regression lock — B-floor
//     didn't accidentally disable the reaper).
//
// Both modes emit the observed WS lifecycle events (open, ping, pong,
// message, close) to stdout with client-clock timestamps so the
// operator can grep and diff the output against the engine's log
// grep (`heartbeat.scan_completed`, `heartbeat.pong_timeout`).
//
// Not intended for CI — this is an interactive verification tool.
// Two-minute browser-sim run is short enough for one-shot ratification.
//
// Usage (PowerShell):
//   $env:SUPABASE_JWT_SECRET = (gcloud secrets versions access latest `
//     --secret=SUPABASE_JWT_SECRET --project=citrus-fantasy-staging)
//   node scripts/proof/heartbeat-probe.mjs --mode=browser-sim
//   node scripts/proof/heartbeat-probe.mjs --mode=dead-sim
//
// Optional:
//   --host=HOST        (default 35.203.89.236)
//   --port=N           (default 3002)
//   --league=UUID      (default the canonical 4e4e Staging League)
//   --duration-ms=N    (default 130000 for browser-sim; 60000 for dead-sim)
//   --verbose          (log every ping/pong; default logs a summary tick every 10s)

import { WebSocket } from 'ws';
import { randomUUID, createHmac } from 'node:crypto';

// ── CLI ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const MODE = opt('mode', 'browser-sim');
const HOST = opt('host', '35.203.89.236');
const PORT = Number(opt('port', '3002'));
const LEAGUE_ID = opt('league', '993c9219-ecbf-4e4e-9fb0-e9837e1bded3');
const DEFAULT_DURATION = MODE === 'dead-sim' ? 60_000 : 130_000;
const DURATION_MS = Number(opt('duration-ms', String(DEFAULT_DURATION)));
const VERBOSE = flag('verbose');

if (!['browser-sim', 'dead-sim'].includes(MODE)) {
  console.error(`FATAL: unknown --mode=${MODE} (expected browser-sim | dead-sim).`);
  process.exit(2);
}

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: SUPABASE_JWT_SECRET not set in environment.');
  console.error('       Set via: $env:SUPABASE_JWT_SECRET = (gcloud secrets versions access latest --secret=SUPABASE_JWT_SECRET --project=citrus-fantasy-staging)');
  process.exit(2);
}

// ── JWT mint (matches scripts/proof/lib/ws-client.mjs pattern) ─────
function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
/**
 * Generate a valid UUIDv4 string with all leading nibbles pinned to
 * `9`s so probe connections stay identifiable in engine logs. Kept in
 * the recognizable "99999999-9999-4999-8999-<random 12 hex>" range
 * (the `4` in position 13 marks version 4; the `8` in position 17
 * marks variant 1 — RFC 4122 compliant).
 *
 * Fixes the 2026-07-28 bug where `probe-<uuid>` (a non-UUID string)
 * passed the engine's JWT signature check but caused the LobbyManager
 * downstream to fail ~250 ms later during connection setup, producing
 * a 1011 server_error close on every probe run. See PROJECT_PLAN.md
 * Decision Log 2026-07-28 "Probe patch + hardening ledger" entry.
 */
function probeUserId() {
  // 12 random hex chars for the node component.
  const hex = randomUUID().replace(/-/g, '').slice(0, 12);
  return `99999999-9999-4999-8999-${hex}`;
}

function mintDraftJwt(leagueId) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  // TTL: DURATION_MS + 60s slack so the JWT never expires mid-probe.
  const ttlSec = Math.ceil(DURATION_MS / 1000) + 60;
  const payload = {
    // Probe sub is a valid UUIDv4 in the recognizable 99999999- range
    // so downstream engine code (LobbyManager, presence, snapshot
    // sender) doesn't 1011 on an unparseable UUID mid-connection-setup.
    // See PROJECT_PLAN.md Decision Log 2026-07-28 for the bug details.
    sub: probeUserId(),
    draftId: leagueId,
    leagueId,
    iat: nowSec,
    exp: nowSec + ttlSec,
    iss: 'citrus-discovery',
    aud: 'citrus-draft-engine',
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', JWT_SECRET).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

// ── Banner ──────────────────────────────────────────────────────────
const wsUrl = `ws://${HOST}:${PORT}/ws/draft/${LEAGUE_ID}`;
console.log('');
console.log('╔═══════════════════════════════════════════════════════════════════════╗');
console.log('║  10c-2 batch 3 C1 — heartbeat B-floor probe                          ║');
console.log('╠═══════════════════════════════════════════════════════════════════════╣');
console.log(`║  Mode:           ${MODE.padEnd(52)} ║`);
console.log(`║  WS target:      ${wsUrl.padEnd(52)} ║`);
console.log(`║  Duration:       ${(DURATION_MS + ' ms').padEnd(52)} ║`);
if (MODE === 'browser-sim') {
  console.log('║  Expected:       Survive to duration end without close             ║');
} else {
  console.log('║  Expected:       Force-closed with code 4002 within 30-40 s         ║');
}
console.log('╚═══════════════════════════════════════════════════════════════════════╝');
console.log('');

// ── State ──────────────────────────────────────────────────────────
const startMs = Date.now();
let pingCount = 0;
let pongCount = 0;
let messageCount = 0;
let firstOpenMs = null;
let closeCode = null;
let closeReason = null;
let closeMs = null;

function iso() {
  return new Date().toISOString();
}
function elapsedSec() {
  return ((Date.now() - startMs) / 1000).toFixed(1);
}

// ── Connect ────────────────────────────────────────────────────────
const jwt = mintDraftJwt(LEAGUE_ID);
const wsOpts = {};
if (MODE === 'dead-sim') {
  // ws v8.6+: autoPong=false disables the library's protocol-pong
  // response to incoming pings. Engine's server-initiated pings will
  // still arrive but our probe never pongs. Cull expected at 30-40s.
  wsOpts.autoPong = false;
}
const ws = new WebSocket(wsUrl, jwt, wsOpts);

// ── Handlers ───────────────────────────────────────────────────────
ws.on('open', () => {
  firstOpenMs = Date.now();
  console.log(`[${iso()}]  +${elapsedSec()}s  open  (autoPong=${MODE === 'browser-sim' ? 'true' : 'false'})`);
});

ws.on('ping', (data) => {
  pingCount += 1;
  if (VERBOSE) {
    console.log(`[${iso()}]  +${elapsedSec()}s  ← ping received  (#${pingCount})  payload=${data ? data.length + 'B' : 'empty'}`);
  }
  // Note: in browser-sim mode ws library auto-sends a pong response
  // BEFORE the ping event fires (default behavior). In dead-sim mode
  // autoPong=false is set at connect time so no pong goes back.
});

ws.on('pong', () => {
  pongCount += 1;
  if (VERBOSE) {
    console.log(`[${iso()}]  +${elapsedSec()}s  ← pong received  (#${pongCount})`);
  }
});

ws.on('message', (data) => {
  messageCount += 1;
  const text = data.toString('utf8').slice(0, 120);
  console.log(`[${iso()}]  +${elapsedSec()}s  ← message #${messageCount}  ${text}${text.length >= 120 ? '…' : ''}`);
});

ws.on('error', (err) => {
  console.error(`[${iso()}]  +${elapsedSec()}s  ✗ error  ${err.message}`);
});

ws.on('close', (code, reason) => {
  closeCode = code;
  closeReason = reason?.toString() ?? '';
  closeMs = Date.now();
  const closeElapsedSec = ((closeMs - startMs) / 1000).toFixed(1);
  console.log('');
  console.log(`[${iso()}]  +${closeElapsedSec}s  ✗ CLOSE  code=${code}  reason=${closeReason || '<empty>'}`);
  console.log('');
  // Finalize + verdict logged in the finish() block after the
  // duration timer OR here if close happened first.
  finish();
});

// ── Periodic status tick (non-verbose default) ─────────────────────
if (!VERBOSE) {
  const tick = setInterval(() => {
    if (closeMs !== null) {
      clearInterval(tick);
      return;
    }
    console.log(`[${iso()}]  +${elapsedSec()}s  status  pings=${pingCount}  pongs=${pongCount}  messages=${messageCount}  open=${ws.readyState === WebSocket.OPEN}`);
  }, 10_000);
  tick.unref();
}

// ── Timeout / finish ───────────────────────────────────────────────
setTimeout(() => {
  if (closeMs === null) {
    // Still open at duration end. Close cleanly and finish.
    try { ws.close(); } catch { /* ignore */ }
    setTimeout(() => finish(), 500);
  }
}, DURATION_MS);

let finished = false;
function finish() {
  if (finished) return;
  finished = true;

  const totalSec = ((closeMs !== null ? closeMs : Date.now()) - startMs) / 1000;
  const durationSec = DURATION_MS / 1000;
  const openSec = firstOpenMs !== null ? ((closeMs !== null ? closeMs : Date.now()) - firstOpenMs) / 1000 : 0;

  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║  RESULT                                                              ║');
  console.log('╠═══════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Total elapsed:   ${totalSec.toFixed(1).padEnd(52)}s║`);
  console.log(`║  Time open:       ${openSec.toFixed(1).padEnd(52)}s║`);
  console.log(`║  Pings received:  ${String(pingCount).padEnd(53)}║`);
  console.log(`║  Pongs received:  ${String(pongCount).padEnd(53)}║`);
  console.log(`║  Messages:        ${String(messageCount).padEnd(53)}║`);
  console.log(`║  Close code:      ${(closeCode === null ? 'still open at end' : String(closeCode)).padEnd(53)}║`);
  console.log(`║  Close reason:    ${(closeReason ?? '<n/a>').padEnd(53)}║`);
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // ── Verdict ──────────────────────────────────────────────────────
  let ok;
  let reason;
  if (MODE === 'browser-sim') {
    // Success = still open at end (no close code) AND at least one
    // ping received (proves the server-initiated ping floor fires).
    if (closeCode !== null) {
      ok = false;
      reason = `expected connection to survive to ${durationSec}s idle but closed at ${totalSec.toFixed(1)}s with code=${closeCode}`;
    } else if (pingCount === 0) {
      ok = false;
      reason = `no server-initiated pings received in ${totalSec.toFixed(1)}s — B-floor is NOT firing`;
    } else {
      ok = true;
      reason = `survived ${totalSec.toFixed(1)}s idle with ${pingCount} ping(s) received — B-floor is firing`;
    }
  } else {
    // dead-sim: success = closed with code 4002 within ~30-40s.
    if (closeCode !== 4002) {
      ok = false;
      reason = `expected close code 4002 (pong_timeout) but got ${closeCode ?? 'no close'} at ${totalSec.toFixed(1)}s`;
    } else if (totalSec > 60) {
      ok = false;
      reason = `close code 4002 correct but timing (${totalSec.toFixed(1)}s) exceeds cull window (30-40s expected, 60s tolerance)`;
    } else if (totalSec < 10) {
      ok = false;
      reason = `close fired too fast (${totalSec.toFixed(1)}s) — cull window should be 30-40s`;
    } else {
      ok = true;
      reason = `culled at ${totalSec.toFixed(1)}s with code 4002 as expected`;
    }
  }

  console.log(ok ? `✓ PASS  ${reason}` : `✗ FAIL  ${reason}`);
  console.log('');
  console.log('Next: correlate with engine logs (via VM SSH):');
  console.log(`  sudo docker logs citrus-draft-engine 2>&1 | grep -E 'heartbeat\\.(scan_completed|pong_timeout|ping)' | tail -20`);
  console.log('');
  process.exit(ok ? 0 : 1);
}

#!/usr/bin/env node
// scripts/proof/heartbeat-probe.mjs
//
// Chunk 10c-2 batch 3 acceptance tooling — verifies the engine's
// B-floor heartbeat behavior (C1) end-to-end AND the join-path-
// robustness gates (chunk pending architect ratification; probe modes
// added 2026-07-28 so acceptance is fully mechanized when the chunk
// lands).
//
// FOUR modes:
//
//   --mode=browser-sim  (default) — C1 acceptance
//     ws default autoPong=true, NO app-level pings/pongs sent by the
//     probe. The engine's server-initiated ping floor MUST keep the
//     connection alive indefinitely. Success criteria: probe survives
//     for >120 s of pure idle without close-code 4002 (or any close).
//     This mimics real browsers: they auto-pong protocol pings but
//     never send app-level heartbeats.
//
//   --mode=dead-sim — C1 acceptance
//     autoPong disabled AND no app-level pings. The engine's server
//     pings arrive but nobody responds; the engine's cull path
//     (`heartbeat.pong_timeout` scanner in `uws-server.ts:344+`) MUST
//     force-close with code 4002 within ~30-40 s. Proves the cull
//     mechanism still fires post-C1 change (regression lock — B-floor
//     didn't accidentally disable the reaper).
//
//   --mode=uninitialized — join-path-robustness gate (b) acceptance
//     Connects to the whitelisted league AFTER fixture reset (zero
//     draft_order rows). Expects clean close code 4400
//     (draft_not_initialized) within ~1 s. Pre-deployment this mode
//     gets 1011 (the current `server/src/draft/index.ts:387-392`
//     throw path); post-deployment 4400. Fences the empty-order 1011
//     regression class forever.
//
//   --mode=bad-sub — join-path-robustness gate (a) acceptance
//     Mints a deliberately non-UUID sub (the ORIGINAL 2026-07-28
//     probe bug, resurrected as a test). Expects clean close code
//     4300 (unauthorized_bad_shape) at upgrade time, BEFORE any
//     `uws.connection.opened` log entry. Pre-deployment gets 1011;
//     post-deployment 4300. Fences the bad-sub regression class.
//
// Field acceptance trio for the join-path-robustness chunk:
//   1. bad-sub → 4300
//   2. uninitialized → 4400
//   3. browser-sim (against a properly set-up league) → survives
//      (unchanged from batch 3 baseline)
//
// All modes emit observed WS lifecycle events (open, ping, pong,
// message, close) with client-clock timestamps so the operator can
// grep and diff against engine logs.
//
// Not intended for CI — interactive verification tool.
//
// Usage (PowerShell):
//   $env:SUPABASE_JWT_SECRET = (gcloud secrets versions access latest `
//     --secret=SUPABASE_JWT_SECRET --project=citrus-fantasy-staging)
//   node scripts/proof/heartbeat-probe.mjs --mode=browser-sim
//   node scripts/proof/heartbeat-probe.mjs --mode=dead-sim
//   node scripts/proof/heartbeat-probe.mjs --mode=uninitialized
//   node scripts/proof/heartbeat-probe.mjs --mode=bad-sub
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
// F1 chunk (2026-07-28): scheme override for WSS acceptance against
// the TLS-terminating Caddy sidecar. Plain ws:// stays default for
// backward compat during the tooling transition. Example:
//   node heartbeat-probe.mjs --scheme=wss --host=draft-staging.citrusfantasysports.com --port=443
const SCHEME = opt('scheme', 'ws');
const LEAGUE_ID = opt('league', '993c9219-ecbf-4e4e-9fb0-e9837e1bded3');
// Chunk 10c-2 batch 3 join-path-robustness acceptance modes (added
// 2026-07-28): `uninitialized` and `bad-sub` exercise the two new
// pre-upgrade gates the chunk introduces. Both expect a fast reject
// (< 1 s in practice — the gates fire before or during the upgrade
// handshake). Default duration is 5 s: comfortably exceeds expected
// reject time while keeping the acceptance suite fast.
const DEFAULT_DURATION_BY_MODE = {
  'browser-sim': 130_000,
  'dead-sim': 60_000,
  'uninitialized': 5_000,
  'bad-sub': 5_000,
};
const DURATION_MS = Number(
  opt('duration-ms', String(DEFAULT_DURATION_BY_MODE[MODE] ?? 130_000)),
);
const VERBOSE = flag('verbose');

const VALID_MODES = ['browser-sim', 'dead-sim', 'uninitialized', 'bad-sub'];
if (!VALID_MODES.includes(MODE)) {
  console.error(`FATAL: unknown --mode=${MODE} (expected one of ${VALID_MODES.join(' | ')}).`);
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

/**
 * Chunk 10c-2 batch 3 join-path-robustness acceptance (added
 * 2026-07-28): deliberately non-UUID sub for the `bad-sub` acceptance
 * mode. Same shape as the ORIGINAL probe bug (`probe-<uuid>`) so
 * running this mode fences the earlier regression class forever.
 *
 * When the join-path-robustness chunk lands, gate (a) at the WS
 * upgrade path (`uws-server.ts` post-`verifyDraftToken` in-cork
 * check per the ratified async-upgrade guard checklist) rejects
 * this shape with a `4300 unauthorized_bad_shape` close BEFORE
 * the connection is accepted, BEFORE the `uws.connection.opened`
 * log entry, and BEFORE any downstream LobbyManager code runs.
 * PASS = 4300 close code observed.
 */
function badSubUserId() {
  return `probe-${randomUUID()}`;
}

function mintDraftJwt(leagueId, subOverride = null) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  // TTL: DURATION_MS + 60s slack so the JWT never expires mid-probe.
  const ttlSec = Math.ceil(DURATION_MS / 1000) + 60;
  const payload = {
    // Probe sub is a valid UUIDv4 in the recognizable 99999999- range
    // so downstream engine code (LobbyManager, presence, snapshot
    // sender) doesn't 1011 on an unparseable UUID mid-connection-setup.
    // See PROJECT_PLAN.md Decision Log 2026-07-28 for the bug details.
    //
    // The `bad-sub` acceptance mode passes a `subOverride` to
    // deliberately reproduce the original bug shape and exercise
    // gate (a) of the join-path-robustness chunk (4300 close).
    sub: subOverride ?? probeUserId(),
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
const EXPECTED_BY_MODE = {
  'browser-sim': 'Survive to duration end without close',
  'dead-sim': 'Force-closed with code 4002 within 30-40 s',
  'uninitialized': 'Force-closed with code 4400 (draft_not_initialized) within ~1 s',
  'bad-sub': 'Force-closed with code 4300 (unauthorized_bad_shape) at upgrade time',
};
const wsUrl = `${SCHEME}://${HOST}:${PORT}/ws/draft/${LEAGUE_ID}`;
console.log('');
console.log('╔═══════════════════════════════════════════════════════════════════════╗');
console.log('║  10c-2 batch 3 — heartbeat + join-path-robustness probe              ║');
console.log('╠═══════════════════════════════════════════════════════════════════════╣');
console.log(`║  Mode:           ${MODE.padEnd(52)} ║`);
console.log(`║  WS target:      ${wsUrl.padEnd(52)} ║`);
console.log(`║  Duration:       ${(DURATION_MS + ' ms').padEnd(52)} ║`);
console.log(`║  Expected:       ${(EXPECTED_BY_MODE[MODE] ?? '(unspecified)').padEnd(52)} ║`);
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
// Chunk 10c-2 batch 3 join-path-robustness (2026-07-28): `bad-sub`
// deliberately mints a non-UUID sub to exercise gate (a); every
// other mode uses the standard probe UUIDv4.
const subOverride = MODE === 'bad-sub' ? badSubUserId() : null;
const jwt = mintDraftJwt(LEAGUE_ID, subOverride);
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
//
// Chunk 10c-2 batch 3 field-run fix (2026-07-28): reaching the
// duration timer with the WS still open = PASS in browser-sim. The
// prior code called ws.close() FIRST which triggered a 1005 close
// event; by the time finish() ran, closeCode was 1005 and the
// verdict logic flagged FAIL. Fix: set `probeReachedDurationEnd`
// BEFORE the self-close so finish() knows the close was our own,
// not the engine's. Field evidence: 130s run with 13 pings + engine
// log confirmed zero pong_timeout for that userId, but the probe
// stamped ✗ FAIL on its own 1005 self-close.
let probeReachedDurationEnd = false;
setTimeout(() => {
  if (closeMs === null) {
    // Still open at duration end. Mark the intent BEFORE self-closing
    // so the close handler + finish() can distinguish our clean end
    // from a server-initiated close.
    probeReachedDurationEnd = true;
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
    // Chunk 10c-2 batch 3 field-run fix (2026-07-28): evaluate PASS
    // BEFORE the probe's own duration-end self-close. Only
    // server-initiated closes count as browser-sim failures.
    //
    // Verdict order:
    //   1. Reached duration end + received ≥1 ping → PASS
    //      (regardless of close code — 1005 from our own ws.close()
    //      is expected and NOT a failure signal).
    //   2. Reached duration end + zero pings → FAIL (B-floor not firing)
    //   3. Closed BEFORE duration end + server code → FAIL (unexpected)
    //   4. Anything else → FAIL (defensive default)
    if (probeReachedDurationEnd && pingCount >= 1) {
      ok = true;
      reason = `survived ${openSec.toFixed(1)}s open with ${pingCount} ping(s) received — B-floor is firing (probe self-closed with code=${closeCode ?? 'still open'})`;
    } else if (probeReachedDurationEnd && pingCount === 0) {
      ok = false;
      reason = `probe reached ${openSec.toFixed(1)}s open but received zero server-initiated pings — B-floor is NOT firing`;
    } else if (closeCode !== null) {
      // Server-initiated close BEFORE duration end.
      ok = false;
      reason = `unexpected close at ${totalSec.toFixed(1)}s (before ${durationSec}s duration end) with code=${closeCode} reason=${closeReason || '<empty>'} — probe pings=${pingCount}`;
    } else {
      ok = false;
      reason = `probe finished in indeterminate state (no close event, no duration-end mark) at ${totalSec.toFixed(1)}s — investigate`;
    }
  } else if (MODE === 'dead-sim') {
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
  } else if (MODE === 'uninitialized') {
    // Chunk 10c-2 join-path-robustness gate (b) acceptance:
    //   Expected: WS closed with code 4400 (draft_not_initialized)
    //   within ~1 s of the connect attempt. The gate runs a cheap
    //   pre-upgrade SELECT against draft_order and rejects when
    //   empty. Before the chunk lands, this mode yields 1011
    //   (server_error from the existing throw at
    //   `server/src/draft/index.ts:387-392` — see prior Decision
    //   Log entry) which registers as FAIL. After the chunk lands
    //   the mode yields 4400 as expected → PASS.
    //
    //   1011 today = pre-deployment state, EXPECTED to fail until
    //   the join-path-robustness chunk ships.
    if (closeCode === 4400) {
      ok = true;
      reason = `gate (b) fired: 4400 draft_not_initialized close at ${totalSec.toFixed(1)}s — chunk deployed and working`;
    } else if (closeCode === 1011) {
      ok = false;
      reason = `got 1011 server_error at ${totalSec.toFixed(1)}s — pre-deployment state (join-path-robustness chunk not shipped yet)`;
    } else if (closeCode === null) {
      ok = false;
      reason = `no close by duration end (${durationSec}s) — gate (b) may not be firing OR the fixture has draft_order rows (should be zero for this mode)`;
    } else {
      ok = false;
      reason = `expected close code 4400 (draft_not_initialized) but got ${closeCode} reason=${closeReason || '<empty>'} at ${totalSec.toFixed(1)}s`;
    }
  } else if (MODE === 'bad-sub') {
    // Chunk 10c-2 join-path-robustness gate (a) acceptance:
    //   Expected: WS closed with code 4300 (unauthorized_bad_shape)
    //   at upgrade time, BEFORE the `uws.connection.opened` log
    //   entry would fire. Gate (a) runs a post-verifyDraftToken
    //   UUID-shape check on `claims.sub` and rejects non-UUIDv4
    //   values. Same 1011-pre-deployment story as gate (b).
    //
    //   Additional PASS criterion: firstOpenMs should be null
    //   (upgrade never accepted → no ws.on('open') fired) if the
    //   gate is doing its job right. But since ws-library semantics
    //   MAY fire 'open' before 'close' regardless of application-
    //   layer close-during-upgrade timing, this is a secondary
    //   signal — the close code is authoritative.
    if (closeCode === 4300) {
      ok = true;
      reason = `gate (a) fired: 4300 unauthorized_bad_shape close at ${totalSec.toFixed(1)}s — chunk deployed and working${firstOpenMs === null ? ' (rejected at upgrade — no open event fired)' : ' (open event fired but close code correct)'}`;
    } else if (closeCode === 1011) {
      ok = false;
      reason = `got 1011 server_error at ${totalSec.toFixed(1)}s — pre-deployment state (join-path-robustness chunk not shipped yet)`;
    } else if (closeCode === null) {
      ok = false;
      reason = `no close by duration end (${durationSec}s) — gate (a) may not be firing; the sub was deliberately non-UUID`;
    } else {
      ok = false;
      reason = `expected close code 4300 (unauthorized_bad_shape) but got ${closeCode} reason=${closeReason || '<empty>'} at ${totalSec.toFixed(1)}s`;
    }
  } else {
    ok = false;
    reason = `unhandled mode=${MODE} — verdict logic gap`;
  }

  console.log(ok ? `✓ PASS  ${reason}` : `✗ FAIL  ${reason}`);
  console.log('');
  console.log('Next: correlate with engine logs (via VM SSH):');
  if (MODE === 'browser-sim' || MODE === 'dead-sim') {
    console.log(`  sudo docker logs citrus-draft-engine 2>&1 | grep -E 'heartbeat\\.(scan_completed|pong_timeout|ping)' | tail -20`);
  } else if (MODE === 'uninitialized') {
    // Expected engine log line (post-chunk): uws.upgrade.rejected with reason draft_not_initialized.
    console.log(`  sudo docker logs citrus-draft-engine 2>&1 | grep -E 'uws\\.upgrade\\.rejected|draft_not_initialized' | tail -10`);
  } else if (MODE === 'bad-sub') {
    // Expected engine log line (post-chunk): uws.upgrade.rejected with reason unauthorized_bad_shape (or the equivalent).
    console.log(`  sudo docker logs citrus-draft-engine 2>&1 | grep -E 'uws\\.upgrade\\.rejected|unauthorized_bad_shape|bad_shape' | tail -10`);
  }
  console.log('');
  process.exit(ok ? 0 : 1);
}

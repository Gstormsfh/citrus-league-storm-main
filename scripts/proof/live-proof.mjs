#!/usr/bin/env node
// scripts/proof/live-proof.mjs
//
// Live-broadcast proof for chunk 11g.10 sub-step 10c-1c (verification of the
// 10c-1a broadcast fix). Connects ONE WebSocket client to the staging engine,
// then submits ONE pick via submit_pick_v2 through a direct pg connection,
// and captures every WS frame the client receives — including the broadcast
// `event` frame the engine's `processExternalEvent` emits on live NOTIFY.
//
// This script produces the four verbatim capture items the sequential-verified
// protocol requires as evidence of a real broadcast:
//   (a) the wire message the client receives
//   (b) client receive timestamp
//   (c) the engine's external_event.applied log line for the same seq
//       (surfaced via post-run VM log grep — see README.md)
//   (d) informal submit→receive wall-clock delta, labeled NON-MANDATE
//
// Env:
//   SUPABASE_DB_URL      direct primary URL (NOT pooled).
//   SUPABASE_JWT_SECRET  HS256 signing secret for the draft-token JWT.
//   HOST                 optional engine host override; default 35.203.89.236.
//   WS_PORT              optional WS port; default 3002.
//
// Preconditions:
//   Fixture applied via `node scripts/proof/fixture-min.mjs --execute`.
//   Verified by the fixture script's state-file presence + printed plan.
//
// Failure mode:
//   15-second timeout post-submission with no matching broadcast frame →
//   prints DIAGNOSTIC FAILURE guidance and exits nonzero. No retries.

import pg from 'pg';
import crypto from 'node:crypto';
import readline from 'node:readline';
import WebSocket from 'ws';

// ─────────────────────────────────────────────────────────────────────────
// Constants — canonical Staging League + proof-team identity.
// ─────────────────────────────────────────────────────────────────────────
const WHITELISTED_LEAGUE_ID = '993c9219-ecbf-4e4e-9fb0-e9837e1bded3';
const PROOF_TEAM_ID = '44444444-4444-4444-4444-444444444444';
// JWT `sub` claim — the WS server doesn't cross-check this against
// auth.users membership at connect time (per smoke-tokens-gen.js
// pattern + the smoke test's scenario (c) which uses a synthetic
// user id). Use a deterministic dummy so the log trail is readable.
const PROOF_USER_ID = '55555555-5555-5555-5555-555555555555';
// A recognizable NHL player id — McDavid (8478402), any int works
// because submit_pick_v2's preflight only checks player_taken (via
// draft_picks_v2) and validate_draft_event_payload's numeric type
// check on player_id. No FK to a players table on draft_picks_v2.
const PROOF_PLAYER_ID = 8478402;

const HOST = process.env.HOST || '35.203.89.236';
const WS_PORT = Number(process.env.WS_PORT || 3002);
const WS_URL = `ws://${HOST}:${WS_PORT}/ws/draft/${WHITELISTED_LEAGUE_ID}`;

const POST_SUBMIT_TIMEOUT_MS = 15_000;

// ─────────────────────────────────────────────────────────────────────────
// Env validation.
// ─────────────────────────────────────────────────────────────────────────
const DB_URL = process.env.SUPABASE_DB_URL;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
if (!DB_URL) {
  console.error('FATAL: SUPABASE_DB_URL not set.');
  process.exit(2);
}
if (!JWT_SECRET) {
  console.error('FATAL: SUPABASE_JWT_SECRET not set.');
  process.exit(2);
}
for (const pat of ['pooler.supabase.com', 'pgbouncer', ':6543']) {
  if (DB_URL.includes(pat)) {
    console.error(`FATAL: SUPABASE_DB_URL contains pooled pattern "${pat}".`);
    console.error(`       KI-E010: use the direct primary URL only.`);
    process.exit(2);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Banner. Prints the exact host:port before anything else so there's no
// ambiguity about what was being connected to.
// ─────────────────────────────────────────────────────────────────────────
console.log('');
console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║           LIVE BROADCAST PROOF — chunk 11g.10 (10c-1c)        ║');
console.log('╠═══════════════════════════════════════════════════════════════╣');
console.log(`║  WS target:  ${WS_URL.padEnd(48)} ║`);
console.log(`║  League:     ${WHITELISTED_LEAGUE_ID}       ║`);
console.log(`║  Team:       ${PROOF_TEAM_ID}       ║`);
console.log(`║  Player:     ${String(PROOF_PLAYER_ID).padEnd(48)} ║`);
console.log(`║  JWT sub:    ${PROOF_USER_ID}       ║`);
console.log('╚═══════════════════════════════════════════════════════════════╝');
console.log('');

// ─────────────────────────────────────────────────────────────────────────
// JWT mint — matches scripts/smoke-tokens-gen.js pattern (chunk 11g.10 10b).
// Claims: sub, draftId, leagueId, iat, exp, iss=citrus-discovery, aud=citrus-draft-engine.
// TTL: 5 minutes — matches draft-token convention (server/src/lib/draftToken.ts).
// ─────────────────────────────────────────────────────────────────────────
function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest();
  return `${signingInput}.${base64url(signature)}`;
}

const nowSec = Math.floor(Date.now() / 1000);
const jwtPayload = {
  sub: PROOF_USER_ID,
  draftId: WHITELISTED_LEAGUE_ID,
  leagueId: WHITELISTED_LEAGUE_ID,
  iat: nowSec,
  exp: nowSec + 5 * 60,
  iss: 'citrus-discovery',
  aud: 'citrus-draft-engine',
};
const jwt = signJwt(jwtPayload, JWT_SECRET);
console.log(`JWT minted (exp in 300s, sub=${PROOF_USER_ID}).`);

// ─────────────────────────────────────────────────────────────────────────
// Frame log — every WS frame recorded with a client-side timestamp.
// ─────────────────────────────────────────────────────────────────────────
/** @type {{ts: number, iso: string, raw: string, parsed: unknown}[]} */
const frameLog = [];
let snapshotReceived = false;
let broadcastReceived = false;
/** @type {number | null} */
let expectedSeq = null;
/** @type {number | null} */
let submitStartMs = null;

function recordFrame(rawText) {
  const ts = Date.now();
  const iso = new Date(ts).toISOString();
  let parsed;
  try { parsed = JSON.parse(rawText); } catch { parsed = null; }
  const entry = { ts, iso, raw: rawText, parsed };
  frameLog.push(entry);
  console.log('');
  console.log(`── WS FRAME #${frameLog.length}  @ ${iso}  (client-clock)`);
  console.log(`   raw: ${rawText}`);
  return entry;
}

// ─────────────────────────────────────────────────────────────────────────
// WebSocket connect. Sec-WebSocket-Protocol carries the JWT per the
// engine's WS auth pattern (server/src/draft/uws-server.ts:120+).
// ─────────────────────────────────────────────────────────────────────────
console.log('');
console.log(`Connecting to ${WS_URL} ...`);
const ws = new WebSocket(WS_URL, jwt); // second arg is the subprotocol

ws.on('open', () => {
  console.log(`WS open (readyState=${ws.readyState}).`);
});

// Heartbeat compliance (chunk 11g.7 sub-step 7d).
// Engine uses WebSocket protocol-level ping/pong control frames:
//   - server/src/draft/uws-server.ts:127-128 configures uWS with
//     sendPingsAutomatically:true (uWS emits pings internally on idle).
//   - server/src/draft/uws-server.ts:312-316 pong: handler calls
//     recordPong(ws, Date.now()) to update lastPongAt.
//   - server/src/draft/heartbeat.ts:135-157 findTimedOutConnections
//     culls any ws whose lastPongAt is older than pongTimeoutMs (30s).
// The Node `ws` library auto-pongs by default, but explicitly ponging
// in the ping handler is belt-and-suspenders: guarantees the pong
// fires regardless of ws-library version quirks, and gives us a
// visible log line so Garrett sees the keepalive working while
// parked at ARMED. Browsers in production carry no heartbeat code
// (apps/web/src/lib/draftClient/ has zero ping/pong handlers) —
// they rely on the WS spec's browser-native auto-pong.
ws.on('ping', (data) => {
  try { ws.pong(data); } catch (err) { void err; }
  process.stdout.write(`\x1b[2m♥ ping→pong @ ${new Date().toISOString()}\x1b[0m\n`);
});
ws.on('pong', () => {
  process.stdout.write(`\x1b[2m♥ ← pong received @ ${new Date().toISOString()}\x1b[0m\n`);
});

ws.on('message', (data) => {
  const text = data.toString('utf8');
  const entry = recordFrame(text);
  const parsed = entry.parsed;

  if (!snapshotReceived && parsed && parsed.type === 'snapshot') {
    snapshotReceived = true;
    console.log('');
    console.log('   ✓ snapshot-on-connect received.');
    console.log(`   lobbyId=${parsed.payload?.lobbyId} format=${parsed.payload?.format}`);
    promptAndSubmit();
    return;
  }

  if (parsed && parsed.type === 'event' && expectedSeq !== null && parsed.seq === expectedSeq) {
    broadcastReceived = true;
    const recvMs = entry.ts;
    const deltaMs = submitStartMs !== null ? recvMs - submitStartMs : null;
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                     BROADCAST FRAME MATCHED                   ║');
    console.log('╠═══════════════════════════════════════════════════════════════╣');
    console.log(`║  Expected seq: ${String(expectedSeq).padEnd(47)}║`);
    console.log(`║  Received at:  ${new Date(recvMs).toISOString().padEnd(47)}║`);
    if (deltaMs !== null) {
      console.log(`║  Wall-clock delta: ${(String(deltaMs) + ' ms  (NON-MANDATE — informal)').padEnd(43)}║`);
    }
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('── CAPTURE ITEM (a): wire message ──');
    console.log(entry.raw);
    console.log('');
    console.log('── CAPTURE ITEM (b): client receive timestamp ──');
    console.log(`${entry.iso}  (${recvMs} ms epoch)`);
    console.log('');
    console.log('── CAPTURE ITEM (c): engine external_event.applied log line ──');
    console.log('SURFACED VIA POST-RUN VM LOG GREP — see README.md section 5.');
    console.log(`Command:`);
    console.log(`  gcloud compute ssh citrus-draft-engine-staging \\`);
    console.log(`    --zone=northamerica-northeast1-a --project=citrus-fantasy-staging \\`);
    console.log(`    --command="sudo docker logs citrus-draft-engine 2>&1 | grep 'external_event.applied' | grep '\\\"seq\\\":${expectedSeq}'"`);
    console.log('');
    console.log('── CAPTURE ITEM (d): submit→receive wall-clock delta ──');
    console.log(`${deltaMs} ms  (NON-MANDATE — informal one-shot measurement)`);
    console.log('');
    finish(0);
    return;
  }
});

ws.on('error', (err) => {
  console.error('');
  console.error('WS error:', err.message);
});

ws.on('close', (code, reason) => {
  console.log('');
  console.log(`WS close (code=${code}, reason=${reason?.toString() || '<empty>'}).`);
});

// ─────────────────────────────────────────────────────────────────────────
// Prompt + submit path. Called after snapshot-on-connect confirms the
// engine has us in the lobby's connection set.
// ─────────────────────────────────────────────────────────────────────────
async function promptAndSubmit() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => {
    rl.question('\nARMED — press Enter to submit the pick.  ', () => {
      rl.close();
      resolve();
    });
  });

  // ── Fresh pg client, submit_pick_v2 via direct DB. ─────────────────
  const client = new pg.Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 10_000,
  });
  await client.connect();

  // Compute the payload_hash exactly as @citrus/shared's
  // computePickPayloadHash would (sha256 hex of the canonical JSON).
  // We match the SUBMIT-TIME arguments deterministically here.
  const pickNumber = 1;
  const round = 1;
  const pickedAt = new Date().toISOString();
  const canonicalPayload = {
    pick_number: pickNumber,
    round,
    team_id: PROOF_TEAM_ID,
    player_id: PROOF_PLAYER_ID,
    picked_at: pickedAt,
    is_autopick: true,
  };
  const payloadHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalPayload))
    .digest('hex');
  const idempotencyKey = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();

  const sql = `SELECT * FROM public.submit_pick_v2(
    $1::uuid, $2::uuid, $3::int, $4::int, $5::int,
    $6::uuid, $7::uuid, $8::text, $9::jsonb, $10::uuid
  ) AS result`;
  const params = [
    WHITELISTED_LEAGUE_ID,        // p_league_id
    PROOF_TEAM_ID,                // p_team_id
    PROOF_PLAYER_ID,              // p_player_id
    round,                        // p_round
    pickNumber,                   // p_pick_number
    sessionId,                    // p_session_id
    idempotencyKey,               // p_idempotency_key
    payloadHash,                  // p_payload_hash
    JSON.stringify({ kind: 'autopick', id: PROOF_USER_ID }), // p_actor
    correlationId,                // p_correlation_id
  ];

  // submit_pick_v2's autopick branch requires `auth.role()` to return
  // 'service_role' or 'postgres'. Supabase's `auth.role()` reads from
  // `current_setting('request.jwt.claims')` (per the phase2 integration
  // tests' pattern at line 1425 — `SET LOCAL "request.jwt.claims" = ...`).
  // A raw pg connection has no JWT context set, so `auth.role()` returns
  // NULL/anon and the RPC rejects. Setting the claim explicitly makes the
  // check pass regardless of Supabase's exact auth.role() implementation.
  const setClaimsSql = `SET SESSION "request.jwt.claims" TO '{"role":"service_role"}'`;
  console.log('');
  console.log('── PRE-SUBMIT: JWT claim context (so auth.role() = service_role) ──');
  console.log(setClaimsSql);
  await client.query(setClaimsSql);

  console.log('');
  console.log('── SUBMITTING PICK via submit_pick_v2 (actor.kind=autopick, direct pg) ──');
  console.log(sql.trim());
  console.log(`params: ${JSON.stringify(params)}`);
  console.log(`payload (for hash): ${JSON.stringify(canonicalPayload)}`);
  console.log(`payload_hash: ${payloadHash}`);
  console.log('');

  submitStartMs = Date.now();
  try {
    const res = await client.query(sql, params);
    const submitEndMs = Date.now();
    const row = res.rows[0].result;
    console.log(`RPC returned (in ${submitEndMs - submitStartMs} ms):`);
    console.log(`  ${JSON.stringify(row)}`);
    expectedSeq = Number(row.seq);
    console.log(`Awaiting WS 'event' frame with seq=${expectedSeq}, timeout ${POST_SUBMIT_TIMEOUT_MS} ms ...`);
  } catch (err) {
    console.error('');
    console.error('RPC error:', err.message);
    console.error('(the RPC failed — no draft_events row written, no NOTIFY, no broadcast expected)');
    await client.end();
    finish(1);
    return;
  }
  await client.end();

  // Post-submit timeout — if the broadcast doesn't arrive, emit
  // diagnostic guidance and exit nonzero.
  setTimeout(() => {
    if (broadcastReceived) return;
    console.error('');
    console.error('╔═══════════════════════════════════════════════════════════════╗');
    console.error('║                    DIAGNOSTIC FAILURE                         ║');
    console.error('╠═══════════════════════════════════════════════════════════════╣');
    console.error(`║  Submitted seq=${expectedSeq}; ${POST_SUBMIT_TIMEOUT_MS/1000}s elapsed; no matching WS 'event' frame  ║`);
    console.error('╚═══════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error('Frames received during the wait window:');
    for (const f of frameLog) {
      console.error(`  [${f.iso}] ${f.raw.slice(0, 200)}${f.raw.length > 200 ? '…' : ''}`);
    }
    console.error('');
    console.error('DIAGNOSTIC STEPS (Garrett runs; do not attempt from here):');
    console.error('');
    console.error(' 1. Confirm the draft_events row landed and the trigger fired:');
    console.error(`    SELECT id, seq, event_type, created_at FROM draft_events`);
    console.error(`     WHERE league_id = '${WHITELISTED_LEAGUE_ID}' ORDER BY seq DESC LIMIT 3;`);
    console.error('');
    console.error(' 2. Confirm the notify trigger is still installed:');
    console.error(`    SELECT tgname FROM pg_trigger`);
    console.error(`     WHERE tgname = 'draft_events_notify_after_insert';`);
    console.error('');
    console.error(' 3. Grep engine logs for the missing external_event.applied:');
    console.error(`    gcloud compute ssh citrus-draft-engine-staging \\`);
    console.error(`      --zone=northamerica-northeast1-a --project=citrus-fantasy-staging \\`);
    console.error(`      --command="sudo docker logs citrus-draft-engine 2>&1 | tail -100"`);
    console.error('');
    console.error(' 4. Check whether the engine\'s LISTEN client is alive:');
    console.error(`    gcloud compute ssh citrus-draft-engine-staging \\`);
    console.error(`      --zone=northamerica-northeast1-a --project=citrus-fantasy-staging \\`);
    console.error(`      --command="sudo docker logs citrus-draft-engine 2>&1 | grep -E 'event_subscription|reconnect' | tail -20"`);
    console.error('');
    console.error('If the LISTEN connection has churned or died silently, an engine');
    console.error('restart is the likely fix — but that is a Garrett-executed action,');
    console.error('not this script\'s scope.');
    console.error('');
    finish(1);
  }, POST_SUBMIT_TIMEOUT_MS);
}

// ─────────────────────────────────────────────────────────────────────────
// Cleanup / exit.
// ─────────────────────────────────────────────────────────────────────────
function finish(code) {
  try { ws.close(); } catch {}
  // Give the WS close a moment to flush.
  setTimeout(() => process.exit(code), 200);
}

// Global connect timeout (in case the WS never opens).
setTimeout(() => {
  if (!snapshotReceived) {
    console.error('');
    console.error(`FATAL: no snapshot-on-connect received within 10s.`);
    console.error(`       Verify the engine is reachable at ${WS_URL} and that`);
    console.error(`       the JWT secret matches the engine's SUPABASE_JWT_SECRET.`);
    finish(1);
  }
}, 10_000);

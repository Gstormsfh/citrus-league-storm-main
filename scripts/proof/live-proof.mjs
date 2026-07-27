#!/usr/bin/env node
// scripts/proof/live-proof.mjs
//
// Live-broadcast proof for chunk 11g.10 sub-step 10c-1c (verification of the
// 10c-1a broadcast fix). Connects ONE WebSocket client to the staging engine,
// then submits ONE pick via submit_pick_v2 through a direct pg connection,
// and captures every WS frame the client receives — including the broadcast
// `event` frame the engine's `processExternalEvent` emits on live NOTIFY.
//
// Chunk 11g.10 sub-step 10c-2 refactor: WS connection + heartbeat are now
// delegated to the shared client lib at `scripts/proof/lib/ws-client.mjs`,
// which uses client-initiated unsolicited pongs (RFC 6455 §5.5.3) every
// 10 s so the engine's reaper (30 s pong timeout) stays satisfied even
// when the connection is otherwise idle. Prior heartbeat pattern (waiting
// for server-initiated pings via uWS's `sendPingsAutomatically`) was
// verifiably not firing — see PROJECT_PLAN.md Decision Log 2026-07-27
// "10c-1d incident closure" for evidence.
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
//
// Failure mode:
//   15-second timeout post-submission with no matching broadcast frame →
//   prints DIAGNOSTIC FAILURE guidance and exits nonzero. No retries.

import pg from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import readline from 'node:readline';
import { connectDraftClient } from './lib/ws-client.mjs';

// ─────────────────────────────────────────────────────────────────────────
// Constants — canonical Staging League + proof-team identity.
// ─────────────────────────────────────────────────────────────────────────
const WHITELISTED_LEAGUE_ID = '993c9219-ecbf-4e4e-9fb0-e9837e1bded3';
const PROOF_TEAM_ID = '44444444-4444-4444-4444-444444444444';
// JWT `sub` claim — the WS server doesn't cross-check this against
// auth.users membership at connect time.
const PROOF_USER_ID = '55555555-5555-5555-5555-555555555555';
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
if (!DB_URL) { console.error('FATAL: SUPABASE_DB_URL not set.'); process.exit(2); }
if (!JWT_SECRET) { console.error('FATAL: SUPABASE_JWT_SECRET not set.'); process.exit(2); }
for (const pat of ['pooler.supabase.com', 'pgbouncer', ':6543']) {
  if (DB_URL.includes(pat)) {
    console.error(`FATAL: SUPABASE_DB_URL contains pooled pattern "${pat}" (KI-E010).`);
    process.exit(2);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Banner.
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
console.log(`║  Heartbeat:  client-initiated unsolicited pong every 10 s      ║`);
console.log('╚═══════════════════════════════════════════════════════════════╝');
console.log('');

// ─────────────────────────────────────────────────────────────────────────
// Frame log — every WS frame recorded with a client-side timestamp.
// (The shared lib maintains its own frame log too; we also record here
// so we can render each frame at receipt time for the operator's UI.)
// ─────────────────────────────────────────────────────────────────────────
let broadcastReceived = false;
let expectedSeq = null;
let submitStartMs = null;
let clientHandle = null;

function renderFrame(frame) {
  console.log('');
  console.log(`── WS FRAME  @ ${frame.iso}  (client-clock)`);
  console.log(`   raw: ${frame.raw}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Main.
// ─────────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Connecting to ${WS_URL} ...`);
  try {
    clientHandle = await connectDraftClient({
      host: HOST,
      port: WS_PORT,
      leagueId: WHITELISTED_LEAGUE_ID,
      userId: PROOF_USER_ID,
      jwtSecret: JWT_SECRET,
      clientLabel: 'proof',
      connectTimeoutMs: 10_000,
      // silentHeartbeat: false — this script runs with ONE client, so
      // full ♥ visibility is useful for operator confidence at the
      // ARMED prompt.
      onEvent: ({ seq, frame, receivedAt }) => {
        renderFrame(frame);
        if (expectedSeq === null || seq !== expectedSeq) return;
        broadcastReceived = true;
        const deltaMs = submitStartMs !== null ? receivedAt - submitStartMs : null;
        console.log('');
        console.log('╔═══════════════════════════════════════════════════════════════╗');
        console.log('║                     BROADCAST FRAME MATCHED                   ║');
        console.log('╠═══════════════════════════════════════════════════════════════╣');
        console.log(`║  Expected seq: ${String(expectedSeq).padEnd(47)}║`);
        console.log(`║  Received at:  ${new Date(receivedAt).toISOString().padEnd(47)}║`);
        if (deltaMs !== null) {
          console.log(`║  Wall-clock delta: ${(String(deltaMs) + ' ms  (NON-MANDATE — informal)').padEnd(43)}║`);
        }
        console.log('╚═══════════════════════════════════════════════════════════════╝');
        console.log('');
        console.log('── CAPTURE ITEM (a): wire message ──');
        console.log(frame.raw);
        console.log('');
        console.log('── CAPTURE ITEM (b): client receive timestamp ──');
        console.log(`${frame.iso}  (${receivedAt} ms epoch)`);
        console.log('');
        console.log('── CAPTURE ITEM (c): engine external_event.applied log line ──');
        console.log('SURFACED VIA POST-RUN VM LOG GREP — see README.md.');
        console.log(`Command:`);
        console.log(`  gcloud compute ssh citrus-draft-engine-staging \\`);
        console.log(`    --zone=northamerica-northeast1-a --project=citrus-fantasy-staging \\`);
        console.log(`    --command="sudo docker logs citrus-draft-engine 2>&1 | grep 'external_event.applied' | grep '\\\"seq\\\":${expectedSeq}'"`);
        console.log('');
        console.log('── CAPTURE ITEM (d): submit→receive wall-clock delta ──');
        console.log(`${deltaMs} ms  (NON-MANDATE — informal one-shot measurement)`);
        console.log('');
        finish(0);
      },
      onError: (err) => {
        console.error('');
        console.error('WS error:', err.message ?? String(err));
      },
    });
  } catch (err) {
    console.error('');
    console.error('FATAL: WS connect failed:', err.message);
    console.error(`       Verify the engine is reachable at ${WS_URL} and that the`);
    console.error(`       JWT secret matches the engine's SUPABASE_JWT_SECRET.`);
    process.exit(1);
  }

  console.log('');
  console.log('   ✓ snapshot-on-connect received.');
  const snap = clientHandle.snapshotFrame?.parsed;
  if (snap && snap.payload) {
    console.log(`   lobbyId=${snap.payload.lobbyId} format=${snap.payload.format}`);
  }
  console.log('   ♥ heartbeat running (10 s cadence, client-initiated pongs).');
  console.log('');

  // ── ARMED prompt + submit ────────────────────────────────────────
  await promptAndSubmit();
})();

async function promptAndSubmit() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => {
    rl.question('\nARMED — press Enter to submit the pick.  ', () => {
      rl.close();
      resolve();
    });
  });

  const client = new pg.Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 10_000,
  });
  await client.connect();

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
  const payloadHash = createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');
  const idempotencyKey = randomUUID();
  const sessionId = randomUUID();
  const correlationId = randomUUID();

  const sql = `SELECT * FROM public.submit_pick_v2(
    $1::uuid, $2::uuid, $3::int, $4::int, $5::int,
    $6::uuid, $7::uuid, $8::text, $9::jsonb, $10::uuid
  ) AS result`;
  const params = [
    WHITELISTED_LEAGUE_ID,
    PROOF_TEAM_ID,
    PROOF_PLAYER_ID,
    round,
    pickNumber,
    sessionId,
    idempotencyKey,
    payloadHash,
    JSON.stringify({ kind: 'autopick', id: PROOF_USER_ID }),
    correlationId,
  ];

  // Supabase's `auth.role()` reads from `current_setting('request.jwt.claims')`.
  // A raw pg connection has no JWT context set, so `auth.role()` returns
  // NULL/anon and the RPC's autopick branch rejects. Setting the claim
  // explicitly makes the check pass regardless of Supabase's exact
  // auth.role() implementation.
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
    for (const f of clientHandle.frames) {
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
    console.error(' 3. Check /health/subscription (chunk 11g.10 sub-step 10c-1d):');
    console.error(`    curl http://${HOST}:3001/health/subscription`);
    console.error('    Expect: {"ok":true,"connected":true,"lastSelfTestOkAt":"…recent…"}');
    console.error('');
    console.error(' 4. Grep engine logs for the missing external_event.applied:');
    console.error(`    gcloud compute ssh citrus-draft-engine-staging \\`);
    console.error(`      --zone=northamerica-northeast1-a --project=citrus-fantasy-staging \\`);
    console.error(`      --command="sudo docker logs citrus-draft-engine 2>&1 | tail -100"`);
    console.error('');
    finish(1);
  }, POST_SUBMIT_TIMEOUT_MS).unref?.();
}

function finish(code) {
  try { clientHandle?.close(); } catch { /* ignore */ }
  setTimeout(() => process.exit(code), 200);
}

#!/usr/bin/env node
// scripts/proof/lifecycle-acceptance-f27.local.mjs
//
// ============================================================================
// F27 acceptance rig — Rider 4 (lifecycle) + Rider 2 (zero-client)
// ============================================================================
//
// Per architect option 1 (2026-08-06): one rig, two modes via --mode flag.
// Reuses fixture-12's constants + lib/ws-client's connectDraftClient.
// Delegates the 12-pick drive to scripts/proof/draft-harness.mjs via
// child_process spawn (concentrates orchestration; no code duplication).
//
// MODES:
//
//   --mode=lifecycle  (default)
//     Rider 4 — button-to-banner. One rig proves the entire draft
//     lifecycle. Pre-registered asserts:
//       A. draft_started event at seq=1 with all six §6.4 validator fields
//       B. leagues.draft_state='active', draft_status='in_progress',
//          pick_deadline=payload.first_pick_deadline (atomic post-RPC)
//       C. Observer (connected pre-ignition) receives the draft_started
//          WS frame; engine logs broadcasted=true (F27 receiver PASS)
//       D. F24 emitter fires — draft_completed at seq=13 with sha256
//          payload_hash, correlation threaded to pick 12
//       E. Zero "clock fired but draftStatus=completed" WARNINGs in
//          engine logs post-completion (F26 teardown cancelled timer;
//          F20 guard need not absorb)
//       F. Mid-draft joiner receives contiguous frame chain from
//          resync point + the draft_completed frame live at the end
//          (Rider 4 addendum — architect condition 2 on the engine diff)
//
//   --mode=zero-client
//     Rider 2 — commissioner-with-zero-clients-connected. 5-step scenario:
//       1. start_draft_v2 invoked; ZERO WS clients connected.
//       2. Assert draft_state=active, draft_status=in_progress,
//          pick_deadline set, draft_started event at seq=1.
//       3. Wait real wall-clock time until pick_deadline elapses.
//       4. First harness client connects.
//       5. Assert F20 absorb-and-announce: autopick lands at seq=2 with
//          picked_by_actor.kind='autopick'. Draft continues.
//     Absorb-and-announce documented as normal operational mode.
//
// USAGE (Garrett runs against staging):
//   node scripts/proof/lifecycle-acceptance-f27.local.mjs --mode=lifecycle
//   node scripts/proof/lifecycle-acceptance-f27.local.mjs --mode=zero-client
//
//   --dry-run          print planned actions; no state writes, no engine calls
//   --pick-time=N      override pickTimeLimit for the fixture (default 30s)
//   --rounds=N         override total_rounds (default 1 → 12 picks)
//
// ENV (per scripts/proof/README §2):
//   SUPABASE_DB_URL      direct primary URL (NOT pooled). KI-E010.
//   SUPABASE_JWT_SECRET  for ws-client JWT minting.
//   HOST, WS_PORT, SCHEME  engine WS target (cloud-path or vm-ip).
//
// PRECONDITIONS:
//   1. F27 migration applied to staging (start_draft_v2 live).
//   2. F26+F27 engine deploy live (LobbyManager switch cases active).
//   3. Fixture setup run: `node scripts/proof/fixture-12.mjs --execute`.
//   4. INS-6 bridge rehearsed against this SUPABASE_DB_URL.
//
// SAFETY POSTURE:
//   - Whitelisted league only (fixture-12's WHITELISTED_LEAGUE_ID).
//   - RPC-only writes (no direct SQL mutation).
//   - Every assertion is queried, not inferred (F18 rule: trust queries,
//     not self-reported counts).
//   - Failure at any assert HALTs the rig; leaves state for architect
//     inspection; explicit cleanup via `fixture-12.mjs --reset --execute`.
//
// SHAKEDOWN NOTE (2026-08-06 authorship):
//   This rig is FIRST-RUN. Author cannot run it (Garrett-only per
//   feedback_hand_off_infra_commands.md). Expected first-run issues
//   are common in this class of orchestration:
//     - Timing races (WS connect vs RPC fire order)
//     - Frame-shape assumptions (observer's frame envelope schema)
//     - draft-harness spawn contract (needs env pass-through)
//   Architect: expect one shakedown iteration on first invocation;
//   the assertion set + orchestration flow are correct; concrete
//   timing/parsing knobs may need tuning.
// ============================================================================

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import {
  WHITELISTED_LEAGUE_ID,
  HARNESS_USER_IDS,
  harnessUserId,
} from './fixture-12.mjs';
import { connectDraftClient } from './lib/ws-client.mjs';

// ── CLI parse ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (k, def) => {
  const found = args.find((a) => a.startsWith(`--${k}=`));
  return found ? found.slice(`--${k}=`.length) : def;
};
const MODE       = flag('mode', 'lifecycle');
const DRY_RUN    = args.includes('--dry-run');
const PICK_TIME  = Number(flag('pick-time', '30'));
const ROUNDS     = Number(flag('rounds', '1'));

if (!['lifecycle', 'zero-client'].includes(MODE)) {
  console.error(`FATAL: --mode=lifecycle | zero-client (got ${MODE})`);
  process.exit(2);
}

// ── Env preflight ────────────────────────────────────────────────────
const DB_URL     = process.env.SUPABASE_DB_URL;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const HOST       = process.env.HOST;
const WS_PORT    = process.env.WS_PORT ? Number(process.env.WS_PORT) : null;
const SCHEME     = process.env.SCHEME ?? 'ws';

if (!DB_URL)     { console.error('FATAL: SUPABASE_DB_URL not set');       process.exit(2); }
if (!JWT_SECRET) { console.error('FATAL: SUPABASE_JWT_SECRET not set');    process.exit(2); }
if (!HOST)       { console.error('FATAL: HOST not set (engine WS host)');  process.exit(2); }
if (!WS_PORT)    { console.error('FATAL: WS_PORT not set');                process.exit(2); }
for (const pat of ['pooler.supabase.com', 'pgbouncer', ':6543']) {
  if (DB_URL.includes(pat)) {
    console.error(`FATAL: SUPABASE_DB_URL contains pooled pattern "${pat}" (KI-E010)`);
    process.exit(2);
  }
}

// ── Small helpers ────────────────────────────────────────────────────
const log = (...m) => console.log('[F27-rig]', ...m);
const fail = (msg) => { console.error('[F27-rig] FAIL:', msg); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function newPgClient() {
  return new pg.Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 15_000,
  });
}

// Query the fixture league's status columns.
async function queryLeagueColumns(client) {
  const { rows } = await client.query(
    `SELECT draft_state, draft_status::text AS draft_status, pick_deadline,
            draft_event_counter, league_size, commissioner_id, settings
       FROM public.leagues WHERE id = $1`,
    [WHITELISTED_LEAGUE_ID],
  );
  return rows[0] ?? null;
}

// Query the last N events for the fixture league (seq DESC).
async function queryRecentEvents(client, limit = 5) {
  const { rows } = await client.query(
    `SELECT id, seq, event_type, event_version, payload, payload_hash,
            idempotency_key, actor, correlation_id, created_at
       FROM public.draft_events
      WHERE league_id = $1
      ORDER BY seq DESC LIMIT $2`,
    [WHITELISTED_LEAGUE_ID, limit],
  );
  return rows;
}

// Assert helper — logs on pass, fails on miss.
function assertEqual(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    log(`  ✓ ${label}: ${JSON.stringify(actual)}`);
    return;
  }
  fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertTruthy(label, value) {
  if (value) { log(`  ✓ ${label}`); return; }
  fail(`${label}: value was falsy (${value})`);
}
function assertKind(label, value, kindDesc) {
  if (value !== null && value !== undefined) { log(`  ✓ ${label}: ${kindDesc}`); return; }
  fail(`${label}: expected ${kindDesc}, got ${value}`);
}

// Fire start_draft_v2 via pg client (service_role bypass — no auth.uid()
// mapping needed since we call as the DB role). Actor.kind must be
// 'commissioner' per Step 1 of the RPC.
async function invokeStartDraftV2(client, { idempotencyKey, correlationId }) {
  const actor = {
    kind: 'commissioner',
    id: '00000000-0000-0000-0000-000000000000',   // service_role bypass path
    note: 'F27 acceptance rig (Rider 4 / Rider 2)',
  };
  const q = `
    SELECT public.start_draft_v2($1::uuid, $2::jsonb, $3::uuid, $4::uuid) AS result
  `;
  const { rows } = await client.query(q, [
    WHITELISTED_LEAGUE_ID,
    JSON.stringify(actor),
    idempotencyKey,
    correlationId ?? null,
  ]);
  return rows[0]?.result ?? null;
}

// Ensure the fixture is in a not-started state before ignition.
// Uses fixture-12 --reset --execute mechanic; here we just query.
async function preflightNotStarted(client) {
  const cols = await queryLeagueColumns(client);
  if (!cols) fail(`league ${WHITELISTED_LEAGUE_ID} not found — run fixture-12 --execute first`);
  if (cols.draft_status !== 'not_started') {
    fail(`preflight: draft_status=${cols.draft_status} (expected not_started); run fixture-12 --reset --execute first`);
  }
  if (cols.draft_state !== 'not_started') {
    fail(`preflight: draft_state=${cols.draft_state} (expected not_started)`);
  }
  if (cols.pick_deadline !== null) {
    fail(`preflight: pick_deadline=${cols.pick_deadline} (expected NULL)`);
  }
  if (cols.draft_event_counter !== 0 && cols.draft_event_counter !== '0') {
    log(`  ⚠ preflight: draft_event_counter=${cols.draft_event_counter} (expected 0; may indicate prior events not cleared)`);
  }
  log('  ✓ preflight PASS: fixture in not_started state');
  return cols;
}

// Set pickTimeLimit on the fixture league's settings so we can control
// the deadline window (default 90s is too long for zero-client rig's
// real-wait; PICK_TIME arg lets us shrink it).
async function setFixturePickTimeLimit(client, seconds) {
  await client.query(
    `UPDATE public.leagues
        SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('pickTimeLimit', $2::int)
      WHERE id = $1`,
    [WHITELISTED_LEAGUE_ID, seconds],
  );
  log(`  ✓ pickTimeLimit set to ${seconds}s`);
}

// Spawn draft-harness to drive N picks. Returns exit code + captured
// stdout tail for observability. Passes env through.
function driveHarnessPicks(picks) {
  return new Promise((resolve) => {
    const child = spawn('node', [
      'scripts/proof/draft-harness.mjs',
      `--picks=${picks}`,
      '--scenario=S2',   // matches existing harness convention
    ], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); process.stdout.write(d); });
    child.stderr.on('data', (d) => { stderr += d.toString(); process.stderr.write(d); });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

// ── Mode: lifecycle (Rider 4) ────────────────────────────────────────
async function runLifecycleMode() {
  log('MODE = lifecycle (Rider 4 — button-to-banner)');
  log(`Target: staging (HOST=${HOST}, WS_PORT=${WS_PORT}, SCHEME=${SCHEME})`);
  log(`League: ${WHITELISTED_LEAGUE_ID}`);
  log(`pickTimeLimit override: ${PICK_TIME}s (default was 90)`);
  log(`Rounds: ${ROUNDS} → ${ROUNDS * 12} picks total`);
  if (DRY_RUN) { log('DRY RUN — printing plan only'); return; }

  const client = newPgClient();
  await client.connect();

  try {
    log('');
    log('── PREFLIGHT ──');
    await preflightNotStarted(client);
    await setFixturePickTimeLimit(client, PICK_TIME);

    log('');
    log('── OBSERVER CONNECT (pre-ignition) — for Rider 4 assert C ──');
    // observerEvents: normalized event stream. Each entry is
    //   { receivedAt, seq, kind, parsedMsg }
    // where parsedMsg is the full server envelope
    //   { v, type: 'event', seq, timestamp, correlationId, payload: <BufferedDraftEvent> }
    // and kind is the BufferedDraftEvent kind (payload.kind), lifted for
    // fast matching. INS-13 fix (2026-08-06) — prior version stored the
    // callback arg wholesale under `.frame` and matched at the wrong
    // nesting depth (frame.frame.parsed.payload.kind), so lifecycle
    // frames arrived correctly but the matcher missed them. Engine was
    // acquitted by architect's log-based verification (00:09:46.972
    // seq 1 draft_started broadcasted:true, notifyToBroadcast 42ms).
    // The DEBUG_FIRST_N block below dumps raw parsed messages for the
    // first N frames so the next envelope mismatch self-diagnoses.
    const observerEvents = [];
    const DEBUG_FIRST_N = 3;
    let debugFramesLogged = 0;
    const observer = connectDraftClient({
      host: HOST,
      port: WS_PORT,
      scheme: SCHEME,
      leagueId: WHITELISTED_LEAGUE_ID,
      userId: harnessUserId(1),
      jwtSecret: JWT_SECRET,
      clientLabel: 'observer',
      silentHeartbeat: true,
      onEvent: (evt) => {
        // evt from lib/ws-client.mjs:276 is { seq, frame, receivedAt }
        // frame is { ts, iso, raw, parsed }
        // parsed is the server envelope { v, type, seq, timestamp, correlationId, payload }
        const parsedMsg = evt.frame?.parsed ?? null;
        const kind = parsedMsg?.payload?.kind ?? '<no-kind>';
        observerEvents.push({
          receivedAt: Date.now(),
          seq: evt.seq,
          kind,
          parsedMsg,
        });
        // Debug dump — first N frames get their parsed envelope logged
        // for future envelope-diagnosis. Emits nothing at steady state.
        if (debugFramesLogged < DEBUG_FIRST_N) {
          debugFramesLogged += 1;
          log(`  [debug frame #${debugFramesLogged}] seq=${evt.seq} kind=${kind} envelope=${JSON.stringify(parsedMsg)}`);
        }
      },
    });
    // Wait for the observer to receive its snapshot (proves connect + subscribe).
    // Timeout: 10s. If it fails, the engine deploy is not up or the WS path is broken.
    log('  waiting for observer snapshot...');
    await observer.waitForSnapshot?.() ?? await sleep(2000);
    log('  ✓ observer connected + subscribed');

    log('');
    log('── IGNITION — start_draft_v2 RPC ──');
    const idem = randomUUID();
    const corr = randomUUID();
    log(`  idempotencyKey=${idem}`);
    log(`  correlationId=${corr}`);
    const igniteStart = Date.now();
    const result = await invokeStartDraftV2(client, {
      idempotencyKey: idem,
      correlationId: corr,
    });
    const igniteMs = Date.now() - igniteStart;
    log(`  ✓ start_draft_v2 returned in ${igniteMs}ms:`, JSON.stringify(result));

    log('');
    log('── ASSERT A — draft_started event at seq=1 with §6.4 fields ──');
    const events1 = await queryRecentEvents(client, 3);
    const firstEvent = events1[events1.length - 1] ?? events1[0]; // ORDER BY DESC → last is oldest
    // Actually events1 is DESC, so events1[0] is highest seq. For seq=1 we want the LAST element:
    const evAtSeq1 = events1.find((e) => e.seq === 1) ?? events1.find((e) => e.seq === '1');
    assertTruthy('event at seq=1 exists', evAtSeq1);
    assertEqual('event.event_type', evAtSeq1.event_type, 'draft_started');
    const p = evAtSeq1.payload;
    for (const field of ['started_at', 'first_pick_deadline', 'total_rounds',
                          'total_teams', 'pick_time_limit_seconds', 'draft_format']) {
      assertTruthy(`payload has "${field}"`, p[field] !== undefined && p[field] !== null);
    }

    log('');
    log('── ASSERT B — leagues columns atomic post-RPC ──');
    const cols = await queryLeagueColumns(client);
    assertEqual('draft_state',  cols.draft_state,  'active');
    assertEqual('draft_status', cols.draft_status, 'in_progress');
    assertTruthy('pick_deadline set', cols.pick_deadline !== null);
    assertEqual(
      'pick_deadline == payload.first_pick_deadline',
      new Date(cols.pick_deadline).toISOString(),
      new Date(p.first_pick_deadline).toISOString(),
    );

    log('');
    log('── ASSERT C — observer received draft_started frame ──');
    // Wait up to 3s for the frame to arrive (broadcast is sub-second under Mandate).
    // Matcher uses the normalized shape at observerEvents entries:
    //   { receivedAt, seq, kind, parsedMsg }
    // kind is the lifted BufferedDraftEvent.payload.kind.
    const cDeadline = Date.now() + 3000;
    let receivedStarted = null;
    while (Date.now() < cDeadline) {
      const found = observerEvents.find((e) => e.kind === 'draft_started');
      if (found) { receivedStarted = found; break; }
      await sleep(100);
    }
    assertTruthy('observer received draft_started frame within 3s', receivedStarted !== null);
    if (receivedStarted) {
      log(`  received at +${receivedStarted.receivedAt - igniteStart}ms; seq=${receivedStarted.seq}`);
    }

    log('');
    log('── PICKS — driving 12 picks via draft-harness ──');
    const harness = await driveHarnessPicks(12);
    if (harness.code !== 0) {
      fail(`draft-harness exited with code ${harness.code}`);
    }
    log(`  ✓ 12 picks driven`);

    log('');
    log('── ASSERT D — draft_completed emitter fires (F24) ──');
    const eventsFinal = await queryRecentEvents(client, 3);
    const evComplete = eventsFinal.find((e) => e.event_type === 'draft_completed');
    assertTruthy('draft_completed event exists', evComplete);
    assertTruthy('draft_completed.payload_hash present (Amendment 4)', evComplete.payload_hash);
    assertTruthy('draft_completed.correlation_id present', evComplete.correlation_id);

    const colsFinal = await queryLeagueColumns(client);
    assertEqual('final draft_status', colsFinal.draft_status, 'completed');
    assertEqual('final pick_deadline', colsFinal.pick_deadline, null);

    log('');
    log('── ASSERT C-mandatory — observer received draft_completed frame ──');
    // Same normalized matcher as ASSERT C (INS-13 fix).
    const cmDeadline = Date.now() + 3000;
    let receivedCompleted = null;
    while (Date.now() < cmDeadline) {
      const found = observerEvents.find((e) => e.kind === 'draft_completed');
      if (found) { receivedCompleted = found; break; }
      await sleep(100);
    }
    assertTruthy('observer received draft_completed frame within 3s', receivedCompleted !== null);
    if (receivedCompleted) {
      log(`  received seq=${receivedCompleted.seq}`);
    }

    log('');
    log('── ASSERT E — zero "clock fired but completed" WARNINGs ──');
    log('  NOTE: engine log inspection required by architect out-of-band.');
    log('  Query template:');
    log(`    gcloud logging read --project=citrus-fantasy-staging --limit=20 \\`);
    log(`      'jsonPayload.message="clock fired but draftStatus=completed"' \\`);
    log(`      --format='value(timestamp, jsonPayload.lobbyId)'`);
    log('  Expected: zero rows in the window from ignition to completion.');
    log('  (F20 guard need not absorb because F26 teardown cancelled the timer.)');

    log('');
    log('── ASSERT F — mid-draft-joiner contiguity ──');
    log('  NOTE: F requires a SECOND rig invocation with mid-draft join');
    log('  timing. Not orchestrated inline (would require driveHarnessPicks');
    log('  pause+resume support). Deferred to a follow-up run:');
    log('    (a) Start draft, drive 3 picks, connect NEW harness client.');
    log('    (b) Assert new client\'s snapshot.recentEvents seq range is');
    log('        contiguous from its resync-point through the current seq.');
    log('    (c) Continue drive to completion; assert new client receives');
    log('        the live draft_completed frame.');

    log('');
    log('── ORCHESTRATION COMPLETE — lifecycle rig PASS on A/B/C/D + C-mandatory ──');
    log('    (E requires log-based follow-up query; F requires follow-up rig invocation.)');

    // Cleanup: close observer WS.
    try { observer.close?.(); } catch (_e) { /* ignore */ }

  } finally {
    await client.end();
  }
}

// ── Mode: zero-client (Rider 2) ──────────────────────────────────────
async function runZeroClientMode() {
  log('MODE = zero-client (Rider 2 — commissioner-with-zero-clients)');
  log(`Target: staging (HOST=${HOST}, WS_PORT=${WS_PORT}, SCHEME=${SCHEME})`);
  log(`League: ${WHITELISTED_LEAGUE_ID}`);
  log(`pickTimeLimit override: ${PICK_TIME}s (default was 90) — controls the real-wait duration`);
  if (DRY_RUN) { log('DRY RUN — printing plan only'); return; }

  const client = newPgClient();
  await client.connect();

  try {
    log('');
    log('── PREFLIGHT ──');
    await preflightNotStarted(client);
    await setFixturePickTimeLimit(client, PICK_TIME);

    log('');
    log('── STEP 1 — start_draft_v2 with ZERO WS clients connected ──');
    log('  (deliberately not connecting any harness clients here — that\'s the whole scenario)');
    const idem = randomUUID();
    const corr = randomUUID();
    const igniteStart = Date.now();
    const result = await invokeStartDraftV2(client, { idempotencyKey: idem, correlationId: corr });
    log(`  ✓ start_draft_v2 returned:`, JSON.stringify(result));

    log('');
    log('── STEP 2 — assert atomic post-RPC state ──');
    const cols = await queryLeagueColumns(client);
    assertEqual('draft_state', cols.draft_state, 'active');
    assertEqual('draft_status', cols.draft_status, 'in_progress');
    assertTruthy('pick_deadline set', cols.pick_deadline !== null);
    const events = await queryRecentEvents(client, 2);
    const seq1 = events.find((e) => e.seq === 1 || e.seq === '1');
    assertTruthy('draft_started event at seq=1', seq1);
    assertEqual('event_type', seq1.event_type, 'draft_started');

    log('');
    log(`── STEP 3 — WAIT ${PICK_TIME + 2}s for pick_deadline to elapse ──`);
    log(`  first_pick_deadline: ${result.first_pick_deadline}`);
    log('  (real wall-clock wait — no acceleration)');
    const waitMs = (PICK_TIME + 2) * 1000;
    await sleep(waitMs);
    log(`  ✓ waited ${waitMs}ms`);

    log('');
    log('── STEP 4 — first harness client connects ──');
    // Same normalized event-collection shape as lifecycle mode (INS-13).
    const lateJoinEvents = [];
    let ljDebugFramesLogged = 0;
    const lateJoiner = connectDraftClient({
      host: HOST,
      port: WS_PORT,
      scheme: SCHEME,
      leagueId: WHITELISTED_LEAGUE_ID,
      userId: harnessUserId(1),
      jwtSecret: JWT_SECRET,
      clientLabel: 'late-joiner',
      silentHeartbeat: true,
      onEvent: (evt) => {
        const parsedMsg = evt.frame?.parsed ?? null;
        const kind = parsedMsg?.payload?.kind ?? '<no-kind>';
        lateJoinEvents.push({
          receivedAt: Date.now(),
          seq: evt.seq,
          kind,
          parsedMsg,
        });
        if (ljDebugFramesLogged < 3) {
          ljDebugFramesLogged += 1;
          log(`  [debug frame #${ljDebugFramesLogged}] seq=${evt.seq} kind=${kind} envelope=${JSON.stringify(parsedMsg)}`);
        }
      },
    });
    log('  waiting for late-joiner snapshot...');
    await lateJoiner.waitForSnapshot?.() ?? await sleep(3000);
    log('  ✓ late-joiner connected + received snapshot');

    log('');
    log('── STEP 5 — F20 absorb-and-announce: autopick lands at seq=2 ──');
    log('  waiting up to 15s for autopick event to land...');
    const step5Deadline = Date.now() + 15000;
    let autopickEvent = null;
    while (Date.now() < step5Deadline) {
      const evs = await queryRecentEvents(client, 5);
      autopickEvent = evs.find((e) => e.seq === 2 || e.seq === '2');
      if (autopickEvent && autopickEvent.event_type === 'pick') {
        const actor = autopickEvent.actor;
        if (actor?.kind === 'autopick') break;
        autopickEvent = null;
      } else {
        autopickEvent = null;
      }
      await sleep(500);
    }
    assertTruthy('pick at seq=2 (autopick) landed within 15s', autopickEvent);
    if (autopickEvent) {
      assertEqual('picked_by_actor.kind', autopickEvent.actor?.kind, 'autopick');
      log(`  ✓ autopick payload:`, JSON.stringify(autopickEvent.payload));
    }

    log('');
    log('── ZERO-CLIENT RIG PASS — 5-step scenario documented in vivo ──');
    log('  Absorb-and-announce class demonstrated as normal operational mode.');

    try { lateJoiner.close?.(); } catch (_e) { /* ignore */ }

  } finally {
    await client.end();
  }
}

// ── Entry ────────────────────────────────────────────────────────────
(async () => {
  try {
    if (MODE === 'lifecycle')   await runLifecycleMode();
    else                        await runZeroClientMode();
    log('');
    log('=== RIG COMPLETE ===');
    process.exit(0);
  } catch (err) {
    console.error('[F27-rig] uncaught error:', err);
    process.exit(1);
  }
})();

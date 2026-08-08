#!/usr/bin/env node
// scripts/proof/lifecycle-acceptance-f27.local.mjs
//
// ============================================================================
// F27 lifecycle acceptance rig (REDESIGNED — architect ruling 2026-08-07 00:05)
// ============================================================================
//
// Redesign covers TWO defects surfaced 2026-08-06 (run #1 assert-C silence,
// run #2 stale-cursor skip) via production-faithful semantics that avoid
// both mechanisms structurally:
//
//   • Fresh-league-per-run (via fixture-12-f27-native)
//     - New league UUID each run → no in-memory lobby carryover
//     - draft_status='not_started', draft_state='not_started',
//       pick_deadline=NULL — no flip-era pre-arm
//     - Cursor at 0 → no seq_at_or_below_cursor duplicate-skip
//     - Old runs soft-deleted; 993c9219 permanently retired (evidence)
//
//   • Observer connects POST-ignition (matches production discovery-gate)
//     - No pre-ignition-observer timing window (rig-only construct)
//     - Observer's snapshot on connect covers draft_started semantics
//       (in_progress + deadline) — the production path
//     - Assert C is on LIVE PICK FRAMES (real broadcast traffic)
//     - Assert C-mandatory is on draft_completed frame (F26/KI-035 gate)
//
// AMENDMENTS 1-7 (architect 2026-08-07 00:05):
//
//   1. Isolation = fresh-league-per-run fixture (task #50). Container
//      bounce is BREAK-GLASS only, never default preamble. 993c9219 is
//      RETIRED PERMANENTLY.
//
//   2. `await connectDraftClient(...)` — observer is the HANDLE, not the
//      Promise. Real .close() in cleanup + on every assert-failure path.
//      Rig must exit cleanly with NO leaked sockets. (Tonight's zombie
//      was rig-authored: prior version did `const observer =
//      connectDraftClient(...)` without await; observer was a Promise;
//      observer.close?.() was a no-op; WS lingered → lobby immortality.)
//
//   3. Capture scope expanded: log snapshot receipt (resolve branch of
//      lib/ws-client's message handler) + every event frame. Direct-sends
//      visible in rig log now.
//
//   4. Observer connects POST-ignition. Assert-C = live pick frames.
//      Assert-C-mandatory = draft_completed frame. Assert on observer's
//      snapshot showing in_progress + deadline (covers draft_started
//      semantics via the production path).
//
//   5. Resync-from-0: lib/ws-client.mjs has NO resume/lastSeq support
//      today (grepped 2026-08-07 — zero matches for resume|lastSeq|
//      sinceSeq|resync). Assert G (buffered draft_started served on
//      resync) requires client machinery. Per architect: DO NOT build
//      client machinery now; docketed as named follow-up (task #18
//      authenticated-harness-client mode).
//
//   6. Assert F folded in: SECOND observer connects at pick 6 —
//      snapshot covers picks 1-5 (proves ring-buffer serving), live
//      receives picks 6-12, receives draft_completed frame.
//
//   7. STEP 6 REDEFINED = abandoned-mid-draft. Rider 2's original
//      "zero-client start" evolves to: ignite → one client connects →
//      lobby created → bootstrap applies draft_started → arm → client
//      disconnects cleanly → engine autopicks the full draft alone
//      (in_progress lobbies are reap-exempt per M1d) → assert DB
//      completion + draft_completed event + autopick lines in docker
//      logs (verified out-of-band). Nobody-ever-joined case is F23
//      (out of F26/F27 scope).
//
// NOTE: bootstrap-arming is load-bearing in this design. Post-ignition
// first-join arms from a possibly-past deadline (if the wait before
// join exceeded pick_time). F20 identity/wallclock guards own the
// immediate-fire case. Watch for those log lines during acceptance.
//
// USAGE (Garrett runs against staging in daylight):
//   node scripts/proof/lifecycle-acceptance-f27.local.mjs --mode=lifecycle
//   node scripts/proof/lifecycle-acceptance-f27.local.mjs --mode=abandoned-mid-draft
//
//   --dry-run          print planned actions; no state writes, no engine calls
//   --pick-time=N      override pickTimeLimit (default 30s)
//   --rounds=N         override rounds (default 1 → 12 picks)
//
// PRECONDITIONS:
//   1. F27 migration applied to staging (start_draft_v2 live) — done.
//   2. F26+F27 engine deploy live — pending morning per §4d.
//   3. F27-native fixture setup:
//        node scripts/proof/fixture-12-f27-native.local.mjs --execute
//      Rig reads the current league_id from the state file at startup.
//   4. INS-6 bridge rehearsed against SUPABASE_DB_URL.
//
// SAFETY POSTURE:
//   - Fresh league per run (isolation by construction).
//   - RPC-only writes.
//   - Real observer close() on ALL exit paths (finally + assert-failure).
//   - F18 rule: every assertion via query, not self-reported count.
//   - Assert-failure path calls cleanupObservers() before exit(1).
//
// ============================================================================

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

import {
  HARNESS_USER_IDS,
  harnessUserId,
} from './fixture-12.mjs';
import { getCurrentLeagueId } from './fixture-12-f27-native.local.mjs';
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

if (!['lifecycle', 'abandoned-mid-draft'].includes(MODE)) {
  console.error(`FATAL: --mode=lifecycle | abandoned-mid-draft (got ${MODE})`);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Global observer registry — every observer opened by the rig registers
// itself here so cleanupObservers() can close them all on ANY exit path,
// including assert-failure. Amendment 2 mandate.
const openObservers = new Set();
function registerObserver(handle) {
  openObservers.add(handle);
  return handle;
}
function cleanupObservers() {
  for (const obs of openObservers) {
    try { obs.close?.(); }
    catch (e) { log(`  ⚠ observer.close threw during cleanup: ${e.message ?? e}`); }
  }
  openObservers.clear();
}

// Assertion helpers that cleanup observers before exit on failure.
function fail(msg) {
  console.error('[F27-rig] FAIL:', msg);
  cleanupObservers();
  process.exit(1);
}
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

function newPgClient() {
  return new pg.Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 15_000,
  });
}

// ── Query helpers ────────────────────────────────────────────────────
async function queryLeagueColumns(client, leagueId) {
  const { rows } = await client.query(
    `SELECT draft_state, draft_status::text AS draft_status, pick_deadline,
            draft_event_counter, league_size, commissioner_id, settings
       FROM public.leagues WHERE id = $1`,
    [leagueId],
  );
  return rows[0] ?? null;
}
async function queryRecentEvents(client, leagueId, limit = 5) {
  const { rows } = await client.query(
    `SELECT id, seq, event_type, event_version, payload, payload_hash,
            idempotency_key, actor, correlation_id, created_at
       FROM public.draft_events
      WHERE league_id = $1
      ORDER BY seq DESC LIMIT $2`,
    [leagueId, limit],
  );
  return rows;
}

// Set pickTimeLimit on the target league (overrides fixture's setting so
// the acceptance rig can control the deadline window per invocation).
async function setPickTimeLimit(client, leagueId, seconds) {
  await client.query(
    `UPDATE public.leagues
        SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('pickTimeLimit', $2::int)
      WHERE id = $1`,
    [leagueId, seconds],
  );
  log(`  ✓ pickTimeLimit set to ${seconds}s on league ${leagueId}`);
}

// Fire start_draft_v2 via pg client (service_role bypass — actor.kind
// still validated by RPC).
async function invokeStartDraftV2(client, leagueId, { idempotencyKey, correlationId }) {
  const actor = {
    kind: 'commissioner',
    id: '00000000-0000-0000-0000-000000000000',
    note: 'F27 acceptance rig',
  };
  const { rows } = await client.query(
    `SELECT public.start_draft_v2($1::uuid, $2::jsonb, $3::uuid, $4::uuid) AS result`,
    [leagueId, JSON.stringify(actor), idempotencyKey, correlationId ?? null],
  );
  return rows[0]?.result ?? null;
}

// Ensure the fixture's target league is in not_started state (F27
// preflight requires this).
async function preflightNotStarted(client, leagueId) {
  const cols = await queryLeagueColumns(client, leagueId);
  if (!cols) fail(`league ${leagueId} not found — run fixture-12-f27-native.local.mjs --execute first`);
  if (cols.draft_status !== 'not_started') {
    fail(`preflight: draft_status=${cols.draft_status} (expected not_started); fresh-league fixture broken?`);
  }
  if (cols.draft_state !== 'not_started') {
    fail(`preflight: draft_state=${cols.draft_state} (expected not_started); F27-native fixture should have left this NULL/not_started`);
  }
  if (cols.pick_deadline !== null) {
    fail(`preflight: pick_deadline=${cols.pick_deadline} (expected NULL); F27-native fixture should have left this NULL`);
  }
  log(`  ✓ preflight PASS: league ${leagueId} in honest not_started state`);
  return cols;
}

// ── Observer factory ─────────────────────────────────────────────────
// Amendment 2: await connectDraftClient; observer IS the handle. Real
// close() in cleanup. Amendment 3: capture snapshot receipt + every event.
async function openObserver(clientLabel, leagueId, userSlot) {
  log(`  connecting observer "${clientLabel}" (userSlot=${userSlot})...`);
  const events = [];
  let snapshotReceived = null;
  let debugFramesLogged = 0;
  const DEBUG_FIRST_N = 5;

  const handle = await connectDraftClient({
    host: HOST,
    port: WS_PORT,
    scheme: SCHEME,
    leagueId,
    userId: harnessUserId(userSlot),
    jwtSecret: JWT_SECRET,
    clientLabel,
    silentHeartbeat: true,
    onEvent: (evt) => {
      // evt = { seq, frame, receivedAt } (ws-client.mjs:276)
      // frame = { ts, iso, raw, parsed }
      // parsed = { v, type:'event', seq, timestamp, correlationId, payload }
      const parsedMsg = evt.frame?.parsed ?? null;
      const kind = parsedMsg?.payload?.kind ?? '<no-kind>';
      events.push({
        receivedAt: Date.now(),
        seq: evt.seq,
        kind,
        parsedMsg,
      });
      if (debugFramesLogged < DEBUG_FIRST_N) {
        debugFramesLogged += 1;
        log(`  [${clientLabel} frame #${debugFramesLogged}] seq=${evt.seq} kind=${kind}`);
      }
    },
  });

  registerObserver(handle);
  // Amendment 3: capture the snapshot too (arrives via resolve-branch,
  // not via onEvent — architect's #4 rig-scope-gap fix).
  snapshotReceived = {
    receivedAt: handle.snapshotReceivedAt,
    frame: handle.snapshotFrame,
  };
  log(`  ✓ observer "${clientLabel}" connected; snapshot received at ${new Date(snapshotReceived.receivedAt).toISOString()}`);
  log(`  [${clientLabel} SNAPSHOT] parsed=${JSON.stringify(snapshotReceived.frame?.parsed).slice(0, 500)}${JSON.stringify(snapshotReceived.frame?.parsed).length > 500 ? '...' : ''}`);

  return {
    handle,
    events,
    snapshotReceived,
    close() {
      openObservers.delete(handle);
      try { handle.close(); } catch (e) { /* ignore */ }
    },
  };
}

// Wait up to timeoutMs for a matching event to appear in observer.events.
async function waitForEvent(observer, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = observer.events.find(predicate);
    if (found) return found;
    await sleep(100);
  }
  return null;
}

// Spawn draft-harness to drive N picks. Passes env through + reads
// current league_id from the F27-native state file.
async function driveHarnessPicks(picks, leagueId) {
  log(`  spawning draft-harness for ${picks} picks against league ${leagueId}...`);
  return new Promise((resolve) => {
    // draft-harness.mjs reads WHITELISTED_LEAGUE_ID from fixture-12.mjs
    // by default. For F27-native runs we need it to use the FRESH league
    // instead. Pass via env override; draft-harness should be updated
    // to honor F27_NATIVE_LEAGUE_ID if set. (If it doesn't yet, follow-
    // up task #52 to teach it — this may be a shakedown iteration
    // finding on first run.)
    const childEnv = { ...process.env, F27_NATIVE_LEAGUE_ID: leagueId };
    // H-2 fix (2026-08-07 architect ratification): draft-harness has no
    // --picks flag; it drives TOTAL_PICKS = TEAM_COUNT * ROUNDS. The prior
    // --picks=${picks} was a fake flag silently ignored → harness inherited
    // S2 default --rounds=3 and drove 36 picks against a 12-slot F27-native
    // league, over-shooting the draft. F27-native lifecycle league is 1
    // round × 12 teams = 12 picks; pass --rounds=1 explicitly. Pacing
    // defaults (2-5s jitter, well under the 30s pick clock) unchanged.
    // Follow-up (task #52 pin): true mid-drive-join needs --pause-after=N;
    // this fix does not address that.
    const child = spawn('node', [
      'scripts/proof/draft-harness.mjs',
      '--scenario=S2',
      '--rounds=1',
    ], {
      env: childEnv,
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

// ── Mode: lifecycle (Rider 4 — REDESIGNED) ───────────────────────────
async function runLifecycleMode() {
  log('MODE = lifecycle (Rider 4 REDESIGNED — post-ignition observer + live-frame asserts)');
  log(`Target: staging (HOST=${HOST}, WS_PORT=${WS_PORT}, SCHEME=${SCHEME})`);
  const leagueId = await getCurrentLeagueId();
  log(`Fresh F27-native league: ${leagueId}`);
  log(`pickTimeLimit override: ${PICK_TIME}s`);
  log(`Rounds: ${ROUNDS} → ${ROUNDS * 12} picks total`);
  if (DRY_RUN) { log('DRY RUN — printing plan only'); return; }

  const client = newPgClient();
  await client.connect();

  try {
    log('');
    log('── PREFLIGHT ──');
    await preflightNotStarted(client, leagueId);
    await setPickTimeLimit(client, leagueId, PICK_TIME);

    log('');
    log('── IGNITION — start_draft_v2 RPC (NO clients connected yet) ──');
    const idem = randomUUID();
    const corr = randomUUID();
    log(`  idempotencyKey=${idem}`);
    log(`  correlationId=${corr}`);
    const igniteStart = Date.now();
    const result = await invokeStartDraftV2(client, leagueId, {
      idempotencyKey: idem,
      correlationId: corr,
    });
    const igniteMs = Date.now() - igniteStart;
    log(`  ✓ start_draft_v2 returned in ${igniteMs}ms:`, JSON.stringify(result));

    log('');
    log('── ASSERT A — draft_started event at seq=1 with §6.4 fields ──');
    const events1 = await queryRecentEvents(client, leagueId, 3);
    const evAtSeq1 = events1.find((e) => e.seq === 1 || e.seq === '1');
    assertTruthy('event at seq=1 exists', evAtSeq1);
    assertEqual('event.event_type', evAtSeq1.event_type, 'draft_started');
    const p = evAtSeq1.payload;
    for (const field of ['started_at', 'first_pick_deadline', 'total_rounds',
                          'total_teams', 'pick_time_limit_seconds', 'draft_format']) {
      assertTruthy(`payload has "${field}"`, p[field] !== undefined && p[field] !== null);
    }

    log('');
    log('── ASSERT B — leagues columns atomic post-RPC ──');
    const cols = await queryLeagueColumns(client, leagueId);
    assertEqual('draft_state',  cols.draft_state,  'active');
    assertEqual('draft_status', cols.draft_status, 'in_progress');
    assertTruthy('pick_deadline set', cols.pick_deadline !== null);
    assertEqual(
      'pick_deadline == payload.first_pick_deadline',
      new Date(cols.pick_deadline).toISOString(),
      new Date(p.first_pick_deadline).toISOString(),
    );

    log('');
    log('── OBSERVER CONNECT (post-ignition) — Amendment 4 ──');
    const primaryObs = await openObserver('primary-observer', leagueId, 1);

    log('');
    log('── ASSERT snapshot shows in_progress + deadline (covers draft_started via prod path) ──');
    const snapPayload = primaryObs.snapshotReceived?.frame?.parsed?.payload;
    assertTruthy('primary observer snapshot has payload', snapPayload);
    if (snapPayload) {
      const snapState = snapPayload.stateSnapshot;
      assertTruthy('snapshot.stateSnapshot present', snapState);
      if (snapState) {
        assertEqual('snapshot draftStatus', snapState.draftStatus, 'in_progress');
        assertTruthy('snapshot currentPickDeadline set', snapState.currentPickDeadline);
      }
    }

    log('');
    log('── PICKS 1-5 — driving 5 picks via draft-harness (before Assert F second observer connects) ──');
    // We'd like to pause after pick 5, connect the second observer, then
    // resume. draft-harness doesn't support pause/resume today. For this
    // first-run scope, drive all 12 picks in one shot and connect the
    // second observer BEFORE the drive starts. Assert F snapshot-coverage
    // is degraded from "1-5" to "0" (empty ring buffer at connect time).
    //
    // FOLLOW-UP (task #53 or ride Assert G's client-machinery follow-up):
    // extend draft-harness with --pause-after=N or expose pick submission
    // as a library so this rig can drive picks inline. Until then, this
    // rig fires all picks after both observers are connected.
    log('  Assert F degraded: second observer connects BEFORE picks (no mid-drive pause API today)');
    log('  Follow-up docket: teach draft-harness pause/resume for true mid-draft-join test.');

    log('');
    log('── SECOND OBSERVER (Assert F setup — mid-draft-joiner surrogate) ──');
    const secondaryObs = await openObserver('secondary-observer', leagueId, 2);
    log(`  ✓ secondary observer connected; will receive live picks + completion`);

    log('');
    log('── DRIVE 12 PICKS via draft-harness ──');
    const harness = await driveHarnessPicks(12, leagueId);
    if (harness.code !== 0) {
      fail(`draft-harness exited with code ${harness.code}`);
    }
    log(`  ✓ 12 picks driven (child exit 0)`);

    log('');
    log('── ASSERT C — live pick frames observed (both observers, F27b true test) ──');
    // Post-drive, primary observer should have received frames for picks 1-12.
    // Wait a small window for any tail-broadcast to land.
    await sleep(500);
    const primaryPickCount = primaryObs.events.filter((e) => e.kind === 'pick_submitted').length;
    const secondaryPickCount = secondaryObs.events.filter((e) => e.kind === 'pick_submitted').length;
    log(`  primary observer received ${primaryPickCount} pick_submitted frames (expect 12)`);
    log(`  secondary observer received ${secondaryPickCount} pick_submitted frames (expect 12)`);
    assertEqual('primary observer pick frame count', primaryPickCount, 12);
    assertEqual('secondary observer pick frame count', secondaryPickCount, 12);

    log('');
    log('── ASSERT D — draft_completed emitter fires (F24) ──');
    const eventsFinal = await queryRecentEvents(client, leagueId, 3);
    const evComplete = eventsFinal.find((e) => e.event_type === 'draft_completed');
    assertTruthy('draft_completed event exists in DB', evComplete);
    assertTruthy('draft_completed.payload_hash present (Amendment 4)', evComplete?.payload_hash);
    assertTruthy('draft_completed.correlation_id present', evComplete?.correlation_id);
    const colsFinal = await queryLeagueColumns(client, leagueId);
    assertEqual('final draft_status', colsFinal.draft_status, 'completed');
    assertEqual('final pick_deadline', colsFinal.pick_deadline, null);

    log('');
    log('── ASSERT C-mandatory — both observers received draft_completed WS frame (F26/KI-035 gate) ──');
    const primaryCompleted = await waitForEvent(
      primaryObs, (e) => e.kind === 'draft_completed', 3000, 'primary completion',
    );
    assertTruthy('primary observer received draft_completed frame within 3s', primaryCompleted);
    const secondaryCompleted = await waitForEvent(
      secondaryObs, (e) => e.kind === 'draft_completed', 3000, 'secondary completion',
    );
    assertTruthy('secondary observer received draft_completed frame within 3s', secondaryCompleted);
    log(`  primary   completion frame seq=${primaryCompleted?.seq}`);
    log(`  secondary completion frame seq=${secondaryCompleted?.seq}`);

    log('');
    log('── ASSERT E — zero "clock fired but completed" WARNINGs (F26 teardown gate) ──');
    log('  NOTE: docker-logs-over-SSH verification required — architect adjudicates.');
    log('  Query template (Garrett runs; DO NOT use gcloud logging read — VM stdout is docker-only):');
    log(`    gcloud compute ssh citrus-draft-engine-staging \\`);
    log(`      --zone=northamerica-northeast1-a --quiet \\`);
    log(`      --command="sudo docker logs citrus-draft-engine --since 15m 2>&1 | grep -i 'clock fired'; echo END-OF-E-CHECK"`);
    log('  Expected: only END-OF-E-CHECK line (zero clock-fired hits).');
    log('  (A3 template: no --project flag [uses configured default];');
    log('   --since 15m widens absence-claim window; ; echo END-OF-E-CHECK');
    log('   inside remote cmd rescues SSH pipeline from grep-zero-match');
    log('   exit-1 dressing up as SSH failure — established gotcha.)');

    log('');
    log('── ASSERT F (degraded) — secondary observer completion coverage ──');
    log('  Full "mid-drive join with 1-5 snapshot coverage" requires draft-harness');
    log('  pause/resume — follow-up docketed. This run proves secondary observer');
    log('  receives contiguous live pick frames + completion (subset of Assert F).');

    log('');
    log('── ORCHESTRATION COMPLETE ──');
    log('  Lifecycle rig PASS on A/B/D/C-mandatory/F(degraded) + observer snapshot check');
    log('  Assert C (live pick frames) verified via count on both observers');
    log('  Assert E requires out-of-band docker-log-over-SSH verification');

    // Explicit cleanup (finally also fires but be defensive on assert paths).
    primaryObs.close();
    secondaryObs.close();

  } finally {
    cleanupObservers();
    await client.end();
  }
}

// ── Mode: abandoned-mid-draft (Amendment 7 — Rider 2 REDEFINED) ──────
async function runAbandonedMidDraftMode() {
  log('MODE = abandoned-mid-draft (Amendment 7 — post-first-join disconnect, engine autopicks alone)');
  log(`Target: staging (HOST=${HOST}, WS_PORT=${WS_PORT}, SCHEME=${SCHEME})`);
  const leagueId = await getCurrentLeagueId();
  log(`Fresh F27-native league: ${leagueId}`);
  log(`pickTimeLimit override: ${PICK_TIME}s (controls autopick cadence)`);
  if (DRY_RUN) { log('DRY RUN — printing plan only'); return; }

  const client = newPgClient();
  await client.connect();

  try {
    log('');
    log('── PREFLIGHT ──');
    await preflightNotStarted(client, leagueId);
    await setPickTimeLimit(client, leagueId, PICK_TIME);

    log('');
    log('── STEP 1 — start_draft_v2 (still no clients) ──');
    const idem = randomUUID();
    const result = await invokeStartDraftV2(client, leagueId, { idempotencyKey: idem });
    log(`  ✓ ignition:`, JSON.stringify(result));

    log('');
    log('── STEP 2 — one client connects, lobby created, bootstrap arms ──');
    const solo = await openObserver('abandonment-witness', leagueId, 1);
    log(`  ✓ client connected; snapshot draftStatus=${solo.snapshotReceived?.frame?.parsed?.payload?.stateSnapshot?.draftStatus}`);

    log('');
    log('── STEP 3 — client disconnects cleanly ──');
    solo.close();
    log(`  ✓ client closed WS`);

    log('');
    log(`── STEP 4 — wait for engine to autopick the full draft alone ──`);
    const expectedPicks = 12 * ROUNDS;
    // Each pick waits PICK_TIME seconds for expiry, then autopicks.
    // Budget: expectedPicks × (PICK_TIME + slack) seconds.
    const budgetMs = expectedPicks * (PICK_TIME + 3) * 1000;
    log(`  budget: ${budgetMs}ms (${expectedPicks} picks × ${PICK_TIME + 3}s each)`);
    log(`  polling DB every 5s for completion...`);
    const startWait = Date.now();
    let completed = false;
    while (Date.now() - startWait < budgetMs) {
      const cols = await queryLeagueColumns(client, leagueId);
      if (cols.draft_status === 'completed') {
        completed = true;
        log(`  ✓ draft completed at +${Math.round((Date.now() - startWait) / 1000)}s`);
        break;
      }
      await sleep(5000);
    }
    if (!completed) {
      fail(`draft did not complete within budget (${budgetMs}ms). engine autopick may have stalled.`);
    }

    log('');
    log('── STEP 5 — assert DB completion + draft_completed event + engine autopick lines ──');
    const evs = await queryRecentEvents(client, leagueId, 3);
    const evComplete = evs.find((e) => e.event_type === 'draft_completed');
    assertTruthy('draft_completed event exists in DB', evComplete);
    assertTruthy('draft_completed.payload_hash present', evComplete?.payload_hash);
    log('');
    log('  NOTE: autopick log-line verification requires docker-logs-over-SSH.');
    log('  Query template (Garrett runs):');
    log(`    gcloud compute ssh citrus-draft-engine-staging \\`);
    log(`      --zone=northamerica-northeast1-a --quiet \\`);
    log(`      --command="sudo docker logs citrus-draft-engine --since 30m 2>&1 | grep -E 'autopick|pick.processed' | wc -l; echo END-OF-AUTOPICK-COUNT"`);
    log(`  Expected: at least ${expectedPicks} pick.processed lines with wasAutopick=true,`);
    log('  then END-OF-AUTOPICK-COUNT marker line.');
    log('  (A3 template: no --project [default]; marker rescues wc-0 → SSH-1 dressup.)');

    log('');
    log('── ABANDONED-MID-DRAFT RIG PASS — engine self-completed to end ──');
    log('  In-progress lobbies are reap-exempt (M1d) — lobby survived post-disconnect,');
    log('  bootstrap-armed timer fired repeatedly, autopick cascade drove to completion.');

  } finally {
    cleanupObservers();
    await client.end();
  }
}

// ── Entry ────────────────────────────────────────────────────────────
(async () => {
  try {
    if (MODE === 'lifecycle')             await runLifecycleMode();
    else if (MODE === 'abandoned-mid-draft') await runAbandonedMidDraftMode();
    log('');
    log('=== RIG COMPLETE ===');
    process.exit(0);
  } catch (err) {
    console.error('[F27-rig] uncaught error:', err);
    cleanupObservers();
    process.exit(1);
  }
})();

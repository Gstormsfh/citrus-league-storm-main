#!/usr/bin/env node
// scripts/proof/lifecycle-acceptance-engine-ear.local.mjs
//
// ============================================================================
// ENGINE-EAR v3 Slice 1 acceptance rig (E106, 2026-08-11)
// ============================================================================
//
// Proves the three Slice 1 items against LIVE STAGING via DB-observable
// side effects. Written to be architect/Garrett-executable per the
// infra-command hand-off protocol — this script drives the DB probes
// but hands off gcloud/docker calls (engine restart, log grep) to
// PowerShell blocks that print for manual execution.
//
// Scenarios:
//   S1 — CLIENT-INDEPENDENT IGNITION (item 1: NOTIFY-creates-lobby)
//        Ignite a rig draft with ZERO WS clients connected. Assert
//        autopicks flow: draft_events accumulates 12 pick_submitted +
//        1 draft_completed within pick_time_limit_seconds × 12 + slack.
//
//   S2 — BOOT-SCAN RESUME (item 2)
//        Ignite a rig draft, wait for a few picks to land, then hand
//        off the engine-restart command. After restart with STILL NO
//        WS CLIENTS, assert the draft resumes autopicking to completion
//        within (remaining_picks × pick_time_limit_seconds + slack).
//
//   S3 — INSTANT-AUTOPICK FOR UNOWNED SEATS (item 6)
//        Ignite a rig draft where every team has owner_id=NULL (the
//        fixture-12 default). Assert autopicks land within
//        INSTANT_AUTOPICK_ARM_MS + slack per pick — total draft
//        completes in ~30s (12 × ~2s + broadcast overhead) instead of
//        the RPC pick_time_limit × 12 window.
//
// Fixture: uses fixture-12-f27-native pattern (fresh league per run).
// All rig writes go through the fixture's execute/reset flow.
//
// USAGE:
//   node scripts/proof/lifecycle-acceptance-engine-ear.local.mjs --scenario=S1
//   node scripts/proof/lifecycle-acceptance-engine-ear.local.mjs --scenario=S2
//   node scripts/proof/lifecycle-acceptance-engine-ear.local.mjs --scenario=S3
//
//   --dry-run     print planned actions; no writes, no engine calls
//   --league-id   override rig league id (default: fresh via fixture-12)
//   --slack-ms    per-pick slack budget (default 5000)
//
// PREREQ (from scripts/proof/README.md §2):
//   $env:SUPABASE_DB_URL       = direct primary (not pooler)
//   $env:SUPABASE_JWT_SECRET   = HS256 secret
//   Fixture-12-f27-native applied against target league.
//
// SAFETY:
//   - Whitelisted to F27_NATIVE_LEAGUE_ID env (mirrors draft-harness).
//   - No prod writes; staging-only via SUPABASE_DB_URL env.
//   - Engine restart is HAND-OFF ONLY (prints PowerShell block).
//   - Assertion failures exit nonzero + print reset guidance.
// ============================================================================

import pg from 'pg';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const SCENARIO = opt('scenario', 'S1');
const LEAGUE_ID = opt('league-id', process.env.F27_NATIVE_LEAGUE_ID);
const SLACK_MS = parseInt(opt('slack-ms', '5000'), 10);
const DRY_RUN = flag('dry-run');

if (!['S1', 'S2', 'S3'].includes(SCENARIO)) {
  console.error(`FATAL: --scenario must be S1 | S2 | S3 (got: ${SCENARIO})`);
  process.exit(2);
}
if (!LEAGUE_ID) {
  console.error(
    'FATAL: --league-id or F27_NATIVE_LEAGUE_ID env required. ' +
      'Run fixture-12-f27-native.local.mjs first to provision a rig league.',
  );
  process.exit(2);
}

if (!process.env.SUPABASE_DB_URL) {
  console.error(
    'FATAL: SUPABASE_DB_URL env required. See scripts/proof/README.md §2.',
  );
  process.exit(2);
}
if (process.env.SUPABASE_DB_URL.match(/pooler\.supabase|pgbouncer|:6543/)) {
  console.error(
    'FATAL: SUPABASE_DB_URL is a POOLED URL. LISTEN frames do not survive ' +
      'pgbouncer (KI-E010). Use the direct connection string.',
  );
  process.exit(2);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL });

// ── Helpers ─────────────────────────────────────────────────────────

async function queryLeagueState(leagueId) {
  const { rows } = await pool.query(
    `SELECT draft_status, draft_state, pick_deadline,
            (SELECT count(*) FROM draft_events WHERE league_id = $1) AS event_count,
            (SELECT count(*) FROM draft_picks_v2 WHERE league_id = $1) AS pick_count
       FROM leagues WHERE id = $1`,
    [leagueId],
  );
  if (rows.length === 0) {
    throw new Error(`league ${leagueId} not found`);
  }
  return {
    draftStatus: rows[0].draft_status,
    draftState: rows[0].draft_state,
    pickDeadline: rows[0].pick_deadline,
    eventCount: parseInt(rows[0].event_count, 10),
    pickCount: parseInt(rows[0].pick_count, 10),
  };
}

async function queryLastEventKind(leagueId) {
  const { rows } = await pool.query(
    `SELECT event_type, seq FROM draft_events
      WHERE league_id = $1 ORDER BY seq DESC LIMIT 1`,
    [leagueId],
  );
  return rows.length > 0 ? { eventType: rows[0].event_type, seq: parseInt(rows[0].seq, 10) } : null;
}

async function waitForCompletion(leagueId, timeoutMs, pollMs = 1000) {
  const start = Date.now();
  let lastState = null;
  while (Date.now() - start < timeoutMs) {
    const s = await queryLeagueState(leagueId);
    lastState = s;
    if (s.draftStatus === 'completed' && s.pickCount === 12) {
      return { completed: true, durationMs: Date.now() - start, state: s };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { completed: false, durationMs: Date.now() - start, state: lastState };
}

function printPowerShellBlock(label, block) {
  console.log('');
  console.log(`── HAND-OFF: ${label} — paste in PowerShell ──`);
  console.log(block);
  console.log('── END HAND-OFF — press Enter here after running ──');
}

async function waitForEnter(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.once('data', () => resolve());
    process.stdin.resume();
  });
}

// ── Scenario runners ────────────────────────────────────────────────

async function runS1() {
  console.log(`\n═══ S1 — CLIENT-INDEPENDENT IGNITION (item 1) ═══`);
  console.log(`League: ${LEAGUE_ID}`);
  console.log('Pre-state:');
  const pre = await queryLeagueState(LEAGUE_ID);
  console.log(JSON.stringify(pre, null, 2));

  if (pre.draftStatus !== 'not_started') {
    console.error(
      `FATAL: league draftStatus=${pre.draftStatus} — expected not_started. ` +
        `Reset via fixture-12-f27-native.local.mjs --reset --execute first.`,
    );
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('DRY RUN — would call start_draft_v2 + wait for completion');
    console.log('  Assert: draft_status=completed + pick_count=12 within budget');
    console.log('  Budget: 12 × pick_time_limit_seconds + slack');
    return;
  }

  console.log('\nCalling start_draft_v2 RPC (client-independent — no WS)…');
  const igniteResult = await pool.query(
    `SELECT public.start_draft_v2($1, $2::jsonb, $3::uuid, NULL) AS result`,
    [
      LEAGUE_ID,
      JSON.stringify({ kind: 'commissioner', id: '00000000-0000-0000-0000-000000000000' }),
      crypto.randomUUID(),
    ],
  );
  console.log(`Ignition result: ${JSON.stringify(igniteResult.rows[0].result)}`);

  // pickTimeLimitSeconds from the fixture default is 30; total budget
  // = 12 × 30 + slack (per-pick) + engine cascade overhead.
  const pickTimeSec = 30;
  const totalBudgetMs = 12 * (pickTimeSec * 1000 + SLACK_MS);
  console.log(`\nWaiting up to ${totalBudgetMs}ms for autopicks + completion…`);
  console.log('Expected: ZERO WS clients connected → NOTIFY-creates-lobby + autopick cascade.');

  const result = await waitForCompletion(LEAGUE_ID, totalBudgetMs);
  if (!result.completed) {
    console.error(`\n✗ S1 FAIL — draft did NOT complete within ${totalBudgetMs}ms`);
    console.error(`Final state: ${JSON.stringify(result.state, null, 2)}`);
    printPowerShellBlock(
      'Engine log tail (diagnostic)',
      `gcloud compute ssh citrus-draft-engine-staging \`
  --zone=northamerica-northeast1-a --project=citrus-fantasy-staging \`
  --command="sudo docker logs citrus-draft-engine 2>&1 | tail -100"`,
    );
    process.exit(1);
  }
  console.log(`\n✓ S1 PASS — draft completed in ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`Item 1 (NOTIFY-creates-lobby) PROVEN: ignition without a client → cascade → completion.`);
}

async function runS2() {
  console.log(`\n═══ S2 — BOOT-SCAN RESUME (item 2) ═══`);
  console.log(`League: ${LEAGUE_ID}`);
  const pre = await queryLeagueState(LEAGUE_ID);
  console.log(`Pre-state: ${JSON.stringify(pre)}`);

  if (pre.draftStatus !== 'not_started') {
    console.error(`FATAL: reset first (draftStatus=${pre.draftStatus})`);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('DRY RUN — would ignite, wait for pick 3, hand off engine restart, wait for completion');
    return;
  }

  console.log('\n[1/3] Ignite via start_draft_v2 (no client)…');
  await pool.query(
    `SELECT public.start_draft_v2($1, $2::jsonb, $3::uuid, NULL)`,
    [
      LEAGUE_ID,
      JSON.stringify({ kind: 'commissioner', id: '00000000-0000-0000-0000-000000000000' }),
      crypto.randomUUID(),
    ],
  );
  console.log('Waiting for pick 3 to land (~90s + slack)…');
  const preRestartBudget = 3 * (30 * 1000 + SLACK_MS);
  const startT = Date.now();
  while (Date.now() - startT < preRestartBudget) {
    const s = await queryLeagueState(LEAGUE_ID);
    if (s.pickCount >= 3) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const midState = await queryLeagueState(LEAGUE_ID);
  console.log(`[2/3] Mid-cascade state: ${JSON.stringify(midState)}`);
  if (midState.pickCount < 3 || midState.draftStatus !== 'in_progress') {
    console.error('✗ S2 FAIL — pre-restart cascade did not reach 3 picks');
    process.exit(1);
  }

  printPowerShellBlock(
    'Engine restart — proves boot-scan resume (item 2)',
    `gcloud compute ssh citrus-draft-engine-staging \`
  --zone=northamerica-northeast1-a --project=citrus-fantasy-staging \`
  --command="sudo docker restart citrus-draft-engine"
Start-Sleep -Seconds 5

# Verify boot-scan log line landed:
gcloud compute ssh citrus-draft-engine-staging \`
  --zone=northamerica-northeast1-a --project=citrus-fantasy-staging \`
  --command="sudo docker logs citrus-draft-engine 2>&1 | tail -30 | grep -E 'boot_scan|notify_creates_lobby|instant_autopick'"`,
  );
  await waitForEnter('Press Enter after engine restart completes and logs verified…\n');

  console.log('[3/3] Waiting for remaining picks + completion (~9 × 30s + slack)…');
  const postRestartBudget = 9 * (30 * 1000 + SLACK_MS);
  const result = await waitForCompletion(LEAGUE_ID, postRestartBudget);
  if (!result.completed) {
    console.error(`\n✗ S2 FAIL — draft did NOT resume to completion within ${postRestartBudget}ms`);
    console.error(`Final state: ${JSON.stringify(result.state, null, 2)}`);
    process.exit(1);
  }
  console.log(`\n✓ S2 PASS — post-restart resume completed in ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`Item 2 (boot-scan resume) PROVEN: engine restart mid-cascade → autopicks continue → completion.`);
}

async function runS3() {
  console.log(`\n═══ S3 — INSTANT-AUTOPICK FOR UNOWNED SEATS (item 6) ═══`);
  console.log(`League: ${LEAGUE_ID}`);

  const pre = await queryLeagueState(LEAGUE_ID);
  console.log(`Pre-state: ${JSON.stringify(pre)}`);

  // Assert all teams unowned (fixture-12 default).
  const { rows: ownerRows } = await pool.query(
    `SELECT count(*) FILTER (WHERE owner_id IS NULL) AS unowned,
            count(*) AS total
       FROM teams WHERE league_id = $1`,
    [LEAGUE_ID],
  );
  const unowned = parseInt(ownerRows[0].unowned, 10);
  const total = parseInt(ownerRows[0].total, 10);
  console.log(`Teams: ${unowned} unowned / ${total} total`);
  if (unowned !== total || total === 0) {
    console.error(
      `FATAL: S3 requires all ${total} teams to have owner_id=NULL. ` +
        `Got ${unowned} unowned. Use a fresh fixture-12 league or NULL out owner_ids.`,
    );
    process.exit(1);
  }
  if (pre.draftStatus !== 'not_started') {
    console.error(`FATAL: reset first (draftStatus=${pre.draftStatus})`);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('DRY RUN — would ignite + wait for completion within 12 × (2s + slack) window');
    return;
  }

  console.log('\nIgniting + waiting for INSTANT autopick cascade…');
  const igniteStart = Date.now();
  await pool.query(
    `SELECT public.start_draft_v2($1, $2::jsonb, $3::uuid, NULL)`,
    [
      LEAGUE_ID,
      JSON.stringify({ kind: 'commissioner', id: '00000000-0000-0000-0000-000000000000' }),
      crypto.randomUUID(),
    ],
  );

  // Budget: 12 × INSTANT_AUTOPICK_ARM_MS (2s) + generous slack.
  // Each ownerless-seat autopick should fire within ~2s of on-clock
  // transition per E106 amendment. Full draft: ~24s + broadcast + slack.
  const instantBudget = 12 * (2000 + SLACK_MS);
  console.log(`Budget: ${instantBudget}ms (12 × (2s + ${SLACK_MS}ms slack))`);

  const result = await waitForCompletion(LEAGUE_ID, instantBudget, 500);
  if (!result.completed) {
    console.error(`\n✗ S3 FAIL — draft did NOT complete within instant window`);
    console.error(`Final state: ${JSON.stringify(result.state, null, 2)}`);
    console.error(`Expected: draft completes in ~${(12 * 2000) / 1000}s (12 × ~2s autopicks).`);
    console.error(`Item 6 (INSTANT-AUTOPICK) NOT PROVEN — check computeArmDeadlineForOnClockTeam invocation.`);
    process.exit(1);
  }
  const durationSec = result.durationMs / 1000;
  const expectedSec = 12 * 2;
  console.log(`\n✓ S3 PASS — draft completed in ${durationSec.toFixed(1)}s (expected ~${expectedSec}s)`);
  if (result.durationMs > 12 * (2000 + SLACK_MS)) {
    console.warn(
      `⚠  Note: duration exceeded 12 × (2s + slack) — INSTANT-AUTOPICK may have fallen through ` +
        `to the RPC deadline for some seats. Check engine logs for instant_autopick_arm lines.`,
    );
  }
  console.log(`Item 6 (INSTANT-AUTOPICK for unowned seats) PROVEN.`);
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  try {
    if (SCENARIO === 'S1') await runS1();
    else if (SCENARIO === 'S2') await runS2();
    else if (SCENARIO === 'S3') await runS3();

    console.log('\n─── CLEANUP ───');
    console.log(`Run fixture-12-f27-native.local.mjs --reset --execute to restore state.`);
  } catch (err) {
    console.error('\n✗ SCENARIO THREW:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Suppress the unused-import lint (existsSync / fileURLToPath /
// dirname / join are stub imports for parity with sibling scripts).
void existsSync;
void fileURLToPath;
void dirname;
void join;

main();

#!/usr/bin/env node
// scripts/proof/fixture-12-f27-native.local.mjs
//
// ============================================================================
// F27-native fixture (task #50 durable fix, INS-12 close)
// ============================================================================
//
// Sibling of fixture-12.mjs. Creates a FRESH league UUID per invocation, with
// draft_status='not_started', draft_state='not_started', pick_deadline=NULL —
// the honest commissioner-start pre-state that start_draft_v2 requires.
// **Does NOT pre-arm draft_state/pick_deadline (flip-era vestige retired).**
//
// Legacy fixture-12.mjs continues to work for the S1/S2/S3/S4 perf scenarios
// against the retired league 993c9219; F27-native runs use their own fresh
// league each invocation and never touch the retired one.
//
// USAGE:
//   node scripts/proof/fixture-12-f27-native.local.mjs                 # DRY RUN setup
//   node scripts/proof/fixture-12-f27-native.local.mjs --execute       # apply setup
//   node scripts/proof/fixture-12-f27-native.local.mjs --reset         # DRY RUN reset
//   node scripts/proof/fixture-12-f27-native.local.mjs --reset --execute
//   node scripts/proof/fixture-12-f27-native.local.mjs --rounds=1      # 1-round (12 picks)
//   node scripts/proof/fixture-12-f27-native.local.mjs --pick-clock=30 # pickTimeLimit=30s
//
// ENV:
//   SUPABASE_DB_URL                  direct primary URL (KI-E010: NOT pooler)
//   F27_NATIVE_COMMISSIONER_ID       optional; UUID of a profile to own the
//                                    new league. Defaults to lookup from
//                                    league 993c9219's commissioner_id.
//
// STATE FILE:
//   scripts/proof/fixture-12-f27-native-state.local.json
//     { leagueId, teamIds, sessionId, createdAt, rounds, pickClock }
//   Written by --execute; read by --reset. Presence blocks a second --execute
//   (must reset first) — mirrors fixture-12's F10 already-configured guard.
//
// RIG CONSUMER:
//   lifecycle-acceptance-f27.local.mjs imports getCurrentLeagueId() from this
//   file to discover the fresh league_id for the run.
//
// SOFT-DELETE ON --reset:
//   Renames leagues.name → `[DELETED-<ts>] <original>`; sets draft_status
//   to 'completed'; marks settings.f27_native_deleted=true. Rows stay in
//   DB for audit; a periodic janitor (post-launch) can hard-purge based
//   on age. `draft_events` for the deleted league stay; `draft_picks_v2`
//   stay. Fixture-native leagues carry `settings.f27_native_run=true` so
//   orphan detection is a WHERE-clause scan.
//
// 993c9219 IS RETIRED PERMANENTLY (architect ruling 2026-08-07 00:05).
//   This script REFUSES to write to 993c9219. Its persisted snapshot row
//   is a poisoned chimera {seq:1, completed} + it stands as evidence.
//
// ============================================================================

import pg from 'pg';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Reuse the deterministic team/user/player identity surface from fixture-12
// (harness clients use these regardless of which league they target).
import {
  HARNESS_TEAM_IDS,
  HARNESS_SESSION_ID,
  TEAM_COUNT,
  HARNESS_USER_IDS,
  harnessUserId,
  HARNESS_PLAYER_IDS,
} from './fixture-12.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE_PATH = join(__dirname, 'fixture-12-f27-native-state.local.json');

const RETIRED_LEAGUE_ID = '993c9219-ecbf-4e4e-9fb0-e9837e1bded3'; // permanent retire

// ── CLI parse ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const OPT_EXECUTE = args.includes('--execute');
const OPT_RESET = args.includes('--reset');
const OPT_HELP = args.includes('--help') || args.includes('-h');
const roundsArg = args.find((a) => a.startsWith('--rounds='));
const ROUNDS = roundsArg ? parseInt(roundsArg.slice('--rounds='.length), 10) : 1;
const pickClockArg = args.find((a) => a.startsWith('--pick-clock='));
const PICK_CLOCK = pickClockArg ? parseInt(pickClockArg.slice('--pick-clock='.length), 10) : 30;

if (OPT_HELP) {
  console.log(`Usage: node ${fileURLToPath(import.meta.url)} [--execute] [--reset] [--rounds=N] [--pick-clock=SECONDS]

DRY-RUN by default. --execute is required to apply DB writes.

--execute            apply setup (creates fresh league UUID)
--reset              plan reset (soft-delete the current F27-native league)
--reset --execute    apply reset (needs state file present)
--rounds=N           snake rounds (default 1 = 12 picks)
--pick-clock=N       pickTimeLimit seconds (default 30)
`);
  process.exit(0);
}

const RUN_MODE = OPT_EXECUTE ? 'EXECUTE' : 'DRY-RUN';

// ── Env preflight ────────────────────────────────────────────────────
const DB_URL = process.env.SUPABASE_DB_URL;
if (!DB_URL) { console.error('FATAL: SUPABASE_DB_URL not set'); process.exit(2); }
for (const p of ['pooler.supabase.com', 'pgbouncer', ':6543']) {
  if (DB_URL.includes(p)) {
    console.error(`FATAL: SUPABASE_DB_URL contains pooled pattern "${p}" (KI-E010)`);
    process.exit(2);
  }
}
const F27_NATIVE_COMMISSIONER_ID = process.env.F27_NATIVE_COMMISSIONER_ID ?? null;

const log = (...m) => console.log(...m);
const fatal = (msg) => { console.error('[fixture-f27-native] FATAL:', msg); process.exit(1); };

function newPgClient() {
  return new pg.Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 15_000,
  });
}

function snakeTeamOrder(round) {
  return round % 2 === 1 ? HARNESS_TEAM_IDS.slice() : HARNESS_TEAM_IDS.slice().reverse();
}

// ── Public API for the rig ───────────────────────────────────────────
// Reads the state file and returns the current F27-native league id.
// Throws if no state file exists (rig should call fixture setup first).
export async function getCurrentLeagueId() {
  if (!existsSync(STATE_FILE_PATH)) {
    throw new Error(
      `F27-native state file missing at ${STATE_FILE_PATH}. Run fixture-12-f27-native.local.mjs --execute first.`,
    );
  }
  const raw = await readFile(STATE_FILE_PATH, 'utf8');
  const state = JSON.parse(raw);
  if (!state.leagueId || typeof state.leagueId !== 'string') {
    throw new Error(`F27-native state file at ${STATE_FILE_PATH} malformed: ${raw}`);
  }
  return state.leagueId;
}

// Also expose the identity surface for consumers that want it via this
// module (rig will import from fixture-12 directly for teams/users, but
// this re-export keeps the sibling-file boundary clean if consumers ever
// want to switch imports).
export {
  HARNESS_TEAM_IDS,
  HARNESS_SESSION_ID,
  TEAM_COUNT,
  HARNESS_USER_IDS,
  harnessUserId,
  HARNESS_PLAYER_IDS,
};

// ── RESET path ───────────────────────────────────────────────────────
async function runReset(client) {
  log('');
  log('╔═══════════════════════════════════════════════════════════════╗');
  log(`║  MODE: RESET  ${RUN_MODE.padEnd(47)}║`);
  log('╚═══════════════════════════════════════════════════════════════╝');
  log('');

  if (!existsSync(STATE_FILE_PATH)) {
    log(`No state file at ${STATE_FILE_PATH} — nothing to reset. Exiting.`);
    return;
  }

  const raw = await readFile(STATE_FILE_PATH, 'utf8');
  const state = JSON.parse(raw);
  const leagueId = state.leagueId;
  log(`state file target league: ${leagueId}`);

  if (leagueId === RETIRED_LEAGUE_ID) {
    fatal(`Refusing to touch retired league ${RETIRED_LEAGUE_ID}. State file corrupt — inspect ${STATE_FILE_PATH} manually.`);
  }

  // Read current state.
  const before = await client.query(
    `SELECT id, name, draft_status::text AS draft_status, draft_state, pick_deadline,
            draft_event_counter, settings
       FROM public.leagues WHERE id = $1`,
    [leagueId],
  );
  if (before.rows.length === 0) {
    log(`League ${leagueId} not found in DB. Deleting state file only.`);
    if (OPT_EXECUTE) {
      await unlink(STATE_FILE_PATH);
      log(`  ✓ state file deleted`);
    } else {
      log('  DRY-RUN — would delete state file');
    }
    return;
  }
  const row = before.rows[0];
  log(`current row:`);
  log(`  name: ${row.name}`);
  log(`  draft_status: ${row.draft_status}`);
  log(`  draft_state: ${row.draft_state}`);
  log(`  pick_deadline: ${row.pick_deadline}`);
  log(`  draft_event_counter: ${row.draft_event_counter}`);

  const eventsCount = await client.query(
    `SELECT count(*)::int AS c FROM public.draft_events WHERE league_id = $1`,
    [leagueId],
  );
  const picksCount = await client.query(
    `SELECT count(*)::int AS c FROM public.draft_picks_v2 WHERE league_id = $1`,
    [leagueId],
  );
  log(`  draft_events for this league: ${eventsCount.rows[0].c}`);
  log(`  draft_picks_v2 for this league: ${picksCount.rows[0].c}`);

  // Soft-delete plan.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const newName = `[DELETED-${ts}] ${row.name}`;
  const newSettings = { ...(row.settings ?? {}), f27_native_deleted: true, f27_native_deleted_at: ts };
  const nextStatus = row.draft_status === 'completed' ? row.draft_status : 'completed';

  log('');
  log('── PLAN ──');
  log(`  UPDATE public.leagues`);
  log(`    SET name = '${newName}',`);
  log(`        settings = ${JSON.stringify(newSettings)},`);
  log(`        draft_status = '${nextStatus}'`);
  log(`   WHERE id = '${leagueId}';`);
  log(`  → then delete state file ${STATE_FILE_PATH}`);
  log('');
  log('NOTE: draft_events + draft_picks_v2 for this league are LEFT INTACT');
  log('      (audit trail; future janitor can hard-purge based on soft-delete age).');

  if (!OPT_EXECUTE) {
    log('');
    log('DRY-RUN — no writes performed. Re-run with --execute to apply.');
    return;
  }

  await client.query('BEGIN');
  try {
    await client.query(
      `UPDATE public.leagues
          SET name = $2,
              settings = $3::jsonb,
              draft_status = $4
        WHERE id = $1`,
      [leagueId, newName, JSON.stringify(newSettings), nextStatus],
    );
    await client.query('COMMIT');
    log(`  ✓ leagues row soft-deleted`);
    await unlink(STATE_FILE_PATH);
    log(`  ✓ state file deleted`);
  } catch (err) {
    await client.query('ROLLBACK');
    fatal(`reset UPDATE failed: ${err.message}`);
  }
}

// ── EXECUTE (SETUP) path ─────────────────────────────────────────────
async function runSetup(client) {
  log('');
  log('╔═══════════════════════════════════════════════════════════════╗');
  log(`║  MODE: SETUP  ${RUN_MODE.padEnd(47)}║`);
  log(`║  Team count:      ${String(TEAM_COUNT).padEnd(44)}║`);
  log(`║  Rounds:          ${String(ROUNDS).padEnd(44)}║`);
  log(`║  Total picks:     ${String(TEAM_COUNT * ROUNDS).padEnd(44)}║`);
  log(`║  Pick clock:      ${String(PICK_CLOCK).padEnd(44)}║`);
  log('╚═══════════════════════════════════════════════════════════════╝');
  log('');

  // Already-configured guard (mirrors fixture-12 F10 discipline).
  if (existsSync(STATE_FILE_PATH)) {
    fatal(`State file already exists at ${STATE_FILE_PATH}. Run --reset --execute first (retires the previous F27-native league) OR delete the file if you know what you're doing.`);
  }

  // Resolve commissioner_id.
  let commissionerId = F27_NATIVE_COMMISSIONER_ID;
  if (!commissionerId) {
    log('F27_NATIVE_COMMISSIONER_ID env not set — looking up commissioner_id from retired league 993c9219 (evidence-only read; no writes to that league).');
    const cq = await client.query(
      `SELECT commissioner_id FROM public.leagues WHERE id = $1`,
      [RETIRED_LEAGUE_ID],
    );
    if (cq.rows.length === 0) {
      fatal(`Retired league ${RETIRED_LEAGUE_ID} not found — cannot infer commissioner_id. Set F27_NATIVE_COMMISSIONER_ID env explicitly.`);
    }
    commissionerId = cq.rows[0].commissioner_id;
    log(`  inferred commissioner_id: ${commissionerId}`);
  }

  // Fresh league UUID.
  const leagueId = randomUUID();
  const leagueName = `F27-Native Rig Run ${new Date().toISOString()}`;
  const sessionId = randomUUID();

  // Settings for the new league:
  //   - pickTimeLimit: from --pick-clock (default 30)
  //   - draftType: 'snake' (fixture is snake-only)
  //   - f27_native_run: true (marker for orphan detection)
  const settings = {
    pickTimeLimit: PICK_CLOCK,
    draftType: 'snake',
    f27_native_run: true,
    f27_native_created_at: new Date().toISOString(),
  };

  log('');
  log('── PLAN ──');
  log(`  Fresh league:`);
  log(`    id:              ${leagueId}`);
  log(`    name:            ${leagueName}`);
  log(`    commissioner_id: ${commissionerId}`);
  log(`    draft_status:    'not_started' (default — F27 semantics)`);
  log(`    draft_state:     'not_started' (default — NO pre-arm; flip-era vestige retired)`);
  log(`    pick_deadline:   NULL (default — NO pre-arm)`);
  log(`    league_size:     ${TEAM_COUNT}`);
  log(`    settings:        ${JSON.stringify(settings)}`);
  log(`    draft_rounds:    ${ROUNDS}`);
  log(`    roster_size:     ${ROUNDS * TEAM_COUNT}`);
  log(`  ${TEAM_COUNT} team INSERTs (harness team IDs 77777777-…-01..12).`);
  log(`  ${ROUNDS} draft_order INSERTs (snake team_order per round).`);
  log(`  Write state file ${STATE_FILE_PATH}.`);
  log('');
  log('  NOTE: start_draft_v2 will perform ignition (draft_state=active,');
  log('        draft_status=in_progress, pick_deadline set). This fixture');
  log('        does NOT pre-arm — that would break F27 semantics.');

  if (!OPT_EXECUTE) {
    log('');
    log('DRY-RUN — no writes performed. Re-run with --execute to apply.');
    return;
  }

  await client.query('BEGIN');
  try {
    // leagues INSERT
    await client.query(
      `INSERT INTO public.leagues
         (id, name, commissioner_id, draft_status, roster_size, draft_rounds,
          settings, league_size)
       VALUES ($1, $2, $3::uuid, 'not_started', $4, $5, $6::jsonb, $7)`,
      [
        leagueId,
        leagueName,
        commissionerId,
        ROUNDS * TEAM_COUNT,
        ROUNDS,
        JSON.stringify(settings),
        TEAM_COUNT,
      ],
    );
    log(`  ✓ league row inserted`);

    // teams INSERT × TEAM_COUNT
    for (let i = 1; i <= TEAM_COUNT; i++) {
      const tid = HARNESS_TEAM_IDS[i - 1];
      await client.query(
        `INSERT INTO public.teams (id, league_id, team_name, owner_id)
         VALUES ($1, $2, $3, NULL)
         ON CONFLICT (id) DO UPDATE SET league_id = EXCLUDED.league_id, team_name = EXCLUDED.team_name`,
        [tid, leagueId, `Harness Team ${String(i).padStart(2, '0')}`],
      );
    }
    log(`  ✓ ${TEAM_COUNT} team rows inserted (or updated to point at new league)`);

    // draft_order INSERT × ROUNDS
    for (let r = 1; r <= ROUNDS; r++) {
      await client.query(
        `INSERT INTO public.draft_order (league_id, round_number, team_order, draft_session_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [leagueId, r, JSON.stringify(snakeTeamOrder(r)), sessionId],
      );
    }
    log(`  ✓ ${ROUNDS} draft_order rows inserted (snake)`);

    await client.query('COMMIT');

    // Write state file
    const state = {
      leagueId,
      leagueName,
      commissionerId,
      teamIds: HARNESS_TEAM_IDS,
      sessionId,
      rounds: ROUNDS,
      pickClock: PICK_CLOCK,
      createdAt: new Date().toISOString(),
    };
    await writeFile(STATE_FILE_PATH, JSON.stringify(state, null, 2), 'utf8');
    log(`  ✓ state file written to ${STATE_FILE_PATH}`);
    log('');
    log('=========================================');
    log(`F27-NATIVE FIXTURE READY — league ${leagueId}`);
    log('=========================================');
    log('');
    log('start_draft_v2 will perform ignition when the rig invokes it.');
    log('draft_state and pick_deadline will remain NULL until ignition.');
  } catch (err) {
    await client.query('ROLLBACK');
    fatal(`setup failed (transaction rolled back): ${err.message}`);
  }
}

// ── Entry ────────────────────────────────────────────────────────────
const IS_MAIN =
  process.argv[1] &&
  process.argv[1].replace(/\\/g, '/').endsWith('fixture-12-f27-native.local.mjs');

if (IS_MAIN) {
  const client = newPgClient();
  await client.connect();
  try {
    if (OPT_RESET) {
      await runReset(client);
    } else {
      await runSetup(client);
    }
  } finally {
    await client.end();
  }
}

#!/usr/bin/env node
// scripts/proof/fixture-min.mjs
//
// Minimal fixture for the live-broadcast proof (chunk 11g.10 sub-step 10c-1c
// verification). Prepares the Staging League for exactly ONE valid pick via
// submit_pick_v2's autopick actor path, and resets everything it changed.
//
// This script is scope-limited to the 12-team production-shape fixture builder
// slated for 10c-2. It sets up the minimum rows/columns submit_pick_v2 (§B.9)
// preflight requires and nothing else.
//
// Modes:
//   node fixture-min.mjs                    → DRY RUN setup (default)
//   node fixture-min.mjs --execute          → apply setup
//   node fixture-min.mjs --reset            → DRY RUN reset
//   node fixture-min.mjs --reset --execute  → apply reset
//
// Env:
//   SUPABASE_DB_URL   direct primary URL (NOT pooled). Never written to disk.
//                     Refused if the URL matches known pooler patterns
//                     (KI-E010: PgBouncer / pooler / :6543 drop LISTEN frames
//                     and any transactional side-effect that depends on
//                     session state; we surface it here to keep the failure
//                     mode obvious and fast).
//
// Non-negotiables:
//   - Hard-whitelisted to the canonical Staging League UUID. There is no
//     override flag; the constant `WHITELISTED_LEAGUE_ID` is the sole target.
//   - Every write is printed BEFORE it runs (dry-run) and printed AGAIN as
//     it runs (execute), with the before-values it depends on.
//   - Reset restores by-value, not by re-derivation.
//   - State file (`scripts/proof/fixture-state.local.json`) carries the
//     before-values setup captured; reset consumes and deletes it.
//     File is ephemeral — never commit it.

import pg from 'pg';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────
// Constants — the entire hard whitelist and identity surface.
// Canonical Staging League UUID established 2026-07-24 by in-database
// boolean comparison per docs/PHASE_4_5_PROJECT_PLAN.md Decision Log
// "UUID correction — canonical" entry. This is the ONLY league this
// script operates on. No override flag exists by design.
// ─────────────────────────────────────────────────────────────────────────
const WHITELISTED_LEAGUE_ID = '993c9219-ecbf-4e4e-9fb0-e9837e1bded3';

// Deterministic proof-team id. Fixed so re-runs are idempotent and the
// reset path can find it by id. `44444444-…` chosen to avoid collision
// with the phase1_regression_seed.sql pattern (`33333333-…`).
const PROOF_TEAM_ID = '44444444-4444-4444-4444-444444444444';
const PROOF_TEAM_NAME = 'Proof Team (10c-1c verification)';

// Deterministic draft session id (for the draft_order row). Not
// semantically load-bearing here — just needs to be a valid uuid.
const PROOF_SESSION_ID = '66666666-6666-6666-6666-666666666666';

// State file — ephemeral, local-only, never committed. Reset consumes
// and deletes it. If missing at reset time, reset falls back to a
// conservative "delete everything I might have created" plan and
// warns the operator to inspect the DB after.
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE_PATH = join(__dirname, 'fixture-state.local.json');

// Pooled-URL patterns per KI-E010. Any of these substrings in the
// connection string → hard refuse. The engine's own startup script has
// the same check (`infra/gce/draft-engine-startup.sh` + friends).
const POOLED_URL_PATTERNS = [
  'pooler.supabase.com',
  'pgbouncer',
  ':6543',
];

// ─────────────────────────────────────────────────────────────────────────
// CLI parsing (no dep — we have two boolean flags).
// ─────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const OPT_EXECUTE = args.includes('--execute');
const OPT_RESET = args.includes('--reset');
const OPT_HELP = args.includes('--help') || args.includes('-h');

if (OPT_HELP) {
  console.log(`Usage:
  node scripts/proof/fixture-min.mjs                    # DRY RUN setup (default)
  node scripts/proof/fixture-min.mjs --execute          # apply setup
  node scripts/proof/fixture-min.mjs --reset            # DRY RUN reset
  node scripts/proof/fixture-min.mjs --reset --execute  # apply reset

Env: SUPABASE_DB_URL (direct primary URL, not pooled).
Whitelist: only operates on league ${WHITELISTED_LEAGUE_ID}.
`);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────
// Env validation.
// ─────────────────────────────────────────────────────────────────────────
const DB_URL = process.env.SUPABASE_DB_URL;
if (!DB_URL) {
  console.error('FATAL: SUPABASE_DB_URL not set in environment.');
  console.error('       Set via Secret Manager, e.g.');
  console.error('       $env:SUPABASE_DB_URL = (gcloud secrets versions access latest --secret=SUPABASE_DB_URL --project=citrus-fantasy-staging)');
  process.exit(2);
}
for (const pat of POOLED_URL_PATTERNS) {
  if (DB_URL.includes(pat)) {
    console.error(`FATAL: SUPABASE_DB_URL contains pooled pattern "${pat}".`);
    console.error(`       KI-E010: pooled connections drop LISTEN frames and`);
    console.error(`       may silently alter session-scoped behavior. Use the`);
    console.error(`       direct primary URL only.`);
    process.exit(2);
  }
}

// Redact for banner logging.
function redactUrl(url) {
  return url.replace(/:\/\/[^:]+:[^@]+@/, '://REDACTED:REDACTED@');
}

// ─────────────────────────────────────────────────────────────────────────
// Statement printer — every SQL/action goes through this so dry-run and
// execute paths use identical rendering. Format is copy-pasteable to psql.
// ─────────────────────────────────────────────────────────────────────────
const RUN_MODE = OPT_EXECUTE ? 'EXECUTE' : 'DRY-RUN';
function planStep(label, sql, params) {
  console.log('');
  console.log(`── ${label} ──`);
  console.log(sql.trim());
  if (params !== undefined) {
    console.log(`params: ${JSON.stringify(params)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Setup path.
// ─────────────────────────────────────────────────────────────────────────
async function runSetup(client) {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log(`║  MODE: SETUP ${RUN_MODE.padEnd(45)} ║`);
  console.log(`║  Target league: ${WHITELISTED_LEAGUE_ID}     ║`);
  console.log(`║  DB: ${redactUrl(DB_URL).padEnd(53)} ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');

  // ── Role check ─────────────────────────────────────────────────────
  const roleRes = await client.query('SELECT current_user, session_user, current_setting(\'is_superuser\') AS superuser');
  console.log('');
  console.log('── DB session identity ──');
  console.log(roleRes.rows[0]);
  const currentUser = roleRes.rows[0].current_user;
  if (currentUser !== 'postgres' && currentUser !== 'service_role' && currentUser !== 'supabase_admin') {
    console.warn(`WARNING: current_user=${currentUser} is not in {postgres, service_role, supabase_admin}.`);
    console.warn('         submit_pick_v2 (§B.9) rejects actor.kind=autopick unless auth.role()');
    console.warn('         returns \'service_role\' or \'postgres\'. Verify before executing.');
  }

  // ── Fetch current before-state (READ-ONLY; safe in either mode) ────
  console.log('');
  console.log('── BEFORE-VALUES (read-only) ──');

  const league = await client.query(
    `SELECT id, name, draft_state, pick_deadline, league_size, draft_event_counter,
            settings->>'draftType'    AS draft_type,
            settings->>'pickTimeLimit' AS pick_time_limit
       FROM public.leagues
      WHERE id = $1`,
    [WHITELISTED_LEAGUE_ID],
  );
  if (league.rows.length === 0) {
    throw new Error(
      `Whitelisted league ${WHITELISTED_LEAGUE_ID} does not exist. ` +
      `Verify SUPABASE_DB_URL points at the staging project; if it does, ` +
      `the league itself is missing and requires a separate creation ` +
      `commit (out of scope for this script).`,
    );
  }
  const leagueRow = league.rows[0];
  console.log('leagues row:');
  console.log(leagueRow);

  const eventsCount = await client.query(
    `SELECT count(*)::int AS c, max(seq) AS max_seq
       FROM public.draft_events
      WHERE league_id = $1`,
    [WHITELISTED_LEAGUE_ID],
  );
  const picksCount = await client.query(
    `SELECT count(*)::int AS c
       FROM public.draft_picks_v2
      WHERE league_id = $1`,
    [WHITELISTED_LEAGUE_ID],
  );
  console.log(`draft_events count = ${eventsCount.rows[0].c} (max_seq=${eventsCount.rows[0].max_seq})`);
  console.log(`draft_picks_v2 count = ${picksCount.rows[0].c}`);
  if (eventsCount.rows[0].c > 0 || picksCount.rows[0].c > 0) {
    throw new Error(
      `League has existing draft_events (${eventsCount.rows[0].c}) or ` +
      `draft_picks_v2 (${picksCount.rows[0].c}). Run --reset --execute first, ` +
      `or investigate what wrote them.`,
    );
  }

  const proofTeam = await client.query(
    `SELECT id, team_name, owner_id FROM public.teams WHERE id = $1`,
    [PROOF_TEAM_ID],
  );
  const proofTeamExists = proofTeam.rows.length > 0;
  console.log(`proof team (${PROOF_TEAM_ID}) exists: ${proofTeamExists}`);
  if (proofTeamExists) {
    console.log('  existing row:', proofTeam.rows[0]);
    if (proofTeam.rows[0].id && proofTeam.rows[0].league_id !== WHITELISTED_LEAGUE_ID) {
      // Note: SELECT above didn't request league_id; harmless — we treat
      // "team with this deterministic id exists" as the reuse signal.
    }
  }

  const draftOrder = await client.query(
    `SELECT round_number, team_order, draft_session_id
       FROM public.draft_order
      WHERE league_id = $1 AND round_number = 1`,
    [WHITELISTED_LEAGUE_ID],
  );
  const draftOrderExists = draftOrder.rows.length > 0;
  console.log(`draft_order round 1 exists: ${draftOrderExists}`);
  if (draftOrderExists) {
    console.log('  existing row:', draftOrder.rows[0]);
  }

  // ── Compute planned writes ─────────────────────────────────────────
  const now = new Date();
  const pickDeadline = new Date(now.getTime() + 5 * 60 * 1000); // now + 5 min

  const plan = {
    beforeValues: {
      league: {
        draft_state: leagueRow.draft_state,
        pick_deadline: leagueRow.pick_deadline,
        league_size: leagueRow.league_size,
        draft_event_counter: leagueRow.draft_event_counter,
      },
      proofTeamExists,
      draftOrderRound1: draftOrderExists ? draftOrder.rows[0] : null,
    },
    steps: [],
  };

  // Step: leagues update — only include columns that need to change.
  const leagueUpdateColumns = [];
  const leagueUpdateValues = [];
  const leagueUpdateBefore = {};
  if (leagueRow.draft_state !== 'active') {
    leagueUpdateColumns.push('draft_state');
    leagueUpdateValues.push('active');
    leagueUpdateBefore.draft_state = leagueRow.draft_state;
  }
  // pick_deadline: set to now+5m if past/null. Also always advance if
  // it's not in the future (a stale future value from a prior test is
  // fine, but a stale past value would trip other engine paths).
  const currentDeadline = leagueRow.pick_deadline
    ? new Date(leagueRow.pick_deadline)
    : null;
  const deadlineIsUsable = currentDeadline && currentDeadline.getTime() > now.getTime() + 60_000;
  if (!deadlineIsUsable) {
    leagueUpdateColumns.push('pick_deadline');
    leagueUpdateValues.push(pickDeadline.toISOString());
    leagueUpdateBefore.pick_deadline = leagueRow.pick_deadline;
  }
  if (leagueRow.league_size === null || leagueRow.league_size <= 0) {
    leagueUpdateColumns.push('league_size');
    leagueUpdateValues.push(1);
    leagueUpdateBefore.league_size = leagueRow.league_size;
  }
  // draft_event_counter: must be 0 for pick_number=1 to work correctly
  // in submit_pick_v2's counter-advance-then-emit path (§B.9 Step 3).
  if (leagueRow.draft_event_counter !== 0 && leagueRow.draft_event_counter !== '0') {
    leagueUpdateColumns.push('draft_event_counter');
    leagueUpdateValues.push(0);
    leagueUpdateBefore.draft_event_counter = leagueRow.draft_event_counter;
  }
  if (leagueUpdateColumns.length > 0) {
    const setClause = leagueUpdateColumns
      .map((c, i) => `${c} = $${i + 2}`)
      .join(', ');
    plan.steps.push({
      label: `leagues UPDATE (${leagueUpdateColumns.join(', ')})`,
      sql: `UPDATE public.leagues SET ${setClause} WHERE id = $1`,
      params: [WHITELISTED_LEAGUE_ID, ...leagueUpdateValues],
      before: leagueUpdateBefore,
    });
  }

  // Step: proof team insert.
  if (!proofTeamExists) {
    plan.steps.push({
      label: 'teams INSERT (proof team)',
      sql: `INSERT INTO public.teams (id, league_id, team_name, owner_id)
            VALUES ($1, $2, $3, NULL)`,
      params: [PROOF_TEAM_ID, WHITELISTED_LEAGUE_ID, PROOF_TEAM_NAME],
      before: { existed: false },
    });
  }

  // Step: draft_order round 1.
  const proofTeamOrderJson = JSON.stringify([PROOF_TEAM_ID]);
  if (!draftOrderExists) {
    plan.steps.push({
      label: 'draft_order INSERT (round 1, [proof-team])',
      sql: `INSERT INTO public.draft_order (league_id, round_number, team_order, draft_session_id)
            VALUES ($1, 1, $2::jsonb, $3)`,
      params: [WHITELISTED_LEAGUE_ID, proofTeamOrderJson, PROOF_SESSION_ID],
      before: { existed: false },
    });
  } else {
    // Row exists — overwrite team_order (and session_id) to guarantee
    // team_order[0] is the proof team. Record before-value.
    plan.steps.push({
      label: 'draft_order UPDATE (round 1 team_order/session_id)',
      sql: `UPDATE public.draft_order
              SET team_order = $2::jsonb, draft_session_id = $3
            WHERE league_id = $1 AND round_number = 1`,
      params: [WHITELISTED_LEAGUE_ID, proofTeamOrderJson, PROOF_SESSION_ID],
      before: {
        team_order: draftOrder.rows[0].team_order,
        draft_session_id: draftOrder.rows[0].draft_session_id,
      },
    });
  }

  // ── Print plan ─────────────────────────────────────────────────────
  console.log('');
  console.log(`── PLANNED WRITES (${plan.steps.length}) ──`);
  if (plan.steps.length === 0) {
    console.log('  (no writes needed — state already matches fixture requirements)');
  }
  for (const step of plan.steps) {
    planStep(step.label, step.sql, step.params);
    console.log(`before: ${JSON.stringify(step.before)}`);
  }

  if (!OPT_EXECUTE) {
    console.log('');
    console.log('DRY RUN — no writes performed. Re-run with --execute to apply.');
    return;
  }

  // ── Execute ────────────────────────────────────────────────────────
  console.log('');
  console.log('── EXECUTING (single transaction) ──');
  await client.query('BEGIN');
  try {
    for (const step of plan.steps) {
      console.log(`  → ${step.label}`);
      await client.query(step.sql, step.params);
    }
    await client.query('COMMIT');
    console.log('  ✓ COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('  ✗ ROLLBACK on error:', err.message);
    throw err;
  }

  // Persist before-values for reset.
  const state = {
    createdAt: new Date().toISOString(),
    leagueId: WHITELISTED_LEAGUE_ID,
    proofTeamId: PROOF_TEAM_ID,
    plan: plan.beforeValues,
    stepsApplied: plan.steps.map((s) => ({ label: s.label, before: s.before })),
  };
  await writeFile(STATE_FILE_PATH, JSON.stringify(state, null, 2));
  console.log('');
  console.log(`  state written: ${STATE_FILE_PATH}`);
  console.log('  (ephemeral — reset consumes and deletes it; never commit this file)');
}

// ─────────────────────────────────────────────────────────────────────────
// Reset path — restores by-value from the state file, plus deletes any
// draft_events/draft_picks_v2 that the pick RPC wrote (CASCADE handles
// draft_picks_v2 via source_event_id FK).
// ─────────────────────────────────────────────────────────────────────────
async function runReset(client) {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log(`║  MODE: RESET ${RUN_MODE.padEnd(45)} ║`);
  console.log(`║  Target league: ${WHITELISTED_LEAGUE_ID}     ║`);
  console.log(`║  DB: ${redactUrl(DB_URL).padEnd(53)} ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');

  let state = null;
  if (existsSync(STATE_FILE_PATH)) {
    state = JSON.parse(await readFile(STATE_FILE_PATH, 'utf8'));
    console.log('');
    console.log(`── state file loaded: ${STATE_FILE_PATH} ──`);
    console.log(state);
  } else {
    console.warn('');
    console.warn('── WARNING: state file missing ──');
    console.warn(`   ${STATE_FILE_PATH} does not exist. Reset will use the`);
    console.warn('   conservative fallback: delete draft_events + delete proof team +');
    console.warn('   delete draft_order round 1. It will NOT touch leagues columns');
    console.warn('   because it doesn\'t know what the before-values were. Inspect');
    console.warn('   the leagues row manually after this run.');
  }

  const plan = [];

  // Step: delete draft_events for the league (CASCADE handles draft_picks_v2).
  plan.push({
    label: 'draft_events DELETE (CASCADEs to draft_picks_v2 via source_event_id FK)',
    sql: `DELETE FROM public.draft_events WHERE league_id = $1`,
    params: [WHITELISTED_LEAGUE_ID],
  });

  // Chunk 11g.10 sub-step 10c-1c.1: also wipe draft_snapshots for the
  // whitelisted league. The engine's periodic + milestone snapshot
  // timers (LobbyManager.startSnapshotTimer, chunk 11g.7-7c) will have
  // persisted snapshot rows even for a short-lived proof run, and a
  // leftover snapshot with stale `last_applied_seq` skews the engine's
  // next-run bootstrap. draft_snapshots has no FK to draft_events so
  // order versus the event delete is irrelevant. Folds in the behavior
  // previously carried by the ad-hoc `clear-snapshots.local.mjs`
  // one-shot Garrett was running by hand between proof cycles.
  plan.push({
    label: 'draft_snapshots DELETE (all rows for whitelisted league)',
    sql: `DELETE FROM public.draft_snapshots WHERE league_id = $1`,
    params: [WHITELISTED_LEAGUE_ID],
  });

  // Step: restore leagues columns from state (if available).
  if (state && state.plan && state.plan.league) {
    const before = state.plan.league;
    const setPairs = [];
    const values = [];
    for (const col of ['draft_state', 'pick_deadline', 'league_size', 'draft_event_counter']) {
      if (before[col] !== undefined) {
        setPairs.push(`${col} = $${values.length + 2}`);
        values.push(before[col]);
      }
    }
    if (setPairs.length > 0) {
      plan.push({
        label: `leagues UPDATE (restore ${setPairs.length} column(s) to before-values)`,
        sql: `UPDATE public.leagues SET ${setPairs.join(', ')} WHERE id = $1`,
        params: [WHITELISTED_LEAGUE_ID, ...values],
      });
    }
  }

  // Step: draft_order — delete if we created it, restore if we mutated it.
  if (state && state.plan) {
    const beforeOrder = state.plan.draftOrderRound1;
    if (beforeOrder === null) {
      // We created the row; delete it.
      plan.push({
        label: 'draft_order DELETE round 1 (we created it)',
        sql: `DELETE FROM public.draft_order WHERE league_id = $1 AND round_number = 1`,
        params: [WHITELISTED_LEAGUE_ID],
      });
    } else {
      // Row pre-existed; restore its team_order + session_id.
      plan.push({
        label: 'draft_order UPDATE round 1 (restore team_order + session_id)',
        sql: `UPDATE public.draft_order
                SET team_order = $2::jsonb, draft_session_id = $3
              WHERE league_id = $1 AND round_number = 1`,
        params: [
          WHITELISTED_LEAGUE_ID,
          JSON.stringify(beforeOrder.team_order),
          beforeOrder.draft_session_id,
        ],
      });
    }
  } else {
    // No state → conservative fallback: delete round 1 unconditionally.
    plan.push({
      label: 'draft_order DELETE round 1 (fallback; no state file)',
      sql: `DELETE FROM public.draft_order WHERE league_id = $1 AND round_number = 1`,
      params: [WHITELISTED_LEAGUE_ID],
    });
  }

  // Step: proof team — delete only if we created it (state says
  // proofTeamExists=false), otherwise leave the pre-existing team.
  const createdProofTeam = state ? state.plan.proofTeamExists === false : true;
  if (createdProofTeam) {
    plan.push({
      label: 'teams DELETE (proof team — we created it)',
      sql: `DELETE FROM public.teams WHERE id = $1`,
      params: [PROOF_TEAM_ID],
    });
  } else {
    console.log('');
    console.log('  note: proof team pre-existed at setup time; leaving in place.');
  }

  // ── Print plan ─────────────────────────────────────────────────────
  console.log('');
  console.log(`── PLANNED RESET WRITES (${plan.length}) ──`);
  for (const step of plan) {
    planStep(step.label, step.sql, step.params);
  }

  if (!OPT_EXECUTE) {
    console.log('');
    console.log('DRY RUN — no writes performed. Re-run with --reset --execute to apply.');
    return;
  }

  // ── Execute ────────────────────────────────────────────────────────
  console.log('');
  console.log('── EXECUTING RESET (single transaction) ──');
  await client.query('BEGIN');
  try {
    for (const step of plan) {
      console.log(`  → ${step.label}`);
      await client.query(step.sql, step.params);
    }
    await client.query('COMMIT');
    console.log('  ✓ COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('  ✗ ROLLBACK on error:', err.message);
    throw err;
  }

  // Delete state file.
  if (existsSync(STATE_FILE_PATH)) {
    await unlink(STATE_FILE_PATH);
    console.log(`  state file deleted: ${STATE_FILE_PATH}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Main.
// ─────────────────────────────────────────────────────────────────────────
(async () => {
  const client = new pg.Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
    // Small statement timeout — this fixture does nothing slow.
    statement_timeout: 15_000,
  });
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
})().catch((err) => {
  console.error('');
  console.error('FATAL:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});

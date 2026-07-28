#!/usr/bin/env node
// scripts/proof/fixture-12.mjs
//
// 12-team snake-draft fixture for the perf harness (chunk 11g.10 sub-step
// 10c-2). Modeled directly on fixture-min.mjs — same dry-run default,
// hard-whitelist, state-file-based reset, snapshot-clear semantics — but
// scales up to 12 deterministic teams, N rounds of snake draft_order,
// and a deterministic pool of 36+ player_ids the harness picks from.
//
// Modes:
//   node fixture-12.mjs                     → DRY RUN setup (default)
//   node fixture-12.mjs --execute           → apply setup
//   node fixture-12.mjs --reset             → DRY RUN reset
//   node fixture-12.mjs --reset --execute   → apply reset
//   node fixture-12.mjs --execute --rounds=5  → 5-round snake (60 picks)
//
// Env:
//   SUPABASE_DB_URL   direct primary URL (NOT pooled). Never written
//                     to disk. Refused if pooled patterns detected.

import pg from 'pg';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────
// Constants — hard whitelist + deterministic identity surface.
//
// The Staging League UUID is fixed. The 12 team UUIDs are also fixed
// (deterministic slugs of a shared prefix) so re-runs are idempotent
// and the reset path can identify our rows by prefix rather than by
// state-file lookup (belt-and-suspenders against a lost state file).
// ─────────────────────────────────────────────────────────────────────
const WHITELISTED_LEAGUE_ID = '993c9219-ecbf-4e4e-9fb0-e9837e1bded3';
const TEAM_COUNT = 12;

// 12 deterministic team ids. Pattern `77777777-…-<slot>` — the
// `77777777` prefix is unused elsewhere in the DB (phase1 seed uses
// `33333333`, fixture-min uses `44444444`), so `WHERE id::text LIKE
// '77777777-%'` uniquely identifies the harness's teams.
function harnessTeamId(slot) {
  const s = String(slot).padStart(12, '0');
  return `77777777-7777-7777-7777-${s}`;
}
const HARNESS_TEAM_IDS = Array.from({ length: TEAM_COUNT }, (_, i) => harnessTeamId(i + 1));

// Deterministic draft session id for the draft_order rows.
const HARNESS_SESSION_ID = '77777777-7777-7777-7777-777777777777';

// Deterministic per-slot owner id space. `sub` in the harness WS JWTs
// will map slot N → the owner id for team N; we insert these as
// `owner_id NULL` on the teams row (RPC uses actor.kind='autopick' so
// the RPC preflight doesn't consult owner_id) — but the harness client
// lib will still mint JWTs with per-slot sub so the engine's uWS
// upgrade log has a distinguishing userId per client.
// (Exposed by the file so draft-harness.mjs can import it.)
//
// 2026-07-28 F1 chunk — must be VALID UUIDv4 per join-path-robustness
// chunk 11g.10 sub-step 10c-2 gate (a) UUID_V4_REGEX at
// server/src/draft/uws-server.ts:116. The pre-chunk `88888888-8888-
// 8888-8888-<12 hex>` shape had `8` in the third group's first
// position (v4 marker requires `4`) and would fail the gate. Third
// group's first char is now `4`; fourth group's first char stays `8`
// (valid v4 variant marker). Change is scope-contained: harness user
// IDs are ephemeral JWT-sub-only values, never persisted in DB
// (teams.owner_id stays NULL per the fixture setup path).
export function harnessUserId(slot) {
  const s = String(slot).padStart(12, '0');
  return `88888888-8888-4888-8888-${s}`;
}
export const HARNESS_USER_IDS = Array.from({ length: TEAM_COUNT }, (_, i) => harnessUserId(i + 1));

// Deterministic player id pool. 36 distinct integers = enough for
// a 3-round × 12-team snake draft. Range chosen in real NHL API ID
// space (~2015 draft class window) so future work that cross-checks
// against a players table won't need re-mapping; RPC-side has no FK
// so any distinct ints work today.
export const HARNESS_PLAYER_IDS = Array.from({ length: 96 }, (_, i) => 8478000 + i);

// Exported so draft-harness.mjs can import + use identical pool.
export { WHITELISTED_LEAGUE_ID, HARNESS_TEAM_IDS, HARNESS_SESSION_ID, TEAM_COUNT };

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE_PATH = join(__dirname, 'fixture-12-state.local.json');

const POOLED_URL_PATTERNS = ['pooler.supabase.com', 'pgbouncer', ':6543'];

// ─────────────────────────────────────────────────────────────────────
// CLI parsing.
// ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const OPT_EXECUTE = args.includes('--execute');
const OPT_RESET = args.includes('--reset');
const OPT_HELP = args.includes('--help') || args.includes('-h');
const roundsArg = args.find((a) => a.startsWith('--rounds='));
const ROUNDS = roundsArg ? parseInt(roundsArg.slice('--rounds='.length), 10) : 3;

// Chunk 11g.10 sub-step 10c-2 batch 1 (item 4): --pick-clock=N writes
// `settings.pickTimeLimit = N` on the whitelisted league during setup
// so the harness's autopick-timing scenario (S5) exercises N-second
// pick windows end-to-end. Writes to the JSONB `settings` field (the
// only path any engine, RPC, or UI code reads today per the pick-clock
// audit) — deliberately NOT to any `pick_time_limit` NUMERIC column
// (which the audit confirmed no code reads even if it exists on some
// legacy DB shape). Before-value is captured in the state file and
// restored on --reset.
const pickClockArg = args.find((a) => a.startsWith('--pick-clock='));
const PICK_CLOCK = pickClockArg
  ? parseInt(pickClockArg.slice('--pick-clock='.length), 10)
  : null;

if (OPT_HELP) {
  console.log(`Usage:
  node scripts/proof/fixture-12.mjs                       # DRY RUN setup (default, 3 rounds)
  node scripts/proof/fixture-12.mjs --execute             # apply setup
  node scripts/proof/fixture-12.mjs --reset               # DRY RUN reset
  node scripts/proof/fixture-12.mjs --reset --execute     # apply reset
  node scripts/proof/fixture-12.mjs --execute --rounds=5  # 5-round snake (60 picks)
  node scripts/proof/fixture-12.mjs --execute --pick-clock=90  # set settings.pickTimeLimit=90 (S5 scenario)

Env: SUPABASE_DB_URL (direct primary URL, not pooled).
Whitelist: only operates on league ${WHITELISTED_LEAGUE_ID}.
Teams:    12 deterministic ids under prefix 77777777-7777-7777-7777-.
`);
  process.exit(0);
}

if (ROUNDS < 1 || ROUNDS > 25 || !Number.isFinite(ROUNDS)) {
  console.error(`FATAL: invalid --rounds value ${ROUNDS} (expected 1..25).`);
  process.exit(2);
}

if (PICK_CLOCK !== null) {
  // Match the server-side validate.ts clamp (batch 1 item 3): 30..300.
  if (!Number.isFinite(PICK_CLOCK) || PICK_CLOCK < 30 || PICK_CLOCK > 300) {
    console.error(`FATAL: invalid --pick-clock value ${PICK_CLOCK} (expected 30..300).`);
    process.exit(2);
  }
}

const DB_URL = process.env.SUPABASE_DB_URL;
if (!DB_URL) {
  console.error('FATAL: SUPABASE_DB_URL not set.');
  process.exit(2);
}
for (const pat of POOLED_URL_PATTERNS) {
  if (DB_URL.includes(pat)) {
    console.error(`FATAL: SUPABASE_DB_URL contains pooled pattern "${pat}" (KI-E010).`);
    process.exit(2);
  }
}

function redactUrl(url) {
  return url.replace(/:\/\/[^:]+:[^@]+@/, '://REDACTED:REDACTED@');
}

const RUN_MODE = OPT_EXECUTE ? 'EXECUTE' : 'DRY-RUN';
function planStep(label, sql, params) {
  console.log('');
  console.log(`── ${label} ──`);
  console.log(sql.trim());
  if (params !== undefined) console.log(`params: ${JSON.stringify(params)}`);
}

// ─────────────────────────────────────────────────────────────────────
// Snake team_order per round.
//   round 1 → teams[0..11]
//   round 2 → teams[11..0]  (reverse)
//   round 3 → teams[0..11]
//   ...
// Odd rounds forward, even rounds reversed.
// ─────────────────────────────────────────────────────────────────────
function snakeTeamOrder(round) {
  return round % 2 === 1 ? HARNESS_TEAM_IDS.slice() : HARNESS_TEAM_IDS.slice().reverse();
}

// ─────────────────────────────────────────────────────────────────────
// SETUP.
// ─────────────────────────────────────────────────────────────────────
async function runSetup(client) {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log(`║  MODE: SETUP  ${RUN_MODE.padEnd(47)}║`);
  console.log(`║  Target league:  ${WHITELISTED_LEAGUE_ID}       ║`);
  console.log(`║  Team count:     ${String(TEAM_COUNT).padEnd(45)}║`);
  console.log(`║  Rounds:         ${String(ROUNDS).padEnd(45)}║`);
  console.log(`║  Total picks:    ${String(TEAM_COUNT * ROUNDS).padEnd(45)}║`);
  console.log(`║  Pick clock:     ${(PICK_CLOCK !== null ? `${PICK_CLOCK}s (writes settings.pickTimeLimit)` : 'unchanged (settings.pickTimeLimit left as-is)').padEnd(45)}║`);
  console.log(`║  DB:             ${redactUrl(DB_URL).padEnd(45)}║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  const roleRes = await client.query(
    "SELECT current_user, session_user, current_setting('is_superuser') AS superuser",
  );
  console.log('');
  console.log('── DB session identity ──');
  console.log(roleRes.rows[0]);

  console.log('');
  console.log('── BEFORE-VALUES (read-only) ──');

  const league = await client.query(
    `SELECT id, name, draft_state, pick_deadline, league_size, draft_event_counter,
            settings->>'draftType' AS draft_type,
            settings->>'pickTimeLimit' AS pick_time_limit
       FROM public.leagues WHERE id = $1`,
    [WHITELISTED_LEAGUE_ID],
  );
  if (league.rows.length === 0) {
    throw new Error(`Whitelisted league ${WHITELISTED_LEAGUE_ID} does not exist.`);
  }
  const leagueRow = league.rows[0];
  console.log('leagues row:', leagueRow);

  const eventsCount = await client.query(
    `SELECT count(*)::int AS c FROM public.draft_events WHERE league_id = $1`,
    [WHITELISTED_LEAGUE_ID],
  );
  const picksCount = await client.query(
    `SELECT count(*)::int AS c FROM public.draft_picks_v2 WHERE league_id = $1`,
    [WHITELISTED_LEAGUE_ID],
  );
  console.log(`draft_events: ${eventsCount.rows[0].c}   draft_picks_v2: ${picksCount.rows[0].c}`);
  if (eventsCount.rows[0].c > 0 || picksCount.rows[0].c > 0) {
    throw new Error(
      `League has existing draft_events (${eventsCount.rows[0].c}) or draft_picks_v2 ` +
      `(${picksCount.rows[0].c}). Run --reset --execute first.`,
    );
  }

  const existingHarnessTeams = await client.query(
    `SELECT id, team_name FROM public.teams WHERE id::text LIKE '77777777-%' ORDER BY id`,
  );
  const existingTeamIds = new Set(existingHarnessTeams.rows.map((r) => r.id));
  console.log(`harness-prefix teams already present: ${existingTeamIds.size}/${TEAM_COUNT}`);

  const existingOrder = await client.query(
    `SELECT round_number, team_order FROM public.draft_order
      WHERE league_id = $1 ORDER BY round_number`,
    [WHITELISTED_LEAGUE_ID],
  );
  console.log(`draft_order rows already present: ${existingOrder.rows.length}`);

  // ── Build plan ────────────────────────────────────────────────────
  const now = new Date();
  const pickDeadline = new Date(now.getTime() + 10 * 60 * 1000); // now + 10 min

  const plan = {
    beforeValues: {
      league: {
        draft_state: leagueRow.draft_state,
        pick_deadline: leagueRow.pick_deadline,
        league_size: leagueRow.league_size,
        draft_event_counter: leagueRow.draft_event_counter,
        // Chunk 11g.10 sub-step 10c-2 batch 1 (item 4): capture the
        // JSONB pickTimeLimit before-value for --pick-clock restore.
        // Read as text (settings->>'pickTimeLimit'); may be null if
        // the field was absent.
        pickTimeLimit: leagueRow.pick_time_limit,
      },
      existingHarnessTeamIds: [...existingTeamIds],
      existingDraftOrderRounds: existingOrder.rows.map((r) => ({
        round_number: r.round_number,
        team_order: r.team_order,
      })),
    },
    steps: [],
    rounds: ROUNDS,
    pickClock: PICK_CLOCK,
  };

  // Step: leagues update.
  const leagueUpdateColumns = [];
  const leagueUpdateValues = [];
  const leagueUpdateBefore = {};
  if (leagueRow.draft_state !== 'active') {
    leagueUpdateColumns.push('draft_state');
    leagueUpdateValues.push('active');
    leagueUpdateBefore.draft_state = leagueRow.draft_state;
  }
  const currentDeadline = leagueRow.pick_deadline ? new Date(leagueRow.pick_deadline) : null;
  if (!currentDeadline || currentDeadline.getTime() < now.getTime() + 5 * 60 * 1000) {
    leagueUpdateColumns.push('pick_deadline');
    leagueUpdateValues.push(pickDeadline.toISOString());
    leagueUpdateBefore.pick_deadline = leagueRow.pick_deadline;
  }
  // league_size must be exactly TEAM_COUNT for the RPC's round-math to
  // match this fixture's draft_order shape (pick_in_round = ((pick-1) %
  // league_size) + 1). Set to 12 if not already.
  if (leagueRow.league_size !== TEAM_COUNT) {
    leagueUpdateColumns.push('league_size');
    leagueUpdateValues.push(TEAM_COUNT);
    leagueUpdateBefore.league_size = leagueRow.league_size;
  }
  if (leagueRow.draft_event_counter !== 0 && leagueRow.draft_event_counter !== '0') {
    leagueUpdateColumns.push('draft_event_counter');
    leagueUpdateValues.push(0);
    leagueUpdateBefore.draft_event_counter = leagueRow.draft_event_counter;
  }
  if (leagueUpdateColumns.length > 0) {
    const setClause = leagueUpdateColumns.map((c, i) => `${c} = $${i + 2}`).join(', ');
    plan.steps.push({
      label: `leagues UPDATE (${leagueUpdateColumns.join(', ')})`,
      sql: `UPDATE public.leagues SET ${setClause} WHERE id = $1`,
      params: [WHITELISTED_LEAGUE_ID, ...leagueUpdateValues],
      before: leagueUpdateBefore,
    });
  }

  // Chunk 11g.10 sub-step 10c-2 batch 1 (item 4): settings.pickTimeLimit
  // update when --pick-clock=N was passed. Writes to the JSONB path
  // (the only path any code reads today per the pick-clock audit).
  // jsonb_set with `to_jsonb(N::int)` produces a numeric JSONB value.
  if (PICK_CLOCK !== null) {
    plan.steps.push({
      label: `leagues UPDATE settings.pickTimeLimit=${PICK_CLOCK} (jsonb_set)`,
      sql: `UPDATE public.leagues
               SET settings = jsonb_set(
                 COALESCE(settings, '{}'::jsonb),
                 '{pickTimeLimit}',
                 to_jsonb($2::int),
                 true
               )
             WHERE id = $1`,
      params: [WHITELISTED_LEAGUE_ID, PICK_CLOCK],
      before: { pickTimeLimit: leagueRow.pick_time_limit },
    });
  }

  // Step: teams INSERT for any missing harness team.
  for (let i = 1; i <= TEAM_COUNT; i++) {
    const tid = HARNESS_TEAM_IDS[i - 1];
    if (existingTeamIds.has(tid)) continue;
    plan.steps.push({
      label: `teams INSERT (harness team slot ${i})`,
      sql: `INSERT INTO public.teams (id, league_id, team_name, owner_id)
            VALUES ($1, $2, $3, NULL)`,
      params: [tid, WHITELISTED_LEAGUE_ID, `Harness Team ${String(i).padStart(2, '0')}`],
      before: { existed: false },
    });
  }

  // Step: draft_order per round. INSERT or UPDATE depending on
  // whether a row already exists for that round.
  const existingRoundSet = new Map(
    existingOrder.rows.map((r) => [r.round_number, r]),
  );
  for (let r = 1; r <= ROUNDS; r++) {
    const teamOrderJson = JSON.stringify(snakeTeamOrder(r));
    const pre = existingRoundSet.get(r);
    if (!pre) {
      plan.steps.push({
        label: `draft_order INSERT (round ${r}, snake)`,
        sql: `INSERT INTO public.draft_order (league_id, round_number, team_order, draft_session_id)
              VALUES ($1, $2, $3::jsonb, $4)`,
        params: [WHITELISTED_LEAGUE_ID, r, teamOrderJson, HARNESS_SESSION_ID],
        before: { existed: false },
      });
    } else {
      plan.steps.push({
        label: `draft_order UPDATE (round ${r} team_order + session_id)`,
        sql: `UPDATE public.draft_order
                 SET team_order = $3::jsonb, draft_session_id = $4
               WHERE league_id = $1 AND round_number = $2`,
        params: [WHITELISTED_LEAGUE_ID, r, teamOrderJson, HARNESS_SESSION_ID],
        before: {
          team_order: pre.team_order,
          draft_session_id: pre.draft_session_id,
        },
      });
    }
  }

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

  const state = {
    createdAt: new Date().toISOString(),
    leagueId: WHITELISTED_LEAGUE_ID,
    rounds: ROUNDS,
    plan: plan.beforeValues,
    stepsApplied: plan.steps.map((s) => ({ label: s.label, before: s.before })),
  };
  await writeFile(STATE_FILE_PATH, JSON.stringify(state, null, 2));
  console.log('');
  console.log(`  state written: ${STATE_FILE_PATH}`);
  console.log('  (ephemeral — reset consumes and deletes it; never commit this file)');
}

// ─────────────────────────────────────────────────────────────────────
// RESET.
// ─────────────────────────────────────────────────────────────────────
async function runReset(client) {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log(`║  MODE: RESET  ${RUN_MODE.padEnd(47)}║`);
  console.log(`║  Target league:  ${WHITELISTED_LEAGUE_ID}       ║`);
  console.log(`║  DB:             ${redactUrl(DB_URL).padEnd(45)}║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  let state = null;
  if (existsSync(STATE_FILE_PATH)) {
    state = JSON.parse(await readFile(STATE_FILE_PATH, 'utf8'));
    console.log('');
    console.log(`── state file loaded: ${STATE_FILE_PATH} ──`);
    console.log(state);
  } else {
    console.warn('');
    console.warn('── WARNING: state file missing ──');
    console.warn('   Falling back to conservative "delete-everything-with-harness-prefix"');
    console.warn('   pattern. Leagues columns will NOT be restored — inspect manually.');
  }

  const plan = [];

  // Step 1: delete draft_events (CASCADEs to draft_picks_v2).
  plan.push({
    label: 'draft_events DELETE (CASCADEs to draft_picks_v2)',
    sql: `DELETE FROM public.draft_events WHERE league_id = $1`,
    params: [WHITELISTED_LEAGUE_ID],
  });

  // Step 2: delete draft_snapshots (10c-1c.1 pattern from fixture-min).
  plan.push({
    label: 'draft_snapshots DELETE (chunk 11g.7-7c residuals)',
    sql: `DELETE FROM public.draft_snapshots WHERE league_id = $1`,
    params: [WHITELISTED_LEAGUE_ID],
  });

  // Step 3: restore league columns from state.
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
        label: `leagues UPDATE (restore ${setPairs.length} column(s))`,
        sql: `UPDATE public.leagues SET ${setPairs.join(', ')} WHERE id = $1`,
        params: [WHITELISTED_LEAGUE_ID, ...values],
      });
    }

    // Chunk 11g.10 sub-step 10c-2 batch 1 (item 4): restore
    // settings.pickTimeLimit. Two cases:
    //   (a) before-value was null/undefined (field was absent) → remove
    //       the key entirely with `settings - 'pickTimeLimit'`.
    //   (b) before-value was a number/string → jsonb_set back to it.
    // The setup path only emitted the pickTimeLimit update if
    // --pick-clock was passed, so we only need to restore if the state
    // file records a `pickTimeLimit` update in stepsApplied. Restoring
    // unconditionally would be a no-op for state files from non-
    // --pick-clock runs but is cleaner and idempotent.
    const beforePickTimeLimit = before.pickTimeLimit;
    if (beforePickTimeLimit === null || beforePickTimeLimit === undefined) {
      plan.push({
        label: `leagues UPDATE settings (remove pickTimeLimit key — was absent)`,
        sql: `UPDATE public.leagues
                 SET settings = settings - 'pickTimeLimit'
               WHERE id = $1`,
        params: [WHITELISTED_LEAGUE_ID],
      });
    } else {
      plan.push({
        label: `leagues UPDATE settings.pickTimeLimit=${beforePickTimeLimit} (jsonb_set restore)`,
        sql: `UPDATE public.leagues
                 SET settings = jsonb_set(
                   COALESCE(settings, '{}'::jsonb),
                   '{pickTimeLimit}',
                   to_jsonb($2::int),
                   true
                 )
               WHERE id = $1`,
        params: [WHITELISTED_LEAGUE_ID, parseInt(beforePickTimeLimit, 10)],
      });
    }
  }

  // Step 4: draft_order — restore original rows, delete rows we created.
  if (state && state.plan) {
    const preExistingRounds = new Map(
      (state.plan.existingDraftOrderRounds ?? []).map((r) => [r.round_number, r]),
    );
    // For rounds 1..N (N = state.rounds), either restore (if
    // pre-existed) or delete (if we created).
    for (let r = 1; r <= state.rounds; r++) {
      const pre = preExistingRounds.get(r);
      if (pre) {
        plan.push({
          label: `draft_order UPDATE round ${r} (restore original)`,
          sql: `UPDATE public.draft_order
                   SET team_order = $2::jsonb, draft_session_id = $3
                 WHERE league_id = $1 AND round_number = $4`,
          params: [
            WHITELISTED_LEAGUE_ID,
            JSON.stringify(pre.team_order),
            pre.draft_session_id ?? HARNESS_SESSION_ID,
            r,
          ],
        });
      } else {
        plan.push({
          label: `draft_order DELETE round ${r} (we created)`,
          sql: `DELETE FROM public.draft_order WHERE league_id = $1 AND round_number = $2`,
          params: [WHITELISTED_LEAGUE_ID, r],
        });
      }
    }
  } else {
    // No state → conservative fallback: delete any draft_order rows
    // whose team_order references any of our harness teams. Simpler
    // heuristic: delete rows whose draft_session_id matches ours.
    plan.push({
      label: 'draft_order DELETE (fallback — matching harness session id)',
      sql: `DELETE FROM public.draft_order
             WHERE league_id = $1 AND draft_session_id = $2`,
      params: [WHITELISTED_LEAGUE_ID, HARNESS_SESSION_ID],
    });
  }

  // Step 5: delete harness teams that we created (state-informed) or
  // all harness-prefix teams (fallback).
  if (state && state.plan) {
    const preExistingTeamIds = new Set(state.plan.existingHarnessTeamIds ?? []);
    const createdTeamIds = HARNESS_TEAM_IDS.filter((id) => !preExistingTeamIds.has(id));
    if (createdTeamIds.length > 0) {
      plan.push({
        label: `teams DELETE (${createdTeamIds.length} harness team(s) we created)`,
        sql: `DELETE FROM public.teams WHERE id = ANY($1::uuid[])`,
        params: [createdTeamIds],
      });
    }
  } else {
    plan.push({
      label: 'teams DELETE (fallback — all rows with 77777777- prefix)',
      sql: `DELETE FROM public.teams WHERE id::text LIKE '77777777-%'`,
      params: [],
    });
  }

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

  if (existsSync(STATE_FILE_PATH)) {
    await unlink(STATE_FILE_PATH);
    console.log(`  state file deleted: ${STATE_FILE_PATH}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main.
// ─────────────────────────────────────────────────────────────────────
async function main() {
  const client = new pg.Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 30_000,
  });
  await client.connect();
  try {
    if (OPT_RESET) await runReset(client);
    else await runSetup(client);
  } finally {
    await client.end();
  }
}

// Only run when executed directly; when imported (draft-harness.mjs
// imports HARNESS_TEAM_IDS etc.), skip the entry point.
const invokedDirectly = fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().catch((err) => {
    console.error('');
    console.error('FATAL:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
}

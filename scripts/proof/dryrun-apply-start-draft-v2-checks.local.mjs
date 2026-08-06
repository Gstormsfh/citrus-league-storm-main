#!/usr/bin/env node
// ============================================================================
// Dry-run harness for scripts/proof/apply-start-draft-v2.local.sql STEP 3.
// ============================================================================
//
// MANDATORY GATE (INS-5, standing rule).
// Validates the F27 start_draft_v2 migration's structural markers against
// the migration file's own text BEFORE the apply harness runs against
// staging.
//
// USAGE:
//   node scripts/proof/dryrun-apply-start-draft-v2-checks.local.mjs
// ============================================================================

import { readFileSync } from 'node:fs';

const MIGRATION_PATH = 'supabase/migrations/20260807000000_start_draft_v2.sql';
const raw = readFileSync(MIGRATION_PATH, 'utf8');

// Extract plpgsql body (same pattern as SL-1b dry-run).
const asOpen = raw.indexOf('AS $$');
if (asOpen === -1) {
  console.error('FATAL: could not find `AS $$` in migration file');
  process.exit(2);
}
const bodyStart = asOpen + 'AS $$'.length;
const commentOn = raw.indexOf('COMMENT ON FUNCTION', bodyStart);
const bodyEnd = raw.lastIndexOf('$$', commentOn === -1 ? raw.length : commentOn);
if (bodyEnd === -1 || bodyEnd < bodyStart) {
  console.error('FATAL: could not find closing `$$` for the plpgsql body');
  process.exit(2);
}
const body = raw.slice(bodyStart, bodyEnd);

// Strip line comments for SQL-shape checks (mirror INS-11 dry-run helper).
const executable = body.split('\n')
  .map(line => {
    const idx = line.indexOf('--');
    return idx === -1 ? line : line.slice(0, idx);
  })
  .join('\n');

// ─── Window: preflight taxonomy region ───────────────────────────────────
// From the first Rider 1 IF to the draft_order preflight, so ordering
// markers can be windowed if needed. Rider 1 relies on ORDER — if a check
// were reordered, some markers would still match body-wide but the
// semantic would break. We enforce ordering via position-comparison, not
// windowed regex.
const posRider1Step1 = body.indexOf("v_draft_status = 'completed'");
const posRider1Step2 = body.indexOf("v_draft_status = 'in_progress'");
const posRider1Step3 = body.indexOf("draft_state IS DISTINCT FROM 'not_started'");
const posRider1Step5 = body.indexOf("v_draft_status NOT IN ('not_started', 'queued')");

const checks = [
  // ─── Function shape ────────────────────────────────────────────────
  {
    id: 'create_or_replace_start_draft_v2',
    corpus: raw,
    re: /CREATE OR REPLACE FUNCTION public\.start_draft_v2\(/,
    expected: true,
    reason: 'function signature declared',
  },
  {
    id: 'returns_jsonb',
    corpus: raw,
    re: /\)\s+RETURNS jsonb/,
    expected: true,
    reason: 'RETURNS jsonb (envelope with event_id, seq, first_pick_deadline)',
  },
  {
    id: 'security_definer',
    corpus: raw,
    re: /SECURITY DEFINER/,
    expected: true,
    reason: 'SECURITY DEFINER (parity with siblings)',
  },
  {
    id: 'search_path_public',
    corpus: raw,
    re: /SET search_path = public/,
    expected: true,
    reason: 'SET search_path = public (parity with siblings)',
  },
  {
    id: 'signature_four_params',
    corpus: raw,
    re: /p_league_id\s+uuid,\s*p_actor\s+jsonb,\s*p_idempotency_key\s+uuid,\s*p_correlation_id\s+uuid DEFAULT NULL/,
    expected: true,
    reason: 'four-param signature per design §5',
  },

  // ─── Step 0: idempotency short-circuit ─────────────────────────────
  {
    id: 'step0_advisory_lock',
    corpus: body,
    re: /pg_advisory_xact_lock\(\s*hashtext\('draft_events_idem:'/,
    expected: true,
    reason: 'Step 0 advisory lock keyed on idem key',
  },
  {
    id: 'step0_reject_null_key',
    corpus: body,
    re: /p_idempotency_key IS NULL/,
    expected: true,
    reason: 'Step 0 rejects NULL idempotency key',
  },
  {
    id: 'step0_replay_short_circuit',
    corpus: body,
    re: /was_duplicate.*true/,
    expected: true,
    reason: 'Step 0 returns was_duplicate=true on replay',
  },
  {
    id: 'step0_cross_event_type_guard',
    corpus: body,
    re: /v_existing_payload \?\s*'first_pick_deadline'/,
    expected: true,
    reason: 'Step 0 guards against cross-event-type key reuse',
  },

  // ─── Step 1: authorization (siblings pattern) ──────────────────────
  {
    id: 'auth_reads_p_actor_kind',
    corpus: body,
    re: /p_actor ->> 'kind'/,
    expected: true,
    reason: 'auth reads p_actor ->> kind',
  },
  {
    id: 'auth_asserts_kind_is_commissioner',
    corpus: body,
    // Two-line pattern: `v_actor_kind IS DISTINCT FROM 'commissioner'`
    re: /v_actor_kind IS DISTINCT FROM 'commissioner'/,
    expected: true,
    reason: 'auth refuses when actor.kind <> commissioner',
  },
  {
    id: 'auth_reads_commissioner_id',
    corpus: body,
    re: /SELECT commissioner_id/,
    expected: true,
    reason: 'auth reads leagues.commissioner_id',
  },
  {
    id: 'auth_uid_check',
    corpus: body,
    re: /auth\.uid\(\) IS DISTINCT FROM v_commissioner/,
    expected: true,
    reason: 'auth compares auth.uid() to commissioner_id',
  },
  {
    id: 'auth_service_role_bypass',
    corpus: body,
    re: /v_caller_role NOT IN \('service_role', 'postgres'\)/,
    expected: true,
    reason: 'service_role bypass matches siblings',
  },

  // ─── Step 2: Rider 1 ordered preflight taxonomy ────────────────────
  {
    id: 'rider1_step1_completed',
    corpus: body,
    re: /draft_already_completed/,
    expected: true,
    reason: 'Rider 1 step 1: refuse completed with named error',
  },
  {
    id: 'rider1_step2_in_progress',
    corpus: body,
    re: /draft_already_in_progress/,
    expected: true,
    reason: 'Rider 1 step 2: refuse in_progress with named error',
  },
  {
    id: 'rider1_step3_illegal_combo',
    corpus: body,
    re: /draft_state_not_startable/,
    expected: true,
    reason: 'Rider 1 step 3/5: draft_state_not_startable named error',
  },
  {
    id: 'rider1_ordering_completed_before_in_progress',
    // KI-034 discipline: completed check MUST fire before in_progress
    // check. Since completed leagues carry state='active', if step 2
    // fired first for some reason, the state check later would misfire.
    // Position-based ordering assertion.
    corpus: body,
    logic: () => posRider1Step1 > 0 && posRider1Step2 > 0 && posRider1Step1 < posRider1Step2,
    expected: true,
    reason: 'KI-034: completed check (step 1) precedes in_progress check (step 2)',
  },
  {
    id: 'rider1_ordering_in_progress_before_illegal_combo',
    corpus: body,
    logic: () => posRider1Step2 > 0 && posRider1Step3 > 0 && posRider1Step2 < posRider1Step3,
    expected: true,
    reason: 'in_progress check (step 2) precedes illegal-combo check (step 3)',
  },
  {
    id: 'rider1_ordering_illegal_combo_before_unexpected',
    corpus: body,
    logic: () => posRider1Step3 > 0 && posRider1Step5 > 0 && posRider1Step3 < posRider1Step5,
    expected: true,
    reason: 'illegal-combo check (step 3) precedes unexpected-status catch-all (step 5)',
  },

  // ─── draft_order preflight — Amendment 3 discipline ────────────────
  {
    id: 'amendment3_deleted_at_filter_round1',
    corpus: body,
    // The round-1 SELECT must filter deleted_at IS NULL.
    re: /round_number = 1\s+AND deleted_at IS NULL/,
    expected: true,
    reason: 'Amendment 3 filter on round-1 team_order lookup',
  },
  {
    id: 'amendment3_deleted_at_filter_total_rounds',
    corpus: body,
    // The total_rounds count must ALSO filter deleted_at IS NULL.
    // Two SQL-context occurrences of `AND deleted_at IS NULL` — one per
    // draft_order query. The RAISE EXCEPTION message on line 229 also
    // contains the phrase in prose form, so the pattern must anchor on
    // `AND ` prefix to isolate SQL filters from error-message text.
    matchCount: (corpus) => (corpus.match(/\bAND deleted_at IS NULL\b/g) || []).length,
    expectedCount: 2,
    reason: 'Amendment 3 mirror: both draft_order queries filter AND deleted_at IS NULL',
  },
  {
    id: 'draft_not_configured_error',
    corpus: body,
    re: /draft_not_configured/,
    expected: true,
    reason: 'draft_not_configured named error surface',
  },

  // ─── Step 3: deadline compute (submit_pick_v2 formula) ─────────────
  {
    id: 'started_at_date_trunc_second',
    corpus: body,
    re: /v_started_at := date_trunc\('second', now\(\)\)/,
    expected: true,
    reason: 'started_at uses date_trunc(second, now()) — matches pick_deadline convention',
  },
  {
    id: 'pick_time_default_90',
    corpus: body,
    re: /COALESCE\(\s*\(v_settings ->> 'pickTimeLimit'\)::int,\s*90\s*\)/,
    expected: true,
    reason: 'pick_time defaults to 90 seconds (matches submit_pick_v2:259-262)',
  },
  {
    id: 'first_deadline_ceil_plus_1s',
    corpus: body,
    re: /make_interval\(secs => ceil\(v_pick_time\)::int\)\s*\+\s*interval '1 second'/,
    expected: true,
    reason: 'first_pick_deadline = started_at + CEIL(pick_time) + 1s (submit_pick_v2 formula)',
  },

  // ─── Step 4: six §6.4 payload fields ───────────────────────────────
  {
    id: 'payload_field_started_at',
    corpus: body,
    re: /'started_at',\s*v_started_at/,
    expected: true,
    reason: 'payload field: started_at',
  },
  {
    id: 'payload_field_first_pick_deadline',
    corpus: body,
    re: /'first_pick_deadline',\s*v_first_pick_deadline/,
    expected: true,
    reason: 'payload field: first_pick_deadline',
  },
  {
    id: 'payload_field_total_rounds',
    corpus: body,
    re: /'total_rounds',\s*v_total_rounds/,
    expected: true,
    reason: 'payload field: total_rounds',
  },
  {
    id: 'payload_field_total_teams',
    corpus: body,
    re: /'total_teams',\s*v_league_size/,
    expected: true,
    reason: 'payload field: total_teams (=league_size)',
  },
  {
    id: 'payload_field_pick_time_limit_seconds',
    corpus: body,
    re: /'pick_time_limit_seconds',\s*v_pick_time/,
    expected: true,
    reason: 'payload field: pick_time_limit_seconds',
  },
  {
    id: 'payload_field_draft_format',
    corpus: body,
    re: /'draft_format',\s*v_draft_format/,
    expected: true,
    reason: 'payload field: draft_format',
  },
  {
    id: 'validator_call',
    corpus: body,
    re: /PERFORM public\.validate_draft_event_payload\('draft_started', v_payload\)/,
    expected: true,
    reason: 'validate_draft_event_payload invoked before emit',
  },

  // ─── Step 5: Amendment 4 hash ──────────────────────────────────────
  {
    id: 'amendment4_sha256_hash',
    corpus: body,
    re: /encode\(sha256\(convert_to\(v_payload::text, 'UTF8'\)\), 'hex'\)/,
    expected: true,
    reason: 'Amendment 4: sha256 payload hash (payload_hash NOT NULL)',
  },

  // ─── Step 6: append_draft_event ────────────────────────────────────
  {
    id: 'append_draft_event_call',
    corpus: body,
    re: /public\.append_draft_event\(/,
    expected: true,
    reason: 'append_draft_event invoked to emit + counter-advance',
  },
  {
    id: 'append_draft_event_extracts_event_id',
    corpus: body,
    re: /v_append_result\s*->>\s*'event_id'/,
    expected: true,
    reason: 'extracts event_id from append_draft_event jsonb return',
  },
  {
    id: 'append_draft_event_extracts_seq',
    corpus: body,
    re: /v_append_result\s*->>\s*'seq'/,
    expected: true,
    reason: 'extracts seq from append_draft_event jsonb return',
  },

  // ─── Step 7: atomic column writes ──────────────────────────────────
  {
    id: 'step7_update_all_three',
    corpus: body,
    // Three writes in one UPDATE statement.
    re: /UPDATE public\.leagues\s+SET draft_state\s*=\s*'active',\s+draft_status\s*=\s*'in_progress',\s+pick_deadline\s*=\s*v_first_pick_deadline/,
    expected: true,
    reason: 'atomic three-column UPDATE (draft_state, draft_status, pick_deadline)',
  },

  // ─── Step 8: return envelope ───────────────────────────────────────
  {
    id: 'return_envelope',
    corpus: body,
    re: /jsonb_build_object\(\s*'event_id',\s*v_event_id,\s*'seq',\s*v_new_seq,\s*'first_pick_deadline',\s*v_first_pick_deadline,\s*'was_duplicate',\s*false\s*\)/,
    expected: true,
    reason: 'return envelope has {event_id, seq, first_pick_deadline, was_duplicate}',
  },

  // ─── Negative markers ──────────────────────────────────────────────
  {
    id: 'exactly_one_sql_update_stmt (comment-stripped)',
    corpus: executable,
    // Exactly one SQL UPDATE statement in executable body. The Step 7
    // leagues UPDATE is the only mutation this migration performs
    // directly (append_draft_event handles its own counter UPDATE, not
    // counted here since it's inside a called function).
    matchCount: (corpus) => (corpus.match(/\bUPDATE\s+[a-z_.]+\s+SET\b/gi) || []).length,
    expectedCount: 1,
    reason: 'exactly one SQL UPDATE (the atomic three-column write)',
  },
  {
    id: 'no_direct_cron_dml (INS-11 rule)',
    corpus: executable,
    matchCount: (corpus) => (corpus.match(/\b(UPDATE|INSERT INTO|DELETE FROM)\s+cron\.job\b/gi) || []).length,
    expectedCount: 0,
    reason: 'INS-11: no direct DML on cron.job',
  },
  {
    id: 'no_stray_deletes (must be false)',
    corpus: executable,
    re: /^\s*DELETE FROM/m,
    expected: false,
    reason: 'no DELETE statements in a create-function migration',
  },
  {
    id: 'no_stray_drops (must be false)',
    corpus: executable,
    re: /^\s*DROP /m,
    expected: false,
    reason: 'no DROP statements',
  },
];

console.log('');
console.log('=== DRY-RUN: F27 start_draft_v2 migration structural markers ===');
console.log('');
console.log(`file:              ${MIGRATION_PATH}`);
console.log(`file bytes:        ${raw.length}`);
console.log(`body (plpgsql):    ${body.length} chars`);
console.log('');
console.log('Rider 1 taxonomy positions (must all be > 0 and increasing):');
console.log(`  step 1 (completed):        char ${posRider1Step1}`);
console.log(`  step 2 (in_progress):      char ${posRider1Step2}`);
console.log(`  step 3 (illegal combo):    char ${posRider1Step3}`);
console.log(`  step 5 (unexpected):       char ${posRider1Step5}`);
console.log('');
console.log('┌─────┬────────────────────────────────────────────────────────────────┬────────┬────────┬────────┐');
console.log('│  #  │ marker                                                         │ expect │ actual │ verdict│');
console.log('├─────┼────────────────────────────────────────────────────────────────┼────────┼────────┼────────┤');

let failCount = 0;
checks.forEach((c, i) => {
  let actual, expected, pass;
  if (typeof c.matchCount === 'function') {
    actual = c.matchCount(c.corpus);
    expected = c.expectedCount;
    pass = actual === expected;
  } else if (typeof c.logic === 'function') {
    actual = !!c.logic();
    expected = c.expected;
    pass = actual === expected;
  } else {
    actual = c.re.test(c.corpus);
    expected = c.expected;
    pass = actual === expected;
  }
  if (!pass) failCount++;
  const label = c.id.length > 62 ? c.id.slice(0, 59) + '...' : c.id.padEnd(62);
  const verdict = pass ? 'PASS' : 'FAIL';
  console.log(`│ ${String(i + 1).padStart(3)} │ ${label} │ ${String(expected).padEnd(6)} │ ${String(actual).padEnd(6)} │ ${verdict.padEnd(6)} │`);
});
console.log('└─────┴────────────────────────────────────────────────────────────────┴────────┴────────┴────────┘');
console.log('');

if (failCount > 0) {
  console.log(`RESULT: ${failCount} FAIL(S). Investigate before enabling apply.`);
  process.exit(1);
} else {
  console.log(`RESULT: ${checks.length}/${checks.length} PASS. F27 migration structural marker set validated.`);
  process.exit(0);
}

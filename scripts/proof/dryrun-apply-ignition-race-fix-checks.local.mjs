#!/usr/bin/env node
// ============================================================================
// Dry-run harness for E100 IGNITION-RACE fix migration.
// Migration: supabase/migrations/20260811100000_start_draft_v2_row_lock.sql
// ============================================================================
//
// MANDATORY GATE (INS-5, standing rule).
// Validates the E100 migration's structural markers against the migration
// file's own text BEFORE the apply harness runs against staging.
//
// This is a CREATE OR REPLACE FUNCTION migration that swaps
// start_draft_v2's body in place. Every check from
// dryrun-apply-start-draft-v2-checks.local.mjs (the F27 original) MUST
// still pass — the E100 fix is a single-line addition (FOR UPDATE on
// Step 2's leagues SELECT), not a rewrite. The E100-specific check adds
// the FOR UPDATE assertion on that specific SELECT.
//
// USAGE:
//   node scripts/proof/dryrun-apply-ignition-race-fix-checks.local.mjs
// ============================================================================

import { readFileSync } from 'node:fs';

const MIGRATION_PATH =
  'supabase/migrations/20260811100000_start_draft_v2_row_lock.sql';
const raw = readFileSync(MIGRATION_PATH, 'utf8');

// Extract plpgsql body (same pattern as SL-1b + F27 dry-runs).
const asOpen = raw.indexOf('AS $$');
if (asOpen === -1) {
  console.error('FATAL: could not find `AS $$` in migration file');
  process.exit(2);
}
const bodyStart = asOpen + 'AS $$'.length;
const commentOn = raw.indexOf('COMMENT ON FUNCTION', bodyStart);
const bodyEnd = raw.lastIndexOf(
  '$$',
  commentOn === -1 ? raw.length : commentOn,
);
if (bodyEnd === -1 || bodyEnd < bodyStart) {
  console.error('FATAL: could not find closing `$$` for the plpgsql body');
  process.exit(2);
}
const body = raw.slice(bodyStart, bodyEnd);

// Strip line comments for SQL-shape checks.
const executable = body
  .split('\n')
  .map((line) => {
    const idx = line.indexOf('--');
    return idx === -1 ? line : line.slice(0, idx);
  })
  .join('\n');

// ─── Position markers for ordering checks ────────────────────────────────
const posStep2SelectLeagues = executable.search(
  /SELECT\s+commissioner_id,\s+draft_state/,
);
const posStep2ForUpdate = executable.search(
  /WHERE id = p_league_id\s+FOR UPDATE/,
);
const posRider1Step1 = body.indexOf("v_draft_status = 'completed'");
const posRider1Step2 = body.indexOf("v_draft_status = 'in_progress'");
const posStep6AppendCall = body.indexOf('append_draft_event(');
const posStep7Update = body.search(
  /UPDATE public\.leagues\s+SET draft_state\s+=\s+'active'/,
);

const checks = [
  // ─── Function shape (F27 parity) ───────────────────────────────────
  {
    id: 'create_or_replace_start_draft_v2',
    corpus: raw,
    re: /CREATE OR REPLACE FUNCTION public\.start_draft_v2\(/,
    expected: true,
    reason: 'function signature declared (CREATE OR REPLACE swaps body in place)',
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
    reason: 'SECURITY DEFINER preserved (parity with siblings)',
  },
  {
    id: 'search_path_public',
    corpus: raw,
    re: /SET search_path = public/,
    expected: true,
    reason: 'SET search_path = public preserved (parity with siblings)',
  },
  {
    id: 'signature_four_params',
    corpus: raw,
    re: /p_league_id\s+uuid,\s*p_actor\s+jsonb,\s*p_idempotency_key\s+uuid,\s*p_correlation_id\s+uuid DEFAULT NULL/,
    expected: true,
    reason: 'four-param signature unchanged from F27 original',
  },

  // ─── E100 CORE: FOR UPDATE on the leagues SELECT ──────────────────
  {
    id: 'e100_step2_for_update_marker',
    corpus: executable,
    re: /FROM public\.leagues\s+WHERE id = p_league_id\s+FOR UPDATE/,
    expected: true,
    reason:
      'E100 FIX: Step 2 leagues SELECT is FOR UPDATE (row lock at preflight, serializes concurrent ignitions)',
  },
  {
    id: 'e100_for_update_bound_to_leagues_select',
    corpus: executable,
    logic: () =>
      posStep2SelectLeagues > 0 &&
      posStep2ForUpdate > 0 &&
      posStep2ForUpdate > posStep2SelectLeagues &&
      // Nothing else between the SELECT and the FOR UPDATE that would
      // suggest they're on different statements (bounds the FOR UPDATE
      // to this specific SELECT, not a stray one elsewhere).
      posStep2ForUpdate - posStep2SelectLeagues < 400,
    expected: true,
    reason:
      'FOR UPDATE is attached to the Step 2 commissioner_id SELECT (not a different statement)',
  },
  {
    id: 'e100_for_update_precedes_status_checks',
    corpus: executable,
    logic: () =>
      posStep2ForUpdate > 0 &&
      posRider1Step1 > 0 &&
      posStep2ForUpdate < posRider1Step1,
    expected: true,
    reason:
      'FOR UPDATE fires BEFORE the Rider 1 status checks — status re-reads committed state post-lock',
  },
  {
    id: 'e100_for_update_precedes_append',
    corpus: executable,
    logic: () =>
      posStep2ForUpdate > 0 &&
      posStep6AppendCall > 0 &&
      posStep2ForUpdate < posStep6AppendCall,
    expected: true,
    reason:
      'FOR UPDATE fires BEFORE append_draft_event (row lock held THROUGH the event insert)',
  },
  {
    id: 'e100_for_update_precedes_step7_update',
    corpus: executable,
    logic: () =>
      posStep2ForUpdate > 0 &&
      posStep7Update > 0 &&
      posStep2ForUpdate < posStep7Update,
    expected: true,
    reason:
      'FOR UPDATE fires BEFORE Step 7 UPDATE (same row lock held THROUGH the status flip)',
  },

  // ─── Step 0: idempotency short-circuit (unchanged) ─────────────────
  {
    id: 'step0_advisory_lock',
    corpus: body,
    re: /pg_advisory_xact_lock\(\s*hashtext\('draft_events_idem:'/,
    expected: true,
    reason: 'Step 0 advisory lock keyed on idem key preserved',
  },
  {
    id: 'step0_reject_null_key',
    corpus: body,
    re: /p_idempotency_key IS NULL/,
    expected: true,
    reason: 'Step 0 rejects NULL idempotency key preserved',
  },
  {
    id: 'step0_replay_short_circuit',
    corpus: body,
    re: /was_duplicate.*true/,
    expected: true,
    reason: 'Step 0 returns was_duplicate=true on replay preserved',
  },
  {
    id: 'step0_cross_event_type_guard',
    corpus: body,
    re: /v_existing_payload \?\s*'first_pick_deadline'/,
    expected: true,
    reason: 'Step 0 guards against cross-event-type key reuse preserved',
  },

  // ─── Step 1: authorization (unchanged) ─────────────────────────────
  {
    id: 'auth_reads_p_actor_kind',
    corpus: body,
    re: /p_actor ->> 'kind'/,
    expected: true,
    reason: 'auth reads p_actor ->> kind preserved',
  },
  {
    id: 'auth_asserts_kind_is_commissioner',
    corpus: body,
    re: /v_actor_kind IS DISTINCT FROM 'commissioner'/,
    expected: true,
    reason: 'auth refuses when actor.kind <> commissioner preserved',
  },
  {
    id: 'auth_reads_commissioner_id',
    corpus: body,
    re: /SELECT commissioner_id/,
    expected: true,
    reason: 'auth reads leagues.commissioner_id preserved',
  },
  {
    id: 'auth_uid_check',
    corpus: body,
    re: /auth\.uid\(\) IS DISTINCT FROM v_commissioner/,
    expected: true,
    reason: 'auth compares auth.uid() to commissioner_id preserved',
  },
  {
    id: 'auth_service_role_bypass',
    corpus: body,
    re: /v_caller_role NOT IN \('service_role', 'postgres'\)/,
    expected: true,
    reason: 'service_role bypass matches siblings preserved',
  },

  // ─── Step 2: Rider 1 ordered preflight taxonomy (unchanged) ───────
  {
    id: 'rider1_step1_completed',
    corpus: body,
    re: /draft_already_completed/,
    expected: true,
    reason: 'Rider 1 step 1: refuse completed with named error preserved',
  },
  {
    id: 'rider1_step2_in_progress',
    corpus: body,
    re: /draft_already_in_progress/,
    expected: true,
    reason: 'Rider 1 step 2: refuse in_progress with named error preserved',
  },
  {
    id: 'rider1_step3_illegal_combo',
    corpus: body,
    re: /draft_state_not_startable/,
    expected: true,
    reason: 'Rider 1 step 3/5: draft_state_not_startable named error preserved',
  },
  {
    id: 'rider1_ordering_completed_before_in_progress',
    corpus: body,
    logic: () =>
      posRider1Step1 > 0 &&
      posRider1Step2 > 0 &&
      posRider1Step1 < posRider1Step2,
    expected: true,
    reason:
      'KI-034: completed check (step 1) precedes in_progress check (step 2)',
  },

  // ─── draft_order preflight (unchanged) ─────────────────────────────
  {
    id: 'draft_order_preflight_amendment3',
    corpus: body,
    re: /deleted_at IS NULL/,
    expected: true,
    reason: 'draft_order preflight filters deleted_at IS NULL (Amendment 3)',
  },
  {
    id: 'draft_order_team_order_length_check',
    corpus: body,
    re: /jsonb_array_length\(v_round1_team_order\)\s*<>\s*v_league_size/,
    expected: true,
    reason: 'team_order length matches league_size assertion preserved',
  },

  // ─── Step 6: append_draft_event call (unchanged) ───────────────────
  {
    id: 'step6_append_draft_event_call',
    corpus: body,
    re: /append_draft_event\(\s*p_league_id,\s*'draft_started'/,
    expected: true,
    reason: 'Step 6 calls append_draft_event with draft_started type preserved',
  },
  {
    id: 'step6_payload_hash_forwarded',
    corpus: body,
    re: /v_payload_hash,\s*p_actor,/,
    expected: true,
    reason: 'Step 6 forwards payload_hash before actor (Amendment 4)',
  },

  // ─── Step 7: atomic column writes (unchanged) ──────────────────────
  {
    id: 'step7_atomic_updates',
    corpus: body,
    re: /UPDATE public\.leagues\s+SET draft_state\s+=\s+'active',\s+draft_status\s+=\s+'in_progress',\s+pick_deadline\s+=\s+v_first_pick_deadline/,
    expected: true,
    reason:
      'Step 7 atomic UPDATE (draft_state=active + draft_status=in_progress + pick_deadline) preserved',
  },

  // ─── COMMENT signals E100 fix ──────────────────────────────────────
  {
    id: 'comment_cites_e100_fix',
    corpus: raw,
    re: /COMMENT ON FUNCTION public\.start_draft_v2[\s\S]*E100 IGNITION-RACE fix/,
    expected: true,
    reason:
      'COMMENT ON FUNCTION cites E100 IGNITION-RACE fix (audit trail on the object itself)',
  },
];

// ─── Runner ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
console.log(
  `\n═══ E100 IGNITION-RACE structural dry-run: ${checks.length} checks ═══\n`,
);
for (const check of checks) {
  const actual = check.logic
    ? check.logic()
    : check.re.test(check.corpus ?? raw);
  const ok = actual === check.expected;
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${check.id.padEnd(50)} ${check.reason}`);
  } else {
    failed += 1;
    console.log(
      `  ✗ ${check.id.padEnd(50)} ${check.reason} (expected ${check.expected}, got ${actual})`,
    );
  }
}
console.log(
  `\n═══ RESULT: ${passed}/${checks.length} passed${failed ? `, ${failed} FAILED` : ''} ═══\n`,
);
process.exit(failed === 0 ? 0 : 1);

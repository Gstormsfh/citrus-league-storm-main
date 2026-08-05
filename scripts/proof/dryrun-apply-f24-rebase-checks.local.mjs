#!/usr/bin/env node
// ============================================================================
// Dry-run harness for scripts/proof/apply-f24-rebase.local.sql STEP 3 markers.
// ============================================================================
//
// MANDATORY GATE (INS-5, architect ruling 2026-08-05):
//   Before Garrett re-applies the rebase, every STEP 3 marker regex + the
//   negative marker MUST be validated against the migration FILE'S OWN TEXT.
//   The instrument gets tested before it points at the database again.
//
// This harness reads the migration file, extracts the CREATE OR REPLACE
// FUNCTION body (stripping the leading migration comment banner and the
// trailing COMMENT ON FUNCTION), and runs a JS-regex equivalent of each
// PL/pgSQL check from apply-f24-rebase.local.sql STEP 3. Because pg_get_functiondef
// preserves the plpgsql body text with whitespace intact (it doesn't
// re-parse and re-format the plpgsql; it stores the source), the migration
// file body is a strong proxy for what STEP 3 will actually see at runtime.
//
// One difference: pg_get_functiondef wraps the body in `AS $function$ ... $function$`
// and prepends its own CREATE OR REPLACE decoration; the file uses `AS $$ ... $$`
// with a comment banner. STEP 3 runs against the pg_get_functiondef output,
// this dry-run runs against the file body. The plpgsql source inside both
// is identical modulo the wrapping — every marker check operates on strings
// inside the plpgsql, so the wrapping doesn't affect any check.
//
// USAGE:
//   node scripts/proof/dryrun-apply-f24-rebase-checks.local.mjs
//   (No secrets needed. Reads local files only.)
//
// EXIT CODE:
//   0 if every marker check produces its expected value.
//   1 if any marker check disagrees with expected.
// ============================================================================

import { readFileSync } from 'node:fs';

const MIGRATION_PATH = 'supabase/migrations/20260805050000_v2_draft_completion_emitter_rebased.sql';

const raw = readFileSync(MIGRATION_PATH, 'utf8');

// ─── Extract the plpgsql body ───────────────────────────────────────────
// The file body: leading `-- ==` banner, then `CREATE OR REPLACE FUNCTION...`
// The plpgsql body proper: `AS $$` ... `$$;`.
// We want the pl/pgsql body inside the outer $$..$$ pair, since that's what
// pg_get_functiondef will preserve. Windows anchor to strings that live
// only in the plpgsql body, so grabbing between the first `AS $$` and
// the last `$$;` is sufficient.
const asOpen = raw.indexOf('AS $$');
if (asOpen === -1) {
  console.error('FATAL: could not find `AS $$` in migration file');
  process.exit(2);
}
const bodyStart = asOpen + 'AS $$'.length;
// Find the matching close: last `$$;` before the COMMENT ON FUNCTION.
const commentOn = raw.indexOf('COMMENT ON FUNCTION', bodyStart);
const bodyEnd = raw.lastIndexOf('$$;', commentOn === -1 ? raw.length : commentOn);
if (bodyEnd === -1 || bodyEnd < bodyStart) {
  console.error('FATAL: could not find `$$;` closing the plpgsql body');
  process.exit(2);
}
const body = raw.slice(bodyStart, bodyEnd);

// ─── Windows (mirror apply-f24-rebase.local.sql STEP 3) ─────────────────
function jsPosition(needle, haystack) {
  const i = haystack.indexOf(needle);
  return i === -1 ? 0 : i + 1; // 1-based, matching PG's position()
}
function jsSubstring(haystack, pos1based, len) {
  if (pos1based === 0) return '';
  return haystack.slice(pos1based - 1, pos1based - 1 + len);
}

const posPayload     = jsPosition('v_payload := jsonb_build_object', body);
const posInsert      = jsPosition('INSERT INTO public.draft_events',   body);
const posCompletion  = jsPosition('v_total_picks > 0',                 body);
const posStep2       = jsPosition('SELECT team_order INTO v_team_order', body);
const posCompSum     = jsPosition('SELECT COALESCE(SUM(jsonb_array_length', body);

const winPayload    = jsSubstring(body, posPayload,    520);
const winInsert     = jsSubstring(body, posInsert,     400);
const winCompletion = jsSubstring(body, posCompletion, 1200);
const winStep2      = jsSubstring(body, posStep2,      400);
const winCompSum    = jsSubstring(body, posCompSum,    200);

// ─── Marker checks (mirror STEP 3 exactly) ──────────────────────────────
// Each check reproduces the PG regex on the JS side. PG `~` uses POSIX ERE;
// JS RegExp uses PCRE-compatible; both support \s and the shape of the
// patterns used here identically.

const checks = [
  // Batch-2 restoration
  {
    id: 'v_has_pick_deadline_in_payload',
    scope: 'payload_window',
    re: /'pick_deadline'/,
    corpus: winPayload,
    expected: true,
    reason: 'batch-2 field restored in pick payload build (payload window)',
  },
  {
    id: 'v_has_deadline_before_validate',
    scope: 'body-wide position math (INS-5 fix)',
    // Body-wide comparison; implemented as JS logic below.
    logic: () => {
      const pDeadline = jsPosition('v_new_deadline :=', body);
      const pPayload  = jsPosition('v_payload := jsonb_build_object', body);
      return pDeadline > 0 && pPayload > 0 && pDeadline < pPayload;
    },
    expected: true,
    reason: 'v_new_deadline assignment precedes v_payload build (batch-2 restructure)',
  },
  {
    id: 'v_has_event_version_2',
    scope: 'insert_window',
    re: /'pick',\s*2\s*,/,
    corpus: winInsert,
    expected: true,
    reason: 'event_version=2 in INSERT VALUES (batch-2 bump)',
  },
  // F24 markers
  {
    id: 'v_has_deleted_at_filter_step2',
    scope: 'step2_window',
    re: /deleted_at IS NULL/,
    corpus: winStep2,
    expected: true,
    reason: 'Amendment 3 filter on on-clock team_order SELECT',
  },
  {
    id: 'v_has_deleted_at_filter_completion',
    scope: 'completion_sum_window',
    re: /deleted_at IS NULL/,
    corpus: winCompSum,
    expected: true,
    reason: 'Amendment 3 mirror filter on completion SUM',
  },
  {
    id: 'v_has_completion_branch',
    scope: 'completion_window',
    re: /v_total_picks > 0 AND p_pick_number >= v_total_picks/,
    corpus: winCompletion,
    expected: true,
    reason: 'D2 guard around completion branch',
  },
  {
    id: 'v_has_d8_warning (part A: RAISE WARNING)',
    scope: 'body-wide (INS-5 fix, combo-anchored)',
    re: /RAISE WARNING/,
    corpus: body,
    expected: true,
    reason: 'D8 absorb-and-announce WARNING keyword',
  },
  {
    id: 'v_has_d8_warning (part B: submit_pick_v2 completion branch string)',
    scope: 'body-wide (INS-5 fix, combo-anchored)',
    re: /submit_pick_v2 completion branch/,
    corpus: body,
    expected: true,
    reason: 'D8 WARNING message string',
  },
  {
    id: 'v_has_status_completed_deadline_null',
    scope: 'body-wide self-anchored (INS-5 fix)',
    re: /draft_status\s*=\s*'completed'\s*,\s*pick_deadline\s*=\s*NULL/,
    corpus: body,
    expected: true,
    reason: 'Amendment 1 UPDATE — status flip + deadline clear',
  },
  {
    id: 'v_has_sha256_hash',
    scope: 'body-wide anchored to single-line portion (INS-5 fix)',
    re: /sha256\(convert_to\(v_completion_payload/,
    corpus: body,
    expected: true,
    reason: 'Amendment 4 sha256 hash of completion payload',
  },
  {
    id: 'v_has_v_completion_payload_declared',
    scope: 'body-wide (DECLARE)',
    re: /v_completion_payload\s+jsonb/,
    corpus: body,
    expected: true,
    reason: 'Amendment 4 payload hoist declaration',
  },
  {
    id: 'v_has_v_completion_hash_declared',
    scope: 'body-wide (DECLARE)',
    re: /v_completion_hash\s+text/,
    corpus: body,
    expected: true,
    reason: 'Amendment 4 hash var declaration',
  },
  {
    id: 'v_has_return_pick_deadline_null',
    scope: 'body-wide self-anchored (INS-5 fix)',
    re: /'pick_deadline',\s*NULL/,
    corpus: body,
    expected: true,
    reason: 'completion-branch RETURN with pick_deadline=NULL (Amendment 1)',
  },
  // Negative
  {
    id: 'v_touches_draft_state',
    scope: 'body-wide',
    re: /draft_state\s*=/,
    corpus: body,
    expected: false,
    reason: 'Amendment 2 — no draft_state writes',
  },
];

// ─── Run and report ─────────────────────────────────────────────────────
console.log('');
console.log('=== DRY-RUN: STEP 3 markers against migration file body ===');
console.log('');
console.log(`file:     ${MIGRATION_PATH}`);
console.log(`file bytes:        ${raw.length}`);
console.log(`body (plpgsql):    ${body.length} chars`);
console.log('');
console.log(`window positions (1-based, 0 = not found):`);
console.log(`  v_payload := ...           at char ${String(posPayload).padStart(5)}  (window len ${winPayload.length})`);
console.log(`  INSERT INTO draft_events   at char ${String(posInsert).padStart(5)}  (window len ${winInsert.length})`);
console.log(`  v_total_picks > 0          at char ${String(posCompletion).padStart(5)}  (window len ${winCompletion.length})`);
console.log(`  SELECT team_order          at char ${String(posStep2).padStart(5)}  (window len ${winStep2.length})`);
console.log(`  SELECT COALESCE(SUM(...    at char ${String(posCompSum).padStart(5)}  (window len ${winCompSum.length})`);
console.log('');
console.log('┌─────┬────────────────────────────────────────────────────────────────┬────────┬────────┬────────┐');
console.log('│  #  │ marker                                                         │ expect │ actual │ verdict│');
console.log('├─────┼────────────────────────────────────────────────────────────────┼────────┼────────┼────────┤');

let failCount = 0;
checks.forEach((c, i) => {
  let actual;
  if (c.logic) {
    actual = !!c.logic();
  } else {
    actual = c.re.test(c.corpus);
  }
  const pass = actual === c.expected;
  if (!pass) failCount++;
  const label = c.id.length > 62 ? c.id.slice(0, 59) + '...' : c.id.padEnd(62);
  const verdict = pass ? 'PASS' : 'FAIL';
  console.log(`│ ${String(i + 1).padStart(3)} │ ${label} │ ${String(c.expected).padEnd(6)} │ ${String(actual).padEnd(6)} │ ${verdict.padEnd(6)} │`);
});
console.log('└─────┴────────────────────────────────────────────────────────────────┴────────┴────────┴────────┘');
console.log('');

if (failCount > 0) {
  console.log(`RESULT: ${failCount} FAIL(S). Investigate before enabling apply.`);
  process.exit(1);
} else {
  console.log(`RESULT: ${checks.length}/${checks.length} PASS. STEP 3 marker set validated against file body. Safe to re-apply.`);
  process.exit(0);
}

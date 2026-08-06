#!/usr/bin/env node
// ============================================================================
// Dry-run harness for scripts/proof/apply-reenable-auto-fix.local.sql STEP 3
// checks + reply-migration body sanity.
// ============================================================================
//
// MANDATORY GATE (INS-5, standing rule from F24 campaign):
//   Before Garrett applies the KI-041 reply migration, the STEP 3 marker
//   set + the migration body's structural asserts MUST validate against
//   the migration file's own text. Instrument tested against a static
//   input before it points at the database.
//
// USAGE:
//   node scripts/proof/dryrun-apply-reenable-checks.local.mjs
//
// EXIT CODE:
//   0 if all checks produce their expected values.
//   1 otherwise.
// ============================================================================

import { readFileSync } from 'node:fs';

const MIGRATION_PATH = 'supabase/migrations/20260806200000_reenable_auto_fix_after_sl1b_v2.sql';
const raw = readFileSync(MIGRATION_PATH, 'utf8');

// SQL-shape checks (no_direct_cron_dml, zero_sql_updates_anywhere) must
// distinguish executable SQL from prose inside `-- ...` comments (e.g.
// header rationale that MENTIONS the forbidden DML to explain why we
// avoid it). Strip line comments before those checks. Block comments
// aren't used in this file family so single-line strip is sufficient.
const executable = raw.split('\n')
  .map(line => {
    const idx = line.indexOf('--');
    return idx === -1 ? line : line.slice(0, idx);
  })
  .join('\n');

const checks = [
  // Structural: the single mutation is cron.alter_job (never direct DML).
  {
    id: 'uses_cron_alter_job_api',
    corpus: raw,
    re: /PERFORM cron\.alter_job\(job_id := v_jobid, active := true\)/,
    expected: true,
    reason: 'the single mutation via pg_cron API (INS-11 rule, MIGRATION_SAFETY_GUIDE Rule 5)',
  },
  {
    id: 'looks_up_by_jobname',
    corpus: raw,
    re: /WHERE jobname = 'auto-fix-integrity'/,
    expected: true,
    reason: '0F-OPS-3 convention: lookup by jobname (jobid may drift)',
  },
  // Guard: pre-verify block references auto_fix_integrity_issues pattern.
  {
    id: 'preverify_matches_auto_fix_pattern',
    corpus: raw,
    re: /v_command NOT ILIKE '%auto_fix_integrity_issues%'/,
    expected: true,
    reason: 'pre-verify refuses if the job command has been repurposed away from auto_fix',
  },
  // Guard: pre-verify checks jobname exists.
  {
    id: 'preverify_jobname_exists',
    corpus: raw,
    re: /jobname ''auto-fix-integrity'' not found/,
    expected: true,
    reason: 'pre-verify raises if jobname does not exist',
  },
  // Guard: post-verify checks active=true after alter_job.
  {
    id: 'postverify_active_true',
    corpus: raw,
    re: /still not active/,
    expected: true,
    reason: 'post-verify raises if cron.alter_job did not stick',
  },
  // Rationale block references 0F-OPS-3 counterpart.
  {
    id: 'cites_counterpart_migration',
    corpus: raw,
    re: /20260805201003_disable_unsafe_auto_fix_and_repair_vacuum_job/,
    expected: true,
    reason: 'reply-migration cites counterpart version + name (PROD_CHANGE_LEDGER Rule 3)',
  },
  {
    id: 'cites_0F_OPS_3',
    corpus: raw,
    re: /0F-OPS-3/,
    expected: true,
    reason: 'reply-migration cites counterpart phase name (PROD_CHANGE_LEDGER Rule 4)',
  },
  // Rationale block addresses defects A/B/C.
  {
    id: 'addresses_defect_A',
    corpus: raw,
    re: /Defect A: TYPE MISMATCH/,
    expected: true,
    reason: 'reply-migration addresses defect A with evidence',
  },
  {
    id: 'addresses_defect_B',
    corpus: raw,
    re: /Defect B: NESTED-ARRAY CORRUPTION/,
    expected: true,
    reason: 'reply-migration addresses defect B with evidence',
  },
  {
    id: 'addresses_defect_C',
    corpus: raw,
    re: /Defect C: NULL INJECTION ON EMPTY AGGREGATE/,
    expected: true,
    reason: 'reply-migration addresses defect C with evidence',
  },
  // Evidence pins.
  {
    id: 'cites_v1_pin',
    corpus: raw,
    re: /0bd6c0f8cfbc9b9b3f970b52009bfbd2/,
    expected: true,
    reason: 'evidence cites v1 md5 pin (INS-7)',
  },
  {
    id: 'cites_v2_pin',
    corpus: raw,
    re: /d0a54ca8925c9a8604781294a4b5631a/,
    expected: true,
    reason: 'evidence cites v2 (LIVE) md5 pin (INS-7)',
  },
  // Negative: no OTHER mutation lurks in the file.
  {
    id: 'no_direct_cron_dml (INS-11 rule; comment-stripped corpus)',
    corpus: executable,
    // No direct UPDATE/INSERT/DELETE on cron.job. Corpus has `--` comments
    // stripped so header prose explaining WHY we avoid direct DML doesn't
    // false-fail here.
    matchCount: (corpus) => (corpus.match(/\b(UPDATE|INSERT INTO|DELETE FROM)\s+cron\.job\b/gi) || []).length,
    expectedCount: 0,
    reason: 'no direct DML on cron.job — must use cron.alter_job API',
  },
  {
    id: 'zero_sql_updates_anywhere (comment-stripped corpus)',
    corpus: executable,
    matchCount: (corpus) => (corpus.match(/\bUPDATE\s+[a-z_.]+\s+SET\b/gi) || []).length,
    expectedCount: 0,
    reason: 'API-only re-enable contains no SQL UPDATE statements',
  },
  {
    id: 'no_stray_deletes (must be false)',
    corpus: raw,
    re: /^\s*DELETE FROM/m,
    expected: false,
    reason: 'no DELETE statements in a re-enable migration',
  },
  {
    id: 'no_stray_drops (must be false)',
    corpus: raw,
    re: /^\s*DROP /m,
    expected: false,
    reason: 'no DROP statements',
  },
  {
    id: 'no_stray_create_or_replace (must be false)',
    corpus: raw,
    re: /CREATE OR REPLACE (FUNCTION|PROCEDURE|VIEW|TRIGGER)/,
    expected: false,
    reason: 'no function/procedure/view/trigger replacement — this is cron-only',
  },
];

console.log('');
console.log('=== DRY-RUN: KI-041 reply migration structural + reply-convention checks ===');
console.log('');
console.log(`file:              ${MIGRATION_PATH}`);
console.log(`file bytes:        ${raw.length}`);
console.log('');
console.log('┌─────┬──────────────────────────────────────────────────────────┬────────┬────────┬────────┐');
console.log('│  #  │ marker                                                   │ expect │ actual │ verdict│');
console.log('├─────┼──────────────────────────────────────────────────────────┼────────┼────────┼────────┤');

let failCount = 0;
checks.forEach((c, i) => {
  let actual, expected, pass;
  if (typeof c.matchCount === 'function') {
    actual = c.matchCount(c.corpus);
    expected = c.expectedCount;
    pass = actual === expected;
  } else {
    actual = c.re.test(c.corpus);
    expected = c.expected;
    pass = actual === expected;
  }
  if (!pass) failCount++;
  const label = c.id.length > 56 ? c.id.slice(0, 53) + '...' : c.id.padEnd(56);
  const verdict = pass ? 'PASS' : 'FAIL';
  console.log(`│ ${String(i + 1).padStart(3)} │ ${label} │ ${String(expected).padEnd(6)} │ ${String(actual).padEnd(6)} │ ${verdict.padEnd(6)} │`);
});
console.log('└─────┴──────────────────────────────────────────────────────────┴────────┴────────┴────────┘');
console.log('');

if (failCount > 0) {
  console.log(`RESULT: ${failCount} FAIL(S). Investigate before enabling apply.`);
  process.exit(1);
} else {
  console.log(`RESULT: ${checks.length}/${checks.length} PASS. Reply migration structurally sound + reply-convention compliant.`);
  process.exit(0);
}

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

const checks = [
  // Structural: the single UPDATE + WHERE jobid=4 is present.
  {
    id: 'update_cron_job_active_true',
    corpus: raw,
    re: /UPDATE cron\.job\s+SET active = true\s+WHERE jobid = 4;/,
    expected: true,
    reason: 'the single mutation: UPDATE cron.job SET active=true WHERE jobid=4',
  },
  // Guard: pre-verify block references auto_fix_integrity_issues pattern.
  {
    id: 'preverify_matches_auto_fix_pattern',
    corpus: raw,
    re: /v_command NOT ILIKE '%auto_fix_integrity_issues%'/,
    expected: true,
    reason: 'pre-verify refuses if jobid 4 command has been repurposed away from auto_fix',
  },
  // Guard: pre-verify checks jobid exists.
  {
    id: 'preverify_jobid_exists',
    corpus: raw,
    re: /jobid 4 not found in cron\.job/,
    expected: true,
    reason: 'pre-verify raises if jobid 4 does not exist',
  },
  // Guard: post-verify checks active=true.
  {
    id: 'postverify_active_true',
    corpus: raw,
    re: /jobid 4 still not active/,
    expected: true,
    reason: 'post-verify raises if UPDATE did not stick',
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
    id: 'exactly_one_sql_update',
    corpus: raw,
    // Match SQL UPDATE statements specifically: `UPDATE <schema.>?<table> SET`
    // (word boundary + table pattern + SET). Prose uses of the word
    // "UPDATE" in comments/messages don't match.
    // Count matches — must be exactly 1 (the authorized cron.job UPDATE).
    // Using .match() with a global flag would be simpler, but the harness
    // uses .test() for uniformity. Encode via a wrapper below.
    matchCount: (corpus) => (corpus.match(/\bUPDATE\s+[a-z_.]+\s+SET\b/gi) || []).length,
    expectedCount: 1,
    reason: 'the migration contains exactly one SQL UPDATE statement',
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

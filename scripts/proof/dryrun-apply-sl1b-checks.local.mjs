#!/usr/bin/env node
// ============================================================================
// Dry-run harness for scripts/proof/apply-sl1b-auto-fix-v2.local.sql STEP 3.
// ============================================================================
//
// MANDATORY GATE (INS-5, standing rule from F24 campaign):
//   Before Garrett applies the v2 SL-1b migration, every STEP 3 marker
//   regex + the negative markers MUST be validated against the migration
//   FILE's own text. The instrument gets tested against a static input
//   before it points at the database.
//
// This harness reads the migration file, extracts the plpgsql body, and
// runs a JS-regex equivalent of each PL/pgSQL check from
// apply-sl1b-auto-fix-v2.local.sql STEP 3. pg_get_functiondef preserves
// the plpgsql body text verbatim, so the file body is a strong proxy
// for what STEP 3 will actually see at runtime.
//
// USAGE:
//   node scripts/proof/dryrun-apply-sl1b-checks.local.mjs
//   (No secrets needed. Reads local files only.)
//
// EXIT CODE:
//   0 if every marker check produces its expected value.
//   1 if any marker check disagrees with expected.
// ============================================================================

import { readFileSync } from 'node:fs';

const MIGRATION_PATH = 'supabase/migrations/20260806100000_sl1b_auto_fix_unwrap_agg.sql';

const raw = readFileSync(MIGRATION_PATH, 'utf8');

// ─── Extract the plpgsql body ───────────────────────────────────────────
const asOpen = raw.indexOf('AS $$');
if (asOpen === -1) {
  console.error('FATAL: could not find `AS $$` in migration file');
  process.exit(2);
}
const bodyStart = asOpen + 'AS $$'.length;
const commentOn = raw.indexOf('COMMENT ON FUNCTION', bodyStart);
// Closing `$$` may be followed by `;` (F24 pattern) OR ` LANGUAGE plpgsql;`
// (SL-1 pattern). Search backward for the last `$$` before COMMENT ON.
const bodyEnd = raw.lastIndexOf('$$', commentOn === -1 ? raw.length : commentOn);
if (bodyEnd === -1 || bodyEnd < bodyStart) {
  console.error('FATAL: could not find closing `$$` for the plpgsql body');
  process.exit(2);
}
const body = raw.slice(bodyStart, bodyEnd);

// ─── UPDATE window (mirror STEP 3) ──────────────────────────────────────
function jsPosition(needle, haystack) {
  const i = haystack.indexOf(needle);
  return i === -1 ? 0 : i + 1;
}
function jsSubstring(haystack, pos1based, len) {
  if (pos1based === 0) return '';
  return haystack.slice(pos1based - 1, pos1based - 1 + len);
}

const posUpdate    = jsPosition('UPDATE team_lineups', body);
const updateWindow = jsSubstring(body, posUpdate, 600);

// ─── Marker checks (mirror STEP 3 exactly) ──────────────────────────────
const checks = [
  // v1 continuity
  {
    id: 'v_has_starters_cast',
    corpus: body,
    re: /tl\.starters \? dp\.player_id::text/,
    expected: true,
    reason: '::text cast on outer starters ? site (SL-1 continuity)',
  },
  {
    id: 'v_has_bench_cast',
    corpus: body,
    re: /tl\.bench\s+\? dp\.player_id::text/,
    expected: true,
    reason: '::text cast on outer bench ? site (SL-1 continuity)',
  },
  {
    id: 'v_has_ir_cast',
    corpus: body,
    re: /tl\.ir\s+\? dp\.player_id::text/,
    expected: true,
    reason: '::text cast on outer ir ? site (SL-1 continuity)',
  },
  {
    id: 'v_has_agg_text_cast',
    corpus: body,
    re: /jsonb_agg\(dp\.player_id::text\)/,
    expected: true,
    reason: '::text cast in jsonb_agg (SL-1 crash-site fix)',
  },
  {
    id: 'v_has_nested_starters',
    corpus: body,
    re: /team_lineups\.starters \? dp\.player_id::text/,
    expected: true,
    reason: '::text cast in inner subquery starters ? site',
  },
  {
    id: 'v_has_nested_bench',
    corpus: body,
    re: /team_lineups\.bench\s+\? dp\.player_id::text/,
    expected: true,
    reason: '::text cast in inner subquery bench ? site',
  },
  {
    id: 'v_has_nested_ir',
    corpus: body,
    re: /team_lineups\.ir\s+\? dp\.player_id::text/,
    expected: true,
    reason: '::text cast in inner subquery ir ? site',
  },
  // v2 signatures (windowed to UPDATE region)
  {
    id: 'v_has_direct_concat',
    corpus: updateWindow,
    re: /bench = bench \|\| COALESCE\(/,
    expected: true,
    reason: 'v2 direct concat: `bench = bench || COALESCE(` in UPDATE window',
  },
  {
    id: 'v_has_empty_fallback',
    corpus: updateWindow,
    re: /'\[\]'::jsonb/,
    expected: true,
    reason: "v2 empty-array fallback '[]'::jsonb in UPDATE window",
  },
  // Negative markers
  {
    id: 'v_has_bare_starters (must be false)',
    corpus: body,
    re: /tl\.starters \? dp\.player_id(?!::text)/,
    expected: false,
    reason: 'no bare outer starters ? without cast',
  },
  {
    id: 'v_has_bare_bench (must be false)',
    corpus: body,
    re: /tl\.bench\s+\? dp\.player_id(?!::text)/,
    expected: false,
    reason: 'no bare outer bench ? without cast',
  },
  {
    id: 'v_has_bare_ir (must be false)',
    corpus: body,
    re: /tl\.ir\s+\? dp\.player_id(?!::text)/,
    expected: false,
    reason: 'no bare outer ir ? without cast',
  },
  {
    id: 'v_has_integer_cast (must be false)',
    corpus: body,
    re: /dp\.player_id::INTEGER/,
    expected: false,
    reason: 'original 22P02 crash site absent',
  },
  {
    id: 'v_has_build_array_in_update (must be false)',
    corpus: updateWindow,
    re: /jsonb_build_array/,
    expected: false,
    reason: 'v1 jsonb_build_array wrapper removed from UPDATE window',
  },
];

// ─── Run and report ─────────────────────────────────────────────────────
console.log('');
console.log('=== DRY-RUN: SL-1b v2 STEP 3 markers against migration file body ===');
console.log('');
console.log(`file:              ${MIGRATION_PATH}`);
console.log(`file bytes:        ${raw.length}`);
console.log(`body (plpgsql):    ${body.length} chars`);
console.log(`UPDATE window:     starts at char ${posUpdate}, length ${updateWindow.length}`);
console.log('');
console.log('┌─────┬────────────────────────────────────────────────────────────────┬────────┬────────┬────────┐');
console.log('│  #  │ marker                                                         │ expect │ actual │ verdict│');
console.log('├─────┼────────────────────────────────────────────────────────────────┼────────┼────────┼────────┤');

let failCount = 0;
checks.forEach((c, i) => {
  const actual = c.re.test(c.corpus);
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
  console.log(`RESULT: ${checks.length}/${checks.length} PASS. STEP 3 v2 marker set validated. Safe to apply.`);
  process.exit(0);
}

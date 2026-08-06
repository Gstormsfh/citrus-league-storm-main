#!/usr/bin/env node
// scripts/proof/BREAK-GLASS-set-draft-status.local.mjs
//
// ╔═══════════════════════════════════════════════════════════════════╗
// ║  BREAK-GLASS ONLY. NOT THE PRODUCTION COMMISSIONER-START PATH.    ║
// ╚═══════════════════════════════════════════════════════════════════╝
//
// PRODUCTION commissioner-start is the `start_draft_v2` RPC via the UI
// button, landed in F27 (migration 20260807000000, engine deploy pairs
// F26+F27 — first deploy since 527ceb38). See:
//   docs/DESIGN_F27_start_draft_v2.md              (design doc)
//   supabase/migrations/20260807000000_start_draft_v2.sql   (RPC)
//   scripts/proof/apply-start-draft-v2.local.sql   (apply harness)
//
// This script exists as an ENGINEER-ONLY rescue tool for a stuck
// draft. Before reaching for it, first check:
//   (a) Can the commissioner press the UI button?
//   (b) Is start_draft_v2 throwing a preflight refusal that names the
//       actual issue? (draft_already_completed, draft_not_configured,
//       draft_state_not_startable — see Rider 1 taxonomy at
//       docs/DESIGN_F27_start_draft_v2.md §4.1.)
//
// If both (a) and (b) point at a real problem this script can't fix,
// investigate the underlying issue. Only use this script when explicit
// database repair is required (e.g., recovering from a lifecycle-event
// emission bug that left column state inconsistent with the event log).
//
// Renamed from set-draft-status.local.mjs on 2026-08-07 as part of the
// F27 landing. Same PR docs; see docs/PROD_CHANGE_LEDGER.md for the
// cross-workstream discipline that makes ad-hoc column flips like this
// one a governance concern.
//
// ── Original doc (preserved for context) ─────────────────────────────
// Flip `leagues.draft_status` on the whitelisted staging league.
//
// WHY: the API discovery endpoint (GET /api/drafts/:id/server) returns
// 409 DRAFT_NOT_CONNECTABLE unless draft_status ∈ CONNECTABLE_DRAFT_STATUSES
// = ['queued', 'in_progress', 'paused'] (packages/shared league.ts:561).
// The staging league sits at 'completed', which is why a real browser
// can never reach the draft room even when the harness fixture is set
// up — the harness never noticed because it signs its own WS tokens and
// bypasses discovery entirely. The draft ENGINE does not read
// draft_status at all (probe experiments proved foreign joins against
// any status), so this flip only opens the API's front door.
//
// Usage (from repo root; SUPABASE_DB_URL must be set, same as fixture):
//   node scripts/proof/BREAK-GLASS-set-draft-status.local.mjs --to=in_progress            # DRY RUN
//   node scripts/proof/BREAK-GLASS-set-draft-status.local.mjs --to=in_progress --execute  # apply
//   node scripts/proof/BREAK-GLASS-set-draft-status.local.mjs --to=completed --execute    # restore
//
// Convention: .local.mjs — never committed (matches kill-listener /
// clear-snapshots / apply-migration pattern).

import pg from 'pg';

const WHITELISTED_LEAGUE_ID = '993c9219-ecbf-4e4e-9fb0-e9837e1bded3';
const ALLOWED = ['queued', 'in_progress', 'paused', 'completed', 'not_started'];

const toArg = process.argv.find((a) => a.startsWith('--to='));
const TO = toArg ? toArg.slice('--to='.length) : null;
const EXECUTE = process.argv.includes('--execute');

if (!TO || !ALLOWED.includes(TO)) {
  console.error(`FATAL: --to=<status> required. Allowed: ${ALLOWED.join(' | ')}`);
  process.exit(2);
}

const DB_URL = process.env.SUPABASE_DB_URL;
if (!DB_URL) {
  console.error('FATAL: SUPABASE_DB_URL not set.');
  process.exit(2);
}
for (const pat of ['pooler.supabase.com', 'pgbouncer', ':6543']) {
  if (DB_URL.includes(pat)) {
    console.error(`FATAL: SUPABASE_DB_URL contains pooled pattern "${pat}" (KI-E010).`);
    process.exit(2);
  }
}

const client = new pg.Client({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 15_000,
});
await client.connect();
try {
  const before = await client.query(
    'SELECT id, name, draft_status FROM public.leagues WHERE id = $1',
    [WHITELISTED_LEAGUE_ID],
  );
  if (before.rows.length === 0) {
    console.error(`FATAL: whitelisted league ${WHITELISTED_LEAGUE_ID} not found.`);
    process.exit(1);
  }
  console.log(`league:              ${before.rows[0].id} (${before.rows[0].name})`);
  console.log(`draft_status BEFORE: ${before.rows[0].draft_status}`);
  console.log(`target:              ${TO}`);

  if (!EXECUTE) {
    console.log('');
    console.log('DRY RUN — no write performed. Re-run with --execute to apply.');
  } else {
    await client.query(
      'UPDATE public.leagues SET draft_status = $2 WHERE id = $1',
      [WHITELISTED_LEAGUE_ID, TO],
    );
    const after = await client.query(
      'SELECT draft_status FROM public.leagues WHERE id = $1',
      [WHITELISTED_LEAGUE_ID],
    );
    console.log(`draft_status AFTER:  ${after.rows[0].draft_status}`);
  }
} finally {
  await client.end();
}

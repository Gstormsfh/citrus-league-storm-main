#!/usr/bin/env node
// Sanity-check the staging Supabase before you sign up and try to create
// a league. Hits each reference table that league creation, drafting,
// and roster rendering depend on — reports row counts and fails loudly
// if anything is below threshold.
//
// READ-ONLY. Does NOT touch leagues/teams/draft tables (those should be
// empty before the user creates their league).
//
// Usage:
//   node scripts/staging/06-verify-staging-ready.mjs
//
// Exits 0 on success, 1 on any check failing.

import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(process.cwd());
const ENV_FILE = path.join(REPO_ROOT, '.env.staging');

if (!fs.existsSync(ENV_FILE)) {
  console.error(`Missing ${ENV_FILE}. Aborting.`);
  process.exit(1);
}
const env = {};
for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.STAGING_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing VITE_SUPABASE_URL or service role key.');
  console.error('Set STAGING_SERVICE_ROLE_KEY env var or add SUPABASE_SERVICE_ROLE_KEY to .env.staging.');
  process.exit(1);
}

// ── Each check: reference table, expected min row count, what to do
//    if it fails. Thresholds are conservative — if you re-run loaders
//    on a fresh staging project these numbers should all pass easily. ─
const CHECKS = [
  {
    table: 'nhl_teams',
    minRows: 32,
    fixHint: 'Run: node scripts/staging/05-load-reference-data.mjs nhl_teams',
    blocks: 'Team lookups during draft + roster rendering',
  },
  {
    table: 'nhl_games',
    minRows: 1000,
    fixHint: 'Run: node scripts/staging/05-load-reference-data.mjs nhl_games',
    blocks: 'ScheduleManager, Matchup, weekly slate views',
  },
  {
    table: 'player_directory',
    minRows: 700,
    fixHint: 'Run: node scripts/staging/04-load-stats-data.mjs chunk_player_directory.sql',
    blocks: 'Roster rendering, FreeAgents browse, draft player pool',
  },
  {
    table: 'player_season_stats',
    minRows: 500,
    fixHint: 'Run: node scripts/staging/04-load-stats-data.mjs chunk_player_season_stats.sql',
    blocks: 'Roster stat columns, TeamAnalytics, Standings PF/PA totals',
  },
  {
    table: 'player_projected_stats',
    minRows: 500,
    fixHint: 'Run: node scripts/staging/04-load-stats-data.mjs chunk_player_projected_stats.sql',
    blocks: 'Auto Lineup, projection-based draft suggestions',
  },
  {
    table: 'player_ros_projections',
    minRows: 500,
    fixHint: 'Run: node scripts/staging/04-load-stats-data.mjs chunk_player_ros_projections.sql',
    blocks: 'Trade analyzer, FreeAgents ranking',
  },
  {
    table: 'player_talent_metrics',
    minRows: 500,
    fixHint: 'Run: node scripts/staging/04-load-stats-data.mjs chunk_player_talent_metrics.sql',
    blocks: 'TeamAnalytics radar chart, advanced metrics views',
  },
  {
    table: 'goalie_gsax_primary',
    minRows: 30,
    fixHint: 'Run: node scripts/staging/04-load-stats-data.mjs chunk_goalie_gsax_primary.sql',
    blocks: 'Goalie projections, Pineapple-led BackToBack watch',
  },
];

// ── HEAD with Prefer: count=exact gets the row count via Content-Range ─
async function countRows(table) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`;
  const res = await fetch(url, {
    method: 'HEAD',
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      Prefer: 'count=exact',
    },
  });
  if (!res.ok) {
    return { error: `${res.status} ${res.statusText}` };
  }
  const range = res.headers.get('content-range');
  if (!range) return { error: 'no Content-Range header' };
  // Format: "0-0/1234" or "*/1234"
  const m = range.match(/\/(\d+)$/);
  if (!m) return { error: `unexpected Content-Range: ${range}` };
  return { count: parseInt(m[1], 10) };
}

console.log(`Verifying ${SUPABASE_URL}\n`);

let failed = 0;
const results = [];
for (const check of CHECKS) {
  const { count, error } = await countRows(check.table);
  if (error) {
    console.log(`  ✗  ${check.table.padEnd(30)} ERROR ${error}`);
    console.log(`     fix: ${check.fixHint}`);
    console.log(`     blocks: ${check.blocks}`);
    failed++;
    results.push({ ...check, count: 0, status: 'error' });
    continue;
  }
  if (count < check.minRows) {
    console.log(`  ✗  ${check.table.padEnd(30)} ${String(count).padStart(6)} rows (need ${check.minRows}+)`);
    console.log(`     fix: ${check.fixHint}`);
    console.log(`     blocks: ${check.blocks}`);
    failed++;
    results.push({ ...check, count, status: 'insufficient' });
  } else {
    console.log(`  ✓  ${check.table.padEnd(30)} ${String(count).padStart(6)} rows`);
    results.push({ ...check, count, status: 'ok' });
  }
}

console.log('');
if (failed > 0) {
  console.log(`✗  ${failed} of ${CHECKS.length} checks failed.`);
  console.log('   Run the indicated loaders, then re-run this script.');
  process.exit(1);
}

console.log(`✓  All ${CHECKS.length} reference tables look healthy.`);
console.log('   Staging is ready for: sign-up → create league → draft → set lineup.');
console.log('   See docs/runbooks/staging-end-to-end.md for the full operator flow.');

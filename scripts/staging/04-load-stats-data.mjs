#!/usr/bin/env node
// Loads SQL dump files (pg_dump --inserts output) into staging Supabase
// via the PostgREST API. Way faster than pasting into SQL Editor, and
// handles arbitrarily large files by batching.
//
// Reads staging credentials from .env.staging at the repo root.
//
// Usage:
//   node scripts/staging/04-load-stats-data.mjs
//   node scripts/staging/04-load-stats-data.mjs <specific_chunk_file.sql>
//
// Idempotent via ON CONFLICT — re-running skips duplicates.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const REPO_ROOT = path.resolve(process.cwd());
const ENV_FILE = path.join(REPO_ROOT, '.env.staging');

// ── Parse .env.staging ─────────────────────────────────────────────
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

if (!SUPABASE_URL) {
  console.error('VITE_SUPABASE_URL missing from .env.staging');
  process.exit(1);
}
if (!SERVICE_ROLE) {
  console.error('Need a service role key. Set env var STAGING_SERVICE_ROLE_KEY or add SUPABASE_SERVICE_ROLE_KEY to .env.staging');
  console.error('Grab the service role JWT from https://supabase.com/dashboard/project/jjgspcpvqaiitloglxbb/settings/api-keys');
  process.exit(1);
}

// ── Default chunk files (ALL six tables, including the big one) ──
const DEFAULT_CHUNKS = [
  'chunk_player_directory.sql',
  'chunk_player_projected_stats.sql',
  'chunk_player_ros_projections.sql',
  'chunk_player_season_stats.sql',
  'chunk_player_talent_metrics.sql',
  'chunk_goalie_gsax_primary.sql',
];

const filesToLoad = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : DEFAULT_CHUNKS;

// ── Parse one INSERT statement into { table, columns, row } ───────
// Expected: INSERT INTO public.foo (a, b, c) VALUES (1, 'x', true);
// Handles multi-line VALUES by requiring the statement to end with ;
function parseInsert(stmt) {
  const m = stmt.match(/^INSERT INTO (?:public\.)?(\w+) \(([^)]+)\) VALUES\s*\((.+)\);\s*$/s);
  if (!m) return null;
  const [, table, colList, valList] = m;
  const columns = colList.split(',').map(c => c.trim());
  const values = parseValues(valList);
  if (values.length !== columns.length) {
    console.warn(`  !! column/value mismatch on ${table}: cols=${columns.length}, vals=${values.length}`);
    return null;
  }
  const row = {};
  for (let i = 0; i < columns.length; i++) row[columns[i]] = values[i];
  return { table, row };
}

// Simple SQL-literal parser — handles strings with '', numbers, NULL, true/false
function parseValues(valStr) {
  const out = [];
  let i = 0;
  while (i < valStr.length) {
    while (i < valStr.length && /\s/.test(valStr[i])) i++;
    if (valStr[i] === "'") {
      let end = i + 1;
      let s = '';
      while (end < valStr.length) {
        if (valStr[end] === "'" && valStr[end + 1] === "'") { s += "'"; end += 2; continue; }
        if (valStr[end] === "'") break;
        s += valStr[end]; end++;
      }
      out.push(s);
      i = end + 1;
    } else {
      let end = i;
      let depth = 0;
      while (end < valStr.length) {
        const c = valStr[end];
        if (c === '(' || c === '{' || c === '[') depth++;
        else if (c === ')' || c === '}' || c === ']') depth--;
        else if (c === ',' && depth === 0) break;
        end++;
      }
      const raw = valStr.slice(i, end).trim();
      if (raw.toUpperCase() === 'NULL') out.push(null);
      else if (raw === 'true') out.push(true);
      else if (raw === 'false') out.push(false);
      else if (/^-?\d+(\.\d+)?$/.test(raw)) out.push(Number(raw));
      else out.push(raw); // fallback for arrays, timestamps without quotes, etc.
      i = end;
    }
    while (i < valStr.length && /[\s,]/.test(valStr[i])) i++;
  }
  return out;
}

// ── Batch-insert rows via PostgREST ────────────────────────────────
async function upsertBatch(table, rows) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body.substring(0, 500)}`);
  }
}

// ── Process a single chunk file ────────────────────────────────────
async function loadChunk(file) {
  if (!fs.existsSync(file)) {
    console.log(`  Skip: ${file} not found`);
    return;
  }
  console.log(`\n▸ ${file}`);
  const rl = readline.createInterface({ input: fs.createReadStream(file) });
  const rowsByTable = new Map();
  let currentStmt = '';
  let parseCount = 0;

  for await (const line of rl) {
    if (line.startsWith('--') || line.startsWith('SET ') || line.startsWith('SELECT ') || !line.trim()) continue;
    currentStmt += line + '\n';
    if (line.trim().endsWith(';')) {
      const parsed = parseInsert(currentStmt);
      if (parsed) {
        if (!rowsByTable.has(parsed.table)) rowsByTable.set(parsed.table, []);
        rowsByTable.get(parsed.table).push(parsed.row);
        parseCount++;
      }
      currentStmt = '';
    }
  }

  console.log(`  Parsed ${parseCount} rows across ${rowsByTable.size} table(s)`);

  for (const [table, rows] of rowsByTable) {
    process.stdout.write(`  ${table}: inserting ${rows.length} rows `);
    const BATCH = 500;
    let done = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      try {
        await upsertBatch(table, chunk);
        done += chunk.length;
        process.stdout.write('.');
      } catch (err) {
        console.error(`\n  ERROR on ${table} batch ${i}-${i + chunk.length}: ${err.message}`);
        throw err;
      }
    }
    console.log(` done (${done})`);
  }
}

// ── Main ───────────────────────────────────────────────────────────
console.log(`Loading into ${SUPABASE_URL}`);
for (const file of filesToLoad) {
  await loadChunk(file);
}
console.log('\nAll chunks loaded.');

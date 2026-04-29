#!/usr/bin/env node
// Loads reference data (nhl_teams + nhl_games) into staging Supabase via the
// PostgREST API. The companion to 04-load-stats-data.mjs — that one handles
// player_* / goalie_* tables; this one handles the league-creation prerequisites
// the app reads at runtime (team lookups, schedule rendering).
//
// Source dump:  prod_data_inserts_clean.sql  (in repo root)
// Target:       staging Supabase (.env.staging)
//
// Idempotent — uses PostgREST upsert (Prefer: resolution=merge-duplicates) on
// each table's primary key, so re-running is safe.
//
// Usage:
//   node scripts/staging/05-load-reference-data.mjs           # both tables
//   node scripts/staging/05-load-reference-data.mjs nhl_teams # one table
//   node scripts/staging/05-load-reference-data.mjs nhl_games

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const REPO_ROOT = path.resolve(process.cwd());
const ENV_FILE = path.join(REPO_ROOT, '.env.staging');
const DUMP_FILE = path.join(REPO_ROOT, 'prod_data_inserts_clean.sql');

// Column order matches CREATE TABLE in prod_schema.sql. The dump uses
// positional INSERT (`INSERT INTO public.foo VALUES (...)`) so we have to
// know the order to map values back to column names.
const TABLE_SCHEMAS = {
  nhl_teams: {
    columns: ['team_id', 'name', 'abbreviation', 'city', 'created_at', 'updated_at'],
    onConflict: 'team_id',
  },
  nhl_games: {
    columns: [
      'id', 'game_id', 'game_date', 'game_time', 'home_team', 'away_team',
      'home_score', 'away_score', 'status', 'period', 'period_time', 'venue',
      'season', 'game_type', 'created_at', 'updated_at',
      'home_team_id', 'away_team_id',
      'moneyline_home', 'moneyline_away',
      'implied_win_probability_home', 'implied_win_probability_away',
      'playoff_round', 'series_id', 'series_game_number',
    ],
    onConflict: 'id',
  },
};

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
  process.exit(1);
}
if (!fs.existsSync(DUMP_FILE)) {
  console.error(`Missing dump file: ${DUMP_FILE}`);
  console.error('This loader expects prod_data_inserts_clean.sql in the repo root.');
  process.exit(1);
}

// ── Pick which tables to load ──────────────────────────────────────
const requested = process.argv.slice(2);
const tablesToLoad = requested.length > 0
  ? requested.filter(t => {
      if (!TABLE_SCHEMAS[t]) {
        console.error(`Unknown table: ${t}. Known: ${Object.keys(TABLE_SCHEMAS).join(', ')}`);
        process.exit(1);
      }
      return true;
    })
  : Object.keys(TABLE_SCHEMAS);

// ── Parse one positional INSERT statement ──────────────────────────
// Expected: INSERT INTO public.foo VALUES (1, 'x', true, NULL, ...);
// Returns { table, values: [...] } or null if it doesn't match.
function parsePositionalInsert(stmt) {
  const m = stmt.match(/^INSERT INTO (?:public\.)?(\w+) VALUES\s*\((.+)\);\s*$/s);
  if (!m) return null;
  const [, table, valList] = m;
  return { table, values: parseValues(valList) };
}

// SQL-literal parser — handles strings with '', numbers, NULL, true/false.
// Unquoted leftovers (timestamps, arrays) are passed through as raw text;
// PostgREST tolerates ISO-8601 timestamps and Postgres array literals.
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
      else out.push(raw);
      i = end;
    }
    while (i < valStr.length && /[\s,]/.test(valStr[i])) i++;
  }
  return out;
}

// ── Bulk upsert via PostgREST ──────────────────────────────────────
// Uses Prefer: resolution=merge-duplicates so re-runs of the loader
// don't 409 on existing primary keys.
async function upsertBatch(table, rows, onConflict) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body.substring(0, 500)}`);
  }
}

// ── Stream the dump, partition rows by table, batch-upsert ─────────
async function loadTables(targetTables) {
  console.log(`Loading into ${SUPABASE_URL}`);
  console.log(`From ${DUMP_FILE}`);
  console.log(`Tables: ${targetTables.join(', ')}\n`);

  const rl = readline.createInterface({ input: fs.createReadStream(DUMP_FILE) });
  const rowsByTable = new Map();
  for (const t of targetTables) rowsByTable.set(t, []);

  let currentStmt = '';
  let parseCount = 0;
  let skippedOtherTables = 0;

  for await (const line of rl) {
    if (line.startsWith('--') || line.startsWith('SET ') || line.startsWith('SELECT ') || !line.trim()) continue;
    currentStmt += line + '\n';
    if (line.trim().endsWith(';')) {
      const parsed = parsePositionalInsert(currentStmt);
      if (parsed) {
        if (rowsByTable.has(parsed.table)) {
          const schema = TABLE_SCHEMAS[parsed.table];
          if (parsed.values.length !== schema.columns.length) {
            console.warn(`  !! ${parsed.table}: expected ${schema.columns.length} cols, got ${parsed.values.length} — skipping row`);
          } else {
            const row = {};
            for (let i = 0; i < schema.columns.length; i++) {
              row[schema.columns[i]] = parsed.values[i];
            }
            rowsByTable.get(parsed.table).push(row);
            parseCount++;
          }
        } else {
          skippedOtherTables++;
        }
      }
      currentStmt = '';
    }
  }

  console.log(`Parsed ${parseCount} target rows; skipped ${skippedOtherTables} rows for non-target tables.\n`);

  for (const [table, rows] of rowsByTable) {
    if (rows.length === 0) {
      console.log(`▸ ${table}: 0 rows in dump (skipping)`);
      continue;
    }
    const onConflict = TABLE_SCHEMAS[table].onConflict;
    process.stdout.write(`▸ ${table}: upserting ${rows.length} rows on conflict=${onConflict} `);
    const BATCH = 500;
    let done = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      try {
        await upsertBatch(table, chunk, onConflict);
        done += chunk.length;
        process.stdout.write('.');
      } catch (err) {
        console.error(`\n  ERROR on ${table} batch ${i}-${i + chunk.length}: ${err.message}`);
        throw err;
      }
    }
    console.log(` done (${done})`);
  }

  console.log('\nReference data loaded.');
}

await loadTables(tablesToLoad);

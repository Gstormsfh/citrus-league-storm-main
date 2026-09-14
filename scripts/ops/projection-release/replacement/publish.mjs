#!/usr/bin/env node
/**
 * Replacement publication of the canonical source (2026-09-14).
 *
 * The first-publication runner is first-publication-only. Every later
 * source change — an availability review, a rate correction — replaces the
 * active run under the compare-and-swap guard the activation RPC already
 * enforces. This is the operator tool for that: four verbs, each one RPC or
 * one read, nothing invented.
 *
 *   node scripts/ops/projection-release/replacement/publish.mjs status
 *   node scripts/ops/projection-release/replacement/publish.mjs export   --out tmp/canonical/source.json
 *   node scripts/ops/projection-release/replacement/publish.mjs directory --out tmp/canonical/directory.json
 *   node scripts/ops/projection-release/replacement/publish.mjs stage    --payload tmp/canonical/stage-args.json
 *   node scripts/ops/projection-release/replacement/publish.mjs validate --run-id <uuid>
 *   node scripts/ops/projection-release/replacement/publish.mjs activate --run-id <uuid> --revision <sha> --expected-active <sha> --yes
 *
 * BYTES, NOT OBJECTS. The source revision is a SHA-256 of the document's
 * JSON text. A JSON round trip in JavaScript can rewrite a number
 * (1e-05 → 0.00001) and silently change what the digest describes. So this
 * tool never parses the payload: `export` writes PostgREST's response bytes
 * to disk minus the one-column envelope, and `stage` sends the stage-args
 * file's bytes verbatim as the request body. The Python editor is the only
 * thing that reads or writes the document.
 *
 * Credentials come from the repo-root .env.admin.local (SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY — the operator file, gitignored) and never from
 * argv. `activate` is the production write; it refuses to run
 * without --yes and prints exactly what it is about to swap.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SEASON = 2026;

function env() {
  const file = path.join(REPO, '.env.admin.local');
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const url = out.SUPABASE_URL;
  const key = out.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('.env.admin.local must set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  if (!url.includes('iezwazccqqrhrjupxzvf')) throw new Error(`refusing: ${url} is not the production project`);
  return { url: url.replace(/\/$/, ''), key };
}

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes') out.yes = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

async function rest(cfg, pathname, init = {}) {
  const res = await fetch(`${cfg.url}${pathname}`, {
    ...init,
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    // PostgREST runs with the role's statement_timeout. The validator walks
    // every player and the activator materializes every ROS/daily row, so
    // either can exceed it. That is not a failure of the run: the statement
    // was cancelled, nothing committed. The same call from the Supabase SQL
    // editor (or the Supabase connector) has no such limit.
    if (text.includes('"57014"') && init.sql) {
      throw new Error(`${pathname} hit the PostgREST statement timeout (nothing committed). Run this exact statement in the Supabase SQL editor instead:\n\n${init.sql}\n`);
    }
    throw new Error(`${init.method || 'GET'} ${pathname} → ${res.status}: ${text.slice(0, 2000)}`);
  }
  return text;
}

async function status(cfg) {
  const text = await rest(cfg, `/rest/v1/canonical_published_runs?season=eq.${SEASON}&select=season,run_id,revision,source_run_id,source_revision,activated_at,last_refresh_at,last_refresh_status,last_refresh_error`);
  const rows = JSON.parse(text);
  if (rows.length !== 1) throw new Error(`expected one active run for ${SEASON}, got ${rows.length}`);
  return rows[0];
}

async function exportSource(cfg, out) {
  if (fs.existsSync(out)) throw new Error(`${out} exists; choose a new filename per revision`);
  const active = await status(cfg);
  const text = await rest(cfg, `/rest/v1/canonical_published_runs?season=eq.${SEASON}&select=source_payload`);
  const prefix = '[{"source_payload":';
  const suffix = '}]';
  if (!text.startsWith(prefix) || !text.endsWith(suffix)) throw new Error('unexpected envelope from PostgREST; refusing to guess');
  const body = text.slice(prefix.length, text.length - suffix.length);
  // Sanity: the document's own revision field must equal the row's source_revision.
  const m = /"revision":\s*"([0-9a-f]{64})"/.exec(body);
  if (!m || m[1] !== active.source_revision) throw new Error(`document revision ${m && m[1]} != source_revision ${active.source_revision}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, body + '\n', { flag: 'wx' });
  return { out, bytes: body.length, source_revision: active.source_revision, runtime_revision: active.revision, runtime_run_id: active.run_id };
}

async function directory(cfg, out) {
  // The validator requires scope_player_ids == player_directory for the season.
  // Read the live ids so the editor's scope-sync can reconcile drift.
  if (fs.existsSync(out)) throw new Error(`${out} exists; choose a new filename`);
  const ids = [];
  for (let offset = 0; ; offset += 1000) {
    const text = await rest(cfg, `/rest/v1/player_directory?season=eq.${SEASON}&select=player_id&order=player_id.asc&offset=${offset}&limit=1000`);
    const rows = JSON.parse(text);
    ids.push(...rows.map((r) => String(r.player_id)));
    if (rows.length < 1000) break;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(ids) + '\n', { flag: 'wx' });
  return { out, directory_ids: ids.length };
}

async function stage(cfg, payloadFile) {
  const body = fs.readFileSync(payloadFile, 'utf8');
  if (!body.trimStart().startsWith('{"p_payload"') && !/^\{\s*"p_payload"/.test(body)) throw new Error('payload file must be the stage-payload output: {"p_payload": …}');
  const text = await rest(cfg, '/rest/v1/rpc/canonical_stage_projection_run', { method: 'POST', body });
  return { run_id: JSON.parse(text) };
}

async function validate(cfg, runId) {
  if (!UUID.test(runId)) throw new Error('run-id must be a uuid');
  const sql = `select public.canonical_validate_projection_run('${runId}'::uuid);`;
  const text = await rest(cfg, '/rest/v1/rpc/canonical_validate_projection_run', { method: 'POST', body: JSON.stringify({ p_run_id: runId }), sql });
  return JSON.parse(text);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;

async function activate(cfg, runId, revision, expectedActive, yes) {
  if (!UUID.test(runId) || !SHA.test(revision) || !SHA.test(expectedActive)) throw new Error('run-id must be a uuid; revision and expected-active must be 64-hex digests');
  const before = await status(cfg);
  if (before.revision !== expectedActive) {
    throw new Error(`refusing: active runtime revision is ${before.revision}, not the expected ${expectedActive}. Re-read status and start the review again.`);
  }
  const plan = { season: SEASON, staged_run_id: runId, staged_revision: revision, replaces_runtime_revision: before.revision, replaces_run_id: before.run_id };
  if (!yes) return { dry_run: true, plan, note: 'add --yes to activate' };
  const sql = `select public.canonical_activate_projection_run('${runId}'::uuid, '${revision}', '${expectedActive}');`;
  const text = await rest(cfg, '/rest/v1/rpc/canonical_activate_projection_run', {
    method: 'POST', body: JSON.stringify({ p_run_id: runId, p_expected_revision: revision, p_expected_active_revision: expectedActive }), sql,
  });
  const after = await status(cfg);
  return { plan, result: JSON.parse(text), after };
}

async function main() {
  const a = args(process.argv.slice(2));
  const verb = a._[0];
  const cfg = env();
  let out;
  if (verb === 'status') out = await status(cfg);
  else if (verb === 'export') out = await exportSource(cfg, a.out || `tmp/canonical/source-${Date.now()}.json`);
  else if (verb === 'directory') out = await directory(cfg, a.out || `tmp/canonical/directory-${Date.now()}.json`);
  else if (verb === 'stage') out = await stage(cfg, a.payload);
  else if (verb === 'validate') out = await validate(cfg, a['run-id']);
  else if (verb === 'activate') out = await activate(cfg, a['run-id'], a.revision, a['expected-active'], a.yes === true);
  else throw new Error('verb must be one of status | export | directory | stage | validate | activate');
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => { console.error(err.message); process.exit(1); });

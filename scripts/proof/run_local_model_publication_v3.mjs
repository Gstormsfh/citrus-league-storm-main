// Infrastructure v3: explicit tmpfs plus verified loopback-published bridge ports.
// Frozen v1 failed its inspection-shape assertion before setup; retained unchanged.
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, writeFile, realpath, lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { verifyDatabaseTmpfs } from './local_tmpfs_contract.mjs';
import { publishedLoopbackPort } from './local_port_contract.mjs';
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [outputArgument, python] = process.argv.slice(2);
assert(outputArgument && python && process.argv.length === 4, 'Usage: script NEW_OUTPUT_DIR ABSOLUTE_PYTHON');
const output = path.resolve(outputArgument);
const sourcePins = {};
for (const name of ['scripts/proof/run_local_model_publication_v3.mjs', 'scripts/proof/local_port_contract.mjs', 'scripts/proof/run_local_model_publication_v2.mjs', 'scripts/proof/local_tmpfs_contract.mjs', 'scripts/proof/run_local_model_publication.mjs'])
  sourcePins[name] = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
assert.equal(sourcePins['scripts/proof/run_local_model_publication.mjs'], '3210d08e5fb4a5dfa2e48005bbfd15153812af63a331909f560271853173f0a7');
assert.equal(sourcePins['scripts/proof/run_local_model_publication_v2.mjs'], 'ff575a5f3dae74e32420c58944f2c50dd363b900734777fcdbe332f70888ba78');
assert(path.dirname(output) === path.join(root, 'scripts/proof/results') && path.basename(output).startsWith('local-model-publication-'));
assert(path.isAbsolute(python) && (await lstat(await realpath(python))).isFile());
assert.equal(await realpath(path.dirname(output)), path.dirname(output), 'No symlink output parents');
await mkdir(output);
const save = (name, data) => writeFile(path.join(output, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const docker = async (...args) => (await exec('docker', args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const owner = randomUUID();
const label = 'citrus.local-model-publication';
const networkName = 'citrus-model-' + owner.slice(0, 12);
const pgImage = 'postgres@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3';
const restImage = 'postgrest/postgrest@sha256:54000f24847d01a2c2302e0041cf0618b875c57fb48507d743cfa9aaa50bf43c';
const owned = [];
let networkId, gateway, worker, gatewayDone, workerDone, stopped = false, result;
const shutdown = () => { stopped = true; worker?.kill('SIGTERM'); gateway?.kill('SIGTERM'); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
const alive = () => { if (stopped) throw new Error('Local proof interrupted'); };
const cleanup = { containers_removed: [], network_removed: false, gateway_stopped: false };
await save('attempt-started.json', { owner, scope: 'new-disposable-local-fixtures-only', started_at: new Date().toISOString(), publishable: false });
try {
  await docker('image', 'inspect', pgImage); await docker('image', 'inspect', restImage);
  alive();
  networkId = await docker('network', 'create', '--driver', 'bridge', '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', '--label', `${label}=${owner}`, networkName);
  alive();
  const pg = await docker('run', '--detach', '--label', `${label}=${owner}`, '--network', networkName,
    '--network-alias', 'local-model-db', '--publish', '127.0.0.1::5432', '--memory', '2g', '--cpus', '2',
    '--mount', 'type=tmpfs,destination=/var/lib/postgresql/data,tmpfs-size=1073741824', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', pgImage);
  owned.push({ id: pg, image: pgImage });
  const [pgInfo] = JSON.parse(await docker('inspect', pg));
  assert(pgInfo.Mounts.every(m => m.Type !== 'bind' && m.Type !== 'volume'));
  const liveMounts = await docker('exec', pg, 'cat', '/proc/self/mountinfo');
  await save('tmpfs-verification.json', verifyDatabaseTmpfs(pgInfo, liveMounts));
  const pgPort = publishedLoopbackPort(pgInfo, '5432/tcp');
  let ready = false;
  for (let i = 0; i < 60; i++) {
    alive();
    try { await docker('exec', pg, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break; } catch { /* bounded startup only */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(ready, 'Disposable PostgreSQL did not become ready');
  const setup = await exec(process.execPath, ['scripts/start_analytics_rest_fixture.mjs', 'setup'], {
    cwd: root, env: { ...process.env, ANALYTICS_TEST_PG_PORT: String(pgPort) }, timeout: 30_000,
  });
  await save('setup.stdout.txt', setup.stdout); await save('setup.stderr.txt', setup.stderr);
  const secret = randomBytes(48).toString('hex');
  const tokens = Object.fromEntries(['anon', 'authenticated', 'service_role'].map(role => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ role, iss: 'citrus-local-integration',
      exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const unsigned = `${header}.${body}`;
    return [role, `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`];
  }));
  await save('synthetic-local-tokens.json', tokens);
  alive();
  const rest = await docker('run', '--detach', '--label', `${label}=${owner}`, '--network', networkName,
    '--publish', '127.0.0.1::3000', '--memory', '512m', '--cpus', '1',
    '--env', 'PGRST_DB_URI=postgres://authenticator@local-model-db:5432/postgres',
    '--env', 'PGRST_DB_SCHEMAS=public', '--env', 'PGRST_DB_ANON_ROLE=anon',
    '--env', 'PGRST_DB_MAX_ROWS=1000', '--env', 'PGRST_DB_POOL=5',
    '--env', `PGRST_JWT_SECRET=${secret}`, restImage);
  owned.push({ id: rest, image: restImage });
  const [restInfo] = JSON.parse(await docker('inspect', rest));
  const restPort = publishedLoopbackPort(restInfo, '3000/tcp');
  ready = false;
  for (let i = 0; i < 60; i++) {
    alive();
    try { const response = await fetch(`http://127.0.0.1:${restPort}/`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; } } catch { /* bounded startup only */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(ready, 'Disposable PostgREST did not become ready');
  gateway = spawn(process.execPath, ['scripts/start_analytics_rest_fixture.mjs', 'gateway'], {
    cwd: root, env: { ...process.env, ANALYTICS_TEST_REST_PORT: String(restPort) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let gatewayOut = '', gatewayErr = '';
  gatewayDone = new Promise(resolve => gateway.once('close', code => resolve(code)));
  gateway.stdout.on('data', b => { gatewayOut += b; }); gateway.stderr.on('data', b => { gatewayErr += b; });
  let base;
  for (let i = 0; i < 60; i++) {
    alive();
    if (gatewayOut.includes('\n')) { base = JSON.parse(gatewayOut.trim().split('\n')[0]).url; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(base && new URL(base).hostname === '127.0.0.1', 'Local gateway failed');
  await save('fixture.json', { owner, network_id: networkId, containers: owned, pg_port: pgPort,
    rest_port: restPort, base_url: base, postgres_tmpfs: true, synthetic_jwt_only: true,
    network_kind: 'task-owned bridge with verified loopback host bindings; not an egress firewall',
    postgres_memory_bytes: 2147483648, postgrest_memory_bytes: 536870912, postgrest_pool: 5 });
  worker = spawn(python, ['scripts/local_model_publication_e2e.py', '--base-url', base,
    '--token-file', path.join(output, 'synthetic-local-tokens.json'), '--output', path.join(output, 'proof')], {
    cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let workerOut = '', workerErr = '';
  worker.stdout.on('data', b => { workerOut += b; process.stdout.write(b); }); worker.stderr.on('data', b => { workerErr += b; });
  workerDone = new Promise((resolve, reject) => { worker.once('error', reject); worker.once('close', resolve); });
  const budget = setTimeout(() => { stopped = true; worker.kill('SIGTERM'); }, 15 * 60 * 1000);
  let code;
  try { code = await workerDone; } finally { clearTimeout(budget); }
  await save('worker.stdout.txt', workerOut); await save('worker.stderr.txt', workerErr);
  await save('gateway.stdout.txt', gatewayOut); await save('gateway.stderr.txt', gatewayErr);
  const counts = await docker('exec', pg, 'psql', '-U', 'postgres', '-At', '-c', `SELECT json_build_object(
    'sources',(SELECT count(*) FROM analytics_source_snapshots),
    'batches',(SELECT count(*) FROM analytics_metric_batches),
    'values',(SELECT count(*) FROM analytics_metric_values),
    'publications',(SELECT count(*) FROM analytics_publications),
    'rls_tables',(SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relrowsecurity));`);
  await save('final-database-counts.json', JSON.parse(counts));
  assert.equal(code, 0, `Local Python proof failed; retained worker.stderr.txt (exit ${code})`);
  const health = JSON.parse(await readFile(path.join(output, 'proof/health.json'), 'utf8'));
  assert.equal(health.status, 'complete-local-diagnostic-transport-not-accepted');
  for (const [name, digest] of Object.entries(sourcePins))
    assert.equal(createHash('sha256').update(await readFile(path.join(root, name))).digest('hex'), digest, 'Infrastructure source drift');
  result = { status: health.status, owner, infrastructure_version: 3, source_sha256: sourcePins, publishable: false, production_changed: false };
} catch (error) {
  await save('failure.json', { status: 'failed-local-model-fixture', error: String(error), publishable: false });
  process.exitCode = 1;
} finally {
  worker?.kill('SIGTERM'); if (workerDone) await workerDone.catch(() => {});
  gateway?.kill('SIGTERM'); if (gatewayDone) { await gatewayDone; cleanup.gateway_stopped = true; }
  for (const { id, image } of owned.reverse()) {
    const [info] = JSON.parse(await docker('inspect', id));
    assert.equal(info.Config.Labels[label], owner, 'Refuse cleanup of unowned container');
    assert.equal(info.Config.Image, image);
    const logs = await exec('docker', ['logs', id], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    await save(`container-${id.slice(0, 12)}.logs.json`, { stdout: logs.stdout, stderr: logs.stderr });
    await docker('stop', '--time', '5', id); await docker('rm', id);
    cleanup.containers_removed.push(id);
  }
  if (networkId) {
    const [info] = JSON.parse(await docker('network', 'inspect', networkId));
    assert.equal(info.Labels[label], owner); assert.equal(Object.keys(info.Containers).length, 0);
    await docker('network', 'rm', networkId); cleanup.network_removed = true;
  }
  const remaining = await docker('ps', '-aq', '--filter', `label=${label}=${owner}`);
  assert.equal(remaining, '');
  cleanup.zero_remaining_owned_containers = true;
  await save('cleanup.json', cleanup);
}
if (result) {
  const files = {};
  for (const name of await readdir(output, { recursive: true })) {
    const full = path.join(output, name), stat = await lstat(full);
    assert(!stat.isSymbolicLink(), 'No symlink fixture artifacts');
    if (stat.isFile()) files[name] = createHash('sha256').update(await readFile(full)).digest('hex');
  }
  await save('health.json', { ...result, cleanup, files }); console.log(JSON.stringify(result));
}

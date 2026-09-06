/** Create-only full-cohort TypeScript/Python artifact parity; no network or serving. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, realpath, stat, lstat, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createPortableXgScorer } from '../../packages/shared/src/utils/portableXg.ts';

const VERSION = 'citrus-full-cohort-typescript-xg-parity-v1';
const TOLERANCE = 1e-12;
const KINDS = ['raw', 'logit_sigmoid', 'isotonic', 'beta', 'beta_group'];
const FIELDS = ['shot_type', 'prior_sog_same_team', 'strength'];
const WINDOWS = {
  fold1: { calibration: ['2021-07-01', '2022-06-30'], validation: ['2022-07-01', '2023-06-30'] },
  fold2: { calibration: ['2022-07-01', '2023-06-30'], validation: ['2023-07-01', '2024-06-30'] },
};
function check(ok, message) { if (!ok) throw new Error(message); }
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function sha(value) { check(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'SHA256 required'); return value; }
async function safe(path) {
  const absolute = resolve(path); check(await realpath(absolute) === absolute && (await stat(absolute)).isFile(), 'Regular nonsymlink file required'); return absolute;
}
async function hashFile(path) {
  await safe(path); const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex');
}
async function persist(directory, name, body) {
  const bytes = JSON.stringify(body); const handle = await open(resolve(directory, name), 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  const parent = await open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
  return digest(bytes);
}
function exactKeys(value, expected) {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every(k => Object.hasOwn(value, k)), 'Exact object keys required');
}
function identity(row) {
  check(row && Number.isSafeInteger(row.game_id) && Number.isSafeInteger(row.event_id), 'Exact event identity required'); return `${row.game_id}:${row.event_id}`;
}
function canonicalContext(value) { exactKeys(value, FIELDS); return JSON.stringify(FIELDS.map(f => value[f])); }

export async function verifyPortableXg({ experiment, exportDir, expectedHealthSha, output }) {
  output = resolve(output); check(await realpath(dirname(output)) === dirname(output), 'Nonsymlink output parent required');
  await mkdir(output); const files = {}, checked = new Map(); let complete = false;
  const interrupt = () => { throw new Error('Interrupted portable parity proof'); };
  // The CLI handles signals through an abort flag; synchronous scoring finishes at a row boundary.
  let interrupted = false; const onSignal = () => { interrupted = true; };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  try {
    files['attempt-started.json'] = await persist(output, 'attempt-started.json', { contract: VERSION, started_at: new Date().toISOString(), publishable: false });
    async function readChecked(path, expected) {
      path = await safe(path); check((await stat(path)).size <= 256 * 1024 * 1024, 'Bounded JSON file required');
      const bytes = await readFile(path), actual = digest(bytes);
      if (expected !== undefined) check(actual === sha(expected), 'Pinned evidence changed');
      if (checked.has(path)) check(checked.get(path) === actual, 'Previously consumed evidence changed');
      checked.set(path, actual); return JSON.parse(bytes);
    }
    const health = await readChecked(resolve(experiment, 'health.json'), sha(expectedHealthSha));
    exactKeys(health, ['status', 'publishable', 'completed_folds', 'files', 'source_code_and_prior_evidence_reverified']);
    check(health.status === 'completed-calibration-development-not-accepted' && health.publishable === false
      && health.source_code_and_prior_evidence_reverified === true && JSON.stringify(health.completed_folds) === '["fold1","fold2"]', 'Completed nonpublishing experiment required');
    try { await stat(resolve(experiment, 'failure.json')); throw new Error('Experiment failure evidence present'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const expectedFiles = ['attempt-started.json', 'declaration.json', 'result.json', ...Object.keys(WINDOWS).flatMap(fold =>
      ['attempt-started.json', 'model.json', 'fit-receipt.json', 'calibration-predictions.json', 'predictions.json', 'scorecard.json',
        ...KINDS.map(k => `calibrator-${k}.json`)].map(name => `${fold}/${name}`))];
    exactKeys(health.files, expectedFiles);
    async function inventory(directory, prefix = '') {
      const found = [];
      for (const name of await readdir(directory)) {
        const path = resolve(directory, name), info = await lstat(path);
        check(!info.isSymbolicLink(), 'No symlink experiment artifacts');
        if (info.isDirectory()) {
          check(prefix === '' && ['fold1', 'fold2'].includes(name), 'Only declared fold directories');
          found.push(...await inventory(path, `${name}/`));
        } else { check(info.isFile(), 'Regular experiment artifact'); found.push(prefix + name); }
      }
      return found.sort();
    }
    const expectedInventory = [...expectedFiles, 'health.json'].sort().join('|');
    check((await inventory(resolve(experiment))).join('|') === expectedInventory, 'Exact experiment file inventory required');
    for (const [name, expected] of Object.entries(health.files)) {
      const path = resolve(experiment, name); check(relative(resolve(experiment), path) === name && !isAbsolute(name), 'Safe indexed relative path required');
      check(await hashFile(path) === sha(expected), 'Experiment artifact drift'); checked.set(path, expected);
    }
    async function artifact(name) { return readChecked(resolve(experiment, name), health.files[name]); }
    const declaration = await artifact('declaration.json'), result = await artifact('result.json');
    check(declaration.contract === 'citrus-source-replayed-calibration-experiment-v1' && declaration.publishable === false
      && result.status === health.status && result.publishable === false && result.plan_sha256 === declaration.plan_sha256, 'Bound experiment declaration required');
    check(declaration.consumed_file_sha256 && typeof declaration.consumed_file_sha256 === 'object'
      && Object.keys(declaration.consumed_file_sha256).length <= 20000, 'Bounded source evidence closure');
    for (const [path, expected] of Object.entries(declaration.consumed_file_sha256)) {
      if (interrupted) interrupt();
      check(await hashFile(path) === sha(expected), 'Source/code/prior evidence changed');
      if (checked.has(path)) check(checked.get(path) === expected, 'Detached prior evidence');
      checked.set(path, expected);
    }
    for (const path of [fileURLToPath(import.meta.url), fileURLToPath(new URL('../../packages/shared/src/utils/portableXg.ts', import.meta.url))]) checked.set(path, await hashFile(path));
    const manifest = await readChecked(resolve(exportDir, 'manifest.json'), declaration.source_manifest_sha256);
    check(manifest.status === 'complete-development-export-not-fit-accepted' && manifest.publishable === false
      && manifest.later_period_event_files_opened === false, 'Completed development-only export required');
    const dataPath = await safe(resolve(exportDir, 'development.jsonl'));
    check(await hashFile(dataPath) === manifest.outputs['development.jsonl'].sha256, 'Frozen feature bytes changed');
    check((await stat(dataPath)).size === manifest.outputs['development.jsonl'].bytes, 'Frozen feature size changed');
    checked.set(dataPath, manifest.outputs['development.jsonl'].sha256);
    const folded = {};
    for (const [fold, windows] of Object.entries(WINDOWS)) {
      const model = await artifact(`${fold}/model.json`), maps = {};
      const calibrators = Object.fromEntries(await Promise.all(KINDS.map(async k => [k, await artifact(`${fold}/calibrator-${k}.json`)])));
      const receipt = await artifact(`${fold}/fit-receipt.json`);
      check(JSON.stringify(model.design.schema) === JSON.stringify(manifest.schema), 'Exact source feature schema required');
      check(receipt.model_sha256 === health.files[`${fold}/model.json`] && receipt.plan_sha256 === declaration.plan_sha256, 'Bound fitted model required');
      for (const k of KINDS) check(receipt.calibrator_sha256[k] === health.files[`${fold}/calibrator-${k}.json`], 'Bound calibrator required');
      for (const split of ['calibration', 'validation']) {
        const list = await artifact(`${fold}/${split === 'calibration' ? 'calibration-predictions' : 'predictions'}.json`);
        check(Array.isArray(list) && list.length > 0 && list.length <= 1000000, 'Bounded reference population required');
        maps[split] = new Map(list.map(r => [identity(r), r])); check(maps[split].size === list.length, 'Duplicate reference row');
        check(receipt.cohorts[split].window.start === windows[split][0] && receipt.cohorts[split].window.end === windows[split][1], 'Fixed parity window required');
      }
      folded[fold] = { scorer: createPortableXgScorer(model, calibrators), maps, receipt, statistics: Object.fromEntries(['calibration', 'validation'].map(split => [split, {
        rows: 0, max_absolute_error: Object.fromEntries((split === 'calibration' ? ['raw'] : KINDS).map(k => [k, 0])),
        context: Object.fromEntries(FIELDS.map(f => [f, { missing: 0, unseen: 0, rows: 0 }])),
      }])) };
    }
    let sourceRows = 0;
    const stream = createReadStream(dataPath); const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (interrupted) interrupt(); check(line.length > 0 && line.length < 65536, 'Bounded nonempty source row');
        const row = JSON.parse(line); sourceRows++; check(sourceRows <= 1000000, 'Source row bound exceeded');
        check(typeof row.game_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.game_date) && row.game_date < '2024-07-01', 'Earlier development dates required');
        for (const [fold, windows] of Object.entries(WINDOWS)) for (const [split, [start, end]] of Object.entries(windows)) {
          if (row.game_date < start || row.game_date > end) continue;
          const f = folded[fold], key = identity(row), reference = f.maps[split].get(key);
          check(reference && reference.target === Number(row.label) && [0, 1].includes(reference.target), 'Exact source/reference membership and outcome required');
          const predicted = f.scorer.predict(row), statistics = f.statistics[split];
          if (split === 'calibration') check(canonicalContext(predicted.context) === canonicalContext(reference.context), 'Pre-outcome context parity');
          for (const kind of Object.keys(statistics.max_absolute_error)) {
            const expected = split === 'calibration' ? reference.raw_probability : reference.predictions[kind];
            check(typeof expected === 'number' && Number.isFinite(expected) && expected >= 0 && expected <= 1, 'Valid reference probability');
            const error = Math.abs(predicted.predictions[kind] - expected); check(error <= TOLERANCE, 'Cross-language probability mismatch');
            statistics.max_absolute_error[kind] = Math.max(statistics.max_absolute_error[kind], error);
          }
          for (const name of FIELDS) { statistics.context[name].missing += Number(predicted.contextStatus[name].missing);
            statistics.context[name].unseen += Number(predicted.contextStatus[name].unseen); statistics.context[name].rows++; }
          statistics.rows++; f.maps[split].delete(key);
        }
        if (sourceRows % 50000 === 0) console.log(JSON.stringify({ event: 'portable.parity.progress', source_rows: sourceRows, publishable: false }));
      }
    } finally { lines.close(); stream.destroy(); }
    check(sourceRows === manifest.counts.eligible_events, 'Complete frozen source population required');
    for (const f of Object.values(folded)) for (const split of ['calibration', 'validation']) {
      check(f.maps[split].size === 0 && f.statistics[split].rows > 0, 'Every reference row must be consumed exactly once');
      for (const field of FIELDS) for (const key of ['missing', 'unseen', 'rows'])
        check(f.statistics[split].context[field][key] === f.receipt.context_receipts[split][field][key], 'Context receipt parity required');
    }
    for (const [path, expected] of checked) { if (interrupted) interrupt(); check(await hashFile(path) === expected, 'Consumed evidence/code drift'); }
    check((await inventory(resolve(experiment))).join('|') === expectedInventory, 'Experiment inventory changed');
    const report = { contract: VERSION, status: 'complete-full-cohort-typescript-parity-not-accepted', publishable: false,
      started_from_health_sha256: expectedHealthSha, source_rows: sourceRows, tolerance: TOLERANCE, node_version: process.version,
      folds: Object.fromEntries(Object.entries(folded).map(([name, f]) => [name, f.statistics])), consumed_file_sha256: Object.fromEntries(checked),
      scope: 'all_calibration_raw_and_all_validation_five_calibrator_probabilities_from_frozen_source_features',
      limitations: ['No hosted writes or serving integration.', 'Consistency with frozen Python evidence is not prospective quality or source authentication.',
        'No source PBP reparse in TypeScript; features remain bound to the independent Python source replay.', 'No FPAR or industry-standard acceptance.'] };
    files['result.json'] = await persist(output, 'result.json', report);
    for (const [name, expected] of Object.entries(files)) check(await hashFile(resolve(output, name)) === expected, 'Proof artifact drift');
    check((await readdir(output)).sort().join('|') === Object.keys(files).sort().join('|'), 'Unexpected proof files');
    await persist(output, 'health.json', { status: report.status, files, publishable: false }); complete = true; return report;
  } catch (error) {
    try { await persist(output, 'failure.json', { status: 'failed-portable-parity', error_type: error.name, publishable: false, partial_files_preserved: true }); } catch {}
    throw error;
  } finally {
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    if (!complete) console.error(JSON.stringify({ event: 'portable.parity.failed', publishable: false }));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  check(args.length === 8, 'Exactly four named arguments required');
  const mapping = { '--experiment': 'experiment', '--export': 'exportDir', '--expected-health-sha': 'expectedHealthSha', '--output': 'output' };
  for (let i = 0; i < args.length; i += 2) { check(mapping[args[i]] && !options[mapping[args[i]]] && args[i + 1], 'Unique named argument required'); options[mapping[args[i]]] = args[i + 1]; }
  verifyPortableXg(options).then(r => console.log(JSON.stringify({ status: r.status, folds: r.folds, publishable: false })))
    .catch(error => { console.error(error); process.exitCode = 1; });
}

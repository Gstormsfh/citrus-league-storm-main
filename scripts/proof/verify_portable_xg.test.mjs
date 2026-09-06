import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyPortableXg } from './verify_portable_xg.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const kinds = ['raw', 'logit_sigmoid', 'isotonic', 'beta', 'beta_group'];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'citrus-portable-proof-'));
  // Realpath is explicit because macOS /tmp is an alias; no cleanup of broad paths.
  const { realpath } = await import('node:fs/promises'); const directory = await realpath(root);
  const experiment = join(directory, 'experiment'), exportDir = join(directory, 'export');
  await mkdir(experiment); await mkdir(exportDir); const files = {};
  async function save(name, value) { const bytes = JSON.stringify(value); await writeFile(join(experiment, name), bytes); files[name] = sha(bytes); }
  const names = ['immediate_previous_sog_same_team', 'shooting_skaters', 'defending_skaters'];
  const schema = { version: 'synthetic', names, categorical_names: ['shot_type'] };
  const rows = [2021, 2022, 2023].map(year => ({ game_id: year * 1000000 + 20001, event_id: 1,
    game_date: `${year}-10-01`, features: [null, 5, 5], categorical: { shot_type: 'wrist' }, label: 0 }));
  const data = rows.map(r => JSON.stringify(r) + '\n').join(''); await writeFile(join(exportDir, 'development.jsonl'), data);
  const manifest = { status: 'complete-development-export-not-fit-accepted', publishable: false,
    later_period_event_files_opened: false, schema, counts: { eligible_events: 3 },
    outputs: { 'development.jsonl': { sha256: sha(data), bytes: Buffer.byteLength(data) } } };
  const manifestBytes = JSON.stringify(manifest); await writeFile(join(exportDir, 'manifest.json'), manifestBytes);
  const settings = { epsilon: 1e-6, shape_ridge: 1, group_ridge: 100, optimizer: 'L-BFGS-B', maxiter: 2000,
    ftol: 1e-12, gtol: 1e-8, max_rows: 1000000, max_categories_per_field: 64, max_context_cells: 32000000,
    unknown_group_policy: 'zero_offset_with_explicit_context_receipt', seed: 60906 };
  const context = { shot_type: 'wrist', prior_sog_same_team: null, strength: '5v5' };
  for (const [i, fold] of ['fold1', 'fold2'].entries()) {
    await mkdir(join(experiment, fold)); await save(`${fold}/attempt-started.json`, { synthetic: true });
    await save(`${fold}/model.json`, { contract: 'citrus-json-numeric-context-model-v1', publishable: false,
      source_sklearn_version: '1.5.2', input_policy: 'finite_design_after_explicit_imputation', branch_policy: 'less_than_or_equal_left',
      leaf_policy: 'already_learning_rate_scaled', baseline_logit: 0, trees: [[{ leaf: 0 }]],
      design: { schema, numeric_names: names, categorical_names: ['shot_type'],
        medians: { immediate_previous_sog_same_team: 0, shooting_skaters: 5, defending_skaters: 5 }, vocabulary: { shot_type: ['wrist'] } } });
    for (const kind of kinds) {
      const c = { contract: 'citrus-probability-calibrator-v1', kind, settings, publishable: false };
      if (kind === 'logit_sigmoid') Object.assign(c, { slope: 1, intercept: 0 });
      if (kind === 'isotonic') Object.assign(c, { x: [0, 1], y: [0, 1] });
      if (kind.startsWith('beta')) Object.assign(c, { a: 1, b: 1, intercept: 0, vocabulary: {}, offsets: [],
        optimization: { converged: true, iterations: 1, objective: .2 } });
      if (kind === 'beta_group') Object.assign(c, { vocabulary: { shot_type: ['wrist'], prior_sog_same_team: [null], strength: ['5v5'] }, offsets: [0, 0, 0] });
      await save(`${fold}/calibrator-${kind}.json`, c);
    }
    await save(`${fold}/calibration-predictions.json`, [{ game_id: rows[i].game_id, event_id: 1, target: 0, raw_probability: .5, context }]);
    await save(`${fold}/predictions.json`, [{ game_id: rows[i + 1].game_id, event_id: 1, target: 0, predictions: Object.fromEntries(kinds.map(k => [k, .5])) }]);
    await save(`${fold}/scorecard.json`, { synthetic: true });
    const counts = Object.fromEntries(Object.keys(context).map(k => [k, { missing: k === 'prior_sog_same_team' ? 1 : 0, unseen: 0, rows: 1 }]));
    await save(`${fold}/fit-receipt.json`, { model_sha256: files[`${fold}/model.json`], plan_sha256: 'a'.repeat(64),
      calibrator_sha256: Object.fromEntries(kinds.map(k => [k, files[`${fold}/calibrator-${k}.json`]])),
      cohorts: Object.fromEntries(['calibration', 'validation'].map((s, j) => [s, { window: { start: `${2021 + i + j}-07-01`, end: `${2022 + i + j}-06-30` } }])),
      context_receipts: { calibration: counts, validation: counts } });
  }
  await save('attempt-started.json', { synthetic: true });
  await save('declaration.json', { contract: 'citrus-source-replayed-calibration-experiment-v1', publishable: false,
    plan_sha256: 'a'.repeat(64), consumed_file_sha256: {}, source_manifest_sha256: sha(manifestBytes) });
  await save('result.json', { status: 'completed-calibration-development-not-accepted', publishable: false, plan_sha256: 'a'.repeat(64) });
  const health = { status: 'completed-calibration-development-not-accepted', publishable: false, completed_folds: ['fold1', 'fold2'], files, source_code_and_prior_evidence_reverified: true };
  const bytes = JSON.stringify(health); await writeFile(join(experiment, 'health.json'), bytes);
  return { experiment, exportDir, expectedHealthSha: sha(bytes), output: join(directory, 'proof') };
}

test('synthetic complete population parity, output binding and no overwrite', async () => {
  const args = await fixture(); const result = await verifyPortableXg(args);
  assert.equal(result.publishable, false); assert.equal(result.source_rows, 3);
  assert.equal(result.folds.fold2.validation.rows, 1); assert.equal(result.folds.fold1.calibration.max_absolute_error.raw, 0);
  const health = JSON.parse(await readFile(join(args.output, 'health.json')));
  assert.equal(health.files['result.json'], sha(await readFile(join(args.output, 'result.json'))));
  await assert.rejects(verifyPortableXg(args), { code: 'EEXIST' });
});
for (const bad of ['health_pin', 'model_bytes', 'source_bytes', 'failure_marker', 'wrong_prediction', 'missing_population', 'extra_artifact']) {
  test(`rejects ${bad} and preserves failed attempt`, async () => {
    const args = await fixture();
    if (bad === 'health_pin') args.expectedHealthSha = '0'.repeat(64);
    if (bad === 'model_bytes') await writeFile(join(args.experiment, 'fold1/model.json'), '{}');
    if (bad === 'source_bytes') await writeFile(join(args.exportDir, 'development.jsonl'), '{}\n');
    if (bad === 'failure_marker') await writeFile(join(args.experiment, 'failure.json'), '{}');
    if (['wrong_prediction', 'missing_population', 'extra_artifact'].includes(bad)) {
      const health = JSON.parse(await readFile(join(args.experiment, 'health.json')));
      const name = bad === 'extra_artifact' ? 'unindexed.json' : 'fold1/predictions.json';
      const rows = bad === 'extra_artifact' ? {} : JSON.parse(await readFile(join(args.experiment, name)));
      if (bad === 'wrong_prediction') rows[0].predictions.beta_group = .1;
      if (bad === 'missing_population') rows[0].event_id = 2;
      const bytes = JSON.stringify(rows); await writeFile(join(args.experiment, name), bytes); health.files[name] = sha(bytes);
      const changed = JSON.stringify(health); await writeFile(join(args.experiment, 'health.json'), changed); args.expectedHealthSha = sha(changed);
    }
    await assert.rejects(verifyPortableXg(args));
    assert.equal(JSON.parse(await readFile(join(args.output, 'failure.json'))).publishable, false);
    await assert.rejects(stat(join(args.output, 'health.json')), { code: 'ENOENT' });
  });
}

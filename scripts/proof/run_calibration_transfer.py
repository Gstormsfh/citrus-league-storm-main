"""Declared retrospective monthly transfer; frozen raw model, earlier-only maps."""
import argparse
from datetime import date, datetime, timezone
import hashlib
from pathlib import Path
import signal
import time

import numpy as np
from threadpoolctl import threadpool_limits
import bounded_conditional_calibration as bounded
from run_calibration_stability import (ROOT, encode, runtime, receipt, primary_passed,
    reuse, portable, conditional, calibration_candidate, fingerprint,
    probability_scorecard, strict_json, file_sha, scalar_predictions,
    strict_keys, join_records, probability_vector, maximum_error)
from run_forward_shooter_movement import frozen_control

PLAN = 'docs/analytics-calibration-transfer-plan-20260906.json'
PLAN_SHA = 'f60544d9eb9ce69fb0c6041947d9c7bde401864cc69371e35f88f7622f909f6e'
CONTRACT = 'citrus-calibration-transfer-v1'
OUTPUTS = ('fixed', 'expanding')
METRICS = ('brier', 'log_loss_clipped')
CHUNK_ROWS = 4096
SOURCE = reuse.CONDITIONAL
SOURCE_SHA = '0e395d181d810d1c616a3787633d778c9c0b75e76844304f45001663944f19c7'
PROOF = 'scripts/proof/results/bounded-conditional-proof-20260906-full'
PROOF_SHA = 'a86f40c8d30e1e29081e0369ee136ccb2eabec51618e05f8764120c63c7ae4ed'
MEMBERSHIP = 'scripts/proof/results/official-forward-shooter-movement-20260906-retry1'
CODE = ('scripts/proof/run_calibration_transfer.py', 'scripts/proof/test_run_calibration_transfer.py',
    'scripts/proof/test_calibration_transfer_review.py', 'scripts/proof/run_calibration_stability.py',
    'scripts/proof/run_forward_shooter_movement.py', 'scripts/proof/run_conditional_shape_candidate.py',
    'scripts/proof/bounded_conditional_calibration.py', 'data-pipeline/projections/conditional_calibration_shape.py',
    'data-pipeline/projections/portable_context_model.py', 'data-pipeline/projections/verified_movement_reuse_v2.py')


def transfer_blocks(calibration_records, validation_records):
    """Date/key partition only: all original calibration plus earlier outer dates."""
    combined = list(calibration_records)+list(validation_records)
    strict_keys(combined)
    if not calibration_records or not validation_records:
        raise ValueError('Nonempty original calibration and validation required')
    days = {}
    for row in combined:
        day = row['game_date']
        if not isinstance(day, str) or date.fromisoformat(day).isoformat() != day:
            raise ValueError('Canonical game date required')
        if row['game_id'] in days and days[row['game_id']] != day:
            raise ValueError('One date per game required')
        days[row['game_id']] = day
    if max(r['game_date'] for r in calibration_records) >= min(r['game_date'] for r in validation_records):
        raise ValueError('Original calibration must precede validation')
    ordered = sorted(combined, key=lambda r: (r['game_date'], r['game_id'], r['event_id']))
    blocks = []
    for month in sorted({r['game_date'][:7] for r in validation_records}):
        test = [r for r in ordered if r['game_date'][:7] == month]
        first = min(r['game_date'] for r in test)
        train = [r for r in ordered if r['game_date'] < first]
        blocks.append({'month': month, 'train_records': train, 'test_records': test,
            'receipt': {'month': month, 'train': receipt(train), 'test': receipt(test)}})
    if set(strict_keys([r for b in blocks for r in b['test_records']])) != set(strict_keys(validation_records)):
        raise ValueError('Every original validation event must be scored exactly once')
    return blocks


def preflight_block(block, contexts_by_key):
    train, test = block['train_records'], block['test_records']
    keys = strict_keys(train); test_keys = strict_keys(test)
    if (len(train) < 100 or len({k[0] for k in keys}) < 30 or not test
            or any(type(r['target']) is not int or r['target'] not in (0, 1) for r in train)
            or {r['target'] for r in train} != {0, 1}
            or {k[0] for k in keys} & {k[0] for k in test_keys}
            or max(r['game_date'] for r in train) >= min(r['game_date'] for r in test)):
        raise ValueError('Supported strictly earlier whole-game training required')
    contexts = [contexts_by_key[k] for k in keys]
    conditional._contexts(contexts, len(contexts))
    conditional._contexts([contexts_by_key[k] for k in test_keys], len(test_keys))
    vocabulary = conditional._vocabulary(contexts)
    states = [s for s in conditional.STATES if any(c['prior_sog_same_team'] == s for c in contexts)]
    return {'training_events': len(train), 'training_games': len({k[0] for k in keys}),
        'train_allocation': bounded.allocation(len(train), vocabulary, states, CHUNK_ROWS),
        'test_allocation': bounded.allocation(len(test), vocabulary, states, CHUNK_ROWS),
        'test_support': 'sparse' if len(test) < 100 or len({k[0] for k in test_keys}) < 30 else 'supported_exploratory'}


def preflight_study(prepared, expected):
    if set(prepared) != {'fold1', 'fold2'} or set(expected) != set(prepared):
        raise ValueError('Both folds required before any fit')
    result = {}
    for fold, item in prepared.items():
        for block in item['blocks']:
            if (block['receipt'] != {'month': block['month'], 'train': receipt(block['train_records']), 'test': receipt(block['test_records'])}
                    or any(r['game_date'][:7] != block['month'] for r in block['test_records'])):
                raise ValueError('Live block records must match declared receipt and month')
        if [b['receipt'] for b in item['blocks']] != expected[fold]:
            raise ValueError('Exact predeclared monthly membership required')
        result[fold] = {b['month']: preflight_block(b, item['contexts_by_key']) for b in item['blocks']}
    return result


def fit_block(block, initial, raw_by_key, contexts_by_key, *, first):
    train, test = block['train_records'], block['test_records']
    keys = strict_keys(train); test_keys = strict_keys(test)
    if ({k[0] for k in keys} & {k[0] for k in test_keys}
            or max(r['game_date'] for r in train) >= min(r['game_date'] for r in test)):
        raise ValueError('Earlier disjoint map fit required')
    if first: return strict_json(encode(initial))
    return strict_json(encode(bounded.fit([raw_by_key[k] for k in keys],
        [r['target'] for r in train], [contexts_by_key[k] for k in keys], chunk_rows=CHUNK_ROWS)))


def map_parity(model, raw, contexts, actual):
    scalar = maximum_error(scalar_predictions(model, raw, contexts), actual, len(raw))
    reverse = maximum_error(bounded.predict(model, list(raw)[::-1], contexts[::-1], CHUNK_ROWS)[::-1], actual, len(raw))
    singleton = 0.
    for i in range(0, len(raw), CHUNK_ROWS):
        singleton = max(singleton, maximum_error(bounded.predict(model, [raw[i]], [contexts[i]], CHUNK_ROWS), [actual[i]], 1))
    return {'events': len(raw), 'scalar_max_abs_error': scalar, 'reversed_max_abs_error': reverse,
        'sampled_singleton_max_abs_error': singleton, 'singleton_policy': 'first_of_each_4096_rows'}


def pin_run(closure, folder, digest, status):
    closure.pin(folder+'/health.json', digest)
    health = closure.read(folder+'/health.json')
    if health['status'] != status or health['publishable'] is not False:
        raise ValueError('Complete nonpublishing source required')
    closure.inventory(folder, [*health['files'], 'health.json'])
    for name, expected in health['files'].items():
        if Path(name).is_absolute() or '..' in Path(name).parts: raise ValueError('Contained member required')
        closure.pin(folder+'/'+name, expected)
    return health


def run(output):
    output = Path(output).absolute()
    if (output.parent != ROOT/'scripts/proof/results' or '..' in output.parts
            or not output.name.startswith('official-calibration-transfer-')
            or any(p.is_symlink() for p in (output, *output.parents))):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False); files, completed = {}, []; closure = reuse.Closure(ROOT)
    def save(name, value):
        body = encode(value); path = output/name; path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as stream: stream.write(body)
        files[name] = hashlib.sha256(body).hexdigest()
    try:
        now = datetime.now(timezone.utc).isoformat()
        save('attempt-started.json', {'started_at': now, 'publishable': False})
        closure.pin(PLAN, PLAN_SHA); plan = closure.read(PLAN)
        if (plan['contract'] != CONTRACT+':plan' or plan['source'] != {'directory': SOURCE, 'health_sha256': SOURCE_SHA}
                or plan['bounded_proof'] != {'directory': PROOF, 'health_sha256': PROOF_SHA}
                or plan['conditional_settings'] != conditional.SETTINGS or bounded.SETTINGS != conditional.SETTINGS
                or plan['outputs'] != list(OUTPUTS) or plan['primary'] != 'expanding' or plan['chunk_rows'] != CHUNK_ROWS
                or any(plan[k] is not False for k in ('publishable', 'automatic_acceptance', 'untouched_test_claim', 'historical_as_of_verified'))
                or datetime.fromisoformat(plan['declared_at']) > datetime.fromisoformat(now)):
            raise ValueError('Exact earlier nonpromoting fixed-settings plan required')
        for name in CODE: closure.pin(name, file_sha(closure.safe(name)))
        save('input-declaration.json', {'plan_sha256': PLAN_SHA, 'code_sha256': dict(closure.checked), 'runtime': runtime(), 'publishable': False})
        pin_run(closure, PROOF, PROOF_SHA, 'complete-bounded-conditional-numerical-proof')
        closure.mapping(closure.read(PROOF+'/consumed-file-sha256.json'))
        proof_declaration = closure.read(PROOF+'/declaration.json')
        closure.mapping(proof_declaration['code_sha256'])
        features = reuse.load(ROOT); closure.mapping(features.closure.checked)
        pin_run(closure, SOURCE, SOURCE_SHA, 'complete-conditional-shape-development-not-accepted')
        if features.schema != plan['schema'] or features.config['scorecard'] != plan['scorecard']:
            raise ValueError('Frozen movement schema and scorecard required')
        prepared = {}
        for fold in ('fold1', 'fold2'):
            model = closure.read(f'{SOURCE}/{fold}/model.json')
            initial = closure.read(f'{SOURCE}/{fold}/calibrators.json')['conditional_shape']
            if model['design']['schema'] != features.schema: raise ValueError('Frozen model schema required')
            rows_by_split = {s: features.folds[fold][s]['rows'] for s in ('calibration', 'validation')}
            if max(r['game_date'] for r in features.folds[fold]['train']['rows']) >= min(r['game_date'] for r in rows_by_split['calibration']):
                raise ValueError('Raw fitted training must precede all calibration')
            records, raw_by_key, context_by_key, source_rows, replay = {}, {}, {}, {}, {}
            for split, rows in rows_by_split.items():
                path = f'{MEMBERSHIP}/{fold}/{split}-identity-inputs.json'
                closure.pin(path, plan['membership_source_sha256'][path])
                matched = join_records(rows, closure.read(path))
                if strict_keys(matched) != strict_keys(rows): raise ValueError('Original canonical feature order required')
                records[split] = [{k: r[k] for k in ('game_id', 'event_id', 'game_date', 'target')} for r in matched]
                if receipt(records[split]) != plan['cohorts'][fold][split]: raise ValueError('Original cohort receipt changed')
                with threadpool_limits(limits=1):
                    raw = portable.predict_rows(model, rows)
                    probability_vector(raw, len(rows))
                    contexts = [calibration_candidate.context_from_row(r, features.schema) for r in rows]
                    mapped = bounded.predict(initial, raw, contexts, CHUNK_ROWS)
                    if split == 'validation':
                        saved_fixed, groups = frozen_control(closure, fold, rows, raw, contexts, features.groups[fold])
                        replay['saved_fixed_max_abs_error'] = maximum_error(mapped, saved_fixed, len(rows))
                        fixed_by_key = dict(zip(strict_keys(rows), map(float, saved_fixed)))
                        replay['saved_raw_max_abs_error'] = 0.
                    replay[split+'_scalar_max_abs_error'] = maximum_error(scalar_predictions(initial, raw, contexts), mapped, len(rows))
                keys = strict_keys(rows)
                raw_by_key.update(zip(keys, map(float, raw))); context_by_key.update(zip(keys, contexts))
                source_rows[split] = [{**r, 'raw_probability': float(raw[i]), 'context': contexts[i],
                    **({'groups': groups[keys[i]]} if split == 'validation' else {})} for i, r in enumerate(records[split])]
            prepared[fold] = {'model': model, 'initial': initial, 'blocks': transfer_blocks(records['calibration'], records['validation']),
                'raw_by_key': raw_by_key, 'contexts_by_key': context_by_key, 'fixed_by_key': fixed_by_key,
                'groups': groups, 'source_rows': source_rows, 'replay': replay}
        bounds = preflight_study(prepared, plan['blocks'])
        closure.verify()
        manifest = {'checked': dict(closure.checked), 'inventories': {**features.closure.inventories, **closure.inventories}}
        save('declaration.json', {'contract': CONTRACT, 'plan': plan, 'plan_sha256': PLAN_SHA,
            'code_and_reference_sha256': dict(closure.checked), 'source_manifest_sha256': fingerprint(manifest),
            'preflight': bounds, 'runtime': runtime(), 'publishable': False,
            'outer_artifacts_access': 'retrospective_earlier_outer_month_labels_update_later_maps_not_historical_asof'})
        summaries = {}
        for fold, item in prepared.items():
            save(f'{fold}/model.json', item['model']); save(f'{fold}/initial-map.json', item['initial'])
            save(f'{fold}/fixed-map-replay.json', item['replay'])
            for split, rows in item['source_rows'].items(): save(f'{fold}/source-{split}.json', rows)
            all_predictions, monthly = [], {}
            for number, block in enumerate(item['blocks']):
                month = block['month']; root = f'{fold}/{month}'
                print(encode({'event': 'calibration_transfer.fit_start', 'fold': fold, 'month': month, 'refit': number != 0}).decode(), flush=True)
                started = time.perf_counter()
                with threadpool_limits(limits=1):
                    fitted = fit_block(block, item['initial'], item['raw_by_key'], item['contexts_by_key'], first=number == 0)
                    fit_wall = time.perf_counter()-started if number else 0.
                    keys = strict_keys(block['test_records'])
                    raw = [item['raw_by_key'][k] for k in keys]; contexts = [item['contexts_by_key'][k] for k in keys]
                    fixed = [item['fixed_by_key'][k] for k in keys]
                    expanded = bounded.predict(fitted, raw, contexts, CHUNK_ROWS)
                    first_error = maximum_error(expanded, fixed, len(keys)) if number == 0 else None
                    if number == 0: expanded = np.asarray(fixed)
                    parity = {**map_parity(fitted, raw, contexts, expanded), 'first_block_recomputed_subset_max_error': first_error,
                        'first_block_saved_vector_reused': number == 0}
                print(encode({'event': 'calibration_transfer.fit_end', 'fold': fold, 'month': month, 'fit_wall_seconds': fit_wall}).decode(), flush=True)
                evaluated = [{'game_id': k[0], 'event_id': k[1], 'target': r['target'], 'groups': item['groups'][k],
                    'predictions': {'fixed': float(fixed[i]), 'expanding': float(expanded[i])}}
                    for i, (k, r) in enumerate(zip(keys, block['test_records']))]
                evaluated.sort(key=lambda r: (r['game_id'], r['event_id']))
                def inputs(records, targets):
                    return [{**{k: r[k] for k in (('game_id', 'event_id', 'game_date', 'target') if targets else ('game_id', 'event_id', 'game_date'))},
                        'raw_probability': item['raw_by_key'][r['game_id'], r['event_id']],
                        'context': item['contexts_by_key'][r['game_id'], r['event_id']]} for r in records]
                save(root+'/map.json', fitted); save(root+'/train-inputs.json', inputs(block['train_records'], True))
                save(root+'/test-inputs.json', inputs(block['test_records'], False)); save(root+'/predictions.json', evaluated)
                save(root+'/fit-receipt.json', {'block': block['receipt'], 'refitted': number != 0, 'fit_wall_seconds': fit_wall,
                    'preflight': bounds[fold][month], 'train_inputs_sha256': files[root+'/train-inputs.json'],
                    'test_inputs_sha256': files[root+'/test-inputs.json'], 'parity': parity, 'publishable': False})
                lineage = {'prediction_rows_sha256': fingerprint(evaluated), 'source_manifest_sha256': fingerprint(manifest),
                    'split_sha256': fingerprint(block['receipt']), 'pipelines': {n: fingerprint({'raw_model': files[f'{fold}/model.json'],
                        'map': files[f'{fold}/initial-map.json'] if n == 'fixed' else files[root+'/map.json'],
                        'declaration': files['declaration.json']}) for n in OUTPUTS}}
                with threadpool_limits(limits=1): card = probability_scorecard(evaluated, config=plan['scorecard'], evidence_kind='real', lineage=lineage)
                save(root+'/scorecard.json', card)
                monthly[month] = {'events': len(evaluated), 'games': len({k[0] for k in keys}), 'support': bounds[fold][month]['test_support'],
                    'refitted': number != 0, 'fit_wall_seconds': fit_wall,
                    'losses': {n: {m: card['overall']['models'][n]['metrics'][m]['value'] for m in METRICS} for n in OUTPUTS}}
                all_predictions.extend(evaluated)
            strict_keys(all_predictions); all_predictions.sort(key=lambda r: (r['game_id'], r['event_id']))
            save(f'{fold}/predictions.json', all_predictions)
            lineage = {'prediction_rows_sha256': fingerprint(all_predictions), 'source_manifest_sha256': fingerprint(manifest),
                'split_sha256': fingerprint(plan['blocks'][fold]), 'pipelines': {n: fingerprint({'model': files[f'{fold}/model.json'],
                    'maps': [files[f'{fold}/initial-map.json']] if n == 'fixed' else [files[f'{fold}/{b["month"]}/map.json'] for b in item['blocks']],
                    'declaration': files['declaration.json']}) for n in OUTPUTS}}
            with threadpool_limits(limits=1): card = probability_scorecard(all_predictions, config=plan['scorecard'], evidence_kind='real', lineage=lineage)
            save(f'{fold}/scorecard.json', card); save(f'{fold}/monthly.json', monthly)
            losses = {n: {m: card['overall']['models'][n]['metrics'][m]['value'] for m in METRICS} for n in OUTPUTS}
            summaries[fold] = {'events': len(all_predictions), 'losses': losses, 'primary_guard_passed': primary_passed(losses)}
            save(f'{fold}/summary.json', summaries[fold]); completed.append(fold)
        features.verify(); closure.verify()
        save('source-reuse.json', manifest); save('consumed-file-sha256.json', dict(closure.checked))
        save('result.json', {'folds': summaries, 'primary_guard_passed': all(s['primary_guard_passed'] for s in summaries.values()),
            'limitations': plan['limitations'], 'publishable': False, 'model_accepted': False, 'production_changed': False,
            'historical_as_of_verified': False, 'earlier_outer_labels_used_for_later_maps': True})
        for name, digest in files.items():
            if file_sha(output/name) != digest: raise ValueError('Output drift')
        save('health.json', {'status': 'complete-calibration-transfer-development-not-accepted', 'files': dict(files), 'publishable': False})
    except BaseException as error:
        save('failure.json', {'error_type': type(error).__name__, 'error': str(error), 'completed_folds': completed,
            'files': dict(files), 'publishable': False})
        raise


if __name__ == '__main__':
    def stop(signum, frame): raise KeyboardInterrupt('Preserve interrupted calibration transfer')
    signal.signal(signal.SIGTERM, stop)
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True)
    run(parser.parse_args().output)

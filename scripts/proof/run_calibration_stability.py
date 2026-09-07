"""Original-calibration-only rolling-origin map study; no raw/identity fitting."""
import argparse
from datetime import date, datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import signal
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'data-pipeline'))
import numpy as np
import scipy
import sklearn
from threadpoolctl import threadpool_limits
from projections import verified_movement_reuse_v2 as reuse
from projections import portable_context_model as portable
from projections import conditional_calibration_shape as conditional
from projections import calibration_candidate
from projections.analytics_publication import fingerprint
from projections.probability_scorecard import probability_scorecard
from projections.verified_export_experiment import strict_json, file_sha
from run_conditional_shape_candidate import scalar_predictions
from run_forward_shooter_movement import strict_keys, join_records, probability_vector, maximum_error

PLAN = 'docs/analytics-calibration-stability-plan-20260906.json'
PLAN_SHA = '9c9d2751ae71dc94a40207260368d0228aefd616184a0f32abb4441fa8fa9b54'
SOURCE = 'scripts/proof/results/official-forward-shooter-movement-20260906-retry1'
SOURCE_SHA = '829119131d856969b5278d1b14d1a711c19b4a5a404b6b932ee40cf29af9fe22'
CONTRACT = 'citrus-calibration-stability-v1'
OUTPUTS = ('fixed', 'expanding')
METRICS = ('brier', 'log_loss_clipped')
CODE = ('scripts/proof/run_calibration_stability.py', 'scripts/proof/test_run_calibration_stability.py',
        'scripts/proof/test_calibration_stability_review.py', 'scripts/proof/run_forward_shooter_movement.py',
        'scripts/proof/run_conditional_shape_candidate.py', 'data-pipeline/projections/conditional_calibration_shape.py',
        'data-pipeline/projections/portable_context_model.py', 'data-pipeline/projections/verified_movement_reuse_v2.py')


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def runtime():
    return {'python': platform.python_version(), 'numpy': np.__version__, 'scipy': scipy.__version__, 'sklearn': sklearn.__version__}


def receipt(records):
    keys = strict_keys(records)
    return {'events': len(records), 'games': len({k[0] for k in keys}),
            'start': min(r['game_date'] for r in records), 'end': max(r['game_date'] for r in records),
            'keys_sha256': hashlib.sha256(encode(sorted([list(k) for k in keys]))).hexdigest()}


def monthly_blocks(records, cutoff):
    """Deterministic dates/keys only; no outcome-based partition or repair."""
    strict_keys(records)
    if not isinstance(cutoff, str) or date.fromisoformat(cutoff).isoformat() != cutoff:
        raise ValueError('Canonical cutoff required')
    games = {}
    for r in records:
        day = r['game_date']
        if not isinstance(day, str) or date.fromisoformat(day).isoformat() != day:
            raise ValueError('Canonical record date required')
        if r['game_id'] in games and games[r['game_id']] != day:
            raise ValueError('One date per game required')
        games[r['game_id']] = day
    ordered = sorted(records, key=lambda r: (r['game_date'], r['game_id'], r['event_id']))
    later = [r for r in ordered if r['game_date'] >= cutoff]
    if not later or len(later) == len(ordered): raise ValueError('Nonempty earlier and later stages required')
    blocks = []
    for month in sorted({r['game_date'][:7] for r in later}):
        test = [r for r in later if r['game_date'][:7] == month]
        first = min(r['game_date'] for r in test)
        train = [r for r in ordered if r['game_date'] < first]
        if not train or {r['game_id'] for r in train} & {r['game_id'] for r in test}:
            raise ValueError('Strictly earlier whole-game fit required')
        blocks.append({'month': month, 'train_records': train, 'test_records': test,
                       'receipt': {'month': month, 'train': receipt(train), 'test': receipt(test)}})
    if set(strict_keys([r for b in blocks for r in b['test_records']])) != set(strict_keys(later)):
        raise ValueError('Complete once-only later-half score membership required')
    return blocks


def fixed_map_replay(model, initial, rows, saved_records):
    """No fitting; replay original JSON and exact prior fixed mapped vector."""
    matched = join_records(rows, saved_records)
    if strict_keys(matched) != strict_keys(rows): raise ValueError('Canonical original calibration row order required')
    schema = model['design']['schema']
    raw = portable.predict_rows(model, rows)
    probability_vector(raw, len(rows))
    contexts = [calibration_candidate.context_from_row(r, schema) for r in rows]
    mapped = conditional.predict(initial, raw, contexts)
    saved_error = maximum_error(mapped, [r['probability'] for r in matched], len(rows), tolerance=0)
    scalar_error = maximum_error(scalar_predictions(initial, raw, contexts), mapped, len(rows))
    return raw, contexts, mapped, {'events': len(rows), 'saved_fixed_max_abs_error': saved_error,
        'independent_scalar_max_abs_error': scalar_error, 'raw_reference': 'frozen_saved_JSON_model_replay',
        'separately_saved_prior_raw_calibration_vector_claimed': False}


def preflight_block(block, contexts_by_key):
    train, test = block['train_records'], block['test_records']
    if (len(train) < 100 or len({r['game_id'] for r in train}) < 30
            or any(type(r['target']) is not int or r['target'] not in (0, 1) for r in train)
            or {r['target'] for r in train} != {0, 1} or not test
            or max(r['game_date'] for r in train) >= min(r['game_date'] for r in test)):
        raise ValueError('Declared supported earlier fit and nonempty forward test required')
    contexts = [contexts_by_key[k] for k in strict_keys(train)]
    conditional._contexts(contexts, len(contexts))
    vocab = conditional._vocabulary(contexts)
    states = [s for s in conditional.STATES if any(c['prior_sog_same_team'] == s for c in contexts)]
    group_width = sum(map(len, vocab.values()))
    width = conditional.SLOPES*(1+len(states))+1+group_width
    rows = max(len(train), len(test))
    cells = rows*(2*width+conditional.SLOPES+group_width)
    if rows > conditional.SETTINGS['max_rows'] or cells > conditional.SETTINGS['max_cells']:
        raise ValueError('Original conditional numerical/resource bounds exceeded')
    return {'max_design_cells': cells, 'design_width': width, 'training_events': len(train),
            'training_games': len({r['game_id'] for r in train}),
            'test_support': 'sparse' if len(test) < 100 or len({r['game_id'] for r in test}) < 30 else 'supported_exploratory'}


def preflight_study(prepared, expected):
    result = {}
    if set(prepared) != {'fold1', 'fold2'} or set(expected) != set(prepared):
        raise ValueError('Both planned folds required before fitting')
    for fold, item in prepared.items():
        if [b['receipt'] for b in item['blocks']] != expected[fold]:
            raise ValueError('Exact predeclared monthly membership required')
        result[fold] = {b['month']: preflight_block(b, item['contexts_by_key']) for b in item['blocks']}
    return result


def fit_block(block, initial, raw_by_key, contexts_by_key, *, first):
    """Only this block's strictly earlier fit labels are passed to the fitter."""
    keys = strict_keys(block['train_records'])
    test_keys = strict_keys(block['test_records'])
    if (set(keys) & set(test_keys) or max(r['game_date'] for r in block['train_records'])
            >= min(r['game_date'] for r in block['test_records'])):
        raise ValueError('Strictly earlier disjoint fit stage required')
    if first:
        return strict_json(encode(initial))
    return strict_json(encode(conditional.fit([raw_by_key[k] for k in keys],
        [r['target'] for r in block['train_records']], [contexts_by_key[k] for k in keys])))


def map_parity(model, raw, contexts, actual):
    scalar = maximum_error(scalar_predictions(model, raw, contexts), actual, len(raw))
    reverse = maximum_error(conditional.predict(model, list(raw)[::-1], contexts[::-1])[::-1], actual, len(raw))
    singleton = 0.
    for i in range(0, len(raw), 4096):
        singleton = max(singleton, maximum_error(conditional.predict(model, [raw[i]], [contexts[i]]), [actual[i]], 1))
    return {'scalar_max_abs_error': scalar, 'reversed_max_abs_error': reverse,
            'sampled_singleton_max_abs_error': singleton, 'singleton_policy': 'first_of_each_4096_rows',
            'events': len(raw)}


def primary_passed(losses):
    return all(type(losses[n][m]) in (int, float) and math.isfinite(losses[n][m])
               for n in OUTPUTS for m in METRICS) and all(losses['expanding'][m] <= losses['fixed'][m] for m in METRICS)


def run(output):
    output = Path(output).absolute()
    if (output.parent != ROOT/'scripts/proof/results' or '..' in output.parts
            or not output.name.startswith('official-calibration-stability-')
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
        if (plan['contract'] != CONTRACT+':plan' or plan['source']['directory'] != SOURCE
                or plan['source']['health_sha256'] != SOURCE_SHA or plan['conditional_settings'] != conditional.SETTINGS
                or plan['outputs'] != list(OUTPUTS) or plan['primary'] != 'expanding'
                or any(plan[k] is not False for k in ('publishable', 'automatic_acceptance', 'untouched_test_claim'))
                or datetime.fromisoformat(plan['declared_at']) > datetime.fromisoformat(now)):
            raise ValueError('Exact earlier nonpromoting fixed-settings plan required')
        for name in CODE: closure.pin(name, file_sha(closure.safe(name)))
        save('input-declaration.json', {'plan_sha256': PLAN_SHA, 'code_sha256': dict(closure.checked),
            'runtime': runtime(), 'publishable': False})
        features = reuse.load(ROOT); closure.mapping(features.closure.checked)
        closure.pin(SOURCE+'/health.json', SOURCE_SHA)
        health = closure.read(SOURCE+'/health.json')
        if health['status'] != 'complete-forward-shooter-movement-development-not-accepted' or health['publishable'] is not False:
            raise ValueError('Complete fixed-map source required')
        closure.inventory(SOURCE, [*health['files'], 'health.json'])
        for name, digest in health['files'].items():
            if Path(name).is_absolute() or '..' in Path(name).parts: raise ValueError('Contained source member required')
            closure.pin(SOURCE+'/'+name, digest)
        source_manifest = closure.read(SOURCE+'/source-reuse.json')
        closure.mapping(source_manifest['checked'])
        for folder, inventory in source_manifest['inventories'].items(): closure.inventory(folder, inventory)
        if features.schema != plan['schema'] or features.config['scorecard'] != plan['scorecard']:
            raise ValueError('Unchanged movement schema and scoring required')
        groups = {}
        for item in closure.lines(reuse.EXPORT+'/groups.jsonl'):
            key = tuple(strict_keys([item])[0])
            if key in groups: raise ValueError('Duplicate original group identity')
            groups[key] = item['groups']
        prepared = {}
        for fold in ('fold1', 'fold2'):
            # No outer validation row or outcome is passed to operational study code.
            rows = features.folds[fold]['calibration']['rows']
            model = closure.read(f'{SOURCE}/{fold}/model.json')
            original_model = closure.read(f'{reuse.CONDITIONAL}/{fold}/model.json')
            if model != original_model or model['design']['schema'] != features.schema:
                raise ValueError('Exact unchanged raw movement model required')
            if max(r['game_date'] for r in features.folds[fold]['train']['rows']) >= min(r['game_date'] for r in rows):
                raise ValueError('Raw model training must precede all calibration')
            saved = closure.read(f'{SOURCE}/{fold}/calibration-identity-inputs.json')
            initial = closure.read(f'{SOURCE}/{fold}/calibrators.json')['conditional_shape']
            with threadpool_limits(limits=1): raw, contexts, fixed, replay = fixed_map_replay(model, initial, rows, saved)
            keys = strict_keys(rows)
            blocks = monthly_blocks(saved, plan['cutoffs'][fold])
            split = closure.read(f'{SOURCE}/{fold}/split.json')
            if (set(strict_keys(blocks[0]['train_records'])) != set(k for k in keys if k[0] in split['earlier_map']['game_ids'])
                    or set(strict_keys([r for b in blocks for r in b['test_records']])) != set(k for k in keys if k[0] in split['later_identity']['game_ids'])):
                raise ValueError('Original earlier/later half membership changed')
            prepared[fold] = {'rows': rows, 'model': model, 'initial': initial, 'replay': replay, 'blocks': blocks,
                'raw_by_key': dict(zip(keys, map(float, raw))), 'fixed_by_key': dict(zip(keys, map(float, fixed))),
                'contexts_by_key': dict(zip(keys, contexts))}
            if not set(keys) <= set(groups): raise ValueError('Original calibration groups incomplete')
        bounds = preflight_study(prepared, plan['blocks'])
        closure.verify()
        manifest = {'checked': dict(closure.checked), 'inventories': {**features.closure.inventories, **closure.inventories}}
        save('declaration.json', {'contract': CONTRACT, 'plan': plan, 'plan_sha256': PLAN_SHA,
            'code_and_reference_sha256': dict(closure.checked), 'source_manifest_sha256': fingerprint(manifest),
            'preflight': bounds, 'runtime': runtime(), 'publishable': False,
            'outer_artifacts_access': 'reuse_and_integrity_may_read_bytes_and_rows_but_no_outer_fitting_scoring_or_selection'})
        summaries = {}
        for fold, item in prepared.items():
            save(f'{fold}/model.json', item['model']); save(f'{fold}/initial-map.json', item['initial'])
            save(f'{fold}/fixed-map-replay.json', item['replay'])
            all_predictions, monthly = [], {}
            for number, block in enumerate(item['blocks']):
                month = block['month']; root = f'{fold}/{month}'
                print(json.dumps({'event': 'calibration_stability.block', 'fold': fold, 'month': month, 'refit': number != 0}), flush=True)
                with threadpool_limits(limits=1):
                    fitted = fit_block(block, item['initial'], item['raw_by_key'], item['contexts_by_key'], first=number == 0)
                    keys = strict_keys(block['test_records'])
                    raw = [item['raw_by_key'][k] for k in keys]
                    context = [item['contexts_by_key'][k] for k in keys]
                    fixed = [item['fixed_by_key'][k] for k in keys]
                    expanded = conditional.predict(fitted, raw, context)
                    first_subset_error = maximum_error(expanded, fixed, len(keys)) if number == 0 else None
                    if number == 0: expanded = np.asarray(fixed)
                    parity = {**map_parity(fitted, raw, context, expanded),
                              'first_block_recomputed_subset_max_error': first_subset_error,
                              'first_block_saved_vector_reused': number == 0}
                evaluated = [{'game_id': k[0], 'event_id': k[1], 'target': r['target'], 'groups': groups[k],
                    'predictions': {'fixed': float(fixed[i]), 'expanding': float(expanded[i])}}
                    for i, (k, r) in enumerate(zip(keys, block['test_records']))]
                evaluated.sort(key=lambda r: (r['game_id'], r['event_id']))
                train_inputs = [{'game_id': r['game_id'], 'event_id': r['event_id'], 'game_date': r['game_date'],
                    'target': r['target'], 'raw_probability': item['raw_by_key'][r['game_id'], r['event_id']],
                    'context': item['contexts_by_key'][r['game_id'], r['event_id']]} for r in block['train_records']]
                test_inputs = [{'game_id': r['game_id'], 'event_id': r['event_id'], 'game_date': r['game_date'],
                    'raw_probability': item['raw_by_key'][r['game_id'], r['event_id']],
                    'context': item['contexts_by_key'][r['game_id'], r['event_id']]} for r in block['test_records']]
                save(root+'/map.json', fitted); save(root+'/train-inputs.json', train_inputs); save(root+'/test-inputs.json', test_inputs)
                save(root+'/predictions.json', evaluated)
                save(root+'/fit-receipt.json', {'block': block['receipt'], 'refitted': number != 0,
                    'preflight': bounds[fold][month], 'train_inputs_sha256': files[root+'/train-inputs.json'],
                    'test_inputs_sha256': files[root+'/test-inputs.json'], 'parity': parity, 'publishable': False})
                lineage = {'prediction_rows_sha256': fingerprint(evaluated), 'source_manifest_sha256': fingerprint(manifest),
                    'split_sha256': fingerprint(block['receipt']), 'pipelines': {n: fingerprint({'raw_model': files[f'{fold}/model.json'],
                        'map': files[f'{fold}/initial-map.json'] if n == 'fixed' else files[root+'/map.json'],
                        'declaration': files['declaration.json']}) for n in OUTPUTS}}
                with threadpool_limits(limits=1): card = probability_scorecard(evaluated, config=plan['scorecard'], evidence_kind='real', lineage=lineage)
                save(root+'/scorecard.json', card)
                monthly[month] = {'events': len(evaluated), 'games': len({k[0] for k in keys}),
                    'support': bounds[fold][month]['test_support'], 'refitted': number != 0,
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
            'outer_validation_used_for_fit_score_selection': False})
        for name, digest in files.items():
            if file_sha(output/name) != digest: raise ValueError('Output drift')
        save('health.json', {'status': 'complete-calibration-stability-development-not-accepted', 'files': dict(files), 'publishable': False})
    except BaseException as error:
        save('failure.json', {'error_type': type(error).__name__, 'error': str(error), 'completed_folds': completed,
            'files': dict(files), 'publishable': False})
        raise


if __name__ == '__main__':
    def stop(signum, frame): raise KeyboardInterrupt('Preserve interrupted calibration study')
    signal.signal(signal.SIGTERM, stop)
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True)
    run(parser.parse_args().output)

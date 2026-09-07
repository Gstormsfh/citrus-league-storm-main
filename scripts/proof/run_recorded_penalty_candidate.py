"""Create-only recorded-annotation development experiment; never production."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import signal
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'data-pipeline'))
import numpy as np
import scipy
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from threadpoolctl import threadpool_limits
from projections import verified_movement_reuse_v2 as reuse
from projections import development_experiment as development
from projections import portable_context_model as portable
from projections import conditional_calibration_shape as conditional
from projections import calibration_candidate, calibration_shape
from projections.analytics_publication import fingerprint
from projections.probability_scorecard import probability_scorecard
from projections.verified_export_experiment import strict_json, file_sha
from run_conditional_shape_candidate import scalar_predictions
from run_strength_partition_candidate import CAL, SHAPE

PLAN = 'docs/analytics-recorded-penalty-candidate-plan-20260906.json'
PRIMARY = 'recorded_penalty_conditional_shape'
CONTROLS = ('frozen_conditional_shape', 'frozen_monotone_group')
OUTPUTS = ('recorded_penalty_raw', PRIMARY, *CONTROLS)
METRICS = ('brier', 'log_loss_clipped')
CONTRACT = 'citrus-recorded-penalty-candidate-v1'
BUNDLE = CONTRACT + ':named-bundle'
BATCH = 4096
MAX_BYTES = 8_000_000
CODE = ('scripts/proof/run_recorded_penalty_candidate.py',
        'scripts/proof/test_run_recorded_penalty_candidate.py',
        'scripts/proof/test_run_recorded_penalty_candidate_review.py',
        'data-pipeline/projections/recorded_penalty_features.py',
        'data-pipeline/tests/test_recorded_penalty_features.py',
        'data-pipeline/tests/test_recorded_penalty_features_review.py',
        'data-pipeline/projections/verified_movement_reuse_v2.py',
        'scripts/proof/run_conditional_shape_candidate.py',
        'scripts/proof/run_strength_partition_candidate.py',
        'data-pipeline/projections/portable_context_model.py',
        'data-pipeline/projections/conditional_calibration_shape.py',
        'data-pipeline/projections/calibration_candidate.py',
        'data-pipeline/projections/calibration_shape.py',
        'data-pipeline/projections/development_experiment.py',
        'data-pipeline/projections/probability_scorecard.py')


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sha(body):
    return hashlib.sha256(body).hexdigest()


def runtime():
    return {'python': platform.python_version(), 'numpy': np.__version__,
            'scipy': scipy.__version__, 'sklearn': sklearn.__version__}


def code_hashes():
    return {name: file_sha(reuse.Closure(ROOT).safe(name)) for name in CODE}


def primary_passed(losses):
    return all(type(losses[n][m]) in (int, float) and math.isfinite(losses[n][m])
               for n in (PRIMARY, *CONTROLS) for m in METRICS) and all(
        losses[PRIMARY][m] <= losses[c][m] for c in CONTROLS for m in METRICS)


def probability_vector(values, count):
    value = np.asarray(values)
    if (count <= 0 or value.shape != (count,) or value.dtype.kind not in 'fi'
            or not np.isfinite(value).all() or np.any(value < 0) or np.any(value > 1)):
        raise ValueError('Exact nonempty finite bounded probability vector required')
    return value


def maximum_error(actual, expected, count):
    actual, expected = probability_vector(actual, count), probability_vector(expected, count)
    error = float(np.max(np.abs(actual-expected)))
    if not math.isfinite(error) or error > 1e-12:
        raise ValueError('Independent JSON prediction mismatch')
    return error


def make_bundle(model, calibrator, *, declaration_sha256, fold):
    if (fold not in ('fold1', 'fold2') or not isinstance(declaration_sha256, str)
            or len(declaration_sha256) != 64 or any(c not in '0123456789abcdef' for c in declaration_sha256)):
        raise ValueError('Exact pre-fit declaration and fold identity required')
    portable.validate_model(model)
    conditional.validate(calibrator)
    body = encode({'contract': BUNDLE, 'publishable': False, 'production_authorized': False,
        'quantity_raw': 'recorded_penalty_model_goal_probability',
        'quantity_calibrated': 'recorded_penalty_conditional_goal_probability',
        'declaration_sha256': declaration_sha256, 'fold': fold, 'runtime': runtime(),
        'code_sha256': code_hashes(), 'schema_sha256': fingerprint(model['design']['schema']),
        'model': model, 'calibrator': calibrator,
        'component_sha256': {'model': sha(encode(model)), 'calibrator': sha(encode(calibrator))}})
    if len(body) > MAX_BYTES:
        raise ValueError('Bundle byte bound exceeded')
    return body


def named_score(body, *, expected_sha256, requests):
    """Fresh JSON per call, exact named inputs, no outcomes or batch fitting."""
    if type(body) is not bytes or not 0 < len(body) <= MAX_BYTES or sha(body) != expected_sha256:
        raise ValueError('External bundle digest required')
    b = strict_json(body)
    expected = {'contract', 'publishable', 'production_authorized', 'quantity_raw', 'quantity_calibrated',
                'declaration_sha256', 'fold', 'runtime', 'code_sha256', 'schema_sha256',
                'model', 'calibrator', 'component_sha256'}
    if (set(b) != expected or b['contract'] != BUNDLE or b['publishable'] is not False
            or b['production_authorized'] is not False or b['fold'] not in ('fold1', 'fold2')
            or b['quantity_raw'] != 'recorded_penalty_model_goal_probability'
            or b['quantity_calibrated'] != 'recorded_penalty_conditional_goal_probability'
            or not isinstance(b['declaration_sha256'], str) or len(b['declaration_sha256']) != 64
            or any(c not in '0123456789abcdef' for c in b['declaration_sha256'])
            or b['runtime'] != runtime() or b['code_sha256'] != code_hashes()
            or b['component_sha256'] != {n: sha(encode(b[n])) for n in ('model', 'calibrator')}):
        raise ValueError('Exact immutable candidate bundle required')
    portable.validate_model(b['model']); conditional.validate(b['calibrator'])
    schema = b['model']['design']['schema']
    if b['schema_sha256'] != fingerprint(schema):
        raise ValueError('Bundle schema mismatch')
    if not isinstance(requests, list) or not 0 < len(requests) <= BATCH:
        raise ValueError('Bounded nonempty named batch required')
    rows, keys, seen = [], [], set()
    for r in requests:
        if not isinstance(r, dict) or set(r) != {'game_id', 'event_id', 'schema_sha256', 'numeric', 'categorical'}:
            raise ValueError('Exact named request without outcome required')
        key = r['game_id'], r['event_id']
        if (any(type(v) is not int for v in key) or not 0 < key[0] < 10**10
                or not 0 <= key[1] < 10**9 or key in seen or r['schema_sha256'] != b['schema_sha256']):
            raise ValueError('Exact unique event identity required')
        if (not isinstance(r['numeric'], dict) or set(r['numeric']) != set(schema['names'])
                or not isinstance(r['categorical'], dict) or set(r['categorical']) != set(schema['categorical_names'])):
            raise ValueError('Every exact feature name required')
        seen.add(key); keys.append(key)
        rows.append({'features': [r['numeric'][n] for n in schema['names']], 'categorical': r['categorical']})
    try:
        raw = portable.predict_rows(b['model'], rows)
    except OverflowError:
        raise ValueError('Representable finite numeric features required') from None
    contexts = [calibration_candidate.context_from_row(r, schema) for r in rows]
    mapped = conditional.predict(b['calibrator'], raw, contexts)
    if b['runtime'] != runtime() or b['code_sha256'] != code_hashes():
        raise ValueError('Inference code/runtime drift')
    return [{'game_id': k[0], 'event_id': k[1], 'bundle_sha256': expected_sha256, 'raw': float(raw[i]),
             'mapped': float(mapped[i]), 'publishable': False} for i, k in enumerate(keys)]


def bundle_parity(body, rows, raw, mapped):
    schema = strict_json(body)['model']['design']['schema']
    digest, schema_sha = sha(body), fingerprint(schema)
    errors = {'direct': 0., 'reversed': 0., 'sampled_singleton': 0.}
    if not 0 < len(rows) == len(raw) == len(mapped):
        raise ValueError('Exact prediction membership required')
    keys = [(r['game_id'], r['event_id']) for r in rows]
    if len(set(keys)) != len(keys):
        raise ValueError('Unique global parity membership required')
    singletons = 0
    for offset in range(0, len(rows), BATCH):
        selected = rows[offset:offset+BATCH]
        requests = [{'game_id': r['game_id'], 'event_id': r['event_id'],
            'schema_sha256': schema_sha, 'numeric': dict(zip(schema['names'], r['features'])),
            'categorical': r['categorical']} for r in selected]
        if any(len(r['features']) != len(schema['names']) for r in selected):
            raise ValueError('Exact named source width required')
        actual = named_score(body, expected_sha256=digest, requests=requests)
        reverse = named_score(body, expected_sha256=digest, requests=requests[::-1])[::-1]
        single_results = named_score(body, expected_sha256=digest, requests=requests[:1])
        if len(actual) != len(selected) or len(reverse) != len(selected) or len(single_results) != 1:
            raise ValueError('Exact named parity output counts required')
        singleton = single_results[0]
        singletons += 1
        for i, result in enumerate(actual):
            expected_key = selected[i]['game_id'], selected[i]['event_id']
            checked_results = [result, reverse[i], *([singleton] if i == 0 else [])]
            for item in checked_results:
                if ((item['game_id'], item['event_id']) != expected_key or item['bundle_sha256'] != digest
                        or item['publishable'] is not False):
                    raise ValueError('Named identity or lineage changed')
            comparisons = [('direct', raw[offset+i], mapped[offset+i]),
                           ('reversed', reverse[i]['raw'], reverse[i]['mapped'])]
            if i == 0:
                comparisons.append(('sampled_singleton', singleton['raw'], singleton['mapped']))
            for name, expected_raw, expected_mapped in comparisons:
                if any(type(v) not in (int, float, np.float64) or not math.isfinite(v) or not 0 <= v <= 1
                       for v in (result['raw'], result['mapped'], expected_raw, expected_mapped)):
                    raise ValueError('Finite bounded parity probabilities required')
                error = abs(result['mapped'] - expected_mapped)
                if result['raw'] != expected_raw or not math.isfinite(error) or error > 1e-12:
                    raise ValueError('Named JSON inference parity failed')
                errors[name] = max(errors[name], float(error))
    try:
        named_score(body, expected_sha256=digest, requests=[requests[0], requests[0]])
    except ValueError:
        pass
    else:
        raise ValueError('Duplicate named request was accepted')
    return {'events': len(rows), 'raw_exact': True, 'mapped_max_abs_error': errors,
            'singleton_policy': 'first row of every 4096-row batch', 'singletons': singletons,
            'duplicate_request_rejected': True}


def project_schema(rows, source_schema, target_schema):
    indices = [source_schema['names'].index(n) for n in target_schema['names']]
    return [{**r, 'features': [r['features'][i] for i in indices],
             'categorical': {n: r['categorical'][n] for n in target_schema['categorical_names']}} for r in rows]


def checked_controls(closure, fold, rows, schema, groups):
    saved = closure.read(f'{reuse.CONDITIONAL}/{fold}/predictions.json')
    prior = {(r['game_id'], r['event_id']): r for r in saved}
    keys = {(r['game_id'], r['event_id']) for r in rows}
    gm = {(r['game_id'], r['event_id']): r['groups'] for r in groups['rows']}
    if (len(prior) != len(saved) or len(keys) != len(rows) or len(gm) != len(groups['rows'])
            or set(prior) != keys or set(gm) != keys):
        raise ValueError('Exact frozen control membership required')
    model = closure.read(f'{reuse.CONDITIONAL}/{fold}/model.json')
    shape = closure.read(f'{reuse.CONDITIONAL}/{fold}/calibrators.json')['conditional_shape']
    move_rows = project_schema(rows, schema, model['design']['schema'])
    context = [calibration_candidate.context_from_row(r, schema) for r in rows]
    raw = portable.predict_rows(model, move_rows)
    probability_vector(raw, len(rows))
    values = {'frozen_conditional_shape': conditional.predict(shape, raw, context)}
    neutral = closure.read(f'{CAL}/{fold}/model.json')
    neutral_map = closure.read(f'{SHAPE}/{fold}/calibrators.json')['monotone_logit_group']
    neutral_raw = portable.predict_rows(neutral, project_schema(rows, schema, neutral['design']['schema']))
    values['frozen_monotone_group'] = calibration_shape.predict(neutral_map, neutral_raw, context)
    probability_vector(neutral_raw, len(rows))
    for value in values.values(): probability_vector(value, len(rows))
    for i, r in enumerate(rows):
        key = r['game_id'], r['event_id']; old = prior[key]
        if (old['target'] != int(r['label']) or old['groups'] != gm[key]
                or old['predictions']['movement_raw'] != float(raw[i])
                or old['predictions']['conditional_shape'] != float(values['frozen_conditional_shape'][i])
                or old['predictions']['frozen_monotone_group'] != float(values['frozen_monotone_group'][i])):
            raise ValueError('Frozen control identity changed')
    return values, gm


def run(output):
    from projections import recorded_penalty_features as penalty
    output = Path(output).absolute()
    if (output.parent != ROOT/'scripts/proof/results' or '..' in output.parts
            or not output.name.startswith('official-recorded-penalty-')
            or any(p.is_symlink() for p in (output, *output.parents))):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False)
    files, completed = {}, []
    def save(name, value):
        body = encode(value); path = output/name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as stream: stream.write(body)
        files[name] = sha(body)
        return body
    try:
        now = datetime.now(timezone.utc).isoformat()
        save('attempt-started.json', {'started_at': now, 'publishable': False})
        closure = reuse.Closure(ROOT)
        plan = closure.read(PLAN)
        if (plan['contract'] != CONTRACT+':plan' or plan['primary'] != PRIMARY
                or plan['outputs'] != list(OUTPUTS) or plan['publishable'] is not False
                or plan['automatic_acceptance'] is not False
                or datetime.fromisoformat(plan['declared_at']) > datetime.fromisoformat(now)):
            raise ValueError('Exact earlier nonpromoting plan required')
        closure.mapping(code_hashes())
        closure.pin(plan['fit']['calibrator_module'], plan['fit']['calibrator_sha256'])
        save('input-declaration.json', {'contract': CONTRACT+':input-declaration', 'plan': plan,
            'plan_sha256': closure.checked[PLAN], 'code_and_reference_sha256': dict(closure.checked),
            'runtime': runtime(), 'stage': 'before-verified-input-load-and-resource-preflight', 'publishable': False})
        base = reuse.load(ROOT)
        features = penalty.load(base, ROOT)
        closure.mapping(base.closure.checked); closure.mapping(features.closure.checked)
        config, schema = features.config, features.schema
        if (config['context'] != plan['fit']['context'] or config['seed'] != plan['fit']['seed']
                or config['scorecard'] != plan['evaluation']['scorecard']
                or conditional.SETTINGS != plan['fit']['calibrator_settings']
                or development.FOLD_WINDOWS != plan['fold_windows']):
            raise ValueError('Frozen fit, calibration, scorecard and chronology required')
        development._preflight_bounds(features.folds, schema, features.groups)
        preflight = {f: development._vocabulary_and_design_bound(
            {s: p['rows'] for s, p in parts.items()}, schema, config)[1] for f, parts in features.folds.items()}
        save('declaration.json', {'contract': CONTRACT, 'plan': plan, 'plan_sha256': closure.checked[PLAN],
            'code_and_reference_sha256': dict(closure.checked), 'runtime': runtime(), 'preflight': preflight,
            'base_cache_key': base.cache_key, 'enriched_cache_key': features.cache_key, 'publishable': False})
        source_manifest_sha = fingerprint({'checked': dict(closure.checked),
            'inventories': features.closure.inventories})
        summaries = {}
        for fold, parts in features.folds.items():
            print(json.dumps({'event': 'recorded_penalty.fit', 'fold': fold}), flush=True)
            rows = {s: p['rows'] for s, p in parts.items()}
            vocab, bound = development._vocabulary_and_design_bound(rows, schema, config)
            raw = development._numeric(rows['train'], schema)
            if np.isnan(raw).all(axis=0).any(): raise ValueError('All-missing training feature')
            medians = np.nanmedian(raw, axis=0)
            design = {'schema': schema, 'numeric_names': config['views']['enhanced_numeric_names'],
                'categorical_names': config['views']['enhanced_categorical_names'], 'vocabulary': vocab,
                'medians': {n: float(medians[schema['names'].index(n)]) for n in config['views']['enhanced_numeric_names']}}
            old_design = closure.read(f'{reuse.CONDITIONAL}/{fold}/model.json')['design']
            if (any(design['medians'][n] != v for n, v in old_design['medians'].items())
                    or any(design['vocabulary'][n] != v for n, v in old_design['vocabulary'].items())):
                raise ValueError('Original training preprocessing changed')
            xx = {s: development._design(rr, schema, medians, vocab, config)['enhanced_context'] for s, rr in rows.items()}
            labels = {s: np.asarray([int(r['label']) for r in rr]) for s, rr in rows.items()}
            with threadpool_limits(limits=1):
                fitted = HistGradientBoostingClassifier(**config['context'], random_state=config['seed']).fit(xx['train'], labels['train'])
                pp = {s: fitted.predict_proba(xx[s])[:, 1] for s in ('calibration', 'validation')}
                model = strict_json(encode(portable.export_model(fitted, design)))
                raw_errors = {s: maximum_error(portable.predict_rows(model, rows[s]), pp[s], len(rows[s])) for s in pp}
                contexts = {s: [calibration_candidate.context_from_row(r, schema) for r in rows[s]] for s in pp}
                shape = strict_json(encode(conditional.fit(pp['calibration'], labels['calibration'], contexts['calibration'])))
                mapped = {s: conditional.predict(shape, pp[s], contexts[s]) for s in pp}
                scalar_errors = {s: maximum_error(scalar_predictions(shape, pp[s], contexts[s]), mapped[s], len(rows[s])) for s in pp}
                controls, gm = checked_controls(closure, fold, rows['validation'], schema, features.groups[fold])
                body = make_bundle(model, shape, declaration_sha256=files['declaration.json'], fold=fold)
                parity = {s: bundle_parity(body, rows[s], portable.predict_rows(model, rows[s]),
                    conditional.predict(shape, portable.predict_rows(model, rows[s]), contexts[s])) for s in pp}
            save(f'{fold}/model.json', model); save(f'{fold}/calibrators.json', {'conditional_shape': shape})
            save(f'{fold}/bundle.json', strict_json(body))
            predictions = {'recorded_penalty_raw': pp['validation'], PRIMARY: mapped['validation'], **controls}
            evaluated, diagnostics = [], []
            for i, r in enumerate(rows['validation']):
                key = r['game_id'], r['event_id']
                item = {'game_id': key[0], 'event_id': key[1], 'target': int(r['label']), 'groups': gm[key],
                        'predictions': {n: float(v[i]) for n, v in predictions.items()}}
                evaluated.append(item)
                diagnostics.append({**item, 'groups': {n: r['categorical'][n] for n in penalty.CATEGORIES}})
            evaluated.sort(key=lambda r: (r['game_id'], r['event_id']))
            diagnostics.sort(key=lambda r: (r['game_id'], r['event_id']))
            save(f'{fold}/predictions.json', evaluated)
            save(f'{fold}/penalty-diagnostic-predictions.json', diagnostics)
            cohort = {s: {k: v for k, v in p.items() if k != 'rows'} for s, p in parts.items()}
            pipeline_components = {
                'recorded_penalty_raw': {'model_sha256': files[f'{fold}/model.json'], 'map_sha256': None},
                PRIMARY: {'model_sha256': files[f'{fold}/model.json'], 'map_sha256': fingerprint(shape)},
                'frozen_conditional_shape': {'model_sha256': closure.checked[f'{reuse.CONDITIONAL}/{fold}/model.json'],
                    'map_file_sha256': closure.checked[f'{reuse.CONDITIONAL}/{fold}/calibrators.json'], 'map_key': 'conditional_shape'},
                'frozen_monotone_group': {'model_sha256': closure.checked[f'{CAL}/{fold}/model.json'],
                    'map_file_sha256': closure.checked[f'{SHAPE}/{fold}/calibrators.json'], 'map_key': 'monotone_logit_group'}}
            lineage = {'prediction_rows_sha256': fingerprint(evaluated), 'source_manifest_sha256': source_manifest_sha,
                'split_sha256': fingerprint(cohort), 'pipelines': {n: fingerprint({'name': n,
                    'declaration': files['declaration.json'], **pipeline_components[n]}) for n in predictions}}
            with threadpool_limits(limits=1):
                card = probability_scorecard(evaluated, config=config['scorecard'], evidence_kind='real', lineage=lineage)
                diagnostic_card = probability_scorecard(diagnostics, config=config['scorecard'], evidence_kind='real',
                    lineage={**lineage, 'prediction_rows_sha256': fingerprint(diagnostics)})
            save(f'{fold}/scorecard.json', card); save(f'{fold}/penalty-diagnostic-scorecard.json', diagnostic_card)
            save(f'{fold}/fit-receipt.json', {'schema': schema, 'config': config, 'bound': bound, 'cohorts': cohort,
                'raw_json_max_abs_error': raw_errors, 'scalar_map_max_abs_error': scalar_errors, 'named_bundle_parity': parity,
                'controls_exact': True, 'original_preprocessing_exact': True, 'calibrator_training_split': 'calibration_only',
                'pipeline_components': pipeline_components,
                'publishable': False})
            losses = {n: {m: card['overall']['models'][n]['metrics'][m]['value'] for m in METRICS} for n in predictions}
            summaries[fold] = {'losses': losses, 'primary_guard_passed': primary_passed(losses), 'events': len(evaluated)}
            save(f'{fold}/summary.json', summaries[fold]); completed.append(fold)
            print(json.dumps({'event': 'recorded_penalty.complete', 'fold': fold, **summaries[fold]}), flush=True)
            del xx, raw, fitted
        base.verify(); features.verify(); closure.verify()
        save('consumed-file-sha256.json', dict(closure.checked))
        save('source-reuse.json', {'checked': dict(closure.checked), 'base_cache_key': base.cache_key,
            'enriched_cache_key': features.cache_key, 'source_manifest_sha256': source_manifest_sha,
            'manifest_inventory': features.closure.inventories, 'publishable': False})
        save('result.json', {'folds': summaries, 'primary_guard_passed': all(s['primary_guard_passed'] for s in summaries.values()),
            'limitations': plan['limitations'], 'publishable': False, 'model_accepted': False, 'production_changed': False})
        for name, expected in files.items():
            if file_sha(output/name) != expected: raise ValueError('Output drift')
        save('health.json', {'status': 'complete-recorded-penalty-development-not-accepted', 'files': dict(files), 'publishable': False})
    except BaseException as error:
        save('failure.json', {'error_type': type(error).__name__, 'error': str(error),
            'completed_folds': completed, 'files': dict(files), 'publishable': False})
        raise


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise KeyboardInterrupt('Interrupted experiment; preserve partial evidence')
    signal.signal(signal.SIGTERM, interrupted)
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True)
    run(parser.parse_args().output)

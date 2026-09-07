"""Three-stage forward shooter experiment, not cross-fitting or neutral xG."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
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
from projections import identity_probability_v2 as identity
from projections import conditional_calibration_shape as conditional
from projections import portable_context_model as portable
from projections import calibration_candidate, development_experiment as development
from projections import player_goalie_attribution as attribution
from projections.analytics_publication import fingerprint
from projections.probability_scorecard import probability_scorecard
from projections.verified_export_experiment import strict_json, file_sha
from run_conditional_shape_candidate import scalar_predictions
from run_identity_probability_v2 import audit_fit, prediction_inputs, actor_support, CAL, SHAPE, PRIOR

PLAN = 'docs/analytics-forward-shooter-movement-plan-20260906.json'
PLAN_SHA = '144abff89374538279c0dde29ee737708c92e27a6c833c4c0dec94bfcfaa9cae'
SOURCE = 'scripts/proof/results/official-identity-probability-v2-20260906-1742'
SOURCE_SHA = 'cf78050f635442423a32a3ce38ff36e289afb369ff9ecb47e69bdea50d94c6c8'
FREEZE = 'scripts/proof/results/historical-official-freeze-20260906'
CONTRACT = 'citrus-forward-shooter-movement-v1'
OUTPUTS = ('new_neutral', 'global_control', 'shooter', 'frozen_conditional_shape')
CONTROLS = ('new_neutral', 'global_control', 'frozen_conditional_shape')
METRICS = ('brier', 'log_loss_clipped')
CODE = ('scripts/proof/run_forward_shooter_movement.py', 'scripts/proof/test_run_forward_shooter_movement.py',
        'scripts/proof/test_forward_shooter_movement_review.py',
        'scripts/proof/forward_shooter_split.py', 'scripts/proof/test_forward_shooter_split.py',
        'scripts/proof/run_identity_probability_v2.py', 'scripts/proof/run_conditional_shape_candidate.py',
        'data-pipeline/projections/identity_probability_v2.py', 'data-pipeline/projections/conditional_calibration_shape.py',
        'data-pipeline/projections/portable_context_model.py', 'data-pipeline/projections/player_goalie_attribution.py',
        'data-pipeline/projections/verified_movement_reuse_v2.py')


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def runtime():
    return {'python': platform.python_version(), 'numpy': np.__version__, 'scipy': scipy.__version__,
            'sklearn': sklearn.__version__}


def probability_vector(values, count):
    value = np.asarray(values)
    if (count <= 0 or value.shape != (count,) or value.dtype.kind not in 'fi'
            or not np.isfinite(value).all() or np.any(value <= 0) or np.any(value >= 1)):
        raise ValueError('Exact finite interior probability vector required')
    return value


def maximum_error(actual, expected, count, *, tolerance=1e-12):
    error = float(np.max(np.abs(probability_vector(actual, count)-probability_vector(expected, count))))
    if not math.isfinite(error) or error > tolerance:
        raise ValueError('Independent inference mismatch')
    return error


def primary_passed(losses):
    return all(type(losses[n][m]) in (int, float) and math.isfinite(losses[n][m])
        for n in OUTPUTS for m in METRICS) and all(losses['shooter'][m] <= losses[c][m]
            for c in CONTROLS for m in METRICS)


def strict_keys(rows):
    if not isinstance(rows, list) or not rows:
        raise ValueError('Nonempty exact event rows required')
    keys = []
    for r in rows:
        if (not isinstance(r, dict) or type(r.get('game_id')) is not int or type(r.get('event_id')) is not int
                or not 0 < r['game_id'] < 10**10 or not 0 <= r['event_id'] < 10**9):
            raise ValueError('Strict integer event keys required')
        keys.append((r['game_id'], r['event_id']))
    if len(set(keys)) != len(keys): raise ValueError('Unique event keys required')
    return keys


def join_records(rows, records):
    """Health-pinned identity records joined by IDs, never order or probability."""
    fields = {'game_id', 'event_id', 'game_date', 'probability', 'target', 'shooter_id', 'goalie_id',
              'source_event_sha256', 'shooter_attribution', 'goalie_attribution', 'event_type'}
    if not isinstance(records, list) or not records or any(not isinstance(r, dict) or set(r) != fields for r in records):
        raise ValueError('Exact retained identity source fields required')
    strict_keys(rows); strict_keys(records)
    prior = {(r['game_id'], r['event_id']): r for r in records}
    keys = {(r['game_id'], r['event_id']) for r in rows}
    if len(prior) != len(records) or len(keys) != len(rows) or set(prior) != keys:
        raise ValueError('Exact unique identity/source membership required')
    result = []
    for row in rows:
        old = prior[row['game_id'], row['event_id']]
        if (type(row['label']) not in (bool, int) or row['label'] not in (0, 1)
                or type(old['target']) is not int or old['target'] != int(row['label'])
                or old['game_date'] != row['game_date'] or not isinstance(old['source_event_sha256'], str)
                or len(old['source_event_sha256']) != 64
                or any(c not in '0123456789abcdef' for c in old['source_event_sha256'])):
            raise ValueError('Identity/source target, date or event hash mismatch')
        result.append(dict(old))
    result.sort(key=lambda r: (r['game_date'], r['game_id'], r['event_id']))
    identity.validate_rows(prediction_inputs(result))
    return result


def replace_probabilities(records, rows, probabilities):
    strict_keys(records); strict_keys(rows)
    values = probability_vector(probabilities, len(rows))
    mapped = {(r['game_id'], r['event_id']): float(p) for r, p in zip(rows, values)}
    if len(mapped) != len(rows) or len(records) != len(rows) or set(mapped) != {(r['game_id'], r['event_id']) for r in records}:
        raise ValueError('Exact probability/source join required')
    return [{**r, 'probability': mapped[r['game_id'], r['event_id']]} for r in records]


def stage_chronology(train, earlier, later, validation):
    stages = [train, earlier, later, validation]
    if any(not part for part in stages): raise ValueError('Every chronological stage must be nonempty')
    game_sets = [{r['game_id'] for r in part} for part in stages]
    for i, left in enumerate(stages):
        for j in range(i+1, len(stages)):
            if (game_sets[i] & game_sets[j]
                    or max(r['game_date'] for r in left) >= min(r['game_date'] for r in stages[j])):
                raise ValueError('Strictly forward disjoint game/date stages required')
    return [{'events': len(part), 'games': len(game_sets[i]), 'start': min(r['game_date'] for r in part),
             'end': max(r['game_date'] for r in part)} for i, part in enumerate(stages)]


def preflight(parts, earlier, later, model, schema, config):
    if any({r['target'] for r in records} != {0, 1} for records in (earlier, later)):
        raise ValueError('Both outcomes required in each fitting stage; no split repair')
    rows = {s: p['rows'] for s, p in parts.items()}
    vocab, bound = development._vocabulary_and_design_bound(rows, schema, config)
    width = portable.validate_model(model)
    if model['design']['schema'] != schema: raise ValueError('Exact frozen movement schema required')
    if (model['design']['vocabulary'] != vocab
            or model['design']['numeric_names'] != config['views']['enhanced_numeric_names']
            or model['design']['categorical_names'] != config['views']['enhanced_categorical_names']):
        raise ValueError('Exact training vocabulary and original movement feature views required')
    for split in ('calibration', 'validation'):
        if len(rows[split])*width > portable.LIMITS['design_cells'] or len(rows[split]) > portable.LIMITS['rows']:
            raise ValueError('Original portable inference bound exceeded')
    by_key = {(r['game_id'], r['event_id']): r for r in rows['calibration']}
    contexts = [calibration_candidate.context_from_row(by_key[r['game_id'], r['event_id']], schema) for r in earlier]
    conditional._contexts(contexts, len(contexts))
    vocab = conditional._vocabulary(contexts)
    states = [s for s in conditional.STATES if any(c['prior_sog_same_team'] == s for c in contexts)]
    group_width = sum(map(len, vocab.values()))
    design_width = conditional.SLOPES*(1+len(states))+1+group_width
    max_rows = max(len(earlier), len(rows['calibration']), len(rows['validation']))
    cells = max_rows*(2*design_width+conditional.SLOPES+group_width)
    if max_rows > conditional.SETTINGS['max_rows'] or cells > conditional.SETTINGS['max_cells']:
        raise ValueError('Original conditional allocation bound exceeded')
    identity.validate_rows(prediction_inputs(later))
    return {'development': bound, 'portable_width': width, 'conditional_max_cells': cells,
            'identity_fit_events': len(later), 'identity_modes': ['global_control', 'shooter'],
            'preprocessing_verification': 'exact source-hash-bound original model/design and training cohort; vocabulary rechecked; saved training medians not refitted'}


def frozen_control(closure, fold, rows, raw, contexts, groups):
    saved = closure.read(f'{reuse.CONDITIONAL}/{fold}/predictions.json')
    prior = {(r['game_id'], r['event_id']): r for r in saved}
    gm = {(r['game_id'], r['event_id']): r['groups'] for r in groups['rows']}
    keys = {(r['game_id'], r['event_id']) for r in rows}
    if len(prior) != len(saved) or len(gm) != len(groups['rows']) or len(keys) != len(rows) or set(prior) != keys or set(gm) != keys:
        raise ValueError('Exact original controls/groups required')
    shape = closure.read(f'{reuse.CONDITIONAL}/{fold}/calibrators.json')['conditional_shape']
    mapped = conditional.predict(shape, raw, contexts)
    probability_vector(raw, len(rows)); probability_vector(mapped, len(rows))
    for i, r in enumerate(rows):
        old = prior[r['game_id'], r['event_id']]
        if (old['target'] != int(r['label']) or old['groups'] != gm[r['game_id'], r['event_id']]
                or old['predictions']['movement_raw'] != float(raw[i])
                or old['predictions']['conditional_shape'] != float(mapped[i])):
            raise ValueError('Frozen movement/control predictions changed')
    return mapped, gm


def verify_source_roles(closure, rows, records, *, lineage):
    """Recheck original body/event hashes and attribution, without feature projection."""
    grouped = defaultdict(list)
    source = {(r['game_id'], r['event_id']): r for r in rows}
    for r in records: grouped[r['game_id']].append(r)
    for gid, selected in grouped.items():
        name = f'{FREEZE}/{gid//1000000}/pbp/{gid}'
        path = closure.safe(name+'.body.json')
        body = path.read_bytes(); digest = hashlib.sha256(body).hexdigest()
        if digest != closure.checked[name+'.body.json'] or any(source[gid, r['event_id']]['source_sha256'] != digest for r in selected):
            raise ValueError('Selected source body hash changed')
        receipt = closure.read(name+'.receipt.json')
        out = attribution.attribute_game(body,
            [{k: r[k] for k in ('game_id', 'event_id', 'source_event_sha256')} for r in selected],
            [{k: r[k] for k in ('game_id', 'event_id', 'probability')} for r in selected],
            lineage=lineage, observed_at=receipt['observed_at'])
        actors = {r['event_id']: r for r in out['events']}
        if len(actors) != len(selected): raise ValueError('Source role membership changed')
        for r in selected:
            a = actors[r['event_id']]
            if (a['shooter'] != r['shooter_attribution'] or a['defending_goalie'] != r['goalie_attribution']
                    or a['shooter']['player_id'] != r['shooter_id'] or a['defending_goalie']['player_id'] != r['goalie_id']
                    or int(a['is_goal']) != r['target'] or a['event_type'] != r['event_type']):
                raise ValueError('Exact original role attribution changed')
    return {'games': len(grouped), 'events': len(records), 'body_event_and_actor_identity_exact': True,
            'method': 'original-actor-attribution-only-not-feature-replay', 'publishable': False}


def identity_score(model, requests):
    ordered = sorted(requests, key=lambda r: (r['game_date'], r['game_id'], r['event_id']))
    values = identity.predict(model, ordered)
    probability_vector(values, len(ordered))
    return [{'game_id': r['game_id'], 'event_id': r['event_id'], 'probability': float(p)} for r, p in zip(ordered, values)]


def inference_parity(model, shape, fitted, rows, records, expected):
    """Full reversed batches, sampled singletons, and canonical identity requests."""
    schema = model['design']['schema']
    keys = [(r['game_id'], r['event_id']) for r in rows]
    if len(set(keys)) != len(keys) or len(keys) != len(records) or keys != [(r['game_id'], r['event_id']) for r in records]:
        raise ValueError('Exact ordered inference membership required')
    for values in expected.values(): probability_vector(values, len(rows))
    maximum = {'raw_reverse': 0., 'raw_singleton': 0., 'map_reverse': 0., 'map_singleton': 0.,
               'identity_batch': 0., 'identity_reverse': 0., 'identity_singleton': 0.}
    singleton_count = 0
    for start in range(0, len(rows), 4096):
        selected = rows[start:start+4096]; selected_records = records[start:start+4096]
        reverse_raw = portable.predict_rows(model, selected[::-1])[::-1]
        single_raw = portable.predict_rows(model, selected[:1])
        maximum['raw_reverse'] = max(maximum['raw_reverse'], maximum_error(reverse_raw, expected['raw'][start:start+len(selected)], len(selected), tolerance=0))
        maximum['raw_singleton'] = max(maximum['raw_singleton'], maximum_error(single_raw, expected['raw'][start:start+1], 1, tolerance=0))
        context = [calibration_candidate.context_from_row(r, schema) for r in selected]
        reverse_map = conditional.predict(shape, reverse_raw[::-1], context[::-1])[::-1]
        single_map = conditional.predict(shape, single_raw, context[:1])
        maximum['map_reverse'] = max(maximum['map_reverse'], maximum_error(reverse_map, expected['new_neutral'][start:start+len(selected)], len(selected)))
        maximum['map_singleton'] = max(maximum['map_singleton'], maximum_error(single_map, expected['new_neutral'][start:start+1], 1))
        requests = prediction_inputs(selected_records)
        for mode, fit in fitted.items():
            actual = identity_score(fit, requests)
            reverse = identity_score(fit, requests[::-1])
            singleton = identity_score(fit, requests[:1])
            if len(actual) != len(selected) or len(reverse) != len(selected) or len(singleton) != 1:
                raise ValueError('Exact identity inference counts required')
            if ([(r['game_id'], r['event_id']) for r in actual] != keys[start:start+len(selected)]
                    or [(r['game_id'], r['event_id']) for r in reverse] != keys[start:start+len(selected)]
                    or (singleton[0]['game_id'], singleton[0]['event_id']) != keys[start]):
                raise ValueError('Identity inference order changed')
            maximum['identity_batch'] = max(maximum['identity_batch'], maximum_error([r['probability'] for r in actual], expected[mode][start:start+len(selected)], len(selected)))
            maximum['identity_reverse'] = max(maximum['identity_reverse'], maximum_error([r['probability'] for r in reverse], expected[mode][start:start+len(selected)], len(selected)))
            maximum['identity_singleton'] = max(maximum['identity_singleton'], maximum_error([singleton[0]['probability']], expected[mode][start:start+1], 1))
            try: identity_score(fit, [requests[0], requests[0]])
            except ValueError: pass
            else: raise ValueError('Duplicate identity request accepted')
        singleton_count += 1
    return {'events': len(rows), 'maximum_errors': maximum, 'singleton_policy': 'first of each4096-rowbatch',
            'sampled_singletons_per_pipeline': singleton_count, 'duplicates_rejected': True, 'publishable': False}


def run(output):
    from forward_shooter_split import partition
    output = Path(output).absolute()
    if (output.parent != ROOT/'scripts/proof/results' or '..' in output.parts
            or not output.name.startswith('official-forward-shooter-movement-')
            or any(p.is_symlink() for p in (output, *output.parents))):
        raise ValueError('Scoped create-only output required')
    output.mkdir(exist_ok=False); files, completed = {}, []
    closure = reuse.Closure(ROOT)
    def save(name, value):
        body = encode(value); path = output/name; path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as stream: stream.write(body)
        files[name] = hashlib.sha256(body).hexdigest()
    try:
        now = datetime.now(timezone.utc).isoformat()
        save('attempt-started.json', {'started_at': now, 'publishable': False})
        closure.pin(PLAN, PLAN_SHA)
        plan = closure.read(PLAN)
        if (plan['contract'] != CONTRACT+':plan' or plan['primary'] != 'shooter' or plan['outputs'] != list(OUTPUTS)
                or plan['controls'] != list(CONTROLS) or any(plan[k] is not False for k in (
                    'publishable', 'automatic_acceptance', 'historical_as_of_verified', 'untouched_test_claim'))
                or plan['conditional_settings'] != conditional.SETTINGS or plan['identity_settings'] != identity.SETTINGS
                or plan['identity_numerics'] != identity.NUMERICS
                or plan['source']['identity_directory'] != SOURCE or plan['source']['identity_health_sha256'] != SOURCE_SHA
                or plan['source']['movement_directory'] != reuse.CONDITIONAL
                or plan['source']['movement_health_sha256'] != reuse.CERTIFICATES[reuse.CONDITIONAL][0]
                or datetime.fromisoformat(plan['declared_at']) > datetime.fromisoformat(now)):
            raise ValueError('Exact earlier forward-only nonpromoting plan required')
        for name in CODE: closure.pin(name, file_sha(closure.safe(name)))
        save('input-declaration.json', {'plan': plan, 'plan_sha256': closure.checked[PLAN],
            'code_and_reference_sha256': dict(closure.checked), 'runtime': runtime(), 'publishable': False})
        features = reuse.load(ROOT); closure.mapping(features.closure.checked)
        closure.pin(SOURCE+'/health.json', SOURCE_SHA)
        health = closure.read(SOURCE+'/health.json')
        if health['status'] != 'complete-identity-development-not-accepted' or health['publishable'] is not False:
            raise ValueError('Complete identity source certificate required')
        closure.inventory(SOURCE, [*health['files'], 'health.json'])
        for name, digest in health['files'].items(): closure.pin(SOURCE+'/'+name, digest)
        closure.mapping(closure.read(SOURCE+'/consumed-file-sha256.json'))
        closure.mapping(closure.read(SOURCE+'/declaration.json')['code_sha256'])
        schema, config = features.schema, features.config
        if schema != plan['schema'] or config['scorecard'] != plan['scorecard']:
            raise ValueError('Original movement schema and scorecard required')
        development._preflight_bounds(features.folds, schema, features.groups)
        prepared, bounds = {}, {}
        for fold, parts in features.folds.items():
            rows = {s: p['rows'] for s, p in parts.items()}
            records = {s: join_records(rows[s], closure.read(f'{SOURCE}/{fold}/{s}-identity-inputs.json'))
                       for s in ('calibration', 'validation')}
            for s in records:
                if [(r['game_id'], r['event_id']) for r in records[s]] != [(r['game_id'], r['event_id']) for r in rows[s]]:
                    raise ValueError('Original row chronology differs from canonical identity order')
            earlier, later, split = partition(records['calibration'])
            expected = {k: ({n: v for n, v in value.items() if n != 'game_ids'} if isinstance(value, dict) else value)
                        for k, value in split.items() if k not in ('rule', 'publishable')}
            if expected != plan['expected_splits'][fold]: raise ValueError('Declared split membership changed')
            stages = stage_chronology(rows['train'], earlier, later, rows['validation'])
            model = closure.read(f'{reuse.CONDITIONAL}/{fold}/model.json')
            bounds[fold] = preflight(parts, earlier, later, model, schema, config)
            identity.validate_rows(prediction_inputs(records['validation']))
            legacy_fit = closure.read(f'{SHAPE}/{fold}/fit-receipt.json')
            legacy_model = closure.read(f'{CAL}/{fold}/model.json')
            source_audit = {}
            for s in records:
                prior_rows = (closure.read(f'{PRIOR}/{fold}/seed-predictions.json') if s == 'calibration'
                              else closure.read(f'{PRIOR}/{fold}/simulation.json')['rows'])
                original_lineage = {'raw_model_sha256': legacy_fit['model_sha256'],
                    'calibrators_sha256': legacy_fit['calibrators_sha256'],
                    'feature_schema_sha256': fingerprint(legacy_model['design']['schema']),
                    'prior_predictions_sha256': fingerprint(prior_rows)}
                source_audit[s] = {**verify_source_roles(closure, rows[s], records[s], lineage=original_lineage),
                                   'original_attribution_lineage': original_lineage}
            prepared[fold] = {'records': records, 'earlier': earlier, 'later': later, 'split': split,
                              'stages': stages, 'model': model, 'source_audit': source_audit}
        closure.verify()
        source_manifest = {'checked': dict(closure.checked), 'inventories': {**features.closure.inventories, **closure.inventories}}
        save('declaration.json', {'contract': CONTRACT, 'plan': plan, 'plan_sha256': closure.checked[PLAN],
            'code_and_reference_sha256': dict(closure.checked), 'source_manifest_sha256': fingerprint(source_manifest),
            'runtime': runtime(), 'preflight': bounds, 'cache_key': features.cache_key, 'publishable': False})
        summaries = {}
        for fold, prep in prepared.items():
            print(json.dumps({'event': 'forward_shooter.fit', 'fold': fold}), flush=True)
            parts = features.folds[fold]; rows = {s: p['rows'] for s, p in parts.items()}
            model = prep['model']; records = prep['records']
            with threadpool_limits(limits=1):
                raw = {s: portable.predict_rows(model, rows[s]) for s in ('calibration', 'validation')}
                for s in raw: probability_vector(raw[s], len(rows[s]))
                contexts = {s: [calibration_candidate.context_from_row(r, schema) for r in rows[s]] for s in raw}
                frozen, gm = frozen_control(closure, fold, rows['validation'], raw['validation'], contexts['validation'], features.groups[fold])
                index = {(r['game_id'], r['event_id']): i for i, r in enumerate(rows['calibration'])}
                ix = [index[r['game_id'], r['event_id']] for r in prep['earlier']]
                shape = strict_json(encode(conditional.fit(raw['calibration'][ix], [r['target'] for r in prep['earlier']],
                    [contexts['calibration'][i] for i in ix])))
                neutral = {s: conditional.predict(shape, raw[s], contexts[s]) for s in raw}
                map_errors = {s: maximum_error(scalar_predictions(shape, raw[s], contexts[s]), neutral[s], len(rows[s])) for s in raw}
                mapped_records = {s: replace_probabilities(records[s], rows[s], neutral[s]) for s in raw}
                later_keys = {(r['game_id'], r['event_id']) for r in prep['later']}
                later = [r for r in mapped_records['calibration'] if (r['game_id'], r['event_id']) in later_keys]
                fit_rows = prediction_inputs(later); targets = [r['target'] for r in later]
                val_records = mapped_records['validation']; val_rows = prediction_inputs(val_records)
                fitted, audits = {}, {}
                pp = {'new_neutral': neutral['validation'].tolist(), 'frozen_conditional_shape': frozen.tolist()}
                for mode in ('global_control', 'shooter'):
                    fitted[mode] = strict_json(encode(identity.fit(fit_rows, targets, mode=mode)))
                    if set(fitted[mode]['effects']) != (set() if mode == 'global_control' else {'shooter'}):
                        raise ValueError('Undeclared goalie effect')
                    pp[mode] = identity.predict(fitted[mode], val_rows)
                    probability_vector(pp[mode], len(val_rows))
                    audits[mode] = audit_fit(fit_rows, targets, fitted[mode], val_rows, pp[mode])
                flipped = [{**r, 'target': 1-r['target']} for r in val_records]
                if prediction_inputs(flipped) != val_rows: raise ValueError('Outcome entered prediction inputs')
                for mode in fitted:
                    maximum_error(identity.predict(fitted[mode], prediction_inputs(flipped)), pp[mode], len(val_rows), tolerance=0)
                parity = inference_parity(model, shape, fitted, rows['validation'], val_records, {'raw': raw['validation'], **pp})
            save(f'{fold}/model.json', model); save(f'{fold}/calibrators.json', {'conditional_shape': shape})
            for mode, fit in fitted.items(): save(f'{fold}/{mode}-model.json', fit)
            save(f'{fold}/split.json', prep['split'])
            save(f'{fold}/calibration-identity-inputs.json', mapped_records['calibration'])
            save(f'{fold}/identity-fit-inputs.json', later); save(f'{fold}/validation-identity-inputs.json', val_records)
            save(f'{fold}/source-role-audit.json', prep['source_audit'])
            save(f'{fold}/inference.json', {'independent_identity_fit_audits': audits, 'scalar_map_max_errors': map_errors,
                'parity': parity, 'validation_target_flip_unchanged': True, 'raw_validation_exact': True, 'frozen_control_exact': True,
                'publishable': False})
            support = {'map': actor_support(prep['earlier'], later), 'identity_fit': actor_support(later),
                       'validation': actor_support(val_records, later)}
            save(f'{fold}/actor-support.json', support)
            evaluated = [{'game_id': r['game_id'], 'event_id': r['event_id'], 'target': r['target'],
                'groups': gm[r['game_id'], r['event_id']], 'predictions': {n: float(pp[n][i]) for n in OUTPUTS}}
                for i, r in enumerate(val_records)]
            evaluated.sort(key=lambda r: (r['game_id'], r['event_id']))
            save(f'{fold}/predictions.json', evaluated)
            lineage = {'prediction_rows_sha256': fingerprint(evaluated), 'source_manifest_sha256': fingerprint(source_manifest),
                'split_sha256': fingerprint(prep['split']), 'pipelines': {n: fingerprint({'name': n,
                    'declaration': files['declaration.json'], 'raw_model': files[f'{fold}/model.json'],
                    'map': files[f'{fold}/calibrators.json'] if n != 'frozen_conditional_shape'
                        else closure.checked[f'{reuse.CONDITIONAL}/{fold}/calibrators.json'],
                    'identity_model': fitted[n]['model_sha256'] if n in fitted else None}) for n in OUTPUTS}}
            with threadpool_limits(limits=1):
                card = probability_scorecard(evaluated, config=config['scorecard'], evidence_kind='real', lineage=lineage)
            save(f'{fold}/scorecard.json', card)
            save(f'{fold}/fit-receipt.json', {'schema': schema, 'config': config, 'preflight': bounds[fold], 'stages': prep['stages'],
                'cohorts': {s: {k: v for k, v in p.items() if k != 'rows'} for s, p in parts.items()},
                'raw_model_refitted': False, 'design': 'three_stage_forward_holdout_not_pooled_crossfit',
                'frozen_conditional_comparator_uses_more_map_fit_data': True, 'publishable': False})
            losses = {n: {m: card['overall']['models'][n]['metrics'][m]['value'] for m in METRICS} for n in OUTPUTS}
            summaries[fold] = {'losses': losses, 'primary_guard_passed': primary_passed(losses), 'events': len(evaluated)}
            save(f'{fold}/summary.json', summaries[fold]); completed.append(fold)
            print(json.dumps({'event': 'forward_shooter.complete', 'fold': fold, **summaries[fold]}), flush=True)
        features.verify(); closure.verify()
        save('source-reuse.json', {**source_manifest, 'cache_key': features.cache_key, 'publishable': False})
        save('consumed-file-sha256.json', dict(closure.checked))
        save('result.json', {'contract': CONTRACT, 'folds': summaries,
            'primary_guard_passed': all(v['primary_guard_passed'] for v in summaries.values()),
            'limitations': plan['limitations'], 'publishable': False, 'model_accepted': False,
            'neutral_xg_replaced': False, 'production_changed': False, 'fpar_accepted': False})
        for name, digest in files.items():
            if file_sha(output/name) != digest: raise ValueError('Output drift')
        save('health.json', {'status': 'complete-forward-shooter-movement-development-not-accepted',
            'files': dict(files), 'completed_folds': completed, 'publishable': False})
    except BaseException as error:
        save('failure.json', {'error_type': type(error).__name__, 'error': str(error), 'completed_folds': completed,
            'files': dict(files), 'consumed_file_sha256': dict(closure.checked), 'publishable': False})
        raise


if __name__ == '__main__':
    def stop(signum, frame): raise KeyboardInterrupt('Preserve interrupted experiment')
    signal.signal(signal.SIGTERM, stop)
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True)
    run(parser.parse_args().output)

"""Create-only retrospective experiment; test access follows persisted fit freeze.

No artifact loading, source acquisition, serving promotion or holdout tuning.
The caller remains responsible for authenticating exports and their completeness.
"""
import hashlib
import json
import os
from pathlib import Path
import platform

import numpy as np
import scipy
import sklearn
import threadpoolctl
from threadpoolctl import threadpool_limits

from projections import chronological_fit, probability_scorecard as scorecard_module, analytics_publication
from projections.analytics_publication import fingerprint

DEFAULT_SCORECARD_CONFIG = {'resamples': 256, 'seed': 60906, 'confidence': .95,
    'min_games': 30, 'min_events': 100, 'min_valid_fraction': .9,
    'bin_edges': [0, .01, .025, .05, .1, .2, .35, .5, .75, 1],
    'log_loss_epsilon': 1e-12}


def _bytes(value):
    return json.dumps(value, sort_keys=True, allow_nan=False, separators=(',', ':')).encode()


def _persist(directory, name, value):
    payload = value if isinstance(value, bytes) else _bytes(value)
    with (directory / name).open('xb') as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return hashlib.sha256(payload).hexdigest()


def _code_hashes():
    paths = {'fit': Path(chronological_fit.__file__), 'scorecard': Path(scorecard_module.__file__),
             'runner': Path(__file__), 'fingerprint': Path(analytics_publication.__file__)}
    return {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in paths.items()}


def _test_cohort(test, schema, window, occupied):
    if (not isinstance(test, dict) or set(test) != {'split', 'window', 'rows',
            'membership_sha256', 'source_sha256', 'feature_sha256'}
            or test['split'] != 'test' or test['window'] != window
            or not isinstance(test['rows'], list) or not test['rows']):
        raise ValueError('Exact frozen test cohort required')
    seen, games = set(), {}
    for row in test['rows']:
        if (not isinstance(row, dict) or set(row) != {'split', 'game_id', 'event_id',
                'game_date', 'label', 'features', 'source_sha256', 'feature_sha256'}
                or row['split'] != 'test'):
            raise ValueError('Exact test row required')
        gid, eid = row['game_id'], row['event_id']
        day = chronological_fit._day(row['game_date'])
        if (type(gid) is not int or len(str(gid)) != 10 or gid // 1000000 < 1900
                or gid // 10000 % 100 not in (2, 3) or gid % 10000 == 0
                or type(eid) is not int or eid < 0 or (gid, eid) in seen or gid in occupied
                or day.year not in (gid // 1000000, gid // 1000000 + 1)
                or not chronological_fit._day(window['start']) <= day <= chronological_fit._day(window['end'])
                or type(row['label']) not in (int, bool) or row['label'] not in (0, 1)):
            raise ValueError('Invalid, overlapping or outside-window test membership')
        identity = (row['game_date'], chronological_fit._sha(row['source_sha256']))
        if gid in games and games[gid] != identity:
            raise ValueError('Conflicting whole-game test source/date')
        games[gid] = identity; seen.add((gid, eid))
        if row['feature_sha256'] != fingerprint({'schema_sha256': fingerprint(schema), 'values': row['features']}):
            raise ValueError('Test feature digest mismatch')
    if test['rows'] != sorted(test['rows'], key=lambda r: (r['game_date'], r['game_id'], r['event_id'])):
        raise ValueError('Canonical test membership required')
    for name, value in chronological_fit.cohort_digests(test['rows']).items():
        if chronological_fit._sha(test[name]) != value:
            raise ValueError('Test cohort digest mismatch')
    chronological_fit._vectors([r['features'] for r in test['rows']], schema)


def run_chronological_experiment(*, train, calibration, schema, test_window, provenance,
                                output, read_test, scorecard_config=None, group_dimensions=()):
    """Callback returns {cohort, groups} after artifacts and plan are fsynced.

    ``output`` must not exist. Failure retains partial evidence, never overwrites
    or resumes it. Provenance hashes are declarations verified by the integrator.
    """
    frozen = json.loads(_bytes({'train': train, 'calibration': calibration, 'schema': schema,
        'test_window': test_window, 'provenance': provenance,
        'config': DEFAULT_SCORECARD_CONFIG if scorecard_config is None else scorecard_config,
        'group_dimensions': list(group_dimensions)}))
    train, calibration, schema, test_window, provenance, config = (
        frozen[k] for k in ('train', 'calibration', 'schema', 'test_window', 'provenance', 'config'))
    scorecard_module._config(config)
    dimensions = frozen['group_dimensions']
    if (any(not isinstance(d, str) or not d.strip() for d in dimensions)
            or len(set(dimensions)) != len(dimensions) or len(dimensions) > 8):
        raise ValueError('Explicit unique subgroup dimensions required')
    if (not isinstance(provenance, dict) or set(provenance) !=
            {'export_manifest_sha256', 'source_inventory_sha256', 'execution_plan_sha256',
             'adapter_code_sha256', 'export_combined_inventory_sha256', 'evidence_kind'}
            or provenance['evidence_kind'] not in ('real', 'synthetic')):
        raise ValueError('Explicit export/source evidence provenance required')
    for key in ('export_manifest_sha256', 'source_inventory_sha256', 'execution_plan_sha256',
                'adapter_code_sha256', 'export_combined_inventory_sha256'):
        chronological_fit._sha(provenance[key])
    if (not isinstance(test_window, dict) or set(test_window) != {'start', 'end'}
            or chronological_fit._day(test_window['start']) > chronological_fit._day(test_window['end'])
            or chronological_fit._day(calibration['window']['end']) >= chronological_fit._day(test_window['start'])
            or not callable(read_test)):
        raise ValueError('Strictly later frozen test window and deferred reader required')
    directory = Path(output)
    directory.mkdir(exist_ok=False)
    code = _code_hashes()
    files = {}
    try:
        fitted = chronological_fit.fit_chronological_baselines(train=train, calibration=calibration,
            schema=schema, code_sha256=code['fit'])
        for name, artifact in fitted.artifacts.items():
            files[name] = _persist(directory, name, artifact)
        files['fit-receipt.json'] = _persist(directory, 'fit-receipt.json', fitted.receipt)
        plan = {'contract': 'chronological-experiment-v1', 'publishable': False,
            'purpose': 'retrospective-only', 'code_sha256': code, 'provenance': provenance,
            'schema': schema, 'test_window': test_window, 'scorecard_config': config,
            'evaluation_runtime': {'thread_policy': 'threadpoolctl-limits-1-during-scorecard',
                'threads': 1, 'python': platform.python_version(), 'numpy': np.__version__,
                'scipy': scipy.__version__, 'sklearn': sklearn.__version__,
                'threadpoolctl': threadpoolctl.__version__},
            'groups_policy': {'dimensions': dimensions, 'unknown': 'explicit-null-retained',
                              'membership': 'exact-one-to-one-test-events'},
            'fit_receipt_sha256': fitted.receipt['receipt_sha256'], 'fit_files': dict(files)}
        plan['pipeline_sha256'] = fingerprint(plan)
        files['pipeline-receipt.json'] = _persist(directory, 'pipeline-receipt.json', plan)
        result = json.loads(_bytes(read_test()))
        if not isinstance(result, dict) or set(result) != {'cohort', 'groups'} or not isinstance(result['groups'], list):
            raise ValueError('Test callback must return cohort and exact subgroup membership')
        test = result['cohort']
        _test_cohort(test, schema, test_window, {r['game_id'] for c in (train, calibration) for r in c['rows']})
        groups = {}
        for entry in result['groups']:
            if (not isinstance(entry, dict) or set(entry) != {'game_id', 'event_id', 'groups'}
                    or type(entry['game_id']) is not int or type(entry['event_id']) is not int
                    or not isinstance(entry['groups'], dict) or set(entry['groups']) != set(dimensions)
                    or any(v is not None and (not isinstance(v, str) or not v.strip()) for v in entry['groups'].values())
                    or (entry['game_id'], entry['event_id']) in groups):
                raise ValueError('Invalid or duplicate test subgroup evidence')
            groups[entry['game_id'], entry['event_id']] = entry['groups']
        if set(groups) != {(r['game_id'], r['event_id']) for r in test['rows']}:
            raise ValueError('Test subgroup membership differs from exact test cohort')
        vectors = [r['features'] for r in test['rows']]
        raw = fitted.predict(vectors, schema=schema, calibrated=False)
        calibrated = fitted.predict(vectors, schema=schema, calibrated=True)
        rows = [{'game_id': r['game_id'], 'event_id': r['event_id'], 'target': int(r['label']),
                 'groups': groups[r['game_id'], r['event_id']], 'predictions': {name+'_'+kind: scores[name][i]
                    for kind, scores in (('raw', raw), ('calibrated', calibrated)) for name in scores}}
                for i, r in enumerate(test['rows'])]
        rows.sort(key=lambda r: (r['game_id'], r['event_id']))
        lineage = {'prediction_rows_sha256': fingerprint(rows),
            'source_manifest_sha256': provenance['source_inventory_sha256'],
            'split_sha256': fingerprint({'train': train['membership_sha256'],
                'calibration': calibration['membership_sha256'], 'test': test['membership_sha256']}),
            'pipelines': {name+'_'+kind: fingerprint({'pipeline': plan['pipeline_sha256'],
                'predictor': name+'_'+kind, 'raw_model_sha256': files[name+'.pickle'],
                'calibrator_sha256': files[name+'-calibrator.json'] if kind == 'calibrated' else None})
                for name in raw for kind in ('raw', 'calibrated')}}
        with threadpool_limits(limits=1):
            report = scorecard_module.probability_scorecard(rows, config=config,
                evidence_kind=provenance['evidence_kind'], lineage=lineage)
        if _code_hashes() != code:
            raise ValueError('Local fit/evaluation source changed during experiment')
        for name, digest in files.items():
            if hashlib.sha256((directory / name).read_bytes()).hexdigest() != digest:
                raise ValueError('Frozen artifact changed during experiment')
        files['test-receipt.json'] = _persist(directory, 'test-receipt.json', {k: v for k, v in test.items() if k != 'rows'})
        files['predictions.json'] = _persist(directory, 'predictions.json', rows)
        files['scorecard.json'] = _persist(directory, 'scorecard.json', report)
        health = {'status': 'completed-retrospective-not-publishable', 'publishable': False,
                  'pipeline_sha256': plan['pipeline_sha256'], 'files': files,
                  'source_export_drift_verification': 'caller-required', 'code_drift_verified': True}
        _persist(directory, 'health.json', health)
        return health
    except Exception as error:
        try:
            _persist(directory, 'failure.json', {'status': 'failed-not-publishable',
                'error_type': type(error).__name__, 'retained_files': files})
        except OSError:
            pass  # Preserve the originating failure, never overwrite a caller file.
        raise

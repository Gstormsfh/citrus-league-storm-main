import copy
import hashlib
import json

import numpy as np
import pytest

from projections.analytics_publication import fingerprint
from projections.chronological_fit import fit_chronological_baselines, cohort_digests, CONFIG

SCHEMA = {'version': 'synthetic-reviewed-numeric-v1',
          'names': ['distance_to_goal_ft', 'signed_angle_deg', 'skater_advantage']}


def cohort(split, day, gid, count=220):
    rows = []
    for i in range(count):
        values = [float(10+i%70), float(i%80-40), None if i%11 == 0 else float(i%3-1)]
        rows.append({'split': split, 'game_id': gid, 'game_date': day, 'event_id': i+1,
            'label': int(i%7 == 0), 'features': values, 'source_sha256': 'a'*64,
            'feature_sha256': fingerprint({'schema_sha256': fingerprint(SCHEMA), 'values': values})})
    return {'split': split, 'window': {'start': day, 'end': day}, 'rows': rows, **cohort_digests(rows)}


def inputs():
    return {'train': cohort('train', '2024-10-01', 2024020001),
            'calibration': cohort('calibration', '2025-10-01', 2025020001),
            'schema': copy.deepcopy(SCHEMA), 'code_sha256': 'b'*64}


def rehash(group):
    for row in group['rows']:
        row['feature_sha256'] = fingerprint({'schema_sha256': fingerprint(SCHEMA), 'values': row['features']})
    group.update(cohort_digests(group['rows']))


def test_fixed_baselines_receipts_and_train_prevalence():
    args = inputs(); before = copy.deepcopy(args)
    fit = fit_chronological_baselines(**args)
    assert args == before
    expected = sum(r['label'] for r in args['train']['rows'])/len(args['train']['rows'])
    vectors = [r['features'] for r in args['calibration']['rows']]
    assert fit.predict(vectors, schema=SCHEMA, calibrated=False)['prevalence'] == [expected]*len(vectors)
    assert fit.context_model.early_stopping is False and fit.context_model.max_iter == 200
    assert fit.context_model.random_state == 60906
    assert fit.receipt['train_prevalence'] == expected
    assert fit.receipt['config']['selection'] == 'fixed-before-fit-no-tuning-or-test-selection'
    assert not fit.receipt['historical_as_of_verified']
    for name, artifact in fit.artifacts.items():
        assert hashlib.sha256(artifact).hexdigest() == fit.receipt['artifact_sha256'][name]
    for values in fit.predict(vectors, schema=SCHEMA).values():
        assert all(0 < p < 1 for p in values)


def test_later_calibration_labels_cannot_change_raw_fitted_bytes_or_scaling():
    args = inputs(); first = fit_chronological_baselines(**args)
    for row in args['calibration']['rows']:
        row['label'] = 1-row['label']
    rehash(args['calibration']); second = fit_chronological_baselines(**args)
    for model in ('prevalence', 'geometry', 'context'):
        assert first.artifacts[model+'.pickle'] == second.artifacts[model+'.pickle']
    assert first.receipt['train_medians'] == second.receipt['train_medians']
    assert first.receipt['geometry_scaler_mean'] == second.receipt['geometry_scaler_mean']
    assert first.calibrators != second.calibrators


def test_later_feature_distribution_does_not_fit_imputation_or_scaling():
    args = inputs(); first = fit_chronological_baselines(**args)
    for row in args['calibration']['rows']:
        row['features'] = [1000., -140., None]
    rehash(args['calibration']); second = fit_chronological_baselines(**args)
    assert first.artifacts['geometry.pickle'] == second.artifacts['geometry.pickle']
    assert first.artifacts['context.pickle'] == second.artifacts['context.pickle']
    assert second.calibrators['geometry']['slope'] == 0


@pytest.mark.parametrize('mutation', ['test_group','test_row','late_row','same_game','duplicate','unknown_field',
    'source_hash','feature_hash','membership','nan','width','schema_order','single_class','all_missing'])
def test_leakage_invalid_lineage_and_feature_contract_rejected(mutation):
    args = inputs(); t = args['train']; c = args['calibration']; row = t['rows'][0]
    if mutation == 'test_group': c['split'] = 'test'
    if mutation == 'test_row': row['split'] = 'test'
    if mutation == 'late_row': row['game_date'] = '2025-10-01'
    if mutation == 'same_game':
        for r in c['rows']: r['game_id'] = row['game_id']
        rehash(c)
    if mutation == 'duplicate': t['rows'][1]['event_id'] = row['event_id']
    if mutation == 'unknown_field': t['test_labels'] = [1]
    if mutation == 'source_hash': row['source_sha256'] = 'invalid'
    if mutation == 'feature_hash': row['feature_sha256'] = '0'*64
    if mutation == 'membership': t['membership_sha256'] = '0'*64
    if mutation == 'nan': row['features'][0] = float('nan')
    if mutation == 'width': row['features'].pop()
    if mutation == 'schema_order': args['schema']['names'].reverse()
    if mutation == 'single_class':
        for r in c['rows']: r['label'] = 0
        rehash(c)
    if mutation == 'all_missing':
        for r in t['rows']: r['features'][2] = None
        rehash(t)
    with pytest.raises(ValueError): fit_chronological_baselines(**args)


def test_test_rows_are_not_an_api_argument_and_prediction_schema_is_exact():
    args = inputs()
    with pytest.raises(TypeError): fit_chronological_baselines(**args, test=args['calibration'])
    fit = fit_chronological_baselines(**args)
    with pytest.raises(ValueError): fit.predict([[1, 2, 0]], schema={'version': 'different', 'names': SCHEMA['names']})
    with pytest.raises(ValueError): fit.predict([[1, 2, True]], schema=SCHEMA)
    # Unknown numeric values use frozen train-only imputation, not learned test values.
    assert np.isfinite(fit.predict([[None, None, None]], schema=SCHEMA)['geometry']).all()


@pytest.mark.parametrize('mutation', ['source_conflict', 'negative_distance', 'invalid_angle'])
def test_whole_game_source_and_geometry_domain_are_enforced(mutation):
    args = inputs(); row = args['train']['rows'][0]
    if mutation == 'source_conflict': row['source_sha256'] = 'c'*64
    if mutation == 'negative_distance': row['features'][0] = -1.0
    if mutation == 'invalid_angle': row['features'][1] = 181.0
    rehash(args['train'])
    with pytest.raises(ValueError): fit_chronological_baselines(**args)


def test_calibrator_bytes_bind_raw_model_and_exact_later_membership():
    args = inputs(); fit = fit_chronological_baselines(**args)
    for name in ('prevalence', 'geometry', 'context'):
        calibration = json.loads(fit.artifacts[name+'-calibrator.json'])
        assert calibration['raw_model_sha256'] == fit.receipt['artifact_sha256'][name+'.pickle']
        for field in ('membership_sha256', 'source_sha256', 'feature_sha256'):
            assert calibration['calibration_'+field] == args['calibration'][field]
        assert calibration['schema_sha256'] == fingerprint(SCHEMA)
    assert len(fit.receipt['geometry_design_names']) == len(fit.receipt['geometry_coefficients'][0])
    assert len(fit.receipt['context_design_names']) == fit.context_model.n_features_in_
    body = {k: v for k, v in fit.receipt.items() if k != 'receipt_sha256'}
    assert fingerprint(body) == fit.receipt['receipt_sha256']


def test_prediction_uses_frozen_configuration_not_later_module_mutations(monkeypatch):
    fit = fit_chronological_baselines(**inputs())
    vectors = [[20., 40., None], [70., -10., 1.]]
    expected = fit.predict(vectors, schema=SCHEMA)
    receipt, artifacts = copy.deepcopy(fit.receipt), dict(fit.artifacts)
    monkeypatch.setitem(CONFIG, 'calibration', {**CONFIG['calibration'], 'epsilon': .4})
    monkeypatch.setitem(CONFIG, 'threads', 2)
    assert fit.predict(vectors, schema=SCHEMA) == expected
    assert fit.receipt == receipt and fit.artifacts == artifacts


def test_calibration_uses_its_own_frozen_regularization(monkeypatch):
    from sklearn.linear_model import LogisticRegression
    args = inputs()
    monkeypatch.setitem(CONFIG, 'calibration', {**CONFIG['calibration'], 'C': .123})
    fit = fit_chronological_baselines(**args)
    vectors = [r['features'] for r in args['calibration']['rows']]
    p = fit.predict(vectors, schema=SCHEMA, calibrated=False)['geometry']
    p = np.clip(p, 1e-6, 1-1e-6)
    expected = LogisticRegression(**CONFIG['logistic'] | {'C': .123, 'random_state': 60906}).fit(
        (np.log(p)-np.log1p(-p)).reshape(-1, 1), [r['label'] for r in args['calibration']['rows']])
    assert fit.calibrators['geometry']['solver_parameters']['C'] == .123
    assert fit.calibrators['geometry']['slope'] == expected.coef_[0, 0]
    assert fit.geometry_model.C == 1.0

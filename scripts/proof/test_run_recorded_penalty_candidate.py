"""Synthetic orchestration contracts, not real-data accuracy evidence."""
from copy import deepcopy
import json
import numpy as np
import pytest
import run_recorded_penalty_candidate as runner


@pytest.fixture
def sample(monkeypatch):
    monkeypatch.setattr(runner, 'code_hashes', lambda: {'synthetic': 'b'*64})
    schema = {'version': 'synthetic', 'names': ['immediate_previous_sog_same_team',
        'shooting_skaters', 'defending_skaters'], 'categorical_names': ['shot_type']}
    model = {'contract': runner.portable.VERSION, 'publishable': False, 'source_sklearn_version': '1.5.2',
        'input_policy': 'finite_design_after_explicit_imputation', 'branch_policy': 'less_than_or_equal_left',
        'leaf_policy': 'already_learning_rate_scaled', 'baseline_logit': -2.,
        'trees': [[{'feature': 0, 'threshold': .5, 'left': 1, 'right': 2}, {'leaf': -.1}, {'leaf': .2}]],
        'design': {'schema': schema, 'numeric_names': schema['names'], 'categorical_names': ['shot_type'],
            'medians': dict(zip(schema['names'], [0., 5., 5.])), 'vocabulary': {'shot_type': ['wrist']}}}
    contexts = [{'shot_type': 'wrist', 'strength': '5v5', 'prior_sog_same_team': '0'}]*12
    shape = runner.conditional.fit([.05, .2, .5, .8]*3, [0, 0, 1, 1]*3, contexts)
    body = runner.make_bundle(model, shape, declaration_sha256='a'*64, fold='fold1')
    request = {'game_id': 2019020001, 'event_id': 12, 'schema_sha256': runner.fingerprint(schema),
        'numeric': dict(zip(schema['names'], [0, 5, 5])), 'categorical': {'shot_type': 'wrist'}}
    return body, request


def score(body, rows):
    return runner.named_score(body, expected_sha256=runner.sha(body), requests=rows)


def test_roundtrip_unknowns_singletons_and_permutation(sample):
    body, row = sample
    other = deepcopy(row); other['event_id'] += 1
    other['numeric']['immediate_previous_sog_same_team'] = None
    other['categorical']['shot_type'] = 'unseen'
    before = deepcopy([row, other])
    actual = score(body, [row, other])
    assert [row, other] == before
    assert score(body, [other, row]) == actual[::-1]
    assert score(body, [row])[0]['raw'] == actual[0]['raw']
    assert abs(score(body, [other])[0]['mapped']-actual[1]['mapped']) <= 1e-12
    value = json.loads(body)
    assert value['quantity_raw'] == 'recorded_penalty_model_goal_probability'
    assert 'run_health_sha256' not in value
    assert value['declaration_sha256'] == 'a'*64


@pytest.mark.parametrize('change', ['outcome', 'missing', 'extra', 'bool', 'infinity', 'huge', 'schema', 'identity', 'category'])
def test_bad_named_inputs_fail(sample, change):
    body, row = sample
    if change == 'outcome': row['target'] = 1
    if change == 'missing': row['numeric'].pop('shooting_skaters')
    if change == 'extra': row['numeric']['future_penalty'] = 1
    if change == 'bool': row['numeric']['shooting_skaters'] = True
    if change == 'infinity': row['numeric']['shooting_skaters'] = float('inf')
    if change == 'huge': row['numeric']['shooting_skaters'] = 10**1000
    if change == 'schema': row['schema_sha256'] = '0'*64
    if change == 'identity': row['event_id'] = True
    if change == 'category': row['categorical']['shot_type'] = 5
    with pytest.raises(ValueError): score(body, [row])


def test_duplicate_empty_and_digest_rejection(sample):
    body, row = sample
    for rows in ([], [row, row]):
        with pytest.raises(ValueError): score(body, rows)
    with pytest.raises(ValueError, match='digest'):
        runner.named_score(body, expected_sha256='0'*64, requests=[row])


@pytest.mark.parametrize('change', ['components', 'runtime', 'code', 'quantity', 'provenance'])
def test_bundle_contract_drift_rejected(sample, change):
    body, row = sample; b = json.loads(body)
    if change == 'components': b['calibrator']['intercept'] += .1
    if change == 'runtime': b['runtime']['numpy'] = 'changed'
    if change == 'code': b['code_sha256'] = {}
    if change == 'quantity': b['quantity_raw'] = 'movement_model_goal_probability'
    if change == 'provenance': b['declaration_sha256'] = 'z'*64
    with pytest.raises(ValueError): score(runner.encode(b), [row])


def test_named_parity_checks_direct_reversal_singleton_and_duplicates(sample):
    body, request = sample
    rows = [{'game_id': request['game_id'], 'event_id': request['event_id'],
        'features': list(request['numeric'].values()), 'categorical': request['categorical']}]
    actual = score(body, [request])[0]
    result = runner.bundle_parity(body, rows, [actual['raw']], [actual['mapped']])
    assert result['raw_exact'] and result['duplicate_request_rejected']
    assert result['mapped_max_abs_error'] == {'direct': 0., 'reversed': 0., 'sampled_singleton': 0.}
    with pytest.raises(ValueError, match='parity'):
        runner.bundle_parity(body, rows, [actual['raw']+.01], [actual['mapped']])


def test_primary_requires_every_control_metric_and_finite():
    losses = {n: {m: .1 for m in runner.METRICS} for n in (runner.PRIMARY, *runner.CONTROLS)}
    assert runner.primary_passed(losses)
    for c in runner.CONTROLS:
        for m in runner.METRICS:
            changed = deepcopy(losses); changed[c][m] -= 1e-10
            assert not runner.primary_passed(changed)
    losses[runner.PRIMARY]['brier'] = float('nan')
    assert not runner.primary_passed(losses)


def test_projection_uses_names_and_preserves_original():
    source = {'names': ['a', 'b'], 'categorical_names': ['c', 'd']}
    target = {'names': ['b'], 'categorical_names': ['d']}
    rows = [{'features': [None, 0], 'categorical': {'c': 'known', 'd': None}, 'event_id': 2}]
    before = deepcopy(rows)
    assert runner.project_schema(rows, source, target) == [{'features': [0], 'categorical': {'d': None}, 'event_id': 2}]
    assert rows == before


def test_independent_scalar_matches_saved_json_unknown_context(sample):
    b = json.loads(sample[0]); shape = b['calibrator']
    contexts = [{'shot_type': None, 'strength': 'unseen', 'prior_sog_same_team': state} for state in (None, '0', '1')]
    probabilities = [0., .15, 1.]
    assert np.max(np.abs(runner.scalar_predictions(shape, probabilities, contexts)
        - runner.conditional.predict(shape, probabilities, contexts))) <= 1e-12


@pytest.mark.parametrize('defect', ['truncated', 'reverse_identity', 'singleton_extra', 'singleton_identity', 'nonfinite', 'range', 'lineage'])
def test_parity_rejects_corrupted_predictor(sample, monkeypatch, defect):
    body, request = sample
    rows = [{'game_id': request['game_id'], 'event_id': request['event_id'],
        'features': list(request['numeric'].values()), 'categorical': request['categorical']}]
    real = runner.named_score
    actual = score(body, [request])[0]
    calls = 0
    def corrupt(*args, **kwargs):
        nonlocal calls
        calls += 1
        out = real(*args, **kwargs)
        if defect == 'truncated' and calls == 1: return []
        if defect == 'reverse_identity' and calls == 2: out[0]['event_id'] += 1
        if defect == 'singleton_extra' and calls == 3: return out+out
        if defect == 'singleton_identity' and calls == 3: out[0]['event_id'] += 1
        if defect == 'nonfinite': out[0]['mapped'] = float('nan')
        if defect == 'range': out[0]['raw'] = 2.
        if defect == 'lineage': out[0]['bundle_sha256'] = '0'*64
        return out
    monkeypatch.setattr(runner, 'named_score', corrupt)
    with pytest.raises(ValueError): runner.bundle_parity(body, rows, [actual['raw']], [actual['mapped']])


def test_parity_rejects_empty_global_duplicates_and_nonfinite_expectations(sample):
    body, request = sample
    row = {'game_id': request['game_id'], 'event_id': request['event_id'],
        'features': list(request['numeric'].values()), 'categorical': request['categorical']}
    with pytest.raises(ValueError): runner.bundle_parity(body, [], [], [])
    with pytest.raises(ValueError, match='global'): runner.bundle_parity(body, [row, row], [.1, .1], [.1, .1])
    with pytest.raises(ValueError, match='bounded'): runner.bundle_parity(body, [row], [float('nan')], [.1])


@pytest.mark.parametrize('values', [[float('nan')], [float('inf')], [], [[.1]], [.1, .2], [True], [-.1], [1.1]])
def test_probability_vector_rejects_malformed(values):
    with pytest.raises(ValueError): runner.maximum_error(values, [.1], 1)


def test_maximum_error_reports_actual_and_rejects_drift():
    assert runner.maximum_error([.1], [.1], 1) == 0.
    assert 0 < runner.maximum_error([.1+1e-13], [.1], 1) < 1e-12
    with pytest.raises(ValueError): runner.maximum_error([.11], [.1], 1)

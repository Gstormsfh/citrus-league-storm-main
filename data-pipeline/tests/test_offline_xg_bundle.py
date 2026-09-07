"""Synthetic contract tests, not evidence of fitted-model accuracy."""
from copy import deepcopy
import json

import pytest
from projections import offline_xg_bundle as bundle
from projections import conditional_calibration_shape as conditional


@pytest.fixture
def fixture_bundle():
    schema = {'version': 'synthetic-contract', 'names': ['immediate_previous_sog_same_team',
              'shooting_skaters', 'defending_skaters'], 'categorical_names': ['shot_type']}
    model = {'contract': bundle.portable.VERSION, 'publishable': False, 'source_sklearn_version': '1.5.2',
             'input_policy': 'finite_design_after_explicit_imputation', 'branch_policy': 'less_than_or_equal_left',
             'leaf_policy': 'already_learning_rate_scaled', 'baseline_logit': -2.0,
             'trees': [[{'leaf': 0.1}]], 'design': {'schema': schema,
                 'numeric_names': schema['names'], 'categorical_names': ['shot_type'],
                 'medians': dict(zip(schema['names'], [0., 5., 5.])), 'vocabulary': {'shot_type': ['wrist']}}}
    contexts = [{'shot_type': 'wrist', 'strength': '5v5', 'prior_sog_same_team': '0'}] * 12
    calibrator = conditional.fit([.05, .2, .5, .8] * 3, [0, 0, 1, 1] * 3, contexts)
    body = bundle.create(bundle.encode(model), bundle.encode({'conditional_shape': calibrator}),
                         run_health_sha256='a' * 64, fold='fold1')
    row = {'game_id': 2019020001, 'event_id': 12, 'schema_sha256': bundle.sha(bundle.encode(schema)),
           'numeric': dict(zip(schema['names'], [0, 5, 5])), 'categorical': {'shot_type': 'wrist'}}
    return body, row


def score(body, rows):
    return bundle.score(body, expected_sha256=bundle.sha(body), rows=rows)


def test_roundtrip_identity_and_immutable_inputs(fixture_bundle):
    body, row = fixture_bundle
    before = deepcopy(row)
    out = score(body, [row])[0]
    assert row == before
    assert out['event_id'] == 12 and out['publishable'] is False
    assert 0 < out['raw_goal_probability'] < 1
    assert 0 < out['calibrated_goal_probability'] < 1
    assert score(body, [row]) == [out]


def test_named_feature_order_independent(fixture_bundle):
    body, row = fixture_bundle
    changed = deepcopy(row)
    changed['numeric'] = dict(reversed(list(row['numeric'].items())))
    assert score(body, [changed]) == score(body, [row])


def test_singleton_permutation_and_unknowns(fixture_bundle):
    body, row = fixture_bundle
    other = deepcopy(row)
    other['event_id'] += 1
    other['numeric']['immediate_previous_sog_same_team'] = None
    other['categorical']['shot_type'] = 'unseen'
    batch = score(body, [row, other])
    assert score(body, [other, row]) == batch[::-1]
    for i, item in enumerate([row, other]):
        one = score(body, [item])[0]
        assert one['raw_goal_probability'] == batch[i]['raw_goal_probability']
        assert abs(one['calibrated_goal_probability'] - batch[i]['calibrated_goal_probability']) <= 1e-12


@pytest.mark.parametrize('change', ['label', 'missing', 'extra', 'bool', 'huge', 'schema', 'identity'])
def test_bad_request_rejected(fixture_bundle, change):
    body, row = fixture_bundle
    if change == 'label': row['label'] = 1
    if change == 'missing': row['numeric'].pop('shooting_skaters')
    if change == 'extra': row['numeric']['future_goal'] = 1
    if change == 'bool': row['numeric']['shooting_skaters'] = True
    if change == 'huge': row['numeric']['shooting_skaters'] = 10**1000
    if change == 'schema': row['schema_sha256'] = '0' * 64
    if change == 'identity': row['event_id'] = True
    with pytest.raises(ValueError): score(body, [row])


def test_duplicate_batch_and_empty_rejected(fixture_bundle):
    body, row = fixture_bundle
    for rows in ([], [row, row]):
        with pytest.raises(ValueError): score(body, rows)


def test_trusted_digest_detects_swapped_map(fixture_bundle):
    body, row = fixture_bundle
    altered = json.loads(body)
    altered['calibrator']['intercept'] += .1
    altered['component_sha256']['calibrator'] = bundle.sha(bundle.encode(altered['calibrator']))
    with pytest.raises(ValueError, match='digest'):
        bundle.score(bundle.encode(altered), expected_sha256=bundle.sha(body), rows=[row])


@pytest.mark.parametrize('body', [b'{"a":1,"a":2}', b'{"a":NaN}', b'', b'[]' * 10000000])
def test_strict_json(body):
    with pytest.raises(ValueError): bundle.decode(body)


def test_code_drift_rejected(fixture_bundle, monkeypatch):
    body, row = fixture_bundle
    monkeypatch.setattr(bundle, 'code_hashes', lambda: {})
    with pytest.raises(ValueError, match='code'): score(body, [row])

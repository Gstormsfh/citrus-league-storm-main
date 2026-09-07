"""Independent synthetic immutable-bundle scoring contracts, not model efficacy."""
from copy import deepcopy
import json

import pytest
from projections import offline_xg_bundle as m


@pytest.fixture(scope='module')
def bundle():
    schema = dict(version='synthetic-review', names=['immediate_previous_sog_same_team',
                 'shooting_skaters', 'defending_skaters'], categorical_names=['shot_type'])
    design = dict(schema=schema, numeric_names=schema['names'], categorical_names=['shot_type'],
                  medians=dict(zip(schema['names'], [0., 5., 5.])), vocabulary={'shot_type': ['wrist']})
    model = dict(contract=m.portable.VERSION, publishable=False, source_sklearn_version='1.5.2',
                 input_policy='finite_design_after_explicit_imputation',
                 branch_policy='less_than_or_equal_left', leaf_policy='already_learning_rate_scaled',
                 design=design, baseline_logit=-2., trees=[[{'leaf': .1}]])
    contexts = [dict(shot_type='wrist', strength='5v5', prior_sog_same_team='0')] * 8
    calibrator = m.conditional.fit([.05, .2, .5, .8] * 2, [0, 0, 1, 1] * 2, contexts)
    return m.create(m.encode(model), m.encode({'conditional_shape': calibrator}),
                    run_health_sha256='a' * 64, fold='fold1')


def row(body, eid=1):
    decoded = m.decode(body)
    return dict(game_id=2018020059, event_id=eid, schema_sha256=decoded['schema_sha256'],
                numeric=dict(immediate_previous_sog_same_team=None, shooting_skaters=5, defending_skaters=5),
                categorical=dict(shot_type='unseen'))


def score(body, rows):
    return m.score(body, expected_sha256=m.sha(body), rows=rows)


def test_single_batch_reversal_missing_unknown_and_no_mutation(bundle):
    rows = [row(bundle, 1), row(bundle, 2)]
    rows[1]['numeric']['immediate_previous_sog_same_team'] = 0
    rows[1]['categorical']['shot_type'] = None
    before = deepcopy(rows)
    batch = score(bundle, rows)
    assert score(bundle, rows[::-1]) == batch[::-1]
    for i in range(2):
        single = score(bundle, [rows[i]])[0]
        assert single['raw_goal_probability'] == batch[i]['raw_goal_probability']
        assert abs(single['calibrated_goal_probability'] - batch[i]['calibrated_goal_probability']) <= 1e-12
    assert rows == before
    assert all(r['publishable'] is False for r in batch)


def test_changed_bytes_cannot_use_original_trusted_digest(bundle):
    with pytest.raises(ValueError, match='digest'):
        m.score(bundle + b' ', expected_sha256=m.sha(bundle), rows=[row(bundle)])


def test_component_tampering_rejected_even_with_refreshed_outer_digest(bundle):
    changed = m.decode(bundle)
    changed['model']['baseline_logit'] = -1.
    with pytest.raises(ValueError, match='components'):
        score(m.encode(changed), [row(bundle)])


def test_schema_reorder_cannot_reuse_existing_request_hash(bundle):
    changed = m.decode(bundle)
    changed['model']['design']['schema']['names'].reverse()
    changed['schema_sha256'] = m.sha(m.encode(changed['model']['design']['schema']))
    changed['component_sha256']['model'] = m.sha(m.encode(changed['model']))
    with pytest.raises(ValueError, match='schema'):
        score(m.encode(changed), [row(bundle)])


@pytest.mark.parametrize('value', [True, float('nan'), float('inf'), 10 ** 1000, '5'])
def test_invalid_numeric_never_silently_imputed(bundle, value):
    request = row(bundle)
    request['numeric']['shooting_skaters'] = value
    with pytest.raises(ValueError):
        score(bundle, [request])


def test_absent_feature_and_outcome_metadata_rejected(bundle):
    request = row(bundle)
    request['numeric'].pop('shooting_skaters')
    with pytest.raises(ValueError):
        score(bundle, [request])
    request = row(bundle)
    request['label'] = 1
    with pytest.raises(ValueError):
        score(bundle, [request])


def test_duplicate_identity_rejected_but_repeated_calls_permitted(bundle):
    request = row(bundle)
    with pytest.raises(ValueError, match='Unique'):
        score(bundle, [request, deepcopy(request)])
    assert score(bundle, [request]) == score(bundle, [request])


@pytest.mark.parametrize('body', [b'{"a":1,"a":2}', b'{"x":NaN}', b'{"x":Infinity}'])
def test_strict_json(body):
    with pytest.raises(ValueError):
        m.decode(body)


def test_policy_booleans_are_not_numeric_zero(bundle):
    changed = m.decode(bundle)
    changed['policy']['production_authorized'] = 0
    with pytest.raises(ValueError):
        score(m.encode(changed), [row(bundle)])


def test_runtime_drift_during_inference_rejected(bundle, monkeypatch):
    original = m.conditional.predict
    def drift(*args):
        result = original(*args)
        monkeypatch.setattr(m, 'runtime', lambda: {'python': 'changed'})
        return result
    monkeypatch.setattr(m.conditional, 'predict', drift)
    with pytest.raises(ValueError):
        score(bundle, [row(bundle)])


def test_code_drift_during_inference_rejected(bundle, monkeypatch):
    original = m.conditional.predict
    def drift(*args):
        result = original(*args)
        monkeypatch.setattr(m, 'code_hashes', lambda: {})
        return result
    monkeypatch.setattr(m.conditional, 'predict', drift)
    with pytest.raises(ValueError):
        score(bundle, [row(bundle)])

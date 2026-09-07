"""Synthetic execution equivalence, not cohort or predictive-accuracy evidence."""
from copy import deepcopy
import json
import math
import numpy as np
import pytest
import bounded_conditional_calibration as bounded


def fixture(n=19):
    p = np.linspace(.001, .95, n)
    y = np.asarray([int(i%3 == 0) for i in range(n)])
    contexts = [{'shot_type': ['wrist', 'slap', None][i%3], 'strength': ['5v5', None][i%2],
                 'prior_sog_same_team': bounded.dense.STATES[i%3]} for i in range(n)]
    vocab = bounded.dense._vocabulary(contexts)
    states = list(bounded.dense.STATES)
    width = bounded.allocation(n, vocab, states)['design_width']
    theta = np.linspace(.1, 1.1, width)
    theta[bounded.dense.SLOPES*(1+len(states))] = -1.3
    return p, y, contexts, vocab, states, theta


@pytest.mark.parametrize('chunk', [1, 2, 7, 19, 4096])
def test_dense_objective_gradient_all_penalties_once(chunk):
    p, y, contexts, vocab, states, theta = fixture()
    design = bounded.dense._design(p, contexts, vocab, states)
    expected = bounded.dense.objective(theta, design, y, len(states))
    actual = bounded.objective(theta, p, y, contexts, vocab, states, chunk_rows=chunk)
    assert actual[0] == pytest.approx(expected[0], abs=1e-12, rel=0)
    np.testing.assert_allclose(actual[1], expected[1], atol=1e-12, rtol=0)


def test_finite_difference_independent_gradient():
    p, y, contexts, vocab, states, theta = fixture()
    _, actual = bounded.objective(theta, p, y, contexts, vocab, states, chunk_rows=5)
    epsilon = 1e-6
    for i in range(len(theta)):
        left, right = theta.copy(), theta.copy()
        left[i] -= epsilon; right[i] += epsilon
        estimate = (bounded.objective(right, p, y, contexts, vocab, states, chunk_rows=5)[0]
                    - bounded.objective(left, p, y, contexts, vocab, states, chunk_rows=5)[0])/(2*epsilon)
        assert estimate == pytest.approx(actual[i], abs=2e-6, rel=0)


def test_fit_json_compatibility_and_explicit_fit_tolerance():
    p, y, contexts, *_ = fixture(48)
    old = bounded.dense.fit(p, y, contexts)
    new = bounded.fit(p, y, contexts, chunk_rows=7)
    new = json.loads(json.dumps(new, allow_nan=False))
    bounded.dense.validate(new)
    assert new['contract'] == old['contract'] and new['settings'] == old['settings']
    assert new['vocabulary'] == old['vocabulary'] and new['states'] == old['states']
    # Separate fitted optimizers need not be bitwise identical.
    np.testing.assert_allclose(bounded.predict(new, p, contexts, chunk_rows=5),
        bounded.dense.predict(old, p, contexts), atol=2e-6, rtol=0)
    assert new['optimization']['projected_gradient'] <= bounded.SETTINGS['projected_gradient_tolerance']


def test_same_model_predict_dense_json_unknown_state_and_category():
    contexts = [{'shot_type': 'wrist', 'strength': '5v5', 'prior_sog_same_team': '0'}]*12
    model = bounded.fit([.02, .1, .3, .7]*3, [0, 0, 1, 1]*3, contexts, chunk_rows=4)
    p = [0., .005, .025, .1, .35, .75, 1.]
    test = [{'shot_type': None if i%2 else 'unseen', 'strength': None if i%3 else '5v5',
             'prior_sog_same_team': [None, '0', '1'][i%3]} for i in range(len(p))]
    before = deepcopy(test)
    for chunk in (1, 2, 4096):
        actual = bounded.predict(model, p, test, chunk_rows=chunk)
        np.testing.assert_allclose(actual, bounded.dense.predict(model, p, test), atol=1e-12, rtol=0)
        np.testing.assert_allclose(bounded.predict(model, p[::-1], test[::-1], chunk_rows=chunk)[::-1], actual, atol=1e-12, rtol=0)
    assert test == before


def test_allocation_caps_large_request_without_changing_original_limit():
    p, y, contexts, vocab, states, theta = fixture()
    plan = bounded.allocation(250000, vocab, states, chunk_rows=250000)
    assert plan['effective_chunk_rows'] < 250000
    assert plan['max_live_numeric_cells'] <= plan['limit'] == bounded.dense.SETTINGS['max_cells']
    assert plan['full_design_cached'] is False
    assert plan['persistent_and_work_cells'] >= 2*250000


def test_no_full_design_calls_or_mutated_inputs(monkeypatch):
    p, y, contexts, vocab, states, theta = fixture()
    before = deepcopy(contexts); observed = []
    old = bounded.dense._design
    def inspect(pp, cc, vv, ss):
        observed.append(len(pp))
        return old(pp, cc, vv, ss)
    monkeypatch.setattr(bounded.dense, '_design', inspect)
    bounded.objective(theta, p, y, contexts, vocab, states, chunk_rows=4)
    assert observed == [4, 4, 4, 4, 3]
    assert contexts == before


@pytest.mark.parametrize('chunk', [0, -1, True, 1.5, '4', 1000001])
def test_invalid_chunk_size_before_design(chunk, monkeypatch):
    p, y, contexts, vocab, states, theta = fixture()
    monkeypatch.setattr(bounded.dense, '_design', lambda *a: pytest.fail('allocated'))
    with pytest.raises(ValueError): bounded.objective(theta, p, y, contexts, vocab, states, chunk_rows=chunk)


@pytest.mark.parametrize('defect', ['nan_p', 'bool_p', 'label_float', 'label_short', 'label_invalid', 'context_short',
                                   'state', 'vocab_duplicate', 'vocab_order', 'vocab_fields', 'theta_short', 'theta_nan', 'theta_bool'])
def test_malformed_inputs_rejected(defect):
    p, y, contexts, vocab, states, theta = fixture()
    if defect == 'nan_p': p[0] = np.nan
    if defect == 'bool_p': p = [True]*len(p)
    if defect == 'label_float': y = y.astype(float)
    if defect == 'label_short': y = y[:-1]
    if defect == 'label_invalid': y[0] = 2
    if defect == 'context_short': contexts = contexts[:-1]
    if defect == 'state': states = ['1', '0', None]
    if defect == 'vocab_duplicate': vocab['shot_type'].append(vocab['shot_type'][0])
    if defect == 'vocab_order': vocab['shot_type'] = vocab['shot_type'][::-1]
    if defect == 'vocab_fields': vocab['extra'] = ['x']
    if defect == 'theta_short': theta = theta[:-1]
    if defect == 'theta_nan': theta[0] = np.nan
    if defect == 'theta_bool': theta = [True]*len(theta)
    with pytest.raises(ValueError): bounded.objective(theta, p, y, contexts, vocab, states)


def test_one_class_fit_rejected_and_boolean_labels_match_original():
    p, y, contexts, *_ = fixture()
    with pytest.raises(ValueError, match='Both'): bounded.fit(p, [0]*len(p), contexts)
    result = bounded.fit(p, [bool(v) for v in y], contexts, chunk_rows=7)
    bounded.dense.validate(result)


def test_nonfinite_computed_objective_rejected():
    p, y, contexts, vocab, states, theta = fixture()
    theta[:] = 1e300
    with np.errstate(over='ignore', invalid='ignore'):
        with pytest.raises(ValueError, match='Nonfinite'): bounded.objective(theta, p, y, contexts, vocab, states, chunk_rows=4)

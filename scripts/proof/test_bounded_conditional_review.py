"""Independent synthetic equivalence tests; no real cohort fits or source reads."""
from copy import deepcopy
import json
import weakref

import numpy as np
import pytest
import bounded_conditional_calibration as bounded
from projections import conditional_calibration_shape as dense


def sample(n=37, states=(None, '0', '1')):
    p = np.linspace(.000001, .999999, n)
    y = np.asarray([i % 2 for i in range(n)], dtype=np.int64)
    contexts = [{'shot_type': None if i % 4 == 0 else 'wrist',
                 'prior_sog_same_team': states[i % len(states)],
                 'strength': '5v5' if i % 2 else None} for i in range(n)]
    vocabulary = dense._vocabulary(contexts)
    actual_states = [s for s in dense.STATES if s in states]
    return p, y, contexts, vocabulary, actual_states


@pytest.mark.parametrize('chunk', [1, 2, 8, 36, 37, 100])
@pytest.mark.parametrize('states', [(None,), ('0',), (None, '0', '1')])
def test_independent_dense_loss_and_gradient_at_nontrivial_theta(chunk, states):
    p, y, c, v, s = sample(states=states)
    design = dense._design(p, c, v, s)
    theta = np.linspace(-.4, 1.7, design.shape[1])
    before = deepcopy(c)
    expected = dense.objective(theta, design, y, len(s))
    actual = bounded.objective(theta, p, y, c, v, s, chunk)
    assert actual[0] == pytest.approx(expected[0], rel=1e-13, abs=1e-13)
    np.testing.assert_allclose(actual[1], expected[1], rtol=1e-12, atol=1e-12)
    assert c == before


def test_penalty_once_and_total_n_normalization_with_duplicate_likelihood():
    p, y, c, v, s = sample(12)
    theta = np.linspace(.2, 1.5, dense._design(p, c, v, s).shape[1])
    a, ga = bounded.objective(theta, p, y, c, v, s, 1)
    b, gb = bounded.objective(theta, np.tile(p, 2), np.tile(y, 2), c * 2, v, s, 7)
    # Dense objective on zero rows supplies penalties only, divided by N.
    zero = np.zeros((len(p), len(theta)))
    penalty_loss, penalty_grad = dense.objective(theta, zero, y, len(s))
    penalty_loss -= np.log(2)
    assert a - b == pytest.approx(penalty_loss / 2, abs=1e-12)
    np.testing.assert_allclose(ga - gb, penalty_grad / 2, atol=1e-12)


def test_analytic_gradient_matches_finite_difference():
    p, y, c, v, s = sample(15)
    theta = np.linspace(.1, 1.3, dense._design(p, c, v, s).shape[1])
    _, gradient = bounded.objective(theta, p, y, c, v, s, 4)
    for i in [0, dense.SLOPES-1, dense.SLOPES, 2*dense.SLOPES+1, len(theta)-1]:
        step = np.zeros_like(theta); step[i] = 1e-5
        a = bounded.objective(theta+step, p, y, c, v, s, 4)[0]
        b = bounded.objective(theta-step, p, y, c, v, s, 4)[0]
        assert gradient[i] == pytest.approx((a-b)/2e-5, rel=1e-7, abs=1e-7)


def test_no_previous_chunk_design_survives_and_chunk_rows_capped(monkeypatch):
    p, y, c, v, s = sample(37)
    width = dense._design(p, c, v, s).shape[1]
    original = dense._design
    refs, sizes = [], []
    def tracked(probabilities, *args):
        assert all(ref() is None for ref in refs), 'Prior design retained'
        result = original(probabilities, *args)
        sizes.append(len(probabilities)); refs.append(weakref.ref(result)); return result
    monkeypatch.setattr(dense, '_design', tracked)
    bounded.objective(np.ones(width), p, y, c, v, s, 7)
    assert sizes == [7, 7, 7, 7, 7, 2]
    assert all(ref() is None for ref in refs)


def test_initializer_bounds_and_options_exact_without_optimization(monkeypatch):
    p, y, c, v, s = sample()
    class Captured(Exception): pass
    calls = []
    def capture(fun, initial, **kwargs):
        calls.append((initial.copy(), kwargs)); raise Captured
    monkeypatch.setattr(bounded, 'minimize', capture)
    monkeypatch.setattr(dense, 'minimize', capture)
    with pytest.raises(Captured): bounded.fit(p, y, c, 3)
    with pytest.raises(Captured): dense.fit(p, y, c)
    np.testing.assert_array_equal(calls[0][0], calls[1][0])
    assert calls[0][1] == calls[1][1]


def model_for_prediction():
    _, _, c, v, s = sample(states=('0',))
    return {'contract': dense.VERSION, 'settings': deepcopy(dense.SETTINGS), 'publishable': False,
            'shared_slopes': [1.1]*dense.SLOPES, 'states': s,
            'context_slopes': [[.8]*dense.SLOPES], 'intercept': -2., 'vocabulary': v,
            'offsets': [.01]*sum(map(len, v.values())),
            'optimization': {'converged': True, 'iterations': 0, 'objective': 1., 'projected_gradient': 0.}}


def test_absent_states_unseen_groups_and_json_prediction_parity():
    model = model_for_prediction(); dense.validate(model)
    p, _, c, _, _ = sample(19)
    c[0]['shot_type'] = 'unseen'; c[1]['strength'] = 'unseen'
    expected = dense.predict(model, p, c)
    for chunk in [1, 3, 100]:
        np.testing.assert_allclose(bounded.predict(json.loads(json.dumps(model)), p, c, chunk), expected, atol=1e-14, rtol=1e-14)


@pytest.mark.parametrize('labels', [[.0, 1.], [0, 2], [0], [[0], [1]], ['0', '1']])
def test_strict_labels_and_limits(labels):
    p, _, c, v, s = sample(2)
    with pytest.raises(ValueError): bounded.fit(p, labels, c, 1)


@pytest.mark.parametrize('chunk', [0, -1, True, 1.5, 1000001])
def test_allocation_rejects_invalid_chunk(chunk):
    _, _, _, v, s = sample()
    with pytest.raises(ValueError): bounded.allocation(10, v, s, chunk)


def test_large_requested_chunk_reduced_without_widening_cell_or_row_limit():
    _, _, _, v, s = sample()
    result = bounded.allocation(1_000_000, v, s, 1_000_000)
    assert result['effective_chunk_rows'] < 1_000_000
    assert result['max_live_numeric_cells'] <= dense.SETTINGS['max_cells']
    assert result['full_design_cached'] is False
    with pytest.raises(ValueError): bounded.allocation(1_000_001, v, s)

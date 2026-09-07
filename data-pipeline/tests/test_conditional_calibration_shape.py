from copy import deepcopy
import json
from types import SimpleNamespace

import numpy as np
import pytest
from projections import conditional_calibration_shape as module


def contexts(states):
    return [{'shot_type': 'wrist', 'strength': '5v5', 'prior_sog_same_team': state} for state in states]


@pytest.fixture(scope='module')
def model():
    return module.fit([.02, .1, .5, .9] * 9, [0, 0, 1, 1] * 9,
                      contexts([None, '0', '1'] * 12))


def test_gradient_matches_central_differences():
    p = np.array([.01, .05, .2, .6, .9, .8])
    c = contexts([None, '0', '1'] * 2)
    vocabulary = module._vocabulary(c)
    states = [None, '0', '1']
    design = module._design(p, c, vocabulary, states)
    theta = np.linspace(.2, 1.2, design.shape[1])
    y = np.array([0, 0, 1, 1, 1, 0])
    _, analytic = module.objective(theta, design, y, len(states))
    finite_difference = []
    for i in range(len(theta)):
        plus, minus = theta.copy(), theta.copy()
        plus[i] += 1e-6
        minus[i] -= 1e-6
        finite_difference.append((module.objective(plus, design, y, 3)[0] - module.objective(minus, design, y, 3)[0]) / 2e-6)
    assert np.max(np.abs(analytic - finite_difference)) < 2e-7


def test_convex_objective_midpoint_bound():
    c = contexts(['0', '1', '0', '1'])
    design = module._design(np.array([.01, .2, .6, .9]), c, module._vocabulary(c), ['0', '1'])
    a, b = np.linspace(.1, 1, design.shape[1]), np.linspace(1, .1, design.shape[1])
    y = np.array([0, 0, 1, 1])
    f = lambda x: module.objective(x, design, y, 2)[0]
    assert f((a + b) / 2) <= (f(a) + f(b)) / 2 + 1e-12


def test_roundtrip_monotonicity_and_batch_invariance(model):
    restored = json.loads(json.dumps(model, allow_nan=False))
    before = deepcopy(restored)
    p = np.linspace(0, 1, 200).tolist()
    for state in (None, '0', '1'):
        c = contexts([state] * len(p))
        predicted = module.predict(restored, p, c)
        assert np.min(np.diff(predicted)) >= 0
        assert predicted[0] >= module.SETTINGS['epsilon']
        assert predicted[-1] <= 1 - module.SETTINGS['epsilon']
        assert np.max(np.abs(module.predict(restored, p[::-1], c) - predicted[::-1])) == 0
        for i in (0, 70, 199):
            assert abs(module.predict(restored, [p[i]], [c[i]])[0] - predicted[i]) < 1e-14
    assert restored == before


def test_absent_missing_state_uses_shared_slopes_and_zero_offset():
    model = module.fit([.05, .2, .5, .8] * 4, [0, 0, 1, 1] * 4, contexts(['0'] * 16))
    assert model['states'] == ['0']
    c = contexts([None, '1'])
    # Both states are absent, not interpreted as the observed false state.
    values = module.predict(model, [.2, .2], c)
    assert values[0] == values[1]
    original_model = {'contract': module.original.VERSION, 'kind': 'monotone_logit_group',
        'settings': deepcopy(module.original.SETTINGS), 'publishable': False, 'slopes': model['shared_slopes'],
        'intercept': model['intercept'], 'vocabulary': model['vocabulary'], 'offsets': model['offsets'],
        'optimization': {key: model['optimization'][key] for key in ('converged', 'iterations', 'objective')}}
    assert np.max(np.abs(values - module.original.predict(original_model, [.2, .2], c))) < 1e-14


@pytest.mark.parametrize('probabilities', [[True, .2], [float('nan'), .2], [-.1, .2], [1.1, .2], ['.1', .2], [], [10**1000, .2]])
def test_bad_probabilities(model, probabilities):
    with pytest.raises(ValueError):
        module.predict(model, probabilities, contexts(['0'] * len(probabilities)))


@pytest.mark.parametrize('bad', [{}, {'shot_type': 'wrist', 'strength': '5v5', 'prior_sog_same_team': 'unknown'},
                                {'shot_type': True, 'strength': '5v5', 'prior_sog_same_team': '0'}])
def test_bad_context(model, bad):
    with pytest.raises(ValueError):
        module.predict(model, [.2], [bad])


@pytest.mark.parametrize('labels', [[0, 0], [0., 1.], [0], [0, 2], [0, None]])
def test_bad_labels(labels):
    with pytest.raises(ValueError):
        module.fit([.1, .8], labels, contexts(['0', '1']))


@pytest.mark.parametrize('field,value', [('states', ['0', '0']), ('states', []), ('shared_slopes', [-1] * 11),
                                        ('shared_slopes', [True] * 11), ('context_slopes', []), ('publishable', True)])
def test_malformed_models(model, field, value):
    bad = deepcopy(model)
    bad[field] = value
    with pytest.raises(ValueError):
        module.predict(bad, [.2], contexts(['0']))


def test_failed_optimizer_rejected(monkeypatch):
    def failure(fun, initial, **kwargs):
        return SimpleNamespace(x=initial, success=False, nit=0)
    monkeypatch.setattr(module, 'minimize', failure)
    with pytest.raises(ValueError, match='converge'):
        module.fit([.1, .8], [0, 1], contexts(['0', '1']))


def test_false_optimizer_success_with_large_gradient_rejected(monkeypatch):
    def false_success(fun, initial, **kwargs):
        return SimpleNamespace(x=initial, success=True, nit=1)
    monkeypatch.setattr(module, 'minimize', false_success)
    with pytest.raises(ValueError, match='converge'):
        module.fit([.1, .8], [0, 1], contexts(['0', '1']))


def test_design_resource_guard(monkeypatch):
    monkeypatch.setitem(module.SETTINGS, 'max_cells', 1)
    with pytest.raises(ValueError, match='design-cell'):
        module.fit([.1, .8], [0, 1], contexts(['0', '1']))


def test_projected_gradient_bound_behavior():
    assert module._projected_gradient(np.array([0., 1.]), np.array([10., .1]), 1) == .1
    assert module._projected_gradient(np.array([0., 1.]), np.array([-10., .1]), 1) == 10.

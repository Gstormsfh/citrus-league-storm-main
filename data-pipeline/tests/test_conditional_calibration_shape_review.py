"""Independent synthetic contract tests; no fitted experiment or corpus access."""
from copy import deepcopy
import math

import numpy as np
import pytest
from projections import conditional_calibration_shape as m


def context(state, shot='wrist', strength='5v5'):
    return dict(shot_type=shot, strength=strength, prior_sog_same_team=state)


def artifact():
    return dict(contract=m.VERSION, settings=deepcopy(m.SETTINGS), publishable=False,
                shared_slopes=[.1 + i / 10 for i in range(m.SLOPES)], states=['0'],
                context_slopes=[[.1 + i / 10 for i in range(m.SLOPES)]],
                intercept=-1.7, vocabulary=dict(shot_type=['wrist'],
                    prior_sog_same_team=['0'], strength=['5v5']), offsets=[.2, -.3, .4],
                optimization=dict(converged=True, iterations=1, objective=.2,
                                  projected_gradient=0.))


def scalar_basis(p):
    """Separate scalar integration of the fixed piecewise logit intervals."""
    epsilon = m.SETTINGS['epsilon']
    logit = lambda x: math.log(x) - math.log1p(-x)
    x = logit(max(epsilon, min(1 - epsilon, p)))
    ref = logit(m.SETTINGS['reference_probability'])
    knots = [logit(k) for k in m.SETTINGS['knots']]
    return [max(0., min(b - a, x - a)) - max(0., min(b - a, ref - a))
            for a, b in zip(knots, knots[1:])]


def test_independent_basis_at_knots_adjacent_floats_and_endpoints():
    p = [0., 1., np.nextafter(0., 1.)]
    for knot in m.SETTINGS['knots']:
        p.extend([np.nextafter(knot, 0.), knot, np.nextafter(knot, 1.)])
    np.testing.assert_allclose(m.original._basis(np.array(p)),
                               np.array([scalar_basis(v) for v in p]), rtol=0, atol=4e-15)


def test_tied_context_slopes_reproduce_original_group_map():
    model = artifact()
    original = dict(contract=m.original.VERSION, kind='monotone_logit_group',
                    settings=deepcopy(m.original.SETTINGS), publishable=False,
                    slopes=model['shared_slopes'], intercept=model['intercept'],
                    vocabulary=model['vocabulary'], offsets=model['offsets'],
                    optimization={k: model['optimization'][k]
                                  for k in ('converged', 'iterations', 'objective')})
    p = [0., .005, .1, .49, .95, 1.] * 3
    rows = [context(s) for s in (None, '0', '1') for _ in range(6)]
    np.testing.assert_allclose(m.predict(model, p, rows), m.original.predict(original, p, rows),
                               rtol=0, atol=4e-15)


def test_unseen_context_keeps_known_other_offsets_not_all_zero():
    model = artifact()
    rows = [context(None), context('1'), context(None, 'novel'),
            context(None, 'novel', 'novel')]
    # At the reference probability every slope-basis coordinate is zero.
    expected_logits = [-1.7 + .2 + .4, -1.7 + .2 + .4, -1.7 + .4, -1.7]
    np.testing.assert_allclose(m.predict(model, [.1] * 4, rows),
                               [1 / (1 + math.exp(-z)) for z in expected_logits], atol=1e-15)


def test_zero_slopes_constant_monotone_and_missing_not_false():
    model = artifact()
    model['shared_slopes'] = [0.] * m.SLOPES
    model['context_slopes'] = [[0.] * m.SLOPES]
    p = [0., .1, .8, 1.]
    for state in (None, '0', '1'):
        values = m.predict(model, p, [context(state)] * 4)
        assert np.ptp(values) == 0
    assert m.predict(model, [.1], [context(None)])[0] != m.predict(model, [.1], [context('0')])[0]


def test_bound_gradient_does_not_hide_intercept_or_interior_gradient():
    theta = np.array([0., 0., .5, 0.])
    gradient = np.array([10., -4., 8., 20.])
    assert m._projected_gradient(theta, gradient, 3) == 20.
    assert m._projected_gradient(theta[:3], gradient[:3], 3) == 8.
    assert m._projected_gradient(theta[:2], gradient[:2], 2) == 4.


def test_resource_guard_before_basis_allocation(monkeypatch):
    monkeypatch.setitem(m.SETTINGS, 'max_cells', 1)
    def forbidden(*args):
        pytest.fail('Basis allocated before resource rejection')
    monkeypatch.setattr(m.original, '_basis', forbidden)
    with pytest.raises(ValueError, match='design-cell'):
        m._design(np.array([.1]), [context('0')], artifact()['vocabulary'], ['0'])


@pytest.mark.parametrize('field', ['shared_slopes', 'context_slopes', 'offsets', 'intercept'])
def test_huge_integer_model_parameters_rejected_as_value_error(field):
    model = artifact()
    value = 10 ** 1000
    if field == 'intercept':
        model[field] = value
    elif field == 'context_slopes':
        model[field][0][0] = value
    else:
        model[field][0] = value
    with pytest.raises(ValueError):
        m.predict(model, [.1], [context('0')])


def test_extreme_finite_slopes_fail_closed_on_overflow():
    model = artifact()
    model['context_slopes'] = [[1e308] * m.SLOPES]
    with np.errstate(over='ignore', invalid='ignore'):
        with pytest.raises(ValueError, match='Nonfinite conditional prediction'):
            m.predict(model, [1.], [context('0')])

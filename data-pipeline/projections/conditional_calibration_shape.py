"""Experimental context-slope calibration; caller proves chronological membership.

No source loading or serving hook. Same original piecewise-logit knots and
penalties; observed prior-SOG contexts have nonnegative slopes partially pooled
to nonnegative shared slopes. Missing context is distinct from false. Absent
calibration contexts use shared slopes and the existing zero-offset policy.
"""
from copy import deepcopy
import json
import math

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit
from threadpoolctl import threadpool_limits
from projections import calibration_candidate as prior
from projections import calibration_shape as original

VERSION = 'citrus-conditional-calibration-shape-v1'
SETTINGS = {key: deepcopy(original.SETTINGS[key]) for key in (
    'epsilon', 'knots', 'reference_probability', 'slope_identity_ridge',
    'adjacent_slope_ridge', 'group_ridge', 'maxiter', 'ftol', 'gtol',
    'max_rows', 'max_cells', 'optimizer', 'threads')}
SETTINGS.update(pooling_ridge=1000., projected_gradient_tolerance=1e-5,
                slope_context='prior_sog_same_team', absent_context_policy='shared_slopes_zero_unseen_offsets')
STATES = (None, '0', '1')
SLOPES = len(SETTINGS['knots']) - 1


def _probabilities(values):
    try:
        return prior._probabilities(values)
    except OverflowError:
        raise ValueError('Finite representable probabilities required') from None


def _finite(value):
    try:
        return prior._finite(value)
    except OverflowError:
        return False


def _contexts(contexts, n):
    prior._contexts(contexts, n)
    if any(row['prior_sog_same_team'] not in STATES for row in contexts):
        raise ValueError('Prior SOG must be explicit None, 0-string or 1-string')


def _vocabulary(contexts):
    result = {}
    for field in prior.CONTEXT_FIELDS:
        values = {row[field] for row in contexts}
        if len(values) > prior.SETTINGS['max_categories_per_field']:
            raise ValueError('Context vocabulary bound exceeded')
        result[field] = sorted(values, key=lambda x: (x is not None, x or ''))
    return result


def _design(p, contexts, vocabulary, states):
    group_width = sum(map(len, vocabulary.values()))
    width = SLOPES * (1 + len(states)) + 1 + group_width
    # Includes simultaneous basis, group matrix and concatenated design storage.
    if len(p) * (2 * width + SLOPES + group_width) > SETTINGS['max_cells']:
        raise ValueError('Conditional shape design-cell bound exceeded')
    basis = original._basis(p)
    design = np.zeros((len(p), width))
    design[:, :SLOPES] = basis
    for index, state in enumerate(states):
        mask = np.asarray([row['prior_sog_same_team'] == state for row in contexts])
        design[mask, :SLOPES] = 0
        start = SLOPES * (index + 1)
        design[mask, start:start + SLOPES] = basis[mask]
    intercept_index = SLOPES * (1 + len(states))
    design[:, intercept_index] = 1
    design[:, intercept_index + 1:] = prior._group_matrix(contexts, vocabulary)
    return design


def objective(theta, design, labels, state_count):
    """Convex log-loss + quadratic penalties, with analytic gradient for tests."""
    intercept = SLOPES * (1 + state_count)
    shared = theta[:SLOPES]
    z = design @ theta
    residual = expit(z) - labels
    loss = np.sum(np.logaddexp(0, z) - labels * z)
    gradient = design.T @ residual
    delta = shared - 1
    loss += .5 * SETTINGS['slope_identity_ridge'] * np.dot(delta, delta)
    gradient[:SLOPES] += SETTINGS['slope_identity_ridge'] * delta
    adjacent = np.diff(shared)
    loss += .5 * SETTINGS['adjacent_slope_ridge'] * np.dot(adjacent, adjacent)
    gradient[:SLOPES - 1] -= SETTINGS['adjacent_slope_ridge'] * adjacent
    gradient[1:SLOPES] += SETTINGS['adjacent_slope_ridge'] * adjacent
    for index in range(state_count):
        start = SLOPES * (index + 1)
        difference = theta[start:start + SLOPES] - shared
        loss += .5 * SETTINGS['pooling_ridge'] * np.dot(difference, difference)
        gradient[start:start + SLOPES] += SETTINGS['pooling_ridge'] * difference
        gradient[:SLOPES] -= SETTINGS['pooling_ridge'] * difference
    offsets = theta[intercept + 1:]
    loss += .5 * SETTINGS['group_ridge'] * np.dot(offsets, offsets)
    gradient[intercept + 1:] += SETTINGS['group_ridge'] * offsets
    loss, gradient = float(loss / len(labels)), gradient / len(labels)
    if not math.isfinite(loss) or not np.isfinite(gradient).all():
        raise ValueError('Nonfinite conditional objective')
    return loss, gradient


def _projected_gradient(theta, gradient, nonnegative):
    projected = gradient.copy()
    for i in range(nonnegative):
        if theta[i] <= 1e-12 and gradient[i] > 0:
            projected[i] = 0
    return float(np.max(np.abs(projected)))


def fit(probabilities, labels, contexts):
    """Fit supplied earlier calibration rows only; no inference-time fitting."""
    p = _probabilities(probabilities)
    _contexts(contexts, len(p))
    if (not isinstance(labels, (list, np.ndarray)) or np.ndim(labels) != 1
            or len(labels) != len(p) or any(type(v) not in (int, bool, np.int32, np.int64)
                                           or v not in (0, 1) for v in labels)):
        raise ValueError('Exact binary calibration labels required')
    y = np.asarray(labels, dtype=float)
    if len(np.unique(y)) != 2:
        raise ValueError('Both calibration outcomes required')
    vocabulary = _vocabulary(contexts)
    states = [state for state in STATES if any(row['prior_sog_same_team'] == state for row in contexts)]
    design = _design(p, contexts, vocabulary, states)
    nonnegative = SLOPES * (1 + len(states))
    initial = np.zeros(design.shape[1])
    initial[:nonnegative] = 1
    reference = SETTINGS['reference_probability']
    initial[nonnegative] = math.log(reference) - math.log1p(-reference)
    with threadpool_limits(limits=1):
        optimized = minimize(lambda theta: objective(theta, design, y, len(states)), initial,
            jac=True, method=SETTINGS['optimizer'],
            bounds=[(0, None)] * nonnegative + [(None, None)] * (len(initial) - nonnegative),
            options={k: SETTINGS[k] for k in ('maxiter', 'ftol', 'gtol')})
        loss, gradient = objective(optimized.x, design, y, len(states))
    pg = _projected_gradient(optimized.x, gradient, nonnegative)
    if (not optimized.success or not np.isfinite(optimized.x).all()
            or np.any(optimized.x[:nonnegative] < 0)
            or pg > SETTINGS['projected_gradient_tolerance']):
        raise ValueError('Conditional calibration did not converge')
    model = {'contract': VERSION, 'settings': deepcopy(SETTINGS), 'publishable': False,
             'shared_slopes': optimized.x[:SLOPES].tolist(), 'states': states,
             'context_slopes': [optimized.x[SLOPES * (i + 1):SLOPES * (i + 2)].tolist() for i in range(len(states))],
             'intercept': float(optimized.x[nonnegative]), 'vocabulary': vocabulary,
             'offsets': optimized.x[nonnegative + 1:].tolist(),
             'optimization': {'converged': True, 'iterations': int(optimized.nit),
                              'objective': loss, 'projected_gradient': pg}}
    validate(model)
    return model


def validate(model):
    keys = {'contract', 'settings', 'publishable', 'shared_slopes', 'states', 'context_slopes',
            'intercept', 'vocabulary', 'offsets', 'optimization'}
    if (not isinstance(model, dict) or set(model) != keys or model['contract'] != VERSION
            or model['publishable'] is not False
            or json.dumps(model['settings'], sort_keys=True) != json.dumps(SETTINGS, sort_keys=True)):
        raise ValueError('Exact conditional calibration contract required')
    states = model['states']
    if (not isinstance(states, list) or not states or any(s not in STATES for s in states)
            or states != [s for s in STATES if s in states]):
        raise ValueError('Canonical observed slope states required')
    vectors = model['context_slopes']
    if not isinstance(vectors, list) or len(vectors) != len(states):
        raise ValueError('Exact context slope width required')
    for slopes in [model['shared_slopes'], *vectors]:
        if (not isinstance(slopes, list) or len(slopes) != SLOPES
                or any(not _finite(v) or v < 0 for v in slopes)):
            raise ValueError('Nonnegative finite slopes required')
    # Reuse the complete unchanged group-map validator with this shared map.
    receipt = model['optimization']
    if (not isinstance(receipt, dict) or set(receipt) != {'converged', 'iterations', 'objective', 'projected_gradient'}
            or not _finite(receipt['projected_gradient'])
            or not 0 <= receipt['projected_gradient'] <= SETTINGS['projected_gradient_tolerance']):
        raise ValueError('Conditional convergence receipt required')
    if (not _finite(model['intercept']) or not isinstance(model['offsets'], list)
            or any(not _finite(v) for v in model['offsets']) or not _finite(receipt['objective'])):
        raise ValueError('Finite conditional parameters required')
    original.validate({'contract': original.VERSION, 'kind': 'monotone_logit_group',
        'settings': deepcopy(original.SETTINGS), 'publishable': False, 'slopes': model['shared_slopes'],
        'intercept': model['intercept'], 'vocabulary': model['vocabulary'], 'offsets': model['offsets'],
        'optimization': {key: receipt[key] for key in ('converged', 'iterations', 'objective')}})
    if model['vocabulary']['prior_sog_same_team'] != states:
        raise ValueError('Slope state and offset vocabulary mismatch')


def predict(model, probabilities, contexts):
    validate(model)
    p = _probabilities(probabilities)
    _contexts(contexts, len(p))
    design = _design(p, contexts, model['vocabulary'], model['states'])
    theta = np.asarray([*model['shared_slopes'], *(v for row in model['context_slopes'] for v in row),
                        model['intercept'], *model['offsets']])
    with threadpool_limits(limits=1):
        logits = design @ theta
    if not np.isfinite(logits).all():
        raise ValueError('Nonfinite conditional prediction')
    return np.clip(expit(logits), SETTINGS['epsilon'], 1 - SETTINGS['epsilon'])

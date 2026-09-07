"""Versioned execution engine for the unchanged conditional calibration model.

Only likelihood/gradient evaluation changes: deterministic bounded chunks,
penalties once, and total-N normalization. No complete design is cached.
Returned models use the frozen JSON contract; execution provenance belongs in
the caller's separate receipt. Mathematical, not bitwise optimizer equivalence.
"""
from copy import deepcopy
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'data-pipeline'))
import numpy as np
from scipy.optimize import minimize
from scipy.special import expit
from threadpoolctl import threadpool_limits
from projections import conditional_calibration_shape as dense

VERSION = 'citrus-bounded-conditional-calibration-v1'
SETTINGS = deepcopy(dense.SETTINGS)
DEFAULT_CHUNK_ROWS = 4096


def _settings():
    if SETTINGS != dense.SETTINGS:
        raise ValueError('Unchanged frozen statistical settings required')


def _schema(vocabulary, states):
    if (not isinstance(states, list) or not states
            or states != [s for s in dense.STATES if s in states]
            or not isinstance(vocabulary, dict) or set(vocabulary) != set(dense.prior.CONTEXT_FIELDS)):
        raise ValueError('Canonical state and context vocabulary required')
    for values in vocabulary.values():
        if (not isinstance(values, list) or not values or len(values) > dense.prior.SETTINGS['max_categories_per_field']
                or any(v is not None and (not isinstance(v, str) or not v.strip() or len(v) > 128) for v in values)
                or len(set(values)) != len(values) or values != sorted(values, key=lambda v: (v is not None, v or ''))):
            raise ValueError('Unique canonical bounded context categories required')
    if vocabulary['prior_sog_same_team'] != states:
        raise ValueError('Slope states must equal prior-SOG offset vocabulary')
    group_width = sum(map(len, vocabulary.values()))
    return dense.SLOPES*(1+len(states))+1+group_width, group_width


def allocation(n, vocabulary, states, chunk_rows=DEFAULT_CHUNK_ROWS):
    """Conservative live numeric-cell budget, not a whole-process RSS promise.

Charge two full input/output vectors; generous L-BFGS parameter/work reserve;
the original simultaneous design/basis/group charge plus chunk temporaries.
Python context objects and interpreter/library overhead are outside this numeric
cell bound and must be reported with measured RSS in the execution proof.
"""
    _settings()
    if (type(n) is not int or not 0 < n <= SETTINGS['max_rows']
            or type(chunk_rows) is not int or not 0 < chunk_rows <= SETTINGS['max_rows']):
        raise ValueError('Bounded positive integer rows and chunk_rows required')
    width, group_width = _schema(vocabulary, states)
    fixed = 2*n + 128*width + 4096
    per_row = 2*width + dense.SLOPES + group_width + 16
    available = SETTINGS['max_cells']-fixed
    cap = available//per_row
    if cap < 1:
        raise ValueError('Original live numeric-cell bound cannot hold one chunk')
    used = min(n, chunk_rows, cap)
    return {'contract': VERSION+':allocation', 'rows': n, 'requested_chunk_rows': chunk_rows,
        'effective_chunk_rows': used, 'design_width': width, 'group_width': group_width,
        'persistent_and_work_cells': fixed, 'charged_cells_per_chunk_row': per_row,
        'max_live_numeric_cells': fixed+used*per_row, 'limit': SETTINGS['max_cells'],
        'full_design_cached': False}


def _theta(theta, width):
    if not isinstance(theta, (list, np.ndarray)):
        raise ValueError('Explicit numeric coefficient vector required')
    if isinstance(theta, list) and any(not dense._finite(v) for v in theta):
        raise ValueError('Finite coefficient values required')
    value = np.asarray(theta)
    if value.shape != (width,) or value.dtype.kind not in 'fi' or not np.isfinite(value).all():
        raise ValueError('Exact finite coefficient width required')
    return np.asarray(value, dtype=float)


def _inputs(probabilities, labels, contexts, vocabulary, states, chunk_rows):
    # Allocation validation precedes converting full probability/label vectors.
    if not isinstance(probabilities, (list, np.ndarray)) or np.ndim(probabilities) != 1:
        raise ValueError('Explicit one-dimensional probabilities required')
    plan = allocation(len(probabilities), vocabulary, states, chunk_rows)
    p = dense._probabilities(probabilities)
    dense._contexts(contexts, len(p))
    if (not isinstance(labels, (list, np.ndarray)) or np.ndim(labels) != 1 or len(labels) != len(p)
            or any(type(v) not in (int, bool, np.int32, np.int64) or v not in (0, 1) for v in labels)):
        raise ValueError('Exact binary calibration labels required')
    return p, np.asarray(labels, dtype=float), plan


def _penalty(theta, state_count):
    """Frozen quadratic penalties, unnormalized and added exactly once."""
    slopes = dense.SLOPES
    intercept = slopes*(1+state_count)
    shared = theta[:slopes]
    gradient = np.zeros(len(theta))
    difference = shared-1
    loss = .5*SETTINGS['slope_identity_ridge']*np.dot(difference, difference)
    gradient[:slopes] += SETTINGS['slope_identity_ridge']*difference
    adjacent = np.diff(shared)
    loss += .5*SETTINGS['adjacent_slope_ridge']*np.dot(adjacent, adjacent)
    gradient[:slopes-1] -= SETTINGS['adjacent_slope_ridge']*adjacent
    gradient[1:slopes] += SETTINGS['adjacent_slope_ridge']*adjacent
    for index in range(state_count):
        start = slopes*(index+1)
        difference = theta[start:start+slopes]-shared
        loss += .5*SETTINGS['pooling_ridge']*np.dot(difference, difference)
        gradient[start:start+slopes] += SETTINGS['pooling_ridge']*difference
        gradient[:slopes] -= SETTINGS['pooling_ridge']*difference
    offsets = theta[intercept+1:]
    loss += .5*SETTINGS['group_ridge']*np.dot(offsets, offsets)
    gradient[intercept+1:] += SETTINGS['group_ridge']*offsets
    return float(loss), gradient


def _evaluate(theta, p, y, contexts, vocabulary, states, plan):
    loss, gradient = _penalty(theta, len(states))
    step = plan['effective_chunk_rows']
    # No list of designs/results: one current chunk and one gradient accumulator.
    for start in range(0, len(p), step):
        stop = min(start+step, len(p))
        design = dense._design(p[start:stop], contexts[start:stop], vocabulary, states)
        z = design @ theta
        residual = expit(z)-y[start:stop]
        loss += float(np.sum(np.logaddexp(0, z)-y[start:stop]*z))
        gradient += design.T @ residual
        del design, z, residual
    loss, gradient = float(loss/len(p)), gradient/len(p)
    if not math.isfinite(loss) or not np.isfinite(gradient).all():
        raise ValueError('Nonfinite bounded conditional objective')
    return loss, gradient


def objective(theta, probabilities, labels, contexts, vocabulary, states, chunk_rows=DEFAULT_CHUNK_ROWS):
    p, y, plan = _inputs(probabilities, labels, contexts, vocabulary, states, chunk_rows)
    coefficients = _theta(theta, plan['design_width'])
    with threadpool_limits(limits=1):
        return _evaluate(coefficients, p, y, contexts, vocabulary, states, plan)


def fit(probabilities, labels, contexts, chunk_rows=DEFAULT_CHUNK_ROWS):
    # Validate bounded shape before vocabulary iteration or dense conversion.
    if not isinstance(probabilities, (list, np.ndarray)) or np.ndim(probabilities) != 1:
        raise ValueError('Explicit one-dimensional probabilities required')
    if not 0 < len(probabilities) <= SETTINGS['max_rows']:
        raise ValueError('Original row bound exceeded')
    dense._contexts(contexts, len(probabilities))
    vocabulary = dense._vocabulary(contexts)
    states = [s for s in dense.STATES if any(c['prior_sog_same_team'] == s for c in contexts)]
    p, y, plan = _inputs(probabilities, labels, contexts, vocabulary, states, chunk_rows)
    if len(np.unique(y)) != 2: raise ValueError('Both calibration outcomes required')
    nonnegative = dense.SLOPES*(1+len(states))
    initial = np.zeros(plan['design_width']); initial[:nonnegative] = 1
    reference = SETTINGS['reference_probability']
    initial[nonnegative] = math.log(reference)-math.log1p(-reference)
    with threadpool_limits(limits=1):
        optimized = minimize(lambda theta: _evaluate(theta, p, y, contexts, vocabulary, states, plan), initial,
            jac=True, method=SETTINGS['optimizer'],
            bounds=[(0, None)]*nonnegative+[(None, None)]*(len(initial)-nonnegative),
            options={k: SETTINGS[k] for k in ('maxiter', 'ftol', 'gtol')})
        loss, gradient = _evaluate(optimized.x, p, y, contexts, vocabulary, states, plan)
    pg = dense._projected_gradient(optimized.x, gradient, nonnegative)
    if (not optimized.success or not np.isfinite(optimized.x).all() or np.any(optimized.x[:nonnegative] < 0)
            or not math.isfinite(pg) or pg > SETTINGS['projected_gradient_tolerance']):
        raise ValueError('Conditional calibration did not converge')
    model = {'contract': dense.VERSION, 'settings': deepcopy(SETTINGS), 'publishable': False,
        'shared_slopes': optimized.x[:dense.SLOPES].tolist(), 'states': states,
        'context_slopes': [optimized.x[dense.SLOPES*(i+1):dense.SLOPES*(i+2)].tolist() for i in range(len(states))],
        'intercept': float(optimized.x[nonnegative]), 'vocabulary': vocabulary,
        'offsets': optimized.x[nonnegative+1:].tolist(),
        'optimization': {'converged': True, 'iterations': int(optimized.nit), 'objective': loss, 'projected_gradient': pg}}
    dense.validate(model)
    return model


def predict(model, probabilities, contexts, chunk_rows=DEFAULT_CHUNK_ROWS):
    _settings(); dense.validate(model)
    if not isinstance(probabilities, (list, np.ndarray)) or np.ndim(probabilities) != 1:
        raise ValueError('Explicit one-dimensional probabilities required')
    plan = allocation(len(probabilities), model['vocabulary'], model['states'], chunk_rows)
    p = dense._probabilities(probabilities); dense._contexts(contexts, len(p))
    theta = np.asarray([*model['shared_slopes'], *(v for row in model['context_slopes'] for v in row),
                        model['intercept'], *model['offsets']])
    output = np.empty(len(p))
    with threadpool_limits(limits=1):
        for start in range(0, len(p), plan['effective_chunk_rows']):
            stop = min(start+plan['effective_chunk_rows'], len(p))
            design = dense._design(p[start:stop], contexts[start:stop], model['vocabulary'], model['states'])
            logits = design @ theta
            if not np.isfinite(logits).all(): raise ValueError('Nonfinite conditional prediction')
            output[start:stop] = np.clip(expit(logits), SETTINGS['epsilon'], 1-SETTINGS['epsilon'])
            del design, logits
    return output

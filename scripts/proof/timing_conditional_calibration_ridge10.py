"""Experimental joint conditional map plus four prior-SOG timing logit offsets.

No source I/O. Only train-observed timing categories receive coefficients.
State zero/null and state-one gaps greater than ten seconds are reference zero.
Original conditional basis/penalties stay intact; timing ridge is added once.
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
import bounded_conditional_calibration as bounded
from projections import conditional_calibration_shape as dense

VERSION = 'citrus-timing-conditional-calibration-ridge10-v1'
SETTINGS = deepcopy(dense.SETTINGS)
TIMING_RIDGE = 10.
BANDS = ('same_clock', 'up_to_1s', 'over_1_under_3s', 'from_3_to_10s')
DEFAULT_CHUNK_ROWS = 4096


def _settings():
    if SETTINGS != dense.SETTINGS or TIMING_RIDGE != 10.:
        raise ValueError('Frozen conditional settings and timing ridge10 required')


def timing_band(state, gap):
    if state not in (None, '0', '1'): raise ValueError('Exact prior-SOG state required')
    if gap is not None:
        try:
            valid = type(gap) in (int, float, np.int32, np.int64, np.float32, np.float64) and math.isfinite(gap) and gap >= 0
        except OverflowError: valid = False
        if not valid: raise ValueError('Finite nonnegative seconds or explicit missing required')
    if state == '1' and gap is None: raise ValueError('State-one timing gap must be known')
    if state != '1' or gap > 10: return None
    return 'same_clock' if gap == 0 else 'up_to_1s' if gap <= 1 else 'over_1_under_3s' if gap < 3 else 'from_3_to_10s'


def timing_values(contexts, gaps):
    if not isinstance(gaps, (list, np.ndarray)) or np.ndim(gaps) != 1 or len(gaps) != len(contexts):
        raise ValueError('Exact one-dimensional timing membership required')
    return [timing_band(c['prior_sog_same_team'], g) for c,g in zip(contexts, gaps)]


def _categories(categories):
    if not isinstance(categories, list) or categories != [b for b in BANDS if b in categories]:
        raise ValueError('Unique canonical observed timing categories required')


def allocation(n, vocabulary, states, timing_categories, chunk_rows=DEFAULT_CHUNK_ROWS):
    """Conservative numeric-cell bound, not a process RSS bound.

Charges probabilities, labels/output, integer timing codes, optimizer reserve,
and live chunk temporaries. Python context/band objects and library overhead
require separately measured process memory in any execution receipt.
"""
    _settings(); _categories(timing_categories)
    if (type(n) is not int or not 0 < n <= SETTINGS['max_rows']
            or type(chunk_rows) is not int or not 0 < chunk_rows <= DEFAULT_CHUNK_ROWS):
        raise ValueError('Bounded row count and chunk up to4096 required')
    base_width, group_width = bounded._schema(vocabulary, states)
    if timing_categories and '1' not in states: raise ValueError('Timing coefficients require observed state one')
    width = base_width+len(timing_categories)
    fixed = 3*n+128*width+4096
    per_row = 2*width+dense.SLOPES+group_width+24
    cap = (SETTINGS['max_cells']-fixed)//per_row
    if cap < 1: raise ValueError('Live numeric-cell bound cannot hold one chunk')
    used = min(n, chunk_rows, cap)
    return {'contract': VERSION+':allocation', 'rows': n, 'requested_chunk_rows': chunk_rows,
        'effective_chunk_rows': used, 'base_design_width': base_width, 'design_width': width,
        'group_width': group_width, 'timing_width': len(timing_categories),
        'persistent_and_work_cells': fixed, 'charged_cells_per_chunk_row': per_row,
        'max_live_numeric_cells': fixed+used*per_row, 'limit': SETTINGS['max_cells'],
        'full_design_cached': False}


def _inputs(probabilities, labels, contexts, gaps, vocabulary, states, categories, chunk_rows):
    if not isinstance(probabilities, (list, np.ndarray)) or np.ndim(probabilities) != 1:
        raise ValueError('One-dimensional probabilities required')
    plan = allocation(len(probabilities), vocabulary, states, categories, chunk_rows)
    p, y, _ = bounded._inputs(probabilities, labels, contexts, vocabulary, states, chunk_rows)
    bands = timing_values(contexts, gaps)
    codes = np.asarray([categories.index(b) if b in categories else -1 for b in bands], dtype=np.int64)
    return p, y, codes, plan


def _evaluate(theta, p, y, contexts, codes, vocabulary, states, categories, plan):
    base_width = plan['base_design_width']; base_theta, timing = theta[:base_width], theta[base_width:]
    loss, base_gradient = bounded._penalty(base_theta, len(states))
    loss += .5*TIMING_RIDGE*float(np.dot(timing, timing))
    gradient = np.concatenate((base_gradient, TIMING_RIDGE*timing))
    for start in range(0, len(p), plan['effective_chunk_rows']):
        stop = min(start+plan['effective_chunk_rows'], len(p))
        design = dense._design(p[start:stop], contexts[start:stop], vocabulary, states)
        z = design@base_theta; code = codes[start:stop]; known = code >= 0
        z[known] += timing[code[known]]
        residual = expit(z)-y[start:stop]
        loss += float(np.sum(np.logaddexp(0, z)-y[start:stop]*z))
        gradient[:base_width] += design.T@residual
        if len(categories): gradient[base_width:] += np.bincount(code[known], weights=residual[known], minlength=len(categories))
        del design, z, code, known, residual
    loss, gradient = float(loss/len(p)), gradient/len(p)
    if not math.isfinite(loss) or not np.isfinite(gradient).all(): raise ValueError('Finite joint timing objective required')
    return loss, gradient


def objective(theta, probabilities, labels, contexts, gaps, vocabulary, states, timing_categories, chunk_rows=DEFAULT_CHUNK_ROWS):
    p, y, codes, plan = _inputs(probabilities, labels, contexts, gaps, vocabulary, states, timing_categories, chunk_rows)
    coefficients = bounded._theta(theta, plan['design_width'])
    with threadpool_limits(limits=1):
        return _evaluate(coefficients, p, y, contexts, codes, vocabulary, states, timing_categories, plan)


def preflight(probabilities, contexts, gaps, chunk_rows=DEFAULT_CHUNK_ROWS):
    """Label-free train-side vocabulary/support and numerical allocation gates."""
    if not isinstance(probabilities, (list, np.ndarray)) or np.ndim(probabilities) != 1 or not 0 < len(probabilities) <= SETTINGS['max_rows']:
        raise ValueError('Bounded one-dimensional preflight probabilities required')
    dense._contexts(contexts, len(probabilities)); vocabulary = dense._vocabulary(contexts)
    states = [s for s in dense.STATES if any(c['prior_sog_same_team'] == s for c in contexts)]
    bands = timing_values(contexts, gaps); categories = [b for b in BANDS if b in bands]
    plan = allocation(len(probabilities), vocabulary, states, categories, chunk_rows)
    dense._probabilities(probabilities)
    return {'vocabulary': vocabulary, 'states': states, 'timing_categories': categories,
        'timing_support': {b: bands.count(b) for b in categories}, 'reference_events': bands.count(None), 'allocation': plan}


def validate(model):
    _settings()
    if not isinstance(model, dict) or model.get('contract') != VERSION or type(model.get('timing_ridge')) not in (int, float) or model['timing_ridge'] != TIMING_RIDGE:
        raise ValueError('Exact experimental timing model required')
    base = {k: deepcopy(v) for k,v in model.items() if k not in ('timing_categories', 'timing_offsets', 'timing_ridge')}
    base['contract'] = dense.VERSION; dense.validate(base)
    categories = model.get('timing_categories'); _categories(categories)
    if categories and '1' not in base['states']: raise ValueError('Timing coefficients require state one')
    values = model.get('timing_offsets')
    if not isinstance(values, list) or len(values) != len(categories) or any(not dense._finite(v) for v in values):
        raise ValueError('Exact finite timing coefficients required')
    return base


def fit(probabilities, labels, contexts, gaps, chunk_rows=DEFAULT_CHUNK_ROWS):
    if not isinstance(probabilities, (list, np.ndarray)) or np.ndim(probabilities) != 1 or not 0 < len(probabilities) <= SETTINGS['max_rows']:
        raise ValueError('Bounded one-dimensional fit probabilities required')
    dense._contexts(contexts, len(probabilities)); vocabulary = dense._vocabulary(contexts)
    states = [s for s in dense.STATES if any(c['prior_sog_same_team'] == s for c in contexts)]
    bands = timing_values(contexts, gaps); categories = [b for b in BANDS if b in bands]
    p, y, codes, plan = _inputs(probabilities, labels, contexts, gaps, vocabulary, states, categories, chunk_rows)
    if len(np.unique(y)) != 2: raise ValueError('Both fit outcomes required')
    nonnegative = dense.SLOPES*(1+len(states))
    initial = np.zeros(plan['design_width']); initial[:nonnegative] = 1
    reference = SETTINGS['reference_probability']; initial[nonnegative] = math.log(reference)-math.log1p(-reference)
    with threadpool_limits(limits=1):
        optimized = minimize(lambda theta: _evaluate(theta, p, y, contexts, codes, vocabulary, states, categories, plan), initial,
            jac=True, method=SETTINGS['optimizer'], bounds=[(0, None)]*nonnegative+[(None, None)]*(len(initial)-nonnegative),
            options={k: SETTINGS[k] for k in ('maxiter', 'ftol', 'gtol')})
        loss, gradient = _evaluate(optimized.x, p, y, contexts, codes, vocabulary, states, categories, plan)
    pg = dense._projected_gradient(optimized.x, gradient, nonnegative)
    if (not optimized.success or not np.isfinite(optimized.x).all() or np.any(optimized.x[:nonnegative] < 0)
            or not math.isfinite(pg) or pg > SETTINGS['projected_gradient_tolerance']): raise ValueError('Joint timing optimizer did not converge')
    model = {'contract': VERSION, 'settings': deepcopy(SETTINGS), 'publishable': False,
        'shared_slopes': optimized.x[:dense.SLOPES].tolist(), 'states': states,
        'context_slopes': [optimized.x[dense.SLOPES*(i+1):dense.SLOPES*(i+2)].tolist() for i in range(len(states))],
        'intercept': float(optimized.x[nonnegative]), 'vocabulary': vocabulary,
        'offsets': optimized.x[nonnegative+1:plan['base_design_width']].tolist(),
        'timing_categories': categories, 'timing_offsets': optimized.x[plan['base_design_width']:].tolist(), 'timing_ridge': TIMING_RIDGE,
        'optimization': {'converged': True, 'iterations': int(optimized.nit), 'objective': loss, 'projected_gradient': pg}}
    validate(model); return model


def predict(model, probabilities, contexts, gaps, chunk_rows=DEFAULT_CHUNK_ROWS):
    validate(model)
    if not isinstance(probabilities, (list, np.ndarray)) or np.ndim(probabilities) != 1: raise ValueError('One-dimensional prediction probabilities required')
    categories = model['timing_categories']; plan = allocation(len(probabilities), model['vocabulary'], model['states'], categories, chunk_rows)
    p = dense._probabilities(probabilities); dense._contexts(contexts, len(p)); bands = timing_values(contexts, gaps)
    codes = np.asarray([categories.index(b) if b in categories else -1 for b in bands], dtype=np.int64)
    theta = np.asarray([*model['shared_slopes'], *(v for row in model['context_slopes'] for v in row), model['intercept'], *model['offsets']])
    timing = np.asarray(model['timing_offsets']); output = np.empty(len(p))
    with threadpool_limits(limits=1):
        for start in range(0, len(p), plan['effective_chunk_rows']):
            stop = min(start+plan['effective_chunk_rows'], len(p)); design = dense._design(p[start:stop], contexts[start:stop], model['vocabulary'], model['states'])
            z = design@theta; code = codes[start:stop]; known = code >= 0; z[known] += timing[code[known]]
            if not np.isfinite(z).all(): raise ValueError('Finite timing predictions required')
            output[start:stop] = np.clip(expit(z), SETTINGS['epsilon'], 1-SETTINGS['epsilon'])
            del design, z, code, known
    return output

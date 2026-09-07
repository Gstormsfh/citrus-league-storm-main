"""Create-only numerical equivalence evidence; no fitting or model evaluation."""
from copy import deepcopy
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import platform
import resource
import signal
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'data-pipeline'))
import numpy as np
import scipy
from threadpoolctl import threadpool_limits
import bounded_conditional_calibration as bounded
from projections import conditional_calibration_shape as dense
from projections.verified_movement_reuse_v2 import Closure

SOURCE = 'scripts/proof/results/official-calibration-stability-20260906-full'
HEALTH_SHA = 'a46bd245f67e43c45950a4a593679e8b1ce610fca361b3fc88819c360ebf7718'
MODEL = 'fold1/2022-02/map.json'
INPUTS = 'fold1/2022-02/train-inputs.json'
ATOL = 1e-12
SYNTHETIC_ROWS = 250000
CODE = ('scripts/proof/prove_bounded_conditional.py', 'scripts/proof/test_prove_bounded_conditional.py',
        'scripts/proof/bounded_conditional_calibration.py',
        'scripts/proof/test_bounded_conditional_calibration.py',
        'scripts/proof/test_bounded_conditional_review.py',
        'docs/analytics-bounded-calibration-execution-20260906.md',
        'data-pipeline/projections/conditional_calibration_shape.py',
        'data-pipeline/projections/calibration_shape.py', 'data-pipeline/projections/calibration_candidate.py',
        'data-pipeline/projections/verified_movement_reuse_v2.py')


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def runtime():
    return {'python': platform.python_version(), 'numpy': np.__version__, 'scipy': scipy.__version__}


def error(actual, expected):
    a, b = np.asarray(actual), np.asarray(expected)
    if (a.shape != b.shape or a.size == 0 or a.dtype.kind not in 'fi' or b.dtype.kind not in 'fi'
            or not np.isfinite(a).all() or not np.isfinite(b).all()):
        raise ValueError('Exact finite numeric comparison required')
    result = float(np.max(np.abs(a-b)))
    if result > ATOL: raise ValueError('Declared absolute parity tolerance exceeded')
    return result


def theta(model):
    dense.validate(model)
    return np.asarray([*model['shared_slopes'], *(v for row in model['context_slopes'] for v in row),
                       model['intercept'], *model['offsets']], dtype=float)


def identity_theta(model):
    result = np.zeros_like(theta(model))
    slopes = dense.SLOPES*(1+len(model['states']))
    result[:slopes] = 1
    reference = dense.SETTINGS['reference_probability']
    result[slopes] = math.log(reference)-math.log1p(-reference)
    return result


def validate_inputs(rows):
    if not isinstance(rows, list) or not 0 < len(rows) <= dense.SETTINGS['max_rows']:
        raise ValueError('Bounded nonempty saved input rows required')
    fields = {'game_id', 'event_id', 'game_date', 'target', 'raw_probability', 'context'}
    seen, days = set(), {}
    for r in rows:
        if (not isinstance(r, dict) or set(r) != fields or type(r['game_id']) is not int or r['game_id'] <= 0
                or type(r['event_id']) is not int or r['event_id'] < 0 or type(r['target']) is not int
                or r['target'] not in (0, 1) or type(r['raw_probability']) not in (int, float)
                or not math.isfinite(r['raw_probability']) or not 0 < r['raw_probability'] < 1
                or not isinstance(r['game_date'], str) or date.fromisoformat(r['game_date']).isoformat() != r['game_date']):
            raise ValueError('Exact saved numerical input contract required')
        key = r['game_id'], r['event_id']
        if key in seen or (key[0] in days and days[key[0]] != r['game_date']):
            raise ValueError('Unique event and consistent game date required')
        seen.add(key); days[key[0]] = r['game_date']
    if rows != sorted(rows, key=lambda r: (r['game_date'], r['game_id'], r['event_id'])):
        raise ValueError('Canonical saved input order required')
    p = np.asarray([r['raw_probability'] for r in rows])
    y = np.asarray([r['target'] for r in rows], dtype=np.int64)
    contexts = [r['context'] for r in rows]
    dense._contexts(contexts, len(rows))
    return p, y, contexts


def source(closure):
    closure.pin(SOURCE+'/health.json', HEALTH_SHA)
    health = closure.read(SOURCE+'/health.json')
    if health['status'] != 'complete-calibration-stability-development-not-accepted' or health['publishable'] is not False:
        raise ValueError('Complete nonpublishing source required')
    closure.inventory(SOURCE, [*health['files'], 'health.json'])
    for name, digest in health['files'].items():
        if Path(name).is_absolute() or '..' in Path(name).parts: raise ValueError('Contained source file required')
        closure.pin(SOURCE+'/'+name, digest)
    if any(name not in health['files'] for name in (MODEL, INPUTS)):
        raise ValueError('Saved map/input source membership required')
    model, rows = closure.read(SOURCE+'/'+MODEL), closure.read(SOURCE+'/'+INPUTS)
    dense.validate(model); validate_inputs(rows)
    return model, rows


def real_parity(model, rows):
    p, y, contexts = validate_inputs(rows)
    n = min(2048, len(rows))
    design = dense._design(p[:n], contexts[:n], model['vocabulary'], model['states'])
    objectives = {}
    for label, parameters in [('saved', theta(model)), ('identity', identity_theta(model))]:
        expected, gradient = dense.objective(parameters, design, y[:n], len(model['states']))
        objectives[label] = {}
        for chunk in (127, 4096):
            value, actual_gradient = bounded.objective(parameters, p[:n], y[:n], contexts[:n],
                model['vocabulary'], model['states'], chunk_rows=chunk)
            objectives[label][str(chunk)] = {'objective_abs_error': error(value, expected),
                                             'gradient_max_abs_error': error(actual_gradient, gradient)}
    full = dense.predict(model, p, contexts)
    actual = bounded.predict(model, p, contexts, chunk_rows=4096)
    if np.asarray(actual).shape != (len(rows),) or np.any(np.asarray(actual) <= 0) or np.any(np.asarray(actual) >= 1):
        raise ValueError('Complete interior prediction vector required')
    return {'source_rows': len(rows), 'objective_prefix_rows': n, 'objectives': objectives,
            'full_prediction_max_abs_error': error(actual, full), 'model_fitted': False}


def synthetic_stress(model, n=SYNTHETIC_ROWS):
    if type(n) is not int or n != SYNTHETIC_ROWS: raise ValueError('Declared stress population required')
    vocabulary, states = model['vocabulary'], model['states']
    if len(states) != 3: raise ValueError('Three genuine saved contexts required')
    p = np.linspace(.001, .999, n)
    y = np.arange(n, dtype=np.int64) % 2
    templates = [{field: values[i % len(values)] for field, values in vocabulary.items()}
                 for i in range(max(map(len, vocabulary.values()))*3)]
    contexts = [templates[i % len(templates)] for i in range(n)]
    try: dense._design(p, contexts, vocabulary, states)
    except ValueError as exc:
        if 'design-cell bound' not in str(exc): raise
    else: raise ValueError('Synthetic evidence did not exceed original dense bound')
    allocations = {}
    for chunk in (4096, 250000):
        allocations[str(chunk)] = bounded.allocation(n, vocabulary, states, chunk_rows=chunk)
        allocation = allocations[str(chunk)]
        if (allocation['limit'] != dense.SETTINGS['max_cells']
                or not 0 < allocation['max_live_numeric_cells'] <= allocation['limit']
                or not 0 < allocation['effective_chunk_rows'] <= chunk
                or allocation['full_design_cached'] is not False):
            raise ValueError('Original bounded allocation contract violated')
    parameters = theta(model)
    value, gradient = bounded.objective(parameters, p, y, contexts, vocabulary, states, chunk_rows=4096)
    alternate, alternate_gradient = bounded.objective(parameters, p, y, contexts, vocabulary, states, chunk_rows=8192)
    predictions = bounded.predict(model, p, contexts, chunk_rows=4096)
    alternate_predictions = bounded.predict(model, p, contexts, chunk_rows=8192)
    if (np.asarray(predictions).shape != (n,) or not np.isfinite(predictions).all()
            or np.any(predictions <= 0) or np.any(predictions >= 1)):
        raise ValueError('Bounded synthetic prediction completion failed')
    group_width = sum(map(len, vocabulary.values()))
    width = dense.SLOPES*(1+len(states))+1+group_width
    return {'rows': n, 'states': len(states), 'group_width': group_width,
            'dense_live_cell_bound': n*(2*width+dense.SLOPES+group_width),
            'original_max_cells': dense.SETTINGS['max_cells'], 'dense_rejected': True,
            'allocations': allocations, 'chunk_objective_abs_error': error(value, alternate),
            'chunk_gradient_max_abs_error': error(gradient, alternate_gradient),
            'chunk_prediction_max_abs_error': error(predictions, alternate_predictions),
            'synthetic_only': True, 'model_fitted': False}


def run(output):
    output = Path(output).absolute()
    if (output.parent != ROOT/'scripts/proof/results' or not output.name.startswith('bounded-conditional-proof-')
            or '..' in output.parts or any(p.is_symlink() for p in (output, *output.parents))):
        raise ValueError('Scoped create-only nonsymlink output required')
    output.mkdir(exist_ok=False)
    closure, files = Closure(ROOT), {}
    def save(name, value):
        body = encode(value)
        with (output/name).open('xb') as stream: stream.write(body)
        files[name] = hashlib.sha256(body).hexdigest()
    try:
        started = time.perf_counter()
        before = runtime()
        for name in CODE:
            path = closure.safe(name)
            closure.pin(name, hashlib.sha256(path.read_bytes()).hexdigest())
        save('declaration.json', {'fit_permitted': False, 'publishable': False, 'absolute_tolerance': ATOL,
            'relative_tolerance': 0, 'source_health_sha256': HEALTH_SHA, 'runtime': before,
            'objective_prefix_max_rows': 2048, 'synthetic_rows': SYNTHETIC_ROWS,
            'synthetic_model_policy': 'reuse_genuine_saved_model_with_actual_vocabulary_no_fabricated_fit',
            'limitations': 'Numerical/resource proof only; no new model performance or historical availability claim.',
            'code_sha256': dict(closure.checked)})
        model, rows = source(closure)
        with threadpool_limits(limits=1):
            save('real-parity.json', real_parity(model, rows))
            save('synthetic-stress.json', synthetic_stress(model))
        closure.verify()
        if runtime() != before: raise ValueError('Runtime drift')
        save('execution.json', {'wall_seconds': time.perf_counter()-started,
            'ru_maxrss': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            'ru_maxrss_units': 'bytes' if sys.platform == 'darwin' else 'KiB' if sys.platform.startswith('linux') else 'platform_defined',
            'limitations': 'Process lifetime RSS high-water mark, not isolated allocation measurement; cell budget excludes Python objects and native allocator/runtime overhead.'})
        save('consumed-file-sha256.json', dict(closure.checked))
        for name, digest in files.items():
            if hashlib.sha256((output/name).read_bytes()).hexdigest() != digest: raise ValueError('Output drift')
        save('health.json', {'status': 'complete-bounded-conditional-numerical-proof', 'publishable': False,
                             'fit_performed': False, 'files': dict(files)})
    except BaseException as exc:
        save('failure.json', {'error_type': type(exc).__name__, 'error': str(exc), 'publishable': False, 'files': dict(files)})
        raise


if __name__ == '__main__':
    def stop(signum, frame): raise KeyboardInterrupt('Preserve interrupted numerical proof')
    signal.signal(signal.SIGTERM, stop)
    run(sys.argv[1])

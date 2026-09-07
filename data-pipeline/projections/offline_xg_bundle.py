"""Single JSON candidate bundle for local feature-row inference, never deployment.

An externally retained digest is mandatory. Internal hashes detect corruption,
not training provenance. No file/model loader, fitting, or publication path.
"""
import hashlib
import json
import math
from pathlib import Path
import platform

import numpy as np
import scipy
from projections import portable_context_model as portable
from projections import conditional_calibration_shape as conditional
from projections import calibration_candidate as calibration

VERSION = 'citrus-offline-xg-bundle-v1'
MAX_BYTES = 8_000_000
MAX_ROWS = 4096
CODE_FILES = ('offline_xg_bundle.py', 'portable_context_model.py',
              'conditional_calibration_shape.py', 'calibration_candidate.py', 'calibration_shape.py')
POLICY = {'publishable': False, 'prediction_scope': 'supplied_feature_rows_only',
          'quantity_raw': 'movement_model_goal_probability',
          'quantity_calibrated': 'conditional_calibrated_goal_probability',
          'original_input_parity_accepted': False, 'production_authorized': False}


def encode(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    except (ValueError, TypeError, OverflowError, RecursionError):
        raise ValueError('Finite bounded JSON required') from None


def sha(body):
    return hashlib.sha256(body).hexdigest()


def _digest(value):
    return isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key')
        result[key] = value
    return result


def decode(body):
    if type(body) is not bytes or not 0 < len(body) <= MAX_BYTES:
        raise ValueError('Bounded nonempty exact JSON bytes required')
    try:
        return json.loads(body, object_pairs_hook=_pairs,
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
    except (UnicodeError, OverflowError, RecursionError) as error:
        raise ValueError('Invalid bounded JSON') from error


def runtime():
    return {'python': platform.python_version(), 'numpy': np.__version__, 'scipy': scipy.__version__}


def code_hashes():
    parent = Path(__file__).resolve().parent
    result = {}
    for name in CODE_FILES:
        path = parent / name
        if path.is_symlink() or not path.is_file():
            raise ValueError('Fixed local inference code required')
        result[name] = sha(path.read_bytes())
    return result


def _validate(bundle):
    expected = {'contract', 'policy', 'runtime', 'code_sha256', 'lineage', 'schema_sha256',
                'model', 'calibrator', 'component_sha256'}
    if (not isinstance(bundle, dict) or set(bundle) != expected
            or bundle['contract'] != VERSION or encode(bundle['policy']) != encode(POLICY)
            or bundle['runtime'] != runtime() or bundle['code_sha256'] != code_hashes()):
        raise ValueError('Exact candidate bundle, runtime and code contract required')
    lineage = bundle['lineage']
    if (not isinstance(lineage, dict) or set(lineage) != {'run_health_sha256', 'fold',
            'model_file_sha256', 'calibrator_file_sha256'} or lineage['fold'] not in ('fold1', 'fold2')
            or any(not _digest(lineage[k]) for k in lineage if k != 'fold')):
        raise ValueError('Explicit frozen artifact identity required')
    try:
        portable.validate_model(bundle['model'])
        conditional.validate(bundle['calibrator'])
    except (OverflowError, TypeError, KeyError) as error:
        raise ValueError('Invalid inference component') from error
    schema = bundle['model']['design']['schema']
    if (not {'immediate_previous_sog_same_team', 'shooting_skaters', 'defending_skaters'} <= set(schema['names'])
            or 'shot_type' not in schema['categorical_names']
            or bundle['schema_sha256'] != sha(encode(schema))):
        raise ValueError('Exact raw and calibration input schema required')
    members = {key: sha(encode(bundle[key])) for key in ('model', 'calibrator')}
    if bundle['component_sha256'] != members:
        raise ValueError('Mixed or changed bundle components')
    return schema


def create(model_body, calibrators_body, *, run_health_sha256, fold):
    """Caller must independently verify file bytes against the run receipt first."""
    model, maps = decode(model_body), decode(calibrators_body)
    if not isinstance(maps, dict) or 'conditional_shape' not in maps:
        raise ValueError('Declared conditional candidate map required')
    bundle = {'contract': VERSION, 'policy': dict(POLICY), 'runtime': runtime(),
              'code_sha256': code_hashes(),
              'lineage': {'run_health_sha256': run_health_sha256, 'fold': fold,
                          'model_file_sha256': sha(model_body), 'calibrator_file_sha256': sha(calibrators_body)},
              'model': model, 'calibrator': maps['conditional_shape'],
              'schema_sha256': sha(encode(model['design']['schema']))}
    bundle['component_sha256'] = {key: sha(encode(bundle[key])) for key in ('model', 'calibrator')}
    _validate(bundle)
    body = encode(bundle)
    if len(body) > MAX_BYTES:
        raise ValueError('Bundle byte bound exceeded')
    return body


def score(body, *, expected_sha256, rows):
    """Use complete named inputs; outputs preserve exact event identity/order.

No labels or arbitrary metadata accepted. Missing is explicit None; absent
fields fail. Each call decodes a fresh copy and rechecks code before/after use.
"""
    if (not _digest(expected_sha256) or type(body) is not bytes
            or not 0 < len(body) <= MAX_BYTES or sha(body) != expected_sha256):
        raise ValueError('Caller-trusted bundle digest mismatch')
    bundle = decode(body)
    schema = _validate(bundle)
    if not isinstance(rows, list) or not 0 < len(rows) <= MAX_ROWS:
        raise ValueError('Bounded nonempty batch required')
    normalized, identities, seen = [], [], set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'game_id', 'event_id', 'schema_sha256', 'numeric', 'categorical'}:
            raise ValueError('Exact named feature request required, without outcomes')
        key = row['game_id'], row['event_id']
        if (any(type(v) is not int for v in key) or not 0 < key[0] < 10**10 or not 0 <= key[1] < 10**9
                or key in seen or row['schema_sha256'] != bundle['schema_sha256']):
            raise ValueError('Unique bounded event identity and exact schema required')
        seen.add(key)
        nums, cats = row['numeric'], row['categorical']
        if (not isinstance(nums, dict) or set(nums) != set(schema['names'])
                or not isinstance(cats, dict) or set(cats) != set(schema['categorical_names'])):
            raise ValueError('Every exact feature name required')
        try:
            if any(v is not None and (type(v) not in (int, float) or not math.isfinite(v)) for v in nums.values()):
                raise ValueError('Finite numbers or explicit missing required')
        except OverflowError:
            raise ValueError('Representable numeric features required') from None
        normalized.append({'features': [nums[n] for n in schema['names']], 'categorical': dict(cats)})
        identities.append(key)
    raw = portable.predict_rows(bundle['model'], normalized)
    contexts = [calibration.context_from_row(row, schema) for row in normalized]
    mapped = conditional.predict(bundle['calibrator'], raw, contexts)
    if bundle['code_sha256'] != code_hashes() or bundle['runtime'] != runtime():
        raise ValueError('Inference code or runtime changed during scoring')
    return [{'game_id': key[0], 'event_id': key[1], 'bundle_sha256': expected_sha256,
             'raw_goal_probability': float(raw[i]), 'calibrated_goal_probability': float(mapped[i]),
             'publishable': False} for i, key in enumerate(identities)]

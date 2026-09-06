"""Pure first-party chronological baseline fitting; no artifact loading or I/O.

Inputs are already source-validated declarations. Digests verify consistency,
not source authenticity or untouched holdout history. Returned pickle bytes are
ONLY newly fitted objects for a caller's create-only persistence; never loaded.
"""
from dataclasses import dataclass
from datetime import date
import hashlib
import json
import math
import pickle
import platform
import re

import numpy as np
import scipy
from scipy.special import expit
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

from projections.analytics_publication import fingerprint

VERSION = 'official-chronological-baseline-fit-v1'
GEOMETRY = ('distance_to_goal_ft', 'signed_angle_deg')
REVIEWED_NUMERIC = frozenset((*GEOMETRY, 'x_raw', 'y_raw', 'x_attacking', 'y_attacking',
    'shooting_skaters', 'defending_skaters', 'shooting_empty_net', 'defending_empty_net',
    'skater_advantage', 'score_differential_pre_shot', 'seconds_since_immediate_event',
    'distance_from_immediate_event_ft', 'event_location_change_ft_per_second'))
CONFIG = {'seed': 60906, 'geometry_terms': ['distance', 'absolute_angle', 'distance_squared',
    'absolute_angle_squared', 'distance_times_absolute_angle'],
    'geometry_contract': 'distance-abs-angle-quadratic-v1',
    'unknown_policy': 'train-median-plus-fixed-missing-indicators-v1',
    'logistic': {'C': 1.0, 'solver': 'lbfgs', 'max_iter': 2000, 'tol': 1e-8},
    'context': {'max_iter': 200, 'learning_rate': .05, 'max_leaf_nodes': 15,
                'min_samples_leaf': 100, 'l2_regularization': 10.0, 'early_stopping': False},
    'calibration': {'contract': 'later-window-logit-sigmoid-l2-v1', 'C': 1.0,
                    'epsilon': 1e-6, 'constant_score_policy': 'calibration-prevalence-intercept-slope-zero'},
    'threads': 1, 'selection': 'fixed-before-fit-no-tuning-or-test-selection'}


def _sha(value):
    if not isinstance(value, str) or re.fullmatch('[0-9a-f]{64}', value) is None:
        raise ValueError('Explicit SHA256 required')
    return value


def _day(value):
    if not isinstance(value, str) or re.fullmatch(r'\d{4}-\d{2}-\d{2}', value) is None:
        raise ValueError('ISO calendar date required')
    return date.fromisoformat(value)


def _schema(schema):
    if (not isinstance(schema, dict) or set(schema) != {'version', 'names'}
            or not isinstance(schema['version'], str) or not schema['version'].strip()
            or not isinstance(schema['names'], list) or not schema['names']
            or any(not isinstance(n, str) for n in schema['names'])
            or len(set(schema['names'])) != len(schema['names'])
            or not set(GEOMETRY) <= set(schema['names'])
            or not set(schema['names']) <= REVIEWED_NUMERIC):
        raise ValueError('Exact ordered reviewed numeric feature schema required')


def cohort_digests(rows):
    """Digest canonical ordered rows; caller retains complete membership evidence."""
    return {'membership_sha256': fingerprint(rows),
            'source_sha256': fingerprint([{'game_id': r['game_id'], 'event_id': r['event_id'],
                'source_sha256': r['source_sha256']} for r in rows]),
            'feature_sha256': fingerprint([{'game_id': r['game_id'], 'event_id': r['event_id'],
                'feature_sha256': r['feature_sha256']} for r in rows])}


def _vectors(rows, schema):
    result = []
    for values in rows:
        if (not isinstance(values, list) or len(values) != len(schema['names'])
                or any(v is not None and (type(v) not in (int, float) or not math.isfinite(v)) for v in values)):
            raise ValueError('Exact finite numeric vector order required; missing is explicit None')
        result.append([np.nan if v is None else v for v in values])
    return np.asarray(result, dtype=np.float64)


def _cohort(cohort, split, schema):
    if (not isinstance(cohort, dict) or set(cohort) != {'split', 'window', 'rows',
            'membership_sha256', 'source_sha256', 'feature_sha256'} or cohort['split'] != split
            or not isinstance(cohort['window'], dict) or set(cohort['window']) != {'start', 'end'}):
        raise ValueError('Only explicit train/calibration cohorts accepted; no test payloads')
    start, end = map(_day, (cohort['window']['start'], cohort['window']['end']))
    rows = cohort['rows']
    if start > end or not isinstance(rows, list) or not rows:
        raise ValueError('Nonempty bounded cohort required')
    seen, games, sources = set(), {}, {}
    schema_hash = fingerprint(schema)
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'split', 'game_id', 'event_id', 'game_date',
                'label', 'features', 'source_sha256', 'feature_sha256'} or row['split'] != split:
            raise ValueError('Unknown fields or late/test fit membership')
        gid, eid, day = row['game_id'], row['event_id'], _day(row['game_date'])
        if (type(gid) is not int or len(str(gid)) != 10 or (gid//10000)%100 not in (2, 3)
                or gid%10000 == 0 or type(eid) is not int or eid < 0
                or day.year not in (gid//1000000, gid//1000000+1) or not start <= day <= end
                or (gid, eid) in seen):
            raise ValueError('Invalid, duplicate or outside-window event identity')
        if gid in games and games[gid] != day:
            raise ValueError('Whole-game date conflict')
        if gid in sources and sources[gid] != row['source_sha256']:
            raise ValueError('Whole-game source receipt conflict')
        sources[gid] = row['source_sha256']
        games[gid] = day; seen.add((gid, eid))
        if type(row['label']) not in (bool, int) or row['label'] not in (0, 1):
            raise ValueError('Explicit binary label required')
        _sha(row['source_sha256'])
        if row['feature_sha256'] != fingerprint({'schema_sha256': schema_hash, 'values': row['features']}):
            raise ValueError('Feature vector/schema digest mismatch')
    if rows != sorted(rows, key=lambda r: (r['game_date'], r['game_id'], r['event_id'])):
        raise ValueError('Canonical ordered event membership required')
    for key, value in cohort_digests(rows).items():
        if _sha(cohort[key]) != value:
            raise ValueError('Exact cohort digest mismatch: ' + key)
    x = _vectors([r['features'] for r in rows], schema)
    y = np.asarray([int(r['label']) for r in rows])
    if len(np.unique(y)) != 2:
        raise ValueError('Both outcome classes required for train and calibration fitting')
    return x, y, games


def _fit_logistic(x, y, parameters):
    model = LogisticRegression(**parameters).fit(x, y)
    if int(model.n_iter_.max()) >= parameters['max_iter']:
        raise ValueError('Fixed-budget logistic did not converge; no fitted receipt')
    return model


@dataclass
class FittedBaselines:
    schema: dict
    medians: np.ndarray
    prevalence: float
    geometry_scaler: object
    geometry_model: object
    context_model: object
    calibrators: dict
    receipt: dict
    artifacts: dict
    config: dict

    def _matrices(self, vectors):
        x = _vectors(vectors, self.schema)
        missing = np.isnan(x).astype(float)
        filled = np.where(np.isnan(x), self.medians, x)
        d, a = (filled[:, self.schema['names'].index(name)] for name in GEOMETRY)
        if np.any(d < 0) or np.any(np.abs(a) > 180):
            raise ValueError('Distance/angle outside reviewed geometry domain')
        a = np.abs(a)
        geometry = np.column_stack((d, a, d*d, a*a, d*a,
            missing[:, self.schema['names'].index(GEOMETRY[0])],
            missing[:, self.schema['names'].index(GEOMETRY[1])]))
        if not np.isfinite(geometry).all():
            raise ValueError('Geometry term overflow')
        return geometry, np.column_stack((filled, missing))

    def predict(self, vectors, *, schema, calibrated=True):
        if schema != self.schema:
            raise ValueError('Prediction feature schema/order differs from frozen fit')
        geometry, context = self._matrices(vectors)
        with threadpool_limits(limits=self.config['threads']):
            scores = {'prevalence': np.full(len(vectors), self.prevalence),
                      'geometry': self.geometry_model.predict_proba(self.geometry_scaler.transform(geometry))[:, 1],
                      'context': self.context_model.predict_proba(context)[:, 1]}
        if calibrated:
            epsilon = self.config['calibration']['epsilon']
            scores = {name: expit(c['intercept'] + c['slope'] *
                (np.log(np.clip(p, epsilon, 1-epsilon)) - np.log1p(-np.clip(p, epsilon, 1-epsilon))))
                for name, p in scores.items() for c in [self.calibrators[name]]}
        return {name: values.tolist() for name, values in scores.items()}


def fit_chronological_baselines(*, train, calibration, schema, code_sha256):
    """Fit fixed models on train only; later calibration never reaches raw fit.

    code_sha256 is caller-verified source identity, not independently read here.
    No test input parameter exists. Window/membership claims still require the
    upstream source and split validator; relabelled dishonest inputs cannot be
    authenticated by a pure fitting function.
    """
    _schema(schema); _sha(code_sha256)
    frozen_config = json.loads(json.dumps(CONFIG, allow_nan=False))
    frozen = json.loads(json.dumps({'train': train, 'calibration': calibration, 'schema': schema}, allow_nan=False))
    train, calibration, schema = (frozen[k] for k in ('train', 'calibration', 'schema'))
    x, y, train_games = _cohort(train, 'train', schema)
    _, cy, cal_games = _cohort(calibration, 'calibration', schema)
    if (_day(train['window']['end']) >= _day(calibration['window']['start'])
            or set(train_games) & set(cal_games)):
        raise ValueError('Whole-game strictly later calibration separation required')
    if np.isnan(x).all(axis=0).any():
        raise ValueError('All-missing training feature has no train-only unknown value')
    fitted = FittedBaselines(schema, np.nanmedian(x, axis=0), float(y.mean()), None, None, None, {}, {}, {}, frozen_config)
    geometry, context = fitted._matrices([r['features'] for r in train['rows']])
    geometry_parameters = {**frozen_config['logistic'], 'random_state': frozen_config['seed']}
    calibration_parameters = {**geometry_parameters, 'C': frozen_config['calibration']['C']}
    with threadpool_limits(limits=frozen_config['threads']):
        fitted.geometry_scaler = StandardScaler().fit(geometry)
        fitted.geometry_model = _fit_logistic(fitted.geometry_scaler.transform(geometry), y, geometry_parameters)
        fitted.context_model = HistGradientBoostingClassifier(**frozen_config['context'], random_state=frozen_config['seed']).fit(context, y)
    common = {'schema': schema, 'medians': fitted.medians, 'unknown_policy': frozen_config['unknown_policy']}
    raw = {'prevalence': {**common, 'probability': fitted.prevalence},
           'geometry': {**common, 'scaler': fitted.geometry_scaler, 'model': fitted.geometry_model},
           'context': {**common, 'model': fitted.context_model}}
    fitted.artifacts = {name+'.pickle': pickle.dumps(model, protocol=5) for name, model in raw.items()}
    scores = fitted.predict([r['features'] for r in calibration['rows']], schema=schema, calibrated=False)
    for name, values in scores.items():
        p = np.clip(values, frozen_config['calibration']['epsilon'], 1-frozen_config['calibration']['epsilon'])
        logits = np.log(p)-np.log1p(-p)
        if np.ptp(logits) == 0:
            rate = float(cy.mean())
            parameters = {'intercept': math.log(rate)-math.log1p(-rate), 'slope': 0.0,
                          'kind': 'constant-score-calibration-prevalence'}
        else:
            with threadpool_limits(limits=frozen_config['threads']):
                model = _fit_logistic(logits.reshape(-1, 1), cy, calibration_parameters)
            parameters = {'intercept': float(model.intercept_[0]), 'slope': float(model.coef_[0, 0]),
                          'kind': frozen_config['calibration']['contract']}
        parameters['solver_parameters'] = calibration_parameters if np.ptp(logits) != 0 else None
        parameters['logit_epsilon'] = frozen_config['calibration']['epsilon']
        parameters.update(raw_model_sha256=hashlib.sha256(fitted.artifacts[name+'.pickle']).hexdigest(),
                          calibration_membership_sha256=calibration['membership_sha256'],
                          calibration_source_sha256=calibration['source_sha256'],
                          calibration_feature_sha256=calibration['feature_sha256'],
                          schema_sha256=fingerprint(schema))
        fitted.calibrators[name] = parameters
        fitted.artifacts[name+'-calibrator.json'] = json.dumps(parameters, sort_keys=True, allow_nan=False).encode()
    environment = {'python': platform.python_version(), 'numpy': np.__version__,
                   'scipy': scipy.__version__, 'sklearn': sklearn.__version__}
    body = {'contract': VERSION, 'status': 'fitted-not-evaluated-not-published', 'config': frozen_config,
            'code_sha256': code_sha256, 'code_hash_semantics': 'caller-verified-not-read-by-fit',
            'environment': environment, 'environment_sha256': fingerprint(environment),
            'schema': schema, 'schema_sha256': fingerprint(schema),
            'train': {k: v for k, v in train.items() if k != 'rows'},
            'calibration': {k: v for k, v in calibration.items() if k != 'rows'},
            'train_events': len(y), 'calibration_events': len(cy), 'train_prevalence': fitted.prevalence,
            'geometry_coefficients': fitted.geometry_model.coef_.tolist(),
            'geometry_intercept': fitted.geometry_model.intercept_.tolist(),
            'geometry_scaler_mean': fitted.geometry_scaler.mean_.tolist(),
            'geometry_scaler_scale': fitted.geometry_scaler.scale_.tolist(),
            'geometry_design_names': frozen_config['geometry_terms'] + ['distance_missing', 'angle_missing'],
            'context_design_names': schema['names'] + ['missing:'+name for name in schema['names']],
            'actual_geometry_parameters': fitted.geometry_model.get_params(),
            'actual_context_parameters': fitted.context_model.get_params(),
            'train_medians': fitted.medians.tolist(), 'calibrators': fitted.calibrators,
            'artifact_sha256': {k: hashlib.sha256(v).hexdigest() for k, v in fitted.artifacts.items()},
            'source_authentication': 'upstream-required', 'historical_as_of_verified': False,
            'test_data_accessed': False}
    body = json.loads(json.dumps(body, allow_nan=False))
    if CONFIG != frozen_config:
        raise ValueError('Fit configuration changed during fitting; no fitted receipt')
    fitted.receipt = {**body, 'receipt_sha256': fingerprint(body)}
    return fitted

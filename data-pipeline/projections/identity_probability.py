"""Earlier-period identity-conditioned probabilities, not neutral xG or GSAx.

Joint penalized Bernoulli offsets describe predictive associations. They do not
isolate causal skill from teammate, selection or unmeasured-context effects.
Missing/unseen identities get no identity effect; there is no learned NULL actor.
"""
from copy import deepcopy
from collections import Counter
from datetime import date
import math
import re

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit

from projections.analytics_publication import fingerprint

VERSION = 'citrus-identity-conditioned-probability-v1'
SETTINGS = {'global_ridge': 100., 'shooter_ridge': 25., 'goalie_ridge': 100.,
            'coefficient_bound': 1.5, 'max_rows': 150000, 'max_actors_per_role': 3000,
            'max_iterations': 1000, 'gradient_tolerance': 0.00005}
MODES = ('global_control', 'shooter', 'joint')
FIELDS = {'game_id', 'event_id', 'game_date', 'probability', 'shooter_id', 'goalie_id'}


def _id(value):
    return value is None or (type(value) is int and 1000000 <= value <= 9999999)


def validate_rows(rows):
    if not isinstance(rows, list) or not 0 < len(rows) <= SETTINGS['max_rows']:
        raise ValueError('Bounded nonempty prediction-time rows required')
    seen, games = set(), {}
    for row in rows:
        if not isinstance(row, dict) or set(row) != FIELDS:
            raise ValueError('Exact identity inputs required; targets are never prediction fields')
        gid, eid, day, p = (row[k] for k in ('game_id', 'event_id', 'game_date', 'probability'))
        if (type(gid) is not int or len(str(gid)) != 10 or gid // 1000000 < 1900
                or gid // 10000 % 100 not in (2, 3) or gid % 10000 == 0
                or type(eid) is not int or eid < 0 or (gid, eid) in seen):
            raise ValueError('Unique regular/playoff event identity required')
        if not isinstance(day, str) or date.fromisoformat(day).isoformat() != day:
            raise ValueError('Canonical ISO date required')
        if date.fromisoformat(day).year not in (gid // 1000000, gid // 1000000 + 1):
            raise ValueError('Date and season disagree')
        if gid in games and games[gid] != day:
            raise ValueError('One date per game required')
        games[gid] = day; seen.add((gid, eid))
        if type(p) not in (int, float) or not math.isfinite(p) or not 0 < p < 1:
            raise ValueError('Finite interior baseline probability required')
        if any(not _id(row[k]) for k in ('shooter_id', 'goalie_id')):
            raise ValueError('Canonical player IDs or explicit unavailable required')
    if rows != sorted(rows, key=lambda r: (r['game_date'], r['game_id'], r['event_id'])):
        raise ValueError('Canonical input order required')
    for key in ('shooter_id', 'goalie_id'):
        if len({r[key] for r in rows if r[key] is not None}) > SETTINGS['max_actors_per_role']:
            raise ValueError('Actor bound exceeded')


def _roles(mode):
    if mode not in MODES:
        raise ValueError('Fixed comparison mode required')
    return () if mode == 'global_control' else ('shooter',) if mode == 'shooter' else ('shooter', 'goalie')


def _design(rows, mode):
    vocabulary, indices, ridge = {}, {}, [SETTINGS['global_ridge']]
    for role in _roles(mode):
        vocabulary[role] = sorted({r[role + '_id'] for r in rows if r[role + '_id'] is not None})
        lookup = {pid: len(ridge) + i for i, pid in enumerate(vocabulary[role])}
        indices[role] = np.asarray([lookup.get(r[role + '_id'], -1) for r in rows], dtype=int)
        ridge.extend([SETTINGS[role + '_ridge']] * len(lookup))
    return vocabulary, indices, np.asarray(ridge)


def objective_gradient(coef, logits, targets, indices, ridge):
    """Sparse identity design: one intercept and at most two role effects per row."""
    eta = logits + coef[0]
    for ix in indices.values():
        known = ix >= 0
        eta[known] += coef[ix[known]]
    residual = expit(eta) - targets
    gradient = ridge * coef
    gradient[0] += residual.sum()
    for ix in indices.values():
        known = ix >= 0
        gradient += np.bincount(ix[known], weights=residual[known], minlength=len(coef))
    objective = np.sum(np.logaddexp(0, eta) - targets * eta) + .5 * np.dot(ridge, coef * coef)
    return float(objective), gradient


def _projected_gradient(coef, gradient):
    bound = SETTINGS['coefficient_bound']
    return np.where(coef <= -bound, np.minimum(gradient, 0),
                    np.where(coef >= bound, np.maximum(gradient, 0), gradient))


def fit(rows, targets, *, mode):
    validate_rows(rows)
    if (not isinstance(targets, list) or len(targets) != len(rows)
            or any(type(y) is not int or y not in (0, 1) for y in targets)):
        raise ValueError('Separate complete binary integer fit targets required')
    vocabulary, indices, ridge = _design(rows, mode)
    p = np.asarray([r['probability'] for r in rows]); logits = np.log(p) - np.log1p(-p)
    y = np.asarray(targets); bound = SETTINGS['coefficient_bound']
    args = (logits, y, indices, ridge)
    result = minimize(objective_gradient, np.zeros(len(ridge)), args=args, jac=True,
                      method='L-BFGS-B', bounds=[(-bound, bound)] * len(ridge),
                      options={'maxiter': SETTINGS['max_iterations'], 'ftol': 1e-15, 'gtol': 1e-8, 'maxls': 40})
    objective, gradient = objective_gradient(result.x, *args)
    projected = float(np.max(np.abs(_projected_gradient(result.x, gradient))))
    if (not result.success or not np.isfinite(result.x).all() or not math.isfinite(objective)
            or projected > SETTINGS['gradient_tolerance']):
        raise ValueError('Identity fit failed declared convergence gate')
    effects = {}; cursor = 1
    for role, ids in vocabulary.items():
        counts = Counter(r[role + '_id'] for r in rows)
        effects[role] = [{'player_id': pid, 'logit_effect': float(result.x[cursor + i]),
                          'fit_events': counts[pid]} for i, pid in enumerate(ids)]
        cursor += len(ids)
    body = {'contract': VERSION, 'mode': mode, 'settings': deepcopy(SETTINGS),
            'fit_rows_sha256': fingerprint(rows), 'fit_targets_sha256': fingerprint(targets),
            'fit_start': rows[0]['game_date'], 'fit_end': rows[-1]['game_date'],
            'fit_game_ids': sorted({r['game_id'] for r in rows}), 'fit_events': len(rows),
            'intercept': float(result.x[0]), 'effects': effects,
            'optimizer': {'method': 'L-BFGS-B', 'iterations': int(result.nit), 'success': True,
                          'objective': objective, 'max_projected_gradient': projected},
            'meaning': 'identity_conditioned_prediction_not_neutral_xg_or_causal_skill',
            'publishable': False, 'historical_as_of_verified': False}
    return {**body, 'model_sha256': fingerprint(body)}


def validate_model(model):
    fields = {'contract', 'mode', 'settings', 'fit_rows_sha256', 'fit_targets_sha256', 'fit_start', 'fit_end',
              'fit_game_ids', 'fit_events', 'intercept', 'effects', 'optimizer', 'meaning', 'publishable',
              'historical_as_of_verified', 'model_sha256'}
    if (not isinstance(model, dict) or set(model) != fields or model['contract'] != VERSION
            or model['settings'] != SETTINGS or model['publishable'] is not False
            or model['historical_as_of_verified'] is not False
            or model['meaning'] != 'identity_conditioned_prediction_not_neutral_xg_or_causal_skill'
            or model['model_sha256'] != fingerprint({k: v for k, v in model.items() if k != 'model_sha256'})):
        raise ValueError('Unchanged nonpromoting identity model required')
    if set(model['effects']) != set(_roles(model['mode'])):
        raise ValueError('Exact fitted role set required')
    if (any(not isinstance(model[k], str) for k in ('fit_start', 'fit_end'))
            or date.fromisoformat(model['fit_start']).isoformat() != model['fit_start']
            or date.fromisoformat(model['fit_end']).isoformat() != model['fit_end']
            or model['fit_start'] > model['fit_end']):
        raise ValueError('Canonical fit window required')
    if (any(not isinstance(model[k], str) or re.fullmatch('[0-9a-f]{64}', model[k]) is None
            for k in ('fit_rows_sha256', 'fit_targets_sha256'))
            or type(model['fit_events']) is not int or not 0 < model['fit_events'] <= SETTINGS['max_rows']
            or not isinstance(model['fit_game_ids'], list) or not model['fit_game_ids']
            or len(model['fit_game_ids']) > model['fit_events']
            or any(type(g) is not int or len(str(g)) != 10 or g // 1000000 < 1900
                   or g // 10000 % 100 not in (2, 3) or g % 10000 == 0 for g in model['fit_game_ids'])
            or model['fit_game_ids'] != sorted(set(model['fit_game_ids']))):
        raise ValueError('Bounded complete fit metadata required')
    optimum = model['optimizer']
    if (not isinstance(optimum, dict) or set(optimum) != {'method', 'iterations', 'success', 'objective', 'max_projected_gradient'}
            or optimum['method'] != 'L-BFGS-B' or optimum['success'] is not True
            or type(optimum['iterations']) is not int or not 0 <= optimum['iterations'] <= SETTINGS['max_iterations']
            or type(optimum['objective']) not in (int, float) or not math.isfinite(optimum['objective']) or optimum['objective'] < 0
            or type(optimum['max_projected_gradient']) not in (int, float)
            or not math.isfinite(optimum['max_projected_gradient'])
            or not 0 <= optimum['max_projected_gradient'] <= SETTINGS['gradient_tolerance']):
        raise ValueError('Declared converged fit required')
    def bounded(x):
        return type(x) in (int, float) and math.isfinite(x) and abs(x) <= SETTINGS['coefficient_bound']
    if not bounded(model['intercept']):
        raise ValueError('Bounded finite global effect required')
    for effect in model['effects'].values():
        if not isinstance(effect, list) or len(effect) > SETTINGS['max_actors_per_role']:
            raise ValueError('Bounded explicit role effects required')
        ids = []
        for row in effect:
            if (not isinstance(row, dict) or set(row) != {'player_id', 'logit_effect', 'fit_events'}
                    or row['player_id'] is None or not _id(row['player_id']) or not bounded(row['logit_effect'])
                    or type(row['fit_events']) is not int or not 0 < row['fit_events'] <= SETTINGS['max_rows']):
                raise ValueError('Finite unique positive-support effects required')
            ids.append(row['player_id'])
        if ids != sorted(set(ids)):
            raise ValueError('Unique canonical role effect IDs required')
    return model


def predict(model, rows):
    validate_model(model); validate_rows(rows)
    if (rows[0]['game_date'] <= model['fit_end']
            or {r['game_id'] for r in rows} & set(model['fit_game_ids'])):
        raise ValueError('Predictions must use whole games strictly after fitting')
    effects = {role: {r['player_id']: r['logit_effect'] for r in rr} for role, rr in model['effects'].items()}
    probabilities = []
    for row in rows:
        shift = model['intercept'] + sum(v.get(row[role + '_id'], 0.) for role, v in effects.items())
        p = row['probability']
        probabilities.append(p if shift == 0 else float(expit(math.log(p) - math.log1p(-p) + shift)))
    return probabilities

"""Prior-date-only intercept adaptation on a frozen base probability stream.

Retrospective simulation, not a historical-as-of or serving implementation.
Game date plus a declared lag SIMULATES label availability; real ingestion and
correction timestamps must be verified before production use. No raw model fit.
"""
from collections import defaultdict
from copy import deepcopy
from datetime import date, timedelta
import math

import numpy as np
from scipy.special import expit

from projections.analytics_publication import fingerprint

VERSION = 'citrus-prequential-intercept-v1'
SETTINGS = {'history_days': 60, 'label_lag_days': 2, 'min_events': 1000,
            'min_games': 20, 'ridge': 100.0, 'max_abs_offset': 1.5,
            'epsilon': 1e-6, 'bisection_iterations': 60, 'max_rows': 300000}
FIELDS = {'game_id', 'event_id', 'game_date', 'target', 'probability'}


def validate_settings(settings):
    if not isinstance(settings, dict) or set(settings) != set(SETTINGS):
        raise ValueError('Complete explicit adaptation settings required')
    for name, low, high in [('history_days', 1, 366), ('label_lag_days', 1, 30),
                           ('min_events', 1, 300000), ('min_games', 1, 5000),
                           ('bisection_iterations', 40, 100), ('max_rows', 1, 300000)]:
        if type(settings[name]) is not int or not low <= settings[name] <= high:
            raise ValueError('Invalid bounded setting: ' + name)
    for name, low, high in [('ridge', 0, 1000000), ('max_abs_offset', 0, 5), ('epsilon', 0, .01)]:
        x = settings[name]
        if type(x) not in (int, float) or not math.isfinite(x) or not low < x <= high:
            raise ValueError('Invalid finite setting: ' + name)


def _day(value):
    if not isinstance(value, str):
        raise ValueError('Explicit ISO game date required')
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError('Canonical game date required')
    return parsed


def _validate_rows(rows, settings, *, allow_empty):
    if not isinstance(rows, list) or not int(not allow_empty) <= len(rows) <= settings['max_rows']:
        raise ValueError('Bounded explicit rows required')
    seen, games = set(), {}
    for row in rows:
        if not isinstance(row, dict) or set(row) != FIELDS:
            raise ValueError('Exact prediction/identity/label fields required')
        gid, eid = row['game_id'], row['event_id']
        if (type(gid) is not int or len(str(gid)) != 10 or gid // 1000000 < 1900
                or gid // 10000 % 100 not in (2, 3) or gid % 10000 == 0
                or type(eid) is not int or eid < 0 or (gid, eid) in seen):
            raise ValueError('Unique regular/playoff event identity required')
        seen.add((gid, eid)); day = _day(row['game_date'])
        if day.year not in (gid // 1000000, gid // 1000000 + 1):
            raise ValueError('Game date and season identity conflict')
        if gid in games and games[gid] != day:
            raise ValueError('One date per game required')
        games[gid] = day
        p = row['probability']
        if type(p) not in (int, float) or not math.isfinite(p) or not 0 < p < 1:
            raise ValueError('Finite interior frozen probability required')
        if type(row['target']) is not int or row['target'] not in (0, 1):
            raise ValueError('Explicit binary integer target required')
    return seen, games


def fit_offset(probabilities, labels, settings):
    """Unique convex penalized Bernoulli intercept fit; no slope/search choice.

    min_a sum(log(1+exp(logit(p)+a))-y*(logit(p)+a)) + ridge*a²/2.
    Positive ridge makes the objective strictly convex even with one label class.
    """
    validate_settings(settings)
    if (not isinstance(probabilities, list) or not isinstance(labels, list)
            or not 0 < len(probabilities) == len(labels) <= settings['max_rows']
            or any(type(p) not in (int, float) or not math.isfinite(p) or not 0 < p < 1 for p in probabilities)
            or any(type(y) is not int or y not in (0, 1) for y in labels)):
        raise ValueError('Bounded finite probability and binary target vectors required')
    p = np.asarray(probabilities, dtype=float); y = np.asarray(labels, dtype=float)
    logits = np.log(p) - np.log1p(-p)
    def gradient(a):
        return float((expit(logits + a) - y).sum() + settings['ridge'] * a)
    low, high = -settings['max_abs_offset'], settings['max_abs_offset']
    if gradient(low) >= 0:
        offset, status = low, 'lower_bound_optimum'
    elif gradient(high) <= 0:
        offset, status = high, 'upper_bound_optimum'
    else:
        for _ in range(settings['bisection_iterations']):
            middle = (low + high) / 2
            if gradient(middle) > 0:
                high = middle
            else:
                low = middle
        offset, status = (low + high) / 2, 'interior_optimum'
    return {'offset': offset, 'status': status, 'gradient': gradient(offset),
            'objective': float((np.logaddexp(0, logits + offset) - y * (logits + offset)).sum()
                               + settings['ridge'] * offset * offset / 2)}


def predict_offset(probabilities, offset, settings):
    validate_settings(settings)
    if (type(offset) not in (int, float) or not math.isfinite(offset)
            or abs(offset) > settings['max_abs_offset'] or not isinstance(probabilities, list)
            or not 0 < len(probabilities) <= settings['max_rows']
            or any(type(p) not in (int, float) or not math.isfinite(p) or not 0 < p < 1 for p in probabilities)):
        raise ValueError('Bounded finite probability/offset required')
    if offset == 0:
        return list(probabilities)  # Exact frozen baseline during insufficient history.
    p = np.asarray(probabilities, dtype=float)
    return np.clip(expit(np.log(p) - np.log1p(-p) + offset),
                   settings['epsilon'], 1 - settings['epsilon']).tolist()


def simulate(seed_rows, validation_rows, *, settings=None):
    """Emit one locked state per target date before exposing eligible past labels.

    Includes history with target_date-lag-history_days < game_date <= target_date-lag.
    All same-date games share one state; input traversal order cannot leak labels.
    The runner separately proves frozen source membership and raw-model lineage.
    """
    settings = deepcopy(SETTINGS if settings is None else settings)
    validate_settings(settings)
    seed_ids, seed_games = _validate_rows(seed_rows, settings, allow_empty=True)
    validation_ids, validation_games = _validate_rows(validation_rows, settings, allow_empty=False)
    if len(seed_rows) + len(validation_rows) > settings['max_rows']:
        raise ValueError('Combined simulation row bound exceeded')
    if seed_ids & validation_ids or seed_games.keys() & validation_games.keys():
        raise ValueError('Seed and validation game identities must be disjoint')
    if seed_games and max(seed_games.values()) >= min(validation_games.values()):
        raise ValueError('All seed dates must precede validation')
    by_day, target_days = defaultdict(list), defaultdict(list)
    key = lambda r: (r['game_date'], r['game_id'], r['event_id'])
    for row in sorted(seed_rows + validation_rows, key=key):
        by_day[_day(row['game_date'])].append(row)
    for row in sorted(validation_rows, key=key):
        target_days[_day(row['game_date'])].append(row)
    all_days = sorted(by_day)
    output, states = [], []
    for target_day in sorted(target_days):
        cutoff = target_day - timedelta(days=settings['label_lag_days'])
        earliest = cutoff - timedelta(days=settings['history_days'])
        eligible_days = [day for day in all_days if earliest < day <= cutoff]
        history = [row for day in eligible_days for row in by_day[day]]
        games = sorted({r['game_id'] for r in history})
        if len(history) < settings['min_events'] or len(games) < settings['min_games']:
            fit = {'offset': 0.0, 'status': 'insufficient_history_frozen_baseline',
                   'gradient': None, 'objective': None}
        else:
            fit = fit_offset([r['probability'] for r in history], [r['target'] for r in history], settings)
        state = {'target_date': target_day.isoformat(), 'history_after_exclusive': earliest.isoformat(),
                 'history_through_inclusive': cutoff.isoformat(),
                 'latest_included_game_date': max(eligible_days).isoformat() if eligible_days else None,
                 'history_events': len(history), 'history_game_ids': games,
                 'history_rows_sha256': fingerprint(history), **fit, 'publishable': False}
        state['state_sha256'] = fingerprint(state); states.append(state)
        batch = target_days[target_day]
        predictions = predict_offset([r['probability'] for r in batch], fit['offset'], settings)
        for row, p in zip(batch, predictions):
            output.append({**deepcopy(row), 'adapted_probability': p, 'state_sha256': state['state_sha256']})
    return {'contract': VERSION, 'settings': settings, 'rows': output, 'states': states,
            'publishable': False, 'historical_as_of_verified': False,
            'label_availability': 'simulated_game_date_plus_lag_not_observed_ingestion_time'}

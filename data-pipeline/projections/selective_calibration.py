"""Conservative lagged intercept challenger with a game-residual L1 penalty.

The penalty is a fixed regularization choice, NOT a confidence guarantee. Its
floor prevents identical game residuals from producing a zero uncertainty scale.
All history and availability limitations of the frozen v1 simulation remain.
"""
from collections import defaultdict
from copy import deepcopy
from datetime import date, timedelta
import math

import numpy as np
from scipy.special import expit

from projections import prequential_calibration as prior
from projections.analytics_publication import fingerprint

VERSION = 'citrus-selective-prequential-intercept-v1'
SETTINGS = {**prior.SETTINGS, 'cluster_penalty_multiplier': 2.0}


def base_settings(settings):
    if not isinstance(settings, dict) or set(settings) != set(SETTINGS):
        raise ValueError('Exact selective settings required')
    base = {k: settings[k] for k in prior.SETTINGS}; prior.validate_settings(base)
    factor = settings['cluster_penalty_multiplier']
    if (type(factor) not in (int, float) or not math.isfinite(factor) or not 0 < factor <= 10
            or base['min_games'] < 2):
        raise ValueError('Positive bounded penalty and multiple games required')
    return base


def fit(history, settings):
    base = base_settings(settings); _, games = prior._validate_rows(history, base, allow_empty=True)
    empty = {'offset': 0., 'status': 'insufficient_history_frozen_baseline', 'penalty': None,
             'cluster_variance': None, 'bernoulli_variance_floor': None, 'gradient_at_zero': None,
             'objective': None, 'kkt_violation': None}
    if len(history) < base['min_events'] or len(games) < base['min_games']:
        return empty
    p = np.asarray([r['probability'] for r in history]); y = np.asarray([r['target'] for r in history])
    logits = np.log(p)-np.log1p(-p); residuals = defaultdict(list)
    for row, residual in zip(history, y-p): residuals[row['game_id']].append(float(residual))
    mean = float(np.mean(y-p)); g = len(residuals)
    cluster_variance = g/(g-1)*sum((math.fsum(rr)-len(rr)*mean)**2 for rr in residuals.values())
    floor = float(np.sum(p*(1-p)))
    penalty = settings['cluster_penalty_multiplier']*math.sqrt(max(cluster_variance, floor))
    def gradient(a): return float(np.sum(expit(logits+a)-y)+base['ridge']*a)
    zero = gradient(0.); bound = base['max_abs_offset']
    if abs(zero) <= penalty:
        offset, status = 0., 'zero_selected_by_penalty'
    else:
        sign = -1 if zero > 0 else 1
        def penalized(a): return gradient(a)+sign*penalty
        lo, hi = (-bound, 0.) if sign == -1 else (0., bound)
        if penalized(lo) >= 0:
            offset, status = lo, 'lower_bound_optimum'
        elif penalized(hi) <= 0:
            offset, status = hi, 'upper_bound_optimum'
        else:
            for _ in range(base['bisection_iterations']):
                middle = (lo+hi)/2
                if penalized(middle) > 0: hi = middle
                else: lo = middle
            offset, status = (lo+hi)/2, 'interior_optimum'
    derivative = gradient(offset) + (penalty if offset > 0 else -penalty if offset < 0 else 0.)
    kkt = (max(0., abs(zero)-penalty) if offset == 0 else max(0., -derivative) if offset == -bound
           else max(0., derivative) if offset == bound else abs(derivative))
    return {'offset': offset, 'status': status, 'penalty': penalty, 'cluster_variance': cluster_variance,
            'bernoulli_variance_floor': floor, 'gradient_at_zero': zero,
            'objective': float(np.sum(np.logaddexp(0, logits+offset)-y*(logits+offset))
                               +base['ridge']*offset*offset/2+penalty*abs(offset)), 'kkt_violation': kkt}


def simulate(seed_rows, validation_rows, *, settings=None):
    settings = deepcopy(SETTINGS if settings is None else settings); base = base_settings(settings)
    seed_ids, seed_games = prior._validate_rows(seed_rows, base, allow_empty=True)
    val_ids, val_games = prior._validate_rows(validation_rows, base, allow_empty=False)
    if len(seed_rows)+len(validation_rows) > base['max_rows'] or seed_ids & val_ids or seed_games.keys() & val_games.keys():
        raise ValueError('Bounded disjoint seed/validation games required')
    if seed_games and max(seed_games.values()) >= min(val_games.values()):
        raise ValueError('Seed must precede all validation dates')
    by_day, target_days = defaultdict(list), defaultdict(list)
    key = lambda r: (r['game_date'], r['game_id'], r['event_id'])
    for row in sorted(seed_rows+validation_rows, key=key): by_day[date.fromisoformat(row['game_date'])].append(row)
    for row in sorted(validation_rows, key=key): target_days[date.fromisoformat(row['game_date'])].append(row)
    days = sorted(by_day); states, rows = [], []
    for day in sorted(target_days):
        cutoff = day-timedelta(days=base['label_lag_days']); earliest = cutoff-timedelta(days=base['history_days'])
        eligible = [d for d in days if earliest < d <= cutoff]
        history = [r for d in eligible for r in by_day[d]]
        fitted = fit(history, settings)
        state = {'target_date': day.isoformat(), 'history_after_exclusive': earliest.isoformat(),
            'history_through_inclusive': cutoff.isoformat(),
            'latest_included_game_date': max(eligible).isoformat() if eligible else None,
            'history_events': len(history), 'history_game_ids': sorted({r['game_id'] for r in history}),
            'history_rows_sha256': fingerprint(history), **fitted, 'publishable': False}
        state['state_sha256'] = fingerprint(state); states.append(state)
        predictions = prior.predict_offset([r['probability'] for r in target_days[day]], fitted['offset'], base)
        rows.extend({**deepcopy(r), 'adapted_probability': p, 'state_sha256': state['state_sha256']}
                    for r,p in zip(target_days[day], predictions))
    return {'contract': VERSION, 'settings': settings, 'rows': rows, 'states': states, 'publishable': False,
            'historical_as_of_verified': False, 'label_availability': 'simulated_game_date_plus_lag_not_observed_ingestion_time'}

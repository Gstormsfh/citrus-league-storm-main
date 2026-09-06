"""Offline binary probability measurement with paired whole-game resampling.

No training, source authentication, artifact loading, deployment, or acceptance.
Callers must retain the prediction rows hashed here and establish their lineage
with the source/split/fit contracts. Input labels and predictions are declarations.
"""
import math
from copy import deepcopy
from collections import defaultdict
from itertools import combinations

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit

from projections.analytics_publication import fingerprint

VERSION = 'citrus-probability-scorecard-v1'
# Operational bounds for this local evaluator, not statistical-quality thresholds.
LIMITS = {'events': 1000000, 'models': 8, 'bins': 100, 'group_dimensions': 8,
          'labels_per_dimension': 128, 'bootstrap_scalar_cells': 20000000}
METRICS = ('brier', 'log_loss_clipped', 'roc_auc', 'average_precision',
           'mean_prediction', 'observed_rate', 'observed_minus_expected_rate')


def _finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def _config(config):
    required = {'bin_edges', 'log_loss_epsilon', 'resamples', 'seed',
                'confidence', 'min_games', 'min_events', 'min_valid_fraction'}
    if not isinstance(config, dict) or set(config) != required:
        raise ValueError('Explicit complete scorecard configuration required')
    edges = config['bin_edges']
    if (not isinstance(edges, list) or not 2 <= len(edges) <= LIMITS['bins'] + 1
            or not all(_finite(x) for x in edges)
            or edges[0] != 0 or edges[-1] != 1
            or any(a >= b for a, b in zip(edges, edges[1:]))):
        raise ValueError('Strict frozen probability bin edges from zero to one required')
    for key, low, high in [('resamples', 2, 10000), ('seed', 0, 2**32 - 1),
                           ('min_games', 2, 10000000), ('min_events', 1, 1000000000)]:
        if type(config[key]) is not int or not low <= config[key] <= high:
            raise ValueError('Invalid scorecard integer: ' + key)
    if not _finite(config['confidence']) or not 0 < config['confidence'] < 1:
        raise ValueError('Invalid scorecard confidence')
    if not _finite(config['min_valid_fraction']) or not 0 < config['min_valid_fraction'] <= 1:
        raise ValueError('Invalid scorecard valid-resample fraction')
    if (not _finite(config['log_loss_epsilon']) or not 0 < config['log_loss_epsilon'] < .5
            or 1 - config['log_loss_epsilon'] == 1):
        raise ValueError('Explicit finite log-loss clipping policy required')


class _Prepared:
    """Pre-sort ties once; game multiplicities become event weights, not IID draws."""

    def __init__(self, target, probability, edges, epsilon):
        self.y = np.asarray(target, dtype=float)
        self.p = np.asarray(probability, dtype=float)
        _, self.rank = np.unique(self.p, return_inverse=True)
        self.ranks = int(self.rank.max()) + 1
        clipped = np.clip(self.p, epsilon, 1 - epsilon)
        self.loss = -(self.y * np.log(clipped) + (1 - self.y) * np.log1p(-clipped))
        self.brier = (self.p - self.y)**2
        self.bin = np.minimum(np.searchsorted(edges, self.p, side='right') - 1, len(edges) - 2)
        self.bins = len(edges) - 1

    def score(self, weights):
        n = float(weights.sum())
        if not n:
            return np.full(len(METRICS), np.nan), np.full((self.bins, 3), np.nan)
        positives = float(weights @ self.y)
        negative = n - positives
        auc = ap = np.nan
        if positives > 0 and negative > 0:
            pos = np.bincount(self.rank, weights=weights * self.y, minlength=self.ranks)
            neg = np.bincount(self.rank, weights=weights * (1 - self.y), minlength=self.ranks)
            # Tied probabilities earn half of positive-negative pair credit.
            auc = float(pos @ (np.cumsum(neg) - .5 * neg) / (positives * negative))
            pos_desc, neg_desc = pos[::-1], neg[::-1]
            total = np.cumsum(pos_desc + neg_desc)
            precision = np.divide(np.cumsum(pos_desc), total, out=np.zeros_like(total), where=total > 0)
            # Noninterpolated recall-increment average precision, NOT trapezoidal PR AUC.
            ap = float(precision @ pos_desc / positives)
        predicted = float(weights @ self.p / n)
        observed = positives / n
        scores = np.array([weights @ self.brier / n, weights @ self.loss / n, auc, ap,
                           predicted, observed, observed - predicted])
        counts = np.bincount(self.bin, weights=weights, minlength=self.bins)
        totals = np.stack([np.bincount(self.bin, weights=weights * field, minlength=self.bins)
                           for field in (self.p, self.y, self.y - self.p)], axis=1)
        reliability = np.divide(totals, counts[:, None], out=np.full_like(totals, np.nan),
                                where=counts[:, None] > 0)
        return scores, reliability


def _calibration_diagnostic(y, p):
    """Unpenalized intercept/slope diagnostic, not a deployable calibrator.

    No clipping for this fit. Boundary/constant/separated cases explicitly abstain.
    Intervals for this diagnostic are not implemented in this first scorecard.
    """
    result = {'status': 'unavailable', 'intercept': None, 'slope': None,
              'uncertainty': 'not_computed', 'purpose': 'retrospective_diagnostic_not_calibrator'}
    if len(np.unique(y)) != 2:
        return {**result, 'reason': 'single_outcome_class'}
    if np.any((p == 0) | (p == 1)):
        return {**result, 'reason': 'boundary_probabilities_no_finite_logit'}
    x = np.log(p) - np.log1p(-p)
    if float(np.var(x)) <= 1e-12:
        return {**result, 'reason': 'constant_or_nearly_constant_predictor'}
    if max(x[y == 0]) <= min(x[y == 1]) or max(x[y == 1]) <= min(x[y == 0]):
        return {**result, 'reason': 'complete_or_quasi_separation'}
    design = np.column_stack((np.ones(len(x)), x))

    def objective(beta):
        z = design @ beta
        return float(np.mean(np.logaddexp(0, z) - y * z))

    def gradient(beta):
        return design.T @ (expit(design @ beta) - y) / len(y)

    fit = minimize(objective, np.array([0., 1.]), jac=gradient, method='BFGS',
                   options={'gtol': 1e-8, 'maxiter': 300})
    fitted = expit(design @ fit.x)
    hessian = design.T @ (design * (fitted * (1 - fitted))[:, None]) / len(y)
    if (not fit.success or not np.all(np.isfinite(fit.x))
            or float(np.linalg.eigvalsh(hessian).min()) <= 1e-10):
        return {**result, 'reason': 'fit_failed_or_ill_conditioned'}
    return {**result, 'status': 'estimated', 'reason': None,
            'intercept': float(fit.x[0]), 'slope': float(fit.x[1])}


def _interval(samples, config, sufficient):
    valid = samples[np.isfinite(samples)]
    result = {'valid_resamples': len(valid), 'invalid_resamples': len(samples) - len(valid),
              'not_computed_resamples': config['resamples'] - len(samples),
              'lower': None, 'upper': None, 'status': 'insufficient_evidence'}
    if not sufficient:
        return {**result, 'reason': 'sparse_original_cohort'}
    if len(valid) < max(2, math.ceil(len(samples) * config['min_valid_fraction'])):
        return {**result, 'reason': 'too_many_undefined_resamples'}
    alpha = (1 - config['confidence']) / 2
    limits = np.quantile(valid, [alpha, 1 - alpha], method='linear')
    return {**result, 'status': 'estimated', 'reason': None,
            'lower': float(limits[0]), 'upper': float(limits[1])}


def _number(value):
    return float(value) if np.isfinite(value) else None


def _cohort(rows, model_names, config, *, all_game_ids):
    game_index = {gid: index for index, gid in enumerate(all_game_ids)}
    membership = np.array([game_index[row['game_id']] for row in rows])
    n, games = len(rows), len(set(membership))
    sufficient = n >= config['min_events'] and games >= config['min_games']
    targets = np.array([row['target'] for row in rows], dtype=float)
    prepared = {name: _Prepared(targets, [row['predictions'][name] for row in rows],
                               config['bin_edges'], config['log_loss_epsilon']) for name in model_names}
    point = {name: value.score(np.ones(n)) for name, value in prepared.items()}
    draws = config['resamples'] if sufficient else 0
    samples = {name: np.empty((draws, len(METRICS))) for name in model_names}
    bins = {name: np.empty((draws, len(config['bin_edges']) - 1, 3)) for name in model_names}
    # Restarting this deterministic RNG for each subgroup deliberately reuses
    # the SAME full-cohort game draws. No subgroup-specific independent samples.
    rng = np.random.default_rng(config['seed'])
    for draw in range(draws):
        multiplicity = np.bincount(rng.integers(0, len(all_game_ids), len(all_game_ids)),
                                  minlength=len(all_game_ids))
        weights = multiplicity[membership].astype(float)
        for name, value in prepared.items():
            samples[name][draw], bins[name][draw] = value.score(weights)
    models = {}
    for name, value in prepared.items():
        scores, reliability = point[name]
        expected_total = float(value.p.sum())
        ratio = float(targets.sum()) / expected_total if expected_total > 0 else None
        ratio_reason = 'zero_expected_total' if ratio is None else None
        if ratio is not None and not math.isfinite(ratio):
            ratio, ratio_reason = None, 'ratio_not_representable_as_finite_float64'
        model = {'metrics': {metric: {'value': _number(scores[i]),
                    'interval': _interval(samples[name][:, i], config, sufficient)}
                    for i, metric in enumerate(METRICS)}, 'reliability': [],
                 'calibration_intercept_slope': _calibration_diagnostic(targets, value.p),
                 'expected_goals': expected_total,
                 'observed_over_expected': ratio, 'observed_over_expected_unavailable_reason': ratio_reason,
                 'clipped_prediction_count': int(np.sum((value.p < config['log_loss_epsilon'])
                                                         | (value.p > 1 - config['log_loss_epsilon']))),
                 'impossible_observation_count': int(np.sum(((value.p == 0) & (targets == 1))
                                                            | ((value.p == 1) & (targets == 0))))}
        model['unclipped_log_loss_status'] = 'infinite' if model['impossible_observation_count'] else 'finite'
        for index, (lower, upper) in enumerate(zip(config['bin_edges'], config['bin_edges'][1:])):
            mask = value.bin == index
            count, cluster_count = int(mask.sum()), len(set(membership[mask]))
            bin_sufficient = count >= config['min_events'] and cluster_count >= config['min_games']
            model['reliability'].append({'lower': lower, 'upper': upper,
                'upper_inclusive': index == value.bins - 1, 'events': count, 'games': cluster_count,
                **{metric: {'value': _number(reliability[index, col]),
                            'interval': _interval(bins[name][:, index, col], config, bin_sufficient)}
                   for col, metric in enumerate(('mean_prediction', 'observed_rate', 'gap'))}})
        models[name] = model
    differences = []
    for left, right in combinations(model_names, 2):
        differences.append({'left': left, 'right': right, 'direction': 'left_minus_right',
            'metrics': {metric: {'value': _number(point[left][0][i] - point[right][0][i]),
                'interval': _interval(samples[left][:, i] - samples[right][:, i], config, sufficient)}
                for i, metric in enumerate(METRICS)}})
    return {'events': n, 'games': games, 'goals': int(targets.sum()),
            'status': 'measured' if sufficient else 'descriptive_only_sparse_cohort',
            'models': models, 'paired_differences': differences}


def probability_scorecard(rows, *, config, evidence_kind, lineage):
    """Measure exactly matched neutral-goal predictions, preserving unknown groups.

    Strict rows: game_id, event_id, target (integer 0/1), predictions (same named
    models on EVERY row), groups (same dimensions, string or None). Missing peer
    predictions fail; explicit matched-cohort selection belongs upstream and must
    retain its exclusions. ``lineage`` binds SHA-256s for rows/source/split and
    each complete model pipeline; hashes are declarations, not execution proof.
    """
    if not isinstance(rows, list) or not 1 <= len(rows) <= LIMITS['events']:
        raise ValueError('Prediction population exceeds local evaluator bounds or is empty')
    # Detach caller objects without JSON's implicit conversion of integer keys.
    rows, config, lineage = deepcopy((rows, config, lineage))
    _config(config)
    if evidence_kind not in ('real', 'synthetic'):
        raise ValueError('Nonempty rows and explicit evidence kind required')
    if (not isinstance(lineage, dict) or set(lineage) !=
            {'prediction_rows_sha256', 'source_manifest_sha256', 'split_sha256', 'pipelines'}):
        raise ValueError('Explicit prediction/source/split/pipeline lineage required')
    names, group_names, seen, canonical = None, None, set(), []
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'game_id', 'event_id', 'target', 'predictions', 'groups'}:
            raise ValueError('Unknown or missing prediction-row fields')
        gid, eid = row['game_id'], row['event_id']
        if (type(gid) is not int or len(str(gid)) != 10 or gid // 1000000 < 1900
                or gid // 10000 % 100 not in (2, 3) or gid % 10000 == 0
                or type(eid) is not int or eid < 0 or (gid, eid) in seen):
            raise ValueError('Duplicate/invalid event identity')
        seen.add((gid, eid))
        if type(row['target']) is not int or row['target'] not in (0, 1):
            raise ValueError('Explicit binary integer target required')
        predictions, groups = row['predictions'], row['groups']
        if (not isinstance(predictions, dict) or not predictions
                or any(not isinstance(key, str) or not key.strip() for key in predictions)
                or any(not _finite(p) or not 0 <= p <= 1 for p in predictions.values())):
            raise ValueError('Every model requires a finite probability on every event')
        if (not isinstance(groups, dict)
                or any(not isinstance(key, str) or not key.strip() for key in groups)
                or any(value is not None and (not isinstance(value, str) or not value.strip()) for value in groups.values())):
            raise ValueError('Explicit named group dimensions and unknown-as-None required')
        if names is None:
            names, group_names = sorted(predictions), sorted(groups)
            if len(names) > LIMITS['models'] or len(group_names) > LIMITS['group_dimensions']:
                raise ValueError('Model/group dimensions exceed local evaluator bounds')
        if sorted(predictions) != names or sorted(groups) != group_names:
            raise ValueError('Identical matched prediction/group inventory required')
        canonical.append(row)
    canonical.sort(key=lambda row: (row['game_id'], row['event_id']))
    if not isinstance(lineage['pipelines'], dict) or sorted(lineage['pipelines']) != names:
        raise ValueError('Exact named model-pipeline inventory required')
    hashes = [lineage[key] for key in ('prediction_rows_sha256', 'source_manifest_sha256', 'split_sha256')]
    hashes.extend(lineage['pipelines'].values())
    if any(not isinstance(sha, str) or len(sha) != 64 or any(x not in '0123456789abcdef' for x in sha) for sha in hashes):
        raise ValueError('Explicit SHA-256 lineage hashes required')
    if fingerprint(canonical) != lineage['prediction_rows_sha256']:
        raise ValueError('Prediction rows do not match declared immutable inventory')
    if (len(names) * config['resamples'] * (len(METRICS) + 3 * (len(config['bin_edges']) - 1))
            > LIMITS['bootstrap_scalar_cells']):
        raise ValueError('Bootstrap arrays exceed local evaluator allocation bound')
    for dimension in group_names:
        if len({row['groups'][dimension] for row in canonical}) > LIMITS['labels_per_dimension']:
            raise ValueError('Group cardinality exceeds local evaluator bounds')
    all_game_ids = sorted({row['game_id'] for row in canonical})
    overall = _cohort(canonical, names, config, all_game_ids=all_game_ids)
    subgroups = []
    for dimension in group_names:
        members = defaultdict(list)
        for row in canonical:
            members[row['groups'][dimension]].append(row)
        for label in sorted(members, key=lambda value: (value is not None, value or '')):
            subgroups.append({'dimension': dimension, 'value': label,
                'statistics': _cohort(members[label], names, config, all_game_ids=all_game_ids)})
    body = {'contract': VERSION, 'status': 'measured_not_model_acceptance',
            'evidence_kind': evidence_kind, 'publishable': False,
            'source_authenticity_verified': False, 'fit_or_split_execution_verified': False,
            'prediction_scope': 'neutral_goal_probability_on_declared_matched_event_population',
            'config': config, 'lineage': lineage, 'overall': overall, 'subgroups': subgroups,
            'operational_limits': dict(LIMITS),
            'resampling': {'method': 'paired_whole_game_percentile', 'game_ids': all_game_ids,
                'rng': 'numpy.default_rng.PCG64', 'numpy_version': np.__version__,
                'quantile_method': 'linear', 'weighting': 'event_weighted_with_whole_games_resampled',
                'subgroups': 'same_full_cohort_game_draws_unknown_groups_retained'},
            'limitations': ['Declared hashes do not prove source, fit, chronology, rights or neutral conditioning.',
                'Rows and upstream exclusions must be retained outside this report.',
                'Retrospective diagnostics are not fitted serving calibrators.',
                'Intercept/slope uncertainty is not computed.',
                'Percentile intervals are marginal, not multiplicity-adjusted or generalization guarantees.',
                'Single-class discrimination is unavailable; every undefined resample is counted.',
                'No quality threshold or automatic serving promotion is implemented.']}
    return {**body, 'report_sha256': fingerprint(body)}

"""Synthetic mathematical/contract tests; not model quality evidence."""
from copy import deepcopy
import json

import numpy as np
import pytest
from sklearn.metrics import average_precision_score, brier_score_loss, log_loss, roc_auc_score

from projections.analytics_publication import fingerprint
from projections.probability_scorecard import (
    METRICS, _Prepared, _calibration_diagnostic, probability_scorecard,
)


def fixture():
    rows = []
    for game in range(4):
        for event, (target, p) in enumerate([(0, .1), (1, .2), (0, .2), (1, .8)]):
            rows.append({'game_id': 2025020001 + game, 'event_id': event,
                         'target': target, 'predictions': {'base': .5, 'context': p},
                         'groups': {'rink': None if game == 0 else 'RINK', 'shot_type': 'wrist'}})
    return rows


def config():
    return {'bin_edges': [0, .2, .5, 1], 'log_loss_epsilon': 1e-12,
            'resamples': 25, 'seed': 17, 'confidence': .9,
            'min_games': 2, 'min_events': 2, 'min_valid_fraction': .8}


def evaluate(rows=None, **kwargs):
    rows = fixture() if rows is None else rows
    lineage = {'prediction_rows_sha256': fingerprint(sorted(rows, key=lambda r: (r['game_id'], r['event_id']))),
               'source_manifest_sha256': 'a'*64, 'split_sha256': 'b'*64,
               'pipelines': {'base': 'c'*64, 'context': 'd'*64}}
    return probability_scorecard(rows, config=kwargs.pop('config', config()),
                                 evidence_kind='synthetic', lineage=kwargs.pop('lineage', lineage), **kwargs)


def test_metrics_match_independent_library_with_ties_and_weights():
    rng = np.random.default_rng(331)
    for size in (10, 200):
        y = rng.integers(0, 2, size)
        p = rng.choice([.05, .2, .5, .9], size)
        weights = rng.integers(0, 5, size).astype(float)
        got, _ = _Prepared(y, p, [0, .1, .5, 1], 1e-12).score(weights)
        assert got[0] == pytest.approx(brier_score_loss(y, p, sample_weight=weights))
        assert got[1] == pytest.approx(log_loss(y, p, sample_weight=weights, labels=[0, 1]))
        assert got[2] == pytest.approx(roc_auc_score(y, p, sample_weight=weights))
        assert got[3] == pytest.approx(average_precision_score(y, p, sample_weight=weights))


def test_deterministic_nonmutating_hash_bound_and_unknown_groups_preserved():
    rows = fixture(); before = deepcopy(rows)
    got = evaluate(rows)
    assert got == evaluate(list(reversed(rows))) and rows == before
    assert got['report_sha256'] == fingerprint({key: val for key, val in got.items() if key != 'report_sha256'})
    assert not got['publishable'] and not got['fit_or_split_execution_verified']
    assert not got['source_authenticity_verified']
    assert got['overall']['events'] == 16 and got['overall']['games'] == 4
    unknown = next(row for row in got['subgroups'] if row['dimension'] == 'rink' and row['value'] is None)
    assert unknown['statistics']['events'] == 4
    assert unknown['statistics']['status'] == 'descriptive_only_sparse_cohort'
    assert json.loads(json.dumps(got, allow_nan=False)) == got


def test_whole_game_bootstrap_matches_explicit_duplicated_games_and_paired_differences():
    rows = fixture()
    # Different game sizes and target mixes reveal accidental IID-row sampling.
    rows = [row for row in rows if row['game_id'] != 2025020004 or row['event_id'] == 0]
    got = evaluate(rows)
    gids = sorted({row['game_id'] for row in rows})
    rng = np.random.default_rng(config()['seed'])
    base, context, differences = [], [], []
    for _ in range(config()['resamples']):
        drawn = rng.integers(0, len(gids), len(gids))
        duplicated = [row for index in drawn for row in rows if row['game_id'] == gids[index]]
        scores = {name: np.mean([(row['predictions'][name] - row['target'])**2 for row in duplicated])
                  for name in ('base', 'context')}
        base.append(scores['base']); context.append(scores['context'])
        differences.append(scores['base'] - scores['context'])
    for name, samples in [('base', base), ('context', context)]:
        interval = got['overall']['models'][name]['metrics']['brier']['interval']
        assert [interval['lower'], interval['upper']] == pytest.approx(np.quantile(samples, [.05, .95]))
    paired = got['overall']['paired_differences'][0]['metrics']['brier']['interval']
    assert [paired['lower'], paired['upper']] == pytest.approx(np.quantile(differences, [.05, .95]))


def test_identical_models_have_exact_zero_paired_intervals():
    rows = fixture()
    for row in rows: row['predictions']['base'] = row['predictions']['context']
    differences = evaluate(rows)['overall']['paired_differences'][0]['metrics']
    for metric in METRICS:
        assert differences[metric]['value'] == 0
        assert differences[metric]['interval']['lower'] == 0
        assert differences[metric]['interval']['upper'] == 0


def test_boundary_clipping_is_explicit_brier_not_clipped_and_empty_bins_retained():
    rows = fixture()
    for row in rows:
        row['predictions'] = {'base': 0., 'context': 1.}
    result = evaluate(rows)
    for name in ('base', 'context'):
        item = result['overall']['models'][name]
        assert item['clipped_prediction_count'] == 16
        assert item['impossible_observation_count'] == 8
        assert item['unclipped_log_loss_status'] == 'infinite'
        assert item['metrics']['brier']['value'] == .5
        assert item['metrics']['log_loss_clipped']['value'] > 10
        assert item['calibration_intercept_slope']['reason'] == 'boundary_probabilities_no_finite_logit'
        assert len(item['reliability']) == 3
        assert sum(row['events'] for row in item['reliability']) == 16
        empty = next(row for row in item['reliability'] if row['events'] == 0)
        assert empty['observed_rate']['value'] is None
    assert result['overall']['models']['context']['reliability'][-1]['upper_inclusive']


def test_single_class_and_degenerate_bootstraps_are_reported_not_dropped():
    rows = fixture()
    for row in rows: row['target'] = 0
    item = evaluate(rows)['overall']['models']['context']
    for metric in ('roc_auc', 'average_precision'):
        assert item['metrics'][metric]['value'] is None
        assert item['metrics'][metric]['interval']['valid_resamples'] == 0
        assert item['metrics'][metric]['interval']['invalid_resamples'] == 25
    assert item['metrics']['brier']['interval']['status'] == 'estimated'
    assert item['calibration_intercept_slope']['reason'] == 'single_outcome_class'


def test_calibration_diagnostic_estimates_without_regularization_and_abstains():
    # At each logit, exactly the indicated rate; true diagnostic is (0, 1).
    y = np.array([0]*8 + [1]*2 + [0]*5 + [1]*5 + [0]*2 + [1]*8, dtype=float)
    p = np.array([.2]*10 + [.5]*10 + [.8]*10)
    got = _calibration_diagnostic(y, p)
    assert got['status'] == 'estimated'
    assert got['intercept'] == pytest.approx(0, abs=1e-8)
    assert got['slope'] == pytest.approx(1, abs=1e-8)
    assert got['uncertainty'] == 'not_computed'
    assert _calibration_diagnostic(y, np.full(len(y), .5))['reason'] == 'constant_or_nearly_constant_predictor'
    assert _calibration_diagnostic(np.array([0, 0, 1, 1]), np.array([.1, .2, .8, .9]))['reason'] == 'complete_or_quasi_separation'


@pytest.mark.parametrize('mutation', ['duplicate', 'bool_target', 'bad_probability', 'nan_probability',
    'missing_model', 'missing_group', 'bad_group', 'extra_field', 'bad_game', 'bad_event'])
def test_invalid_event_or_cohort_membership_fails(mutation):
    rows = fixture()
    if mutation == 'duplicate': rows.append(deepcopy(rows[0]))
    elif mutation == 'bool_target': rows[0]['target'] = True
    elif mutation == 'bad_probability': rows[0]['predictions']['base'] = 1.1
    elif mutation == 'nan_probability': rows[0]['predictions']['base'] = float('nan')
    elif mutation == 'missing_model': del rows[0]['predictions']['base']
    elif mutation == 'missing_group': del rows[0]['groups']['rink']
    elif mutation == 'bad_group': rows[0]['groups']['rink'] = 12
    elif mutation == 'extra_field': rows[0]['assist_id'] = 7
    elif mutation == 'bad_game': rows[0]['game_id'] = 2025020000
    elif mutation == 'bad_event': rows[0]['event_id'] = True
    with pytest.raises(ValueError): evaluate(rows)


@pytest.mark.parametrize('key,value', [('bin_edges', [0, .5, .5, 1]), ('bin_edges', [0, .5]),
    ('bin_edges', [False, 1]), ('log_loss_epsilon', 0), ('log_loss_epsilon', float('inf')),
    ('log_loss_epsilon', 1e-100), ('resamples', 1),
    ('resamples', True), ('seed', -1), ('confidence', 1), ('min_games', 1), ('min_valid_fraction', 0)])
def test_invalid_configuration_rejected(key, value):
    cfg = config(); cfg[key] = value
    with pytest.raises(ValueError): evaluate(config=cfg)


def test_changed_prediction_or_unbound_pipeline_fails():
    rows = fixture()
    lineage = evaluate(rows)['lineage']
    changed = deepcopy(rows); changed[0]['predictions']['base'] = .3
    with pytest.raises(ValueError, match='immutable'): evaluate(changed, lineage=lineage)
    bad = deepcopy(lineage); del bad['pipelines']['context']
    with pytest.raises(ValueError, match='inventory'): evaluate(rows, lineage=bad)


def test_returned_configuration_and_lineage_detached_from_caller():
    rows = fixture(); cfg = config(); lineage = evaluate(rows)['lineage']
    report = evaluate(rows, config=cfg, lineage=lineage)
    before = deepcopy(report)
    cfg['bin_edges'][1] = .3
    lineage['pipelines']['base'] = 'e'*64
    assert report == before


def test_finite_subnormal_probabilities_do_not_overflow_report():
    rows = fixture()
    for row in rows: row['predictions']['base'] = 5e-324
    report = evaluate(rows)
    base = report['overall']['models']['base']
    assert base['observed_over_expected'] is None
    assert base['observed_over_expected_unavailable_reason'] == 'ratio_not_representable_as_finite_float64'
    assert base['metrics']['brier']['value'] == .5
    json.dumps(report, allow_nan=False)


def test_integer_model_keys_not_coerced_to_strings():
    rows = fixture()
    for row in rows: row['predictions'] = {1: .5, 'context': .3}
    with pytest.raises(ValueError):
        probability_scorecard(rows, config=config(), evidence_kind='synthetic', lineage=evaluate()['lineage'])


def test_sparse_groups_do_not_run_unusable_bootstrap_draws():
    report = evaluate()
    unknown = next(row for row in report['subgroups'] if row['dimension'] == 'rink' and row['value'] is None)
    interval = unknown['statistics']['models']['base']['metrics']['brier']['interval']
    assert interval['not_computed_resamples'] == config()['resamples']
    assert interval['valid_resamples'] == interval['invalid_resamples'] == 0
    assert interval['reason'] == 'sparse_original_cohort'


def test_resource_shape_bounds_fail_before_bootstrap_allocation():
    cfg = config(); cfg['bin_edges'] = np.linspace(0, 1, 102).tolist()
    with pytest.raises(ValueError): evaluate(config=cfg)
    rows = fixture()
    for row in rows: row['predictions'] = {str(i): .5 for i in range(9)}
    with pytest.raises(ValueError, match='bounds'):
        probability_scorecard(rows, config=config(), evidence_kind='synthetic', lineage=evaluate()['lineage'])

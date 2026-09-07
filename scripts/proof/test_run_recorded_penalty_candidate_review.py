"""Independent synthetic runner gates. Never fit a real-data candidate."""
from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import run_recorded_penalty_candidate as m
from projections import recorded_penalty_features as feature_module


def test_both_fold_resource_checks_finish_before_any_fit(tmp_path, monkeypatch):
    root = m.ROOT
    plan = json.loads((root / m.PLAN).read_text())
    monkeypatch.setattr(m, 'ROOT', tmp_path)
    (tmp_path / 'scripts/proof/results').mkdir(parents=True)
    output = tmp_path / 'scripts/proof/results/official-recorded-penalty-synthetic'
    config = {'context': plan['fit']['context'], 'seed': plan['fit']['seed'],
              'scorecard': plan['evaluation']['scorecard']}
    folds = {f: {'train': {'rows': []}} for f in ('fold1', 'fold2')}
    features = SimpleNamespace(config=config, schema={}, folds=folds, groups={}, cache_key='synthetic',
                               closure=SimpleNamespace(checked={}, inventories={}))
    class Closure:
        def __init__(self, *args): self.checked = {m.PLAN: feature_module.PLAN_SHA}
        def read(self, name): return deepcopy(plan)
        def mapping(self, value): pass
        def pin(self, *args): pass
    monkeypatch.setattr(m.reuse, 'Closure', Closure)
    monkeypatch.setattr(m, 'code_hashes', lambda: {})
    monkeypatch.setattr(m.reuse, 'load', lambda root: features)
    monkeypatch.setattr(feature_module, 'load', lambda base, root: features)
    monkeypatch.setattr(m.development, '_preflight_bounds', lambda *args: None)
    calls = []
    def bound(*args):
        calls.append('preflight')
        if len(calls) == 2: raise ValueError('synthetic fold2 resource bound')
        return {}, {'total_cells': 1}
    monkeypatch.setattr(m.development, '_vocabulary_and_design_bound', bound)
    def forbidden_fit(*args, **kwargs):
        pytest.fail('Model constructed before both folds passed resource checks')
    monkeypatch.setattr(m, 'HistGradientBoostingClassifier', forbidden_fit)
    with pytest.raises(ValueError, match='fold2 resource'):
        m.run(output)
    assert calls == ['preflight', 'preflight']
    failure = json.loads((output / 'failure.json').read_text())
    assert failure['completed_folds'] == []
    assert (output / 'input-declaration.json').exists()
    assert not (output / 'declaration.json').exists()


def controls_fixture(monkeypatch):
    schema = {'names': ['a'], 'categorical_names': ['shot_type']}
    rows = [dict(game_id=2019020001, event_id=i, label=0, features=[.2],
                 categorical={'shot_type': None}) for i in (1, 2)]
    groups = {'rows': [dict(game_id=r['game_id'], event_id=r['event_id'],
                           groups={'strength': None}) for r in rows]}
    saved = [dict(game_id=r['game_id'], event_id=r['event_id'], target=0, groups={'strength': None},
                  predictions={'movement_raw': .1, 'conditional_shape': .2,
                               'frozen_monotone_group': .3}) for r in rows]
    def read(path):
        if path.endswith('predictions.json'): return saved
        if path.endswith('model.json'): return {'design': {'schema': schema}}
        return {'conditional_shape': {}, 'monotone_logit_group': {}}
    monkeypatch.setattr(m.portable, 'predict_rows', lambda *args: np.array([.1, .1]))
    monkeypatch.setattr(m.conditional, 'predict', lambda *args: np.array([.2, .2]))
    monkeypatch.setattr(m.calibration_shape, 'predict', lambda *args: np.array([.3, .3]))
    monkeypatch.setattr(m.calibration_candidate, 'context_from_row', lambda *args: {})
    return SimpleNamespace(read=read), rows, schema, groups


def test_controls_preserve_unknown_groups_and_exact_values(monkeypatch):
    closure, rows, schema, groups = controls_fixture(monkeypatch)
    values, actual_groups = m.checked_controls(closure, 'fold1', rows, schema, groups)
    assert actual_groups[(2019020001, 1)]['strength'] is None
    np.testing.assert_array_equal(values['frozen_conditional_shape'], [.2, .2])
    np.testing.assert_array_equal(values['frozen_monotone_group'], [.3, .3])


def test_duplicate_frozen_group_rows_rejected(monkeypatch):
    closure, rows, schema, groups = controls_fixture(monkeypatch)
    groups['rows'].append(deepcopy(groups['rows'][0]))
    with pytest.raises(ValueError):
        m.checked_controls(closure, 'fold1', rows, schema, groups)


def test_extra_recomputed_control_predictions_rejected(monkeypatch):
    closure, rows, schema, groups = controls_fixture(monkeypatch)
    monkeypatch.setattr(m.conditional, 'predict', lambda *args: np.array([.2, .2, .2]))
    with pytest.raises(ValueError):
        m.checked_controls(closure, 'fold1', rows, schema, groups)


@pytest.mark.parametrize('control', m.CONTROLS)
@pytest.mark.parametrize('metric', m.METRICS)
def test_no_cross_control_or_cross_metric_compensation(control, metric):
    losses = {name: {key: .2 for key in m.METRICS} for name in (m.PRIMARY, *m.CONTROLS)}
    losses[m.PRIMARY] = {key: .1 for key in m.METRICS}
    losses[control][metric] = .1 - 1e-15
    assert m.primary_passed(losses) is False


def test_no_nan_or_boolean_loss_guard_success():
    losses = {name: {key: .2 for key in m.METRICS} for name in (m.PRIMARY, *m.CONTROLS)}
    for value in (float('nan'), float('inf'), True):
        corrupted = deepcopy(losses)
        corrupted[m.PRIMARY]['brier'] = value
        assert m.primary_passed(corrupted) is False


@pytest.mark.parametrize('actual,expected,count', [
    ([float('nan')], [.1], 1), ([.1], [float('nan')], 1),
    ([.1, .2], [.1], 1), ([[.1]], [.1], 1),
    ([], [], 0), ([True], [.1], 1), ([1.1], [1.1], 1),
    ([.1], [.1 + 2e-12], 1)])
def test_independent_comparison_is_finite_bounded_exact_membership(actual, expected, count):
    with pytest.raises(ValueError):
        m.maximum_error(actual, expected, count)


def test_small_rounding_reported_not_called_exact():
    a = np.array([.1, .2])
    b = np.nextafter(a, 1.)
    error = m.maximum_error(a, b, 2)
    assert 0 < error < 1e-12

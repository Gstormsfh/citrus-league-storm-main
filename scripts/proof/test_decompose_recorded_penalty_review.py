"""Independent analytic/bootstrap tests of no-fit paired loss accounting."""
from copy import deepcopy
import math

import numpy as np
import pytest
import decompose_recorded_penalty as m


def joined():
    return [dict(key=(1, 1), target=0, p=[.1, .2, .2, .3], cell=[5, None, 'a', 'b']),
            dict(key=(1, 2), target=1, p=[.6, .21, .7, .3], cell=[5, None, 'a', 'b']),
            dict(key=(2, 1), target=0, p=[.1, .1, .1, .1], cell=[4, 'other', 'c', 'd'])]


def test_scalar_loss_algebra_and_telescoping():
    rows = joined()
    actual = m.loss_deltas(rows)
    for i, r in enumerate(rows):
        losses = []
        for p in r['p']:
            clipped = min(1 - m.EPSILON, max(m.EPSILON, p))
            losses.append([(p-r['target'])**2,
                           -(r['target']*math.log(clipped)+(1-r['target'])*math.log1p(-clipped))])
        for j in range(2):
            total, raw = losses[3][j]-losses[1][j], losses[2][j]-losses[0][j]
            np.testing.assert_allclose(actual[i, j], [total, raw, total-raw], rtol=0, atol=1e-15)
            assert abs(actual[i, j, 0]-sum(actual[i, j, 1:])) < 1e-15


def test_shared_game_weights_different_denominators_and_empty_cell(monkeypatch):
    rows = joined()
    weights = np.array([[2, 0], [0, 2], [1, 1], [1, 1]])
    calls = []
    class Rng:
        def multinomial(self, n, p, size):
            calls.append((n, size))
            assert n == 2 and size == 4
            return weights.copy()
    monkeypatch.setattr(m.np.random, 'default_rng', lambda seed: Rng())
    result = m.decomposition(rows, draws=4)
    assert calls == [(2, 4)]  # same draws reused across all cells/components
    a = next(c for c in result['cells'] if c['cell'][1] is None)
    assert a['events'] == 2 and a['games'] == 1 and a['zero_event_draws'] == 1
    delta = m.loss_deltas(rows)
    totals = weights @ np.array([2, 1])
    for j, metric in enumerate(m.METRICS):
        for k, component in enumerate(m.COMPONENTS):
            per_game = np.array([delta[:2, j, k].sum(), 0.])
            sums = weights @ per_game
            expected_contribution = sums / totals
            expected_means = sums[[0, 2, 3]] / np.array([4, 2, 2])
            observed = a['metrics'][metric][component]
            np.testing.assert_allclose(observed['weighted_contribution_ci95'],
                                       np.quantile(expected_contribution, [.025, .975]), atol=1e-15)
            np.testing.assert_allclose(observed['mean_delta_ci95_nonempty_draws'],
                                       np.quantile(expected_means, [.025, .975]), atol=1e-15)
            assert abs(observed['weighted_contribution']-delta[:2, j, k].sum()/3) < 1e-15
            assert abs(sum(c['metrics'][metric][component]['weighted_contribution'] for c in result['cells'])
                       -result['overall']['metrics'][metric][component]['mean_delta']) < 1e-15


def test_fixed_seed_determinism_permutation_and_no_mutation():
    rows = joined()
    before = deepcopy(rows)
    first = m.decomposition(rows, draws=16, seed=42)
    second = m.decomposition(rows[::-1], draws=16, seed=42)
    assert first == second
    assert rows == before


@pytest.mark.parametrize('p,expected', [(0, 0), (.01, 1), (.025, 2), (.1, 4), (.75, 8), (1, 8)])
def test_fixed_bin_edges_and_last_inclusive(p, expected):
    assert m.band(p) == expected


def sources(event_id=1):
    groups = {'prior_sog_same_team': None}
    predictions = {'frozen_conditional_shape': .05, 'recorded_penalty_raw': .6,
                   'recorded_penalty_conditional_shape': .7}
    row = dict(game_id=1, event_id=event_id, target=0, groups=groups, predictions=predictions)
    diag = {**deepcopy(row), 'groups': {'recorded_penalty_same_team__annotation_state':
        'unavailable:no_recorded_penalty_in_current_period',
        'recorded_penalty_opponent__annotation_state': 'recorded:type_known:duration_known'}}
    prior = {**deepcopy(row), 'predictions': {'movement_raw': .04, 'conditional_shape': .05}}
    return [row], [diag], [prior]


def test_anchor_is_old_calibrated_not_new_probability():
    result = m.matched(*sources())[0]
    assert result['cell'][0] == m.band(.05)
    assert result['p'] == [.04, .05, .6, .7]
    assert result['cell'][1] is None


def test_zero_event_id_matches_upstream_identity_contract():
    assert m.matched(*sources(0))[0]['key'] == (1, 0)


@pytest.mark.parametrize('index', [0, 1, 2])
def test_every_source_duplicate_or_target_drift_fails(index):
    data = list(sources())
    data[index].append(deepcopy(data[index][0]))
    with pytest.raises(ValueError):
        m.matched(*data)
    data = list(sources())
    data[index][0]['target'] = 1
    with pytest.raises(ValueError):
        m.matched(*data)

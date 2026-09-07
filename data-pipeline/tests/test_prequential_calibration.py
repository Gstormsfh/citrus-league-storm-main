from copy import deepcopy
from datetime import date, timedelta
import math

import pytest

from projections import prequential_calibration as c


def settings(**kwargs):
    return {**c.SETTINGS, 'min_events': 2, 'min_games': 1, 'history_days': 5, 'ridge': 2., **kwargs}


def row(day=1, game=1, event=1, p=.5, y=0):
    return {'game_id': 2022020000 + game, 'event_id': event,
            'game_date': (date(2022, 10, 1) + timedelta(days=day-1)).isoformat(),
            'probability': p, 'target': y}


def probabilities(result):
    return [(r['game_id'], r['event_id'], r['adapted_probability'], r['state_sha256']) for r in result['rows']]


def test_balanced_symmetric_fit_is_identity():
    result = c.fit_offset([.5, .5], [0, 1], settings())
    assert abs(result['offset']) < 1e-12
    assert abs(result['gradient']) < 1e-12
    assert result['status'] == 'interior_optimum'


@pytest.mark.parametrize('y,sign', [(0, -1), (1, 1)])
def test_single_class_history_finite_penalized_optimum(y, sign):
    result = c.fit_offset([.5]*100, [y]*100, settings())
    assert math.isfinite(result['objective']) and result['offset'] * sign > 0
    assert result['status'] == ('lower_bound_optimum' if y == 0 else 'upper_bound_optimum')
    assert result['gradient'] * sign <= 0


def test_unconstrained_optimum_gradient_and_improvement():
    result = c.fit_offset([.2]*100, [0]*90+[1]*10, settings(ridge=100.))
    assert result['offset'] < 0 and abs(result['gradient']) < 1e-10
    objective_zero = -90*math.log(.8)-10*math.log(.2)
    assert result['objective'] < objective_zero


def test_sparse_history_returns_exact_baseline_not_zero_or_clipped():
    result = c.simulate([], [row(p=1e-12)], settings=settings())
    assert result['rows'][0]['adapted_probability'] == 1e-12
    assert result['states'][0]['status'] == 'insufficient_history_frozen_baseline'
    assert result['states'][0]['latest_included_game_date'] is None
    assert result['publishable'] is False and result['historical_as_of_verified'] is False


def test_lag_window_exact_boundaries_and_same_date_batch():
    seed = [row(day=1, game=1), row(day=2, game=2), row(day=6, game=3), row(day=7, game=4)]
    validation = [row(day=8, game=5), row(day=8, game=6), row(day=10, game=7)]
    result = c.simulate(seed, validation, settings=settings())
    state = result['states'][0]
    assert state['history_game_ids'] == [2022020002, 2022020003]  # (day 1, day 6]
    assert state['history_events'] == 2 and state['history_through_inclusive'] == '2022-10-06'
    assert len({r['state_sha256'] for r in result['rows'][:2]}) == 1
    assert result['states'][1]['history_game_ids'] == [2022020003, 2022020004, 2022020005, 2022020006]


def test_future_and_same_date_targets_cannot_change_earlier_predictions():
    seed = [row(day=1, game=1), row(day=1, game=1, event=2)]
    validation = [row(day=d, game=d) for d in range(3, 12)]
    before = c.simulate(seed, validation, settings=settings())
    changed = deepcopy(validation)
    for r in changed:
        if r['game_date'] >= '2022-10-06': r['target'] = 1-r['target']
    after = c.simulate(seed, changed, settings=settings())
    assert before['states'][:4] == after['states'][:4]
    assert probabilities(before)[:4] == probabilities(after)[:4]
    assert probabilities(before)[-1] != probabilities(after)[-1]


def test_prior_labels_do_affect_later_state_and_inputs_not_mutated():
    seed = [row(), row(event=2)]
    validation = [row(day=3, game=2)]
    original = deepcopy((seed, validation)); a = c.simulate(seed, validation, settings=settings())
    assert (seed, validation) == original
    seed[0]['target'] = seed[1]['target'] = 1
    b = c.simulate(seed, validation, settings=settings())
    assert a['rows'][0]['adapted_probability'] < .5 < b['rows'][0]['adapted_probability']


def test_input_traversal_order_cannot_change_results():
    seed = [row(), row(event=2)]
    validation = [row(day=d, game=d) for d in range(3, 10)]
    assert c.simulate(seed, validation, settings=settings()) == c.simulate(seed[::-1], validation[::-1], settings=settings())


@pytest.mark.parametrize('kind', ['seed_overlap', 'same_game_split', 'seed_late', 'date_conflict', 'duplicate', 'empty_validation', 'resource'])
def test_invalid_memberships_fail(kind):
    seed = [row(), row(event=2)]; validation = [row(day=3, game=2)]
    cfg = settings()
    if kind == 'seed_overlap': validation.append(deepcopy(seed[0]))
    elif kind == 'same_game_split': validation.append(row(game=1, event=3, day=3))
    elif kind == 'seed_late': seed[0]['game_date'] = '2022-10-04'; seed[1]['game_date'] = '2022-10-04'
    elif kind == 'date_conflict': seed[1]['game_date'] = '2022-10-02'
    elif kind == 'duplicate': validation.append(deepcopy(validation[0]))
    elif kind == 'empty_validation': validation = []
    else: cfg['max_rows'] = 2
    with pytest.raises(ValueError): c.simulate(seed, validation, settings=cfg)


@pytest.mark.parametrize('p', [0, 1, -.1, 1.1, float('nan'), float('inf'), True, '.5', None])
def test_invalid_probability_rejected(p):
    with pytest.raises(ValueError): c.simulate([], [row(p=p)], settings=settings())
    with pytest.raises(ValueError): c.fit_offset([p], [0], settings())
    with pytest.raises(ValueError): c.predict_offset([p], 0, settings())


@pytest.mark.parametrize('y', [True, .0, 2, -1, None, '0'])
def test_invalid_labels_rejected(y):
    with pytest.raises(ValueError): c.simulate([], [row(y=y)], settings=settings())


@pytest.mark.parametrize('key,value', [('label_lag_days', 0), ('label_lag_days', True), ('ridge', 0),
    ('ridge', float('nan')), ('history_days', 500), ('epsilon', .5), ('min_games', .5), ('bisection_iterations', 1)])
def test_invalid_settings_rejected(key, value):
    with pytest.raises(ValueError): c.simulate([], [row()], settings=settings(**{key: value}))


@pytest.mark.parametrize('date_value', ['2022-02-30', '20221001', '2022-10-01T00:00:00', None, '2024-10-01'])
def test_invalid_or_conflicting_date_rejected(date_value):
    r = row(); r['game_date'] = date_value
    with pytest.raises(ValueError): c.simulate([], [r], settings=settings())


def test_rank_monotonicity_and_fixed_bounds():
    result = c.predict_offset([1e-12, .01, .5, .99, 1-1e-12], 1.5, settings())
    assert result == sorted(result)
    assert all(c.SETTINGS['epsilon'] <= p <= 1-c.SETTINGS['epsilon'] for p in result)

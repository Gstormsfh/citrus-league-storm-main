from copy import deepcopy
import pytest
from test_composed_xg import fixture
from test_recent_timing_inference import sidecar
from recent_timing_inference import RecentCandidate
from selected_timing_candidate import SelectedCandidate, choose


def shape(s):
    result = deepcopy(s['fit'])
    for b in result['bands'].values():
        del b['offset']
        b.update(intercept=0., slope_delta=0., mean_logit=0., projected_gradient=0.)
    return result


def history(**changes):
    return [{'game_id': 99, 'event_id': 1, 'game_date': '2022-12-01',
             'target': 0, 'population': 'original', 'recent_xg': .3, 'shape_xg': .1, **changes}]


def test_empty_tie_and_improvement():
    assert choose([]) is False
    assert choose(history()) is True
    assert choose(history(shape_xg=.3)) is False
    assert choose(history(shape_xg=.5)) is False


def test_exact_reference_and_no_caller_override(fixture):
    base, row = fixture
    s = sidecar(base)
    recent = RecentCandidate(base, s)
    c = SelectedCandidate(recent, shape(s), [])
    assert c.predict([row])[0]['neutral_xg'] == recent.predict([row])[0]['neutral_xg']
    assert c.predict([row]) == c.predict([{**row, 'band': 'same_clock', 'target': 999}])


@pytest.mark.parametrize('changes', [{'population': 'recovered'}, {'game_date': '2023-01-01'}])
def test_selection_contamination_rejected(fixture, changes):
    base, _ = fixture
    s = sidecar(base)
    with pytest.raises(ValueError):
        SelectedCandidate(RecentCandidate(base, s), shape(s), history(**changes))


def test_selected_shape_does_not_double_apply_recent(fixture):
    base, row = fixture
    s = sidecar(base)
    s['fit']['bands']['up_to_1s'] = {'offset': -1., 'events': 30, 'games': 10,
        'training_keys': [[i//3+100, i] for i in range(30)], 'training_end': '2022-12-31'}
    recent = RecentCandidate(base, s)
    c = SelectedCandidate(recent, shape(s), history())
    p = c.predict([row])[0]
    assert p['neutral_xg'] == p['baseline_neutral_xg']
    assert p['recent_xg'] < p['neutral_xg']
    assert p['publishable'] is False


def test_invalid_sparse_shape_rejected(fixture):
    base, _ = fixture
    s = sidecar(base)
    f = shape(s)
    f['bands']['same_clock']['intercept'] = 1.
    with pytest.raises(ValueError):
        SelectedCandidate(RecentCandidate(base, s), f, [])

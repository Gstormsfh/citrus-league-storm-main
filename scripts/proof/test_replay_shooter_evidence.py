from copy import deepcopy
import pytest
from replay_shooter_evidence import aggregate, inference_error


def fixture():
    records = [dict(game_id=2025020001, event_id=i, target=i%2, shooter_id=8478402 if i else None, probability=.2) for i in range(3)]
    predictions = [{**r, 'predictions': {'frozen_monotone': .2, 'global_control': .21, 'shooter': .25}} for r in records]
    return records, predictions


def test_totals_unknown_actor_and_immutable_inputs():
    r,p = fixture(); before = deepcopy((r,p))
    result = aggregate(r,p)
    assert result['overall']['conditional_expected_goals']['shooter'] == .75
    assert result['overall']['observed_goals'] == 1
    assert result['players'][0]['shooter_id'] is None
    assert result['overall']['shot_mix_specific_shooter_to_neutral_ratio'] == pytest.approx(1.25)
    assert (r,p) == before
    assert result == aggregate(r[::-1], p[::-1])


@pytest.mark.parametrize('mutation', ['duplicate','missing','target','baseline','nan'])
def test_corruption_rejected(mutation):
    r,p = fixture()
    if mutation == 'duplicate': p.append(deepcopy(p[0]))
    if mutation == 'missing': r.pop()
    if mutation == 'target': p[0]['target'] = 1
    if mutation == 'baseline': r[0]['probability'] = .3
    if mutation == 'nan': p[0]['predictions']['shooter'] = float('nan')
    with pytest.raises(ValueError): aggregate(r,p)


@pytest.mark.parametrize('value', [True, 1.0, -1])
@pytest.mark.parametrize('side', [0,1])
def test_identity_aliases_rejected(value, side):
    data = fixture()
    data[side][1]['event_id'] = value
    with pytest.raises(ValueError): aggregate(*data)


@pytest.mark.parametrize('actual', [[.25], [.25]*4, [float('nan')]*3, [True]*3, [float('inf')]*3])
def test_invalid_replay_outputs_rejected(actual):
    r,p = fixture()
    saved = {(x['game_id'], x['event_id']): x for x in p}
    with pytest.raises(ValueError): inference_error(r, actual, saved, 'shooter')


def test_exact_replay_outputs():
    r,p = fixture()
    saved = {(x['game_id'], x['event_id']): x for x in p}
    assert inference_error(r, [.25]*3, saved, 'shooter') == 0

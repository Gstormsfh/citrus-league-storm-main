from copy import deepcopy
import pytest
from prior_sog_fidelity import classify
from projections.development_feature_export import prefix_measurements


def play(code=506, owner=1, clock='00:10'):
    return {'eventId': 1, 'sortOrder': 1, 'typeCode': code, 'timeInPeriod': clock,
            'periodDescriptor': {'number': 1, 'periodType': 'REG'},
            'homeTeamDefendingSide': 'left',
            'details': {'eventOwnerTeamId': owner, 'xCoord': 70, 'yCoord': 5, 'shotType': 'wrist'}}


@pytest.mark.parametrize('code,owner,state', [(506,1,'1'),(506,2,'0'),(502,1,'0'),
    (503,1,'0'),(504,1,'0'),(507,1,'0'),(508,1,'0'),(525,1,'0'),
    (505,1,None),(509,1,None),(516,None,None),(506,None,None),(506,True,None)])
def test_state_agrees_with_original_projector(code, owner, state):
    current, previous = play(clock='00:12'), play(code,owner)
    base = {'coordinates': {k: {'value': v, 'reason': None} for k,v in [('x_attacking',70),('y_attacking',5)]},
            'features': {'signed_angle_deg': 15}}
    original = prefix_measurements(current,previous,None,home=1,away=2,base_row=base)
    value = original['values']['immediate_previous_sog_same_team']
    assert classify(current,previous,1,2)['expected_state'] == state == (None if value is None else str(value))


@pytest.mark.parametrize('second,band', [(10,'same_clock'),(11,'up_to_1s'),
    (12,'over_1_under_3s'),(13,'from_3_to_10s'),(20,'from_3_to_10s'),(21,'over_10s')])
def test_gap_boundaries_do_not_change_state(second,band):
    result = classify(play(clock=f'00:{second:02}'),play(),1,2)
    assert result['gap_band'] == band and result['expected_state'] == '1'


def test_boundary_and_missing_facts_are_not_conflated():
    current, previous = play(clock='00:12'), play(509,None)
    current['details'].pop('xCoord'); previous.pop('homeTeamDefendingSide')
    result = classify(current,previous,1,2)
    assert result['reason'] == 'prior_type_outside_baseline_live_set'
    assert not result['facts']['prior_owner_known'] and not result['facts']['current_coordinates_usable']
    assert not result['facts']['prior_side_known']


def test_current_outcome_and_future_payload_do_not_change_classification():
    current, previous = play(clock='00:12'), play()
    expected = classify(current,previous,1,2)
    current['typeCode'] = 505; current['details']['scoringPlayerId'] = 42
    current['future'] = [{'typeCode': 505}]
    assert classify(current,previous,1,2) == expected


def test_period_boundary_no_previous_and_no_mutation():
    current, previous = play(), play(clock='19:59')
    current['periodDescriptor']['number'] = 2
    old = deepcopy((current,previous))
    assert classify(current,previous,1,2)['reason'] == 'predecessor_other_period'
    assert classify(current,None,1,2)['reason'] == 'no_raw_predecessor'
    assert (current,previous) == old


@pytest.mark.parametrize('mutation', ['negative','bad_clock','bool_team','same_team','bad_period','bad_prior_code'])
def test_invalid_inputs_fail(mutation):
    current, previous, home, away = play(clock='00:12'), play(), 1, 2
    if mutation == 'negative': current['timeInPeriod'] = '00:09'
    if mutation == 'bad_clock': current['timeInPeriod'] = '0:12'
    if mutation == 'bool_team': home = True
    if mutation == 'same_team': away = home
    if mutation == 'bad_period': current['periodDescriptor']['number'] = True
    if mutation == 'bad_prior_code': previous['typeCode'] = True
    with pytest.raises(ValueError): classify(current,previous,home,away)

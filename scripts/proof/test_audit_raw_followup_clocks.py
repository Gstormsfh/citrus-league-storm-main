from copy import deepcopy
import pytest
import audit_raw_followup_clocks as m


def fixture():
    p = {'eventId': 1, 'typeCode': 506, 'periodDescriptor': {'number':1,'periodType':'REG'},
         'timeInPeriod':'01:00','timeRemaining':'19:00',
         'details': {'eventOwnerTeamId':1,'shootingPlayerId':2,'xCoord':75,'yCoord':10}}
    q = deepcopy(p); q.update(eventId=2,timeInPeriod='01:01',timeRemaining='18:59')
    return q,p


def test_raw_gap_and_remaining_clock_agree():
    q,p = fixture(); out = m.pair(q,p,1)
    assert out['remaining_clock_consistent'] is True
    assert out['same_shooter'] and out['same_recorded_coordinates']


@pytest.mark.parametrize('field,value', [('typeCode',505),('timeInPeriod','00:59')])
def test_wrong_previous_event_or_gap_rejected(field,value):
    q,p = fixture(); p[field] = value
    with pytest.raises(ValueError): m.pair(q,p,1)


def test_goal_actor_and_missing_coordinates_are_not_assumed_duplicates():
    q,p = fixture(); q['typeCode']=505; q['details']['scoringPlayerId']=3; q['details'].pop('xCoord')
    out=m.pair(q,p,1)
    assert not out['same_shooter'] and not out['same_recorded_coordinates']


def test_period_boundary_rejected():
    q,p=fixture(); q['periodDescriptor']['number']=2
    with pytest.raises(ValueError): m.pair(q,p,1)

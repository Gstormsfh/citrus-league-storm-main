from copy import deepcopy
import pytest
from projections import event_memory_features as f


def event(i, second, code=506, team=1, **kwargs):
    return {'eventId': i, 'timeInPeriod': f'00:{second:02}', 'typeCode': code,
            'periodDescriptor': {'number': 1, 'periodType': 'REG'},
            'situationCode': '1551', 'homeTeamDefendingSide': 'left',
            'details': {'eventOwnerTeamId': team, 'xCoord': 70, 'yCoord': 10}, **kwargs}


def project(rows): return f.project(rows, home=1, away=2)


def test_memory_uses_earlier_attempt_across_intervening_live_event():
    rows = [event(1,0,520), event(2,1), event(3,2,503), event(4,4)]
    v=project(rows)[4]
    assert v[:5] == [1,0,2,0,3] and v[5:7] == [0,0] and v[7] == 4


def test_current_goal_label_and_future_events_cannot_change_current_features():
    rows = [event(1,0,520),event(2,1),event(3,2)]
    expected=project(rows)[3]
    rows[2]['typeCode']=505
    rows.append(event(4,3,509))
    assert project(rows)[3] == expected


@pytest.mark.parametrize('code', [502,505,509,516,521,999])
def test_boundaries_do_not_skip_back_to_prior_shot(code):
    v=project([event(1,0,520),event(2,1),event(3,2,code),event(4,3)])[4]
    assert v[4:7] == [None]*3
    assert v[:4] == ([None]*4 if code==999 else [0]*4)


def test_window_boundary_and_opponent_are_exact():
    v=project([event(1,0,520),event(2,1,506,2),event(3,2),event(4,12)])[4]
    assert v[:4] == [1,0,1,0]


def test_incomplete_origin_is_missing_not_zero():
    assert project([event(1,1)])[1][:4] == [None]*4


def test_unknown_owner_invalidates_window_until_boundary():
    rows=[event(1,0,520),event(2,1,503,None),event(3,2),event(4,3,502),event(5,4)]
    result=project(rows)
    assert result[3][:4] == [None]*4 and result[5][:4] == [0]*4


def test_observed_strength_age_is_not_assumed_powerplay_start():
    rows=[event(1,0,520),event(2,4,situationCode='1541'),event(3,7,situationCode='1541')]
    result=project(rows)
    assert result[2][7] is None and result[3][7] == 3


def test_period_reset_and_same_clock_history():
    rows=[event(1,0,520),event(2,1),event(3,1)]
    assert project(rows)[3][4] == 0
    rows.append(event(4,0,periodDescriptor={'number':2,'periodType':'REG'}))
    assert project(rows)[4] == [None]*8


@pytest.mark.parametrize('kind', ['duplicate','reverse','bad_clock'])
def test_bad_order_or_identity_rejected(kind):
    rows=[event(1,1),event(2,2)]
    if kind=='duplicate': rows[1]['eventId']=1
    elif kind=='reverse': rows.reverse()
    else: rows[1]['timeInPeriod']='00:99'
    with pytest.raises(ValueError): project(rows)


def test_missing_geometry_stays_missing_without_changing_counts():
    rows=[event(1,0,520),event(2,1),event(3,2)]
    rows[1]['details']['xCoord']=None
    result=project(rows)[3]
    assert result[:5] == [1,0,1,0,1] and result[5:7] == [None,None]

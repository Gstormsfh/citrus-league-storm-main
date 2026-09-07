from copy import deepcopy
import pytest
from projections.pre_shot_history import project


def event(eid, code=506, owner=1, second=None, point=(70, 15), side='left', period=1):
    second = eid if second is None else second
    details = {'eventOwnerTeamId': owner}
    if point is not None:
        details.update(xCoord=point[0], yCoord=point[1])
    return {'eventId': eid, 'sortOrder': eid, 'typeCode': code,
            'timeInPeriod': f'{second // 60:02d}:{second % 60:02d}',
            'periodDescriptor': {'number': period, 'periodType': 'REG'},
            'homeTeamDefendingSide': side, 'details': details}


def run(events):
    return project(events, home=1, away=2)


def test_pointer_precedes_current_and_distinct_contexts():
    rows = run([event(1), event(2, code=503), event(3)])
    assert rows[3]['immediate_recorded_live_event']['prior_event_id'] == 2
    assert rows[3]['prior_same_team_unblocked_attempt']['prior_event_id'] == 1
    assert rows[1]['prior_same_team_unblocked_attempt']['prior_event_id'] is None


def test_current_goal_and_future_invariance_no_mutations():
    events = [event(1), event(2), event(3)]
    original = deepcopy(events)
    prefix = run(events[:2])[2]
    assert run(events)[2] == prefix
    goal = deepcopy(events)
    goal[1]['typeCode'] = 505
    assert run(goal)[2] == prefix
    assert run(goal)[3]['immediate_recorded_live_event']['prior_event_id'] is None
    assert events == original


@pytest.mark.parametrize('code', [502, 509, 516, 520, 521, 523, 524, 999, 505, None, True])
def test_boundaries_clear_both_contexts(code):
    row = run([event(1), event(2, code=code), event(3)])[3]
    assert all(pair['prior_event_id'] is None for key, pair in row.items() if isinstance(pair, dict))


@pytest.mark.parametrize('owner', [None, 99, True])
def test_unknown_owner_clears_history_and_withholds_current(owner):
    rows = run([event(1), event(2, owner=owner), event(3)])
    assert rows[2]['immediate_recorded_live_event']['prior_event_id'] is None
    assert rows[3]['prior_same_team_unblocked_attempt']['prior_event_id'] is None


def test_opponent_is_immediate_context_but_breaks_same_team_attempt():
    row = run([event(1), event(2, code=503, owner=2), event(3)])[3]
    assert row['immediate_recorded_live_event']['prior_owner_relation'] == 'opponent'
    assert row['prior_same_team_unblocked_attempt']['prior_event_id'] is None


def test_common_frame_keeps_cross_center_origin():
    pair = run([event(1, point=(-10, -20)), event(2, point=(70, 20))])[2]['immediate_recorded_live_event']
    assert pair['values']['event_lateral_displacement_ft'] == 40
    assert pair['values']['event_crossed_centerline'] == 1


def test_rotation_invariance():
    a = run([event(1, point=(65, -15)), event(2, point=(75, 15))])[2]
    b = run([event(1, point=(-65, 15), side='right'), event(2, point=(-75, -15), side='right')])[2]
    assert a == b


@pytest.mark.parametrize('side', [None, 'right', 'unknown'])
def test_prior_missing_or_conflicting_orientation_withholds_geometry(side):
    pair = run([event(1, side=side), event(2)])[2]['immediate_recorded_live_event']
    assert pair['values']['event_elapsed_seconds'] == 1
    assert pair['values']['event_lateral_displacement_ft'] is None


def test_missing_point_does_not_select_older_complete_event():
    pair = run([event(1), event(2, point=None), event(3)])[3]['prior_same_team_unblocked_attempt']
    assert pair['prior_event_id'] == 2
    assert pair['values']['event_lateral_displacement_ft'] is None


@pytest.mark.parametrize('point', [(10 ** 1000, 0), (0, -(10 ** 1000))])
def test_huge_integer_coordinate_is_missing_not_overflow(point):
    pair = run([event(1, point=point), event(2)])[2]['immediate_recorded_live_event']
    assert pair['prior_event_id'] == 1
    assert pair['values']['event_displacement_ft'] is None
    assert pair['values']['event_elapsed_seconds'] == 1


def test_same_clock_rates_missing_and_zero_coordinate_valid():
    pair = run([event(1, second=1, point=(-70, 0), side='right'),
                event(2, second=1, point=(-80, 0), side='right')])[2]['immediate_recorded_live_event']
    assert pair['values']['event_lateral_displacement_ft'] == 0
    assert pair['values']['event_angular_rate_deg_per_second'] is None
    assert pair['values']['event_lateral_rate_ft_per_second'] is None


def test_period_change_and_shootout_withhold():
    events = [event(1), event(2, second=0, period=2), event(3, period=2)]
    assert run(events)[2]['immediate_recorded_live_event']['prior_event_id'] is None
    events[2]['periodDescriptor'] = {'number': 3, 'periodType': 'SO'}
    assert run(events)[3]['immediate_recorded_live_event']['prior_event_id'] is None


@pytest.mark.parametrize('change', ['duplicate', 'order', 'clock', 'type', 'seconds', 'owner_bool'])
def test_invalid_contract_rejected(change):
    events = [event(1), event(2)]
    kwargs = {'home': 1, 'away': 2}
    if change == 'duplicate': events[1]['eventId'] = 1
    if change == 'order': events[1]['sortOrder'] = 1
    if change == 'clock': events[1]['timeInPeriod'] = '00:00'
    if change == 'type': events[1]['periodDescriptor']['periodType'] = 'OT'
    if change == 'seconds': events[1]['timeInPeriod'] = '00:60'
    if change == 'owner_bool': kwargs['home'] = True
    with pytest.raises(ValueError):
        project(events, **kwargs)

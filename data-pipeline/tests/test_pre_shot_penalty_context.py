from copy import deepcopy

import pytest

from projections.pre_shot_penalty_context import project, SCOPE


def event(eid, code=506, clock='01:00', owner=1, period=1, kind='REG', **details):
    return {'eventId': eid, 'sortOrder': eid, 'typeCode': code, 'timeInPeriod': clock,
            'periodDescriptor': {'number': period, 'periodType': kind},
            'details': {'eventOwnerTeamId': owner, **details}}


def penalty(eid=1, owner=2, clock='01:00', **kwargs):
    return event(eid, 509, clock, owner, typeCode='MIN', duration=2, **kwargs)


def test_shooter_relative_channels_and_recorded_units():
    result = project([penalty(), event(2, clock='01:10'), event(3, clock='01:11', owner=2)], home=1, away=2)
    assert result[2]['scope'] == SCOPE and result[2]['publishable'] is False
    assert result[2]['same_team']['status'] == 'unavailable'
    other = result[2]['opponent']
    assert other['recorded_duration_minutes'] == 2
    assert other['seconds_since_recorded_penalty_event'] == 10
    assert other['penalty_team_id'] == 2 and other['prior_event_id'] == 1
    assert result[3]['same_team']['prior_event_id'] == 1
    assert result[3]['opponent']['status'] == 'unavailable'


def test_current_penalty_is_not_its_own_predictor():
    result = project([penalty()], home=1, away=2)[1]
    assert result['same_team']['prior_event_id'] is None


def test_goal_outcome_and_future_events_do_not_change_current_output():
    prefix = [penalty(), event(2, clock='01:10')]
    goal = deepcopy(prefix)
    goal[-1]['typeCode'] = 505
    goal[-1]['details'].update(homeScore=20, awayScore=10)
    original = project(prefix, home=1, away=2)
    assert project(goal, home=1, away=2)[2] == original[2]
    assert project(prefix + [penalty(3, clock='01:20')], home=1, away=2)[2] == original[2]


def test_goals_and_stoppages_do_not_claim_historical_penalty_expiration():
    result = project([penalty(), event(2, 505, '01:10'), event(3, 516, '01:15'),
                      event(4, clock='01:20')], home=1, away=2)
    assert result[4]['opponent']['seconds_since_recorded_penalty_event'] == 20


def test_new_period_withholds_cross_period_age_and_shootout_is_unsupported():
    result = project([penalty(), event(2, period=2, clock='00:05'),
                      event(3, period=4, kind='SO', clock='00:00')], home=1, away=2)
    assert result[2]['opponent']['prior_event_id'] is None
    assert result[3]['opponent']['reason'] == 'shootout_scope_unsupported'


def test_same_clock_prior_source_order_has_known_zero_age():
    result = project([penalty(), event(2)], home=1, away=2)
    assert result[2]['opponent']['seconds_since_recorded_penalty_event'] == 0
    assert result[2]['opponent']['availability']['age'] is None


def test_missing_type_and_duration_replace_old_record_not_fallback():
    missing = event(2, 509, '01:05', 2)
    result = project([penalty(), missing, event(3, clock='01:10')], home=1, away=2)[3]['opponent']
    assert result['prior_event_id'] == 2
    assert result['recorded_type_code'] is result['recorded_duration_minutes'] is None
    assert result['seconds_since_recorded_penalty_event'] == 5
    assert result['availability']['duration'] == 'missing_or_invalid_recorded_duration'


@pytest.mark.parametrize('duration', [None, -1, True, float('nan'), float('inf'), 10**1000, '2'])
def test_invalid_duration_is_unknown_without_losing_known_event(duration):
    p = penalty()
    p['details']['duration'] = duration
    result = project([p, event(2)], home=1, away=2)[2]['opponent']
    assert result['recorded_duration_minutes'] is None
    assert result['recorded_type_code'] == 'MIN' and result['prior_event_id'] == 1


def test_recorded_zero_duration_is_preserved_not_active_state():
    p = penalty()
    p['details'].update(duration=0, typeCode='PS')
    result = project([p, event(2)], home=1, away=2)[2]['opponent']
    assert result['recorded_duration_minutes'] == 0
    assert result['recorded_type_code'] == 'PS'


@pytest.mark.parametrize('owner', [None, True, 999])
def test_unattributed_penalty_invalidates_both_prior_channels(owner):
    p = penalty(2, clock='01:05')
    p['details']['eventOwnerTeamId'] = owner
    result = project([penalty(), p, event(3, clock='01:10')], home=1, away=2)[3]
    assert all(result[k]['reason'] == 'unattributed_recorded_penalty' for k in ('same_team', 'opponent'))


def test_unknown_current_owner_does_not_erase_earlier_record():
    result = project([penalty(), event(2, clock='01:05', owner=None), event(3, clock='01:10')], home=1, away=2)
    assert result[2]['opponent']['reason'] == 'unknown_current_event_owner'
    assert result[3]['opponent']['prior_event_id'] == 1


def test_unknown_event_is_explicit_history_boundary():
    result = project([penalty(), event(2, 999, '01:05'), event(3, clock='01:10')], home=1, away=2)
    assert result[3]['opponent']['reason'] == 'unknown_event_boundary'


def test_input_and_per_event_result_objects_are_independent():
    events = [penalty(), event(2), event(3)]
    before = deepcopy(events)
    result = project(events, home=1, away=2)
    result[2]['opponent']['availability']['duration'] = 'mutated'
    assert result[3]['opponent']['availability']['duration'] is None
    assert events == before


@pytest.mark.parametrize('change', ['duplicate_id', 'duplicate_order', 'reverse_clock', 'bad_clock',
                                  'unicode_clock', 'boolean_owner_id', 'bad_period', 'reverse_period'])
def test_invalid_sequence_or_team_identity_rejected(change):
    rows = [penalty(), event(2, clock='01:10')]
    home = 1
    if change == 'duplicate_id': rows[1]['eventId'] = 1
    elif change == 'duplicate_order': rows[1]['sortOrder'] = 1
    elif change == 'reverse_clock': rows[1]['timeInPeriod'] = '00:10'
    elif change == 'bad_clock': rows[1]['timeInPeriod'] = '20:01'
    elif change == 'unicode_clock': rows[1]['timeInPeriod'] = '０１:１０'
    elif change == 'boolean_owner_id': home = True
    elif change == 'bad_period': rows[1]['periodDescriptor'] = {'number': 1, 'periodType': 'OT'}
    elif change == 'reverse_period': rows[0]['periodDescriptor']['number'] = 2
    with pytest.raises(ValueError): project(rows, home=home, away=2)

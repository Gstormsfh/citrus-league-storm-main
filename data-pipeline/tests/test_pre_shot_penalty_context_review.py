"""Independent annotation-prefix review; no active-penalty inference."""
from copy import deepcopy
import pytest
from projections.pre_shot_penalty_context import project


def e(eid, code=506, owner=1, time='01:00', period=1, **details):
    return {'eventId': eid, 'sortOrder': eid, 'typeCode': code, 'timeInPeriod': time,
            'periodDescriptor': {'number': period, 'periodType': 'REG'},
            'details': {'eventOwnerTeamId': owner, **details}}


def run(events):
    return project(events, home=1, away=2)


def test_both_channels_and_current_annotation_strict_prefix():
    events = [e(1, 509, 1, typeCode='MIN', duration=2),
              e(2, 509, 2, typeCode='MAJ', duration=5), e(3)]
    rows = run(events)
    assert rows[2]['same_team']['prior_event_id'] is None
    assert rows[2]['opponent']['prior_event_id'] == 1
    assert rows[3]['same_team']['recorded_duration_minutes'] == 2
    assert rows[3]['opponent']['recorded_duration_minutes'] == 5
    assert rows[3]['opponent']['seconds_since_recorded_penalty_event'] == 0


def test_elapsed_beyond_duration_is_retained_historical_annotation():
    rows = run([e(1, 509, 2, typeCode='MIN', duration=2),
                e(2, 505, time='04:00'), e(3, 516, time='04:01'), e(4, time='06:00')])
    annotation = rows[4]['opponent']
    assert annotation['recorded_duration_minutes'] == 2
    assert annotation['seconds_since_recorded_penalty_event'] == 300
    assert 'remaining' not in ' '.join(annotation)
    assert 'not_active_state' in rows[4]['scope']


def test_unrelated_goal_fields_and_future_dont_change_or_mutate_prefix():
    events = [e(1, 509, 2, typeCode='MIN', duration=2), e(2, time='01:01')]
    original = deepcopy(events)
    expected = run(events)[2]
    variant = deepcopy(events)
    variant[1]['typeCode'] = 505
    variant[1]['details'].update(homeScore=200, awayScore=100, duration=100, typeCode='MAJ')
    assert run(variant)[2] == expected
    assert run(events + [e(3, 509, 2, time='02:00', typeCode='MAJ', duration=5)])[2] == expected
    assert events == original


def test_owned_missing_annotation_replaces_only_its_team():
    row = run([e(1, 509, 1, typeCode='MIN', duration=2),
               e(2, 509, 2, typeCode='MAJ', duration=5),
               e(3, 509, 1), e(4)])[4]
    assert row['same_team']['prior_event_id'] == 3
    assert row['same_team']['recorded_type_code'] is None
    assert row['opponent']['prior_event_id'] == 2


@pytest.mark.parametrize('annotation', [{'eventOwnerTeamId': None}, {'eventOwnerTeamId': True}, {'eventOwnerTeamId': 88}])
def test_unattributed_annotation_clears_both_channels(annotation):
    unknown = e(3, 509)
    unknown['details'] = annotation
    row = run([e(1, 509, 1), e(2, 509, 2), unknown, e(4)])[4]
    assert row['same_team']['prior_event_id'] is row['opponent']['prior_event_id'] is None


def test_period_clears_even_same_clock_and_unknown_event_clears():
    assert run([e(1, 509, 2), e(2, period=2)])[2]['opponent']['prior_event_id'] is None
    assert run([e(1, 509, 2), e(2, 999), e(3)])[3]['opponent']['prior_event_id'] is None


@pytest.mark.parametrize('field,value', [('sortOrder', 1), ('eventId', 1), ('timeInPeriod', '00:59'),
                                        ('timeInPeriod', '20:01'), ('details', None)])
def test_reordered_or_malformed_input_rejected(field, value):
    current = e(2)
    current[field] = value
    with pytest.raises(ValueError): run([e(1, 509, 2), current])

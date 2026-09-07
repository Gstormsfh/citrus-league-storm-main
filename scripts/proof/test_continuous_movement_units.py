import numpy as np
from test_continuous_event_movement import movement,temporal

NAMES=['seconds_since_immediate_event','immediate_recorded_live_event__event_lateral_displacement_ft',
 'immediate_recorded_live_event__event_longitudinal_displacement_ft','immediate_recorded_live_event__same_team_indicator']


def row(t,d,longitudinal=5,prior='506'):
    return {'features':[t,d,longitudinal,1],'categorical':{'previous_event_type':prior}}


def test_no_jump_at_old_bucket_boundaries():
    for d in (5,10,20,40):
        assert np.max(np.abs(movement(row(1,d-1e-7),NAMES)-movement(row(1,d+1e-7),NAMES)))<1e-6
    assert np.max(np.abs(movement(row(3-1e-7,40),NAMES)-movement(row(3+1e-7,40),NAMES)))<1e-6


def test_joint_time_distance_and_direction():
    fast=movement(row(1,40),NAMES);slow=movement(row(3,40),NAMES);short=movement(row(1,2),NAMES)
    assert np.all(fast[:9]>slow[:9]) and np.all(fast[:9]>short[:9])
    assert movement(row(1,40,80),NAMES)[6]<fast[6]


def test_zero_missing_not_infinite_or_positive_time():
    assert np.array_equal(movement(row(0,40),NAMES),np.zeros(27))
    assert np.array_equal(movement(row(None,40),NAMES),np.zeros(27))
    assert np.array_equal(temporal(row(0,40),NAMES,['506']),[1,0,0,0])


def test_previous_event_specific_surfaces():
    a=movement(row(1,40,prior='506'),NAMES);b=movement(row(1,40,prior='507'),NAMES)
    assert np.array_equal(a[:9],b[9:18]) and not a[9:].any() and not b[:9].any()

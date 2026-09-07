import math
import pytest
from projections.pre_shot_movement import measure


def pair(prior=(70, -12), shot=(80, 12), seconds=1, orientation=1):
    return measure(prior_xy=prior, shot_xy=shot, elapsed_seconds=seconds, orientation=orientation)


def test_crossing_retains_signed_geometry_and_physical_units():
    result = pair()
    v = result['values']
    assert result['publishable'] is False
    assert v['event_crossed_centerline'] == 1
    assert v['event_lateral_displacement_ft'] == 24
    assert v['event_displacement_ft'] == 26
    angle = abs(math.degrees(math.atan2(12, 9)) - math.degrees(math.atan2(-12, 19)))
    assert v['event_angle_change_deg'] == pytest.approx(angle)
    assert v['event_angular_rate_deg_per_second'] == pytest.approx(angle)
    assert v['legacy_style_movement'] == pytest.approx(.48 * (2 / 3))


def test_rotation_with_orientation_is_identical():
    assert pair()['values'] == pair(prior=(-70, 12), shot=(-80, -12), orientation=-1)['values']


def test_timing_changes_rate_and_legacy_composite_not_distance_or_angle():
    quick, slow = pair(seconds=.5)['values'], pair(seconds=2)['values']
    assert quick['event_angle_change_deg'] == slow['event_angle_change_deg']
    assert quick['event_angular_rate_deg_per_second'] == 4 * slow['event_angular_rate_deg_per_second']
    assert quick['legacy_style_movement'] > slow['legacy_style_movement']


def test_same_clock_preserves_displacement_with_unknown_rates():
    v = pair(seconds=0)['values']
    assert v['event_lateral_displacement_ft'] == 24
    assert v['event_angular_rate_deg_per_second'] is None
    assert v['event_lateral_rate_ft_per_second'] is None


def test_behind_goal_short_arc():
    assert pair(prior=(95, -.1), shot=(95, .1))['values']['event_angle_change_deg'] < 2


def test_goal_center_angle_undefined_not_zero():
    v = pair(shot=(89, 0))['values']
    assert v['event_angle_change_deg'] is None
    assert v['event_angular_rate_deg_per_second'] is None
    assert v['event_lateral_displacement_ft'] == 12


@pytest.mark.parametrize('kwargs', [{'orientation': None}, {'prior': None}, {'shot': None}])
def test_missing_geometry_not_zero(kwargs):
    v = pair(**kwargs)['values']
    assert v['event_crossed_centerline'] is None
    assert v['legacy_style_movement'] is None
    assert v['event_elapsed_seconds'] == 1


@pytest.mark.parametrize('kwargs', [{'seconds': -1}, {'seconds': float('nan')}, {'seconds': True},
                                  {'orientation': True}, {'orientation': 0}, {'shot': (101, 0)},
                                  {'shot': (80, float('inf'))}, {'prior': (True, 1)}])
def test_malformed_inputs_fail(kwargs):
    with pytest.raises(ValueError):
        pair(**kwargs)


@pytest.mark.parametrize('ys', [(12, 6), (-12, -6), (0, 6), (-12, 0)])
def test_no_opposite_side_is_not_crossing(ys):
    assert pair(prior=(70, ys[0]), shot=(80, ys[1]))['values']['event_crossed_centerline'] == 0


def test_unknown_time_does_not_invent_speed_or_immediacy():
    v = pair(seconds=None)['values']
    assert v['event_displacement_ft'] == 26
    assert v['event_angular_rate_deg_per_second'] is None
    assert v['legacy_style_movement'] is None

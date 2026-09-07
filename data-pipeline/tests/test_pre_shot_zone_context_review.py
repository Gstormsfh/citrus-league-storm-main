"""Independent zone boundaries and explicitly limited comparator semantics."""
import math

import pytest

from projections.pre_shot_zone_context import measure


def pair(prior=(75, 10), shot=(80, -10), seconds=1, eligible=True):
    return measure(prior_xy=prior, shot_xy=shot, elapsed_seconds=seconds,
                   same_team_eligible=eligible)


@pytest.mark.parametrize('distance,zone', [
    (0, 'crease'), (9.999, 'crease'), (10, 'slot_low_angle'),
    (19.999, 'slot_low_angle'), (20, 'high_slot_low_angle'),
    (34.999, 'high_slot_low_angle'), (35, 'blue_line_low_angle'),
    (59.999, 'blue_line_low_angle'), (60, 'deep'),
])
def test_radial_thresholds_are_right_open(distance, zone):
    assert pair(prior=(89 - distance, 0))['zone'] == zone


def test_goal_center_physical_angle_unknown_but_legacy_comparator_explicit():
    result = pair(prior=(89, 0))
    assert result['zone'] == 'crease'
    assert result['values']['origin_distance_to_net_ft'] == 0
    assert result['values']['origin_angle_deg'] is None
    assert result['values']['legacy_style_origin_abs_angle_deg'] == 90


def test_mirroring_y_preserves_composites_but_reverses_physical_angle():
    a, b = pair(), pair(prior=(75, -10), shot=(80, 10))
    assert a['zone'] == b['zone']
    assert a['values']['origin_angle_deg'] == -b['values']['origin_angle_deg']
    for name in a['values']:
        if name != 'origin_angle_deg':
            assert a['values'][name] == b['values'][name]


@pytest.mark.parametrize('seconds', [0, 3.0000001, 10])
def test_known_outside_window_withholds_every_comparator(seconds):
    result = pair(seconds=seconds)
    assert result['zone'] is None
    assert all(v is None for v in result['values'].values())


def test_three_seconds_is_eligible_without_immediacy_bonus():
    result = pair(prior=(84, 0), seconds=3)
    assert result['zone'] == 'crease'
    assert result['values']['legacy_style_quality'] == pytest.approx(.4 + .95 * .1)


def test_missing_origin_cannot_be_inferred_from_shot_and_missing_time_withholds_zone():
    assert pair(prior=None)['zone'] is None
    assert pair(seconds=None)['zone'] is None
    assert all(v is None for v in pair(seconds=None)['values'].values())


def test_missing_shot_preserves_only_known_origin_measurements():
    result = pair(shot=None)
    assert result['zone'] == 'slot_high_angle'
    assert result['values']['origin_distance_to_net_ft'] == math.hypot(14, 10)
    assert result['values']['legacy_style_zone_relative_distance'] is not None
    assert result['values']['legacy_style_quality'] is None
    assert result['values']['legacy_style_normalized_lateral_distance'] is None


def test_no_current_outcome_parameter_and_no_input_mutation():
    prior, shot = [75, 10], [80, -10]
    result = pair(prior=prior, shot=shot)
    assert result['publishable'] is False
    assert prior == [75, 10] and shot == [80, -10]
    with pytest.raises(TypeError):
        measure(prior_xy=prior, shot_xy=shot, elapsed_seconds=1,
                same_team_eligible=True, current_is_goal=True)

"""Independent arithmetic/contract review; synthetic pairs, no acquisition imports."""
import math

import pytest

from projections.pre_shot_movement import NAMES, VERSION, measure


def pair(prior=(70, -12), shot=(80, 12), seconds=1, orientation=1):
    return measure(prior_xy=prior, shot_xy=shot, elapsed_seconds=seconds,
                   orientation=orientation)


@pytest.mark.parametrize("prior,shot", [
    ((-100, -42.5), (100, 42.5)), ((95, -1), (95, 1)),
    ((89, -1), (89, 1)), ((89, 0), (89, 0)),
    ((0, 0), (0, 0)), ((70, 0), (80, 0)),
])
def test_pair_geometry_rotation_and_euclidean_decomposition(prior, shot):
    result = pair(prior, shot)
    values = result['values']
    assert result['version'] == VERSION and result['publishable'] is False
    assert set(values) == set(NAMES)
    assert values == pair(tuple(-v for v in prior), tuple(-v for v in shot),
                          orientation=-1)['values']
    assert values['event_displacement_ft'] ** 2 == pytest.approx(
        values['event_lateral_displacement_ft'] ** 2
        + values['event_longitudinal_displacement_ft'] ** 2)
    assert all(v is None or math.isfinite(v) for v in values.values())
    if values['event_angle_change_deg'] is not None:
        assert 0 <= values['event_angle_change_deg'] <= 180


def test_same_location_has_zero_movement_not_missing():
    values = pair((70, 12), (70, 12))['values']
    for key in ('event_displacement_ft', 'event_lateral_displacement_ft',
                'event_longitudinal_displacement_ft', 'event_angle_change_deg',
                'event_angular_rate_deg_per_second', 'event_lateral_rate_ft_per_second'):
        assert values[key] == 0


def test_missing_time_preserves_measurable_geometry():
    known = pair()['values']
    missing = pair(seconds=None)['values']
    for key in ('event_displacement_ft', 'event_lateral_displacement_ft',
                'event_longitudinal_displacement_ft', 'prior_event_distance_to_net_ft',
                'event_angle_change_deg', 'event_crossed_centerline'):
        assert missing[key] == known[key]
    for key in ('event_elapsed_seconds', 'event_angular_rate_deg_per_second',
                'event_lateral_rate_ft_per_second', 'legacy_style_immediacy',
                'legacy_style_movement'):
        assert missing[key] is None


def test_long_elapsed_clips_only_legacy_composite_not_physical_rate():
    values = pair(seconds=10)['values']
    assert values['legacy_style_immediacy'] == values['legacy_style_movement'] == 0
    assert values['event_lateral_rate_ft_per_second'] == pytest.approx(2.4)
    assert values['event_angular_rate_deg_per_second'] > 0


def test_inputs_not_mutated_and_result_is_fresh():
    prior, shot = [70, -12], [80, 12]
    result = pair(prior, shot)
    result['values']['event_displacement_ft'] = -1
    assert prior == [70, -12] and shot == [80, 12]
    assert pair(prior, shot)['values']['event_displacement_ft'] == 26


def test_tiny_positive_clock_cannot_emit_nonfinite_rates():
    with pytest.raises(ValueError):
        pair(seconds=5e-324)


@pytest.mark.parametrize('kwargs', [
    {'seconds': 10 ** 1000}, {'prior': (10 ** 1000, 0)},
])
def test_unrepresentable_numeric_values_fail_cleanly(kwargs):
    with pytest.raises(ValueError):
        pair(**kwargs)

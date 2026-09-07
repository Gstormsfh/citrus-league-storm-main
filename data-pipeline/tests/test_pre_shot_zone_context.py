import ast
from copy import deepcopy
import math
from pathlib import Path
import pytest
from projections.pre_shot_zone_context import measure


def calculate(point=(75, 10), **kwargs):
    return measure(prior_xy=point, shot_xy=kwargs.get('shot', (80, -10)),
                   elapsed_seconds=kwargs.get('seconds', 1), same_team_eligible=kwargs.get('eligible', True))


@pytest.mark.parametrize('point', [(84, 0), (79, 0), (74, 10), (69, 0), (65, 20), (54, 0), (50, 30), (29, 0)])
def test_original_constants_and_front_net_composites_exactly_preserved(point):
    source = Path(__file__).resolve().parents[2] / 'data-pipeline/acquisition/data_acquisition.py'
    # Execute ONLY inspected pure functions; never import acquisition or binaries.
    wanted = {'classify_pass_zone', 'calculate_pass_quality_score',
              'calculate_normalized_lateral_distance', 'calculate_zone_relative_distance'}
    functions = [n for n in ast.parse(source.read_text()).body if isinstance(n, ast.FunctionDef) and n.name in wanted]
    assert len(functions) == 4
    scope = {'math': math, 'NET_X': 89, 'NET_Y': 0}
    exec(compile(ast.Module(body=functions, type_ignores=[]), '<pure-legacy-functions>', 'exec'), scope)
    out = calculate(point)
    zone = scope['classify_pass_zone'](*point)
    assert out['zone'] == zone
    distance = math.hypot(89-point[0], point[1])
    lateral = abs(-10-point[1])
    values = out['values']
    assert values['legacy_style_normalized_lateral_distance'] == scope['calculate_normalized_lateral_distance'](lateral, zone)
    assert values['legacy_style_zone_relative_distance'] == scope['calculate_zone_relative_distance'](distance, zone)
    assert values['legacy_style_quality'] == scope['calculate_pass_quality_score'](zone, 1-1/3, min(1,lateral/50)*(1-1/3), distance)


@pytest.mark.parametrize('eligible', [False, None])
def test_no_same_team_evidence_withholds_not_zero(eligible):
    out = calculate(eligible=eligible)
    assert out['zone'] is None
    assert all(v is None for v in out['values'].values())


def test_missing_origin_or_shot_or_time_are_distinct():
    assert calculate(None)['zone'] is None
    no_shot = calculate(shot=None)
    assert no_shot['zone'] is not None
    assert no_shot['values']['legacy_style_quality'] is None
    assert calculate(seconds=None)['values']['legacy_style_quality'] is None


def test_common_frame_does_not_flip_negative_x():
    out = calculate((-75, 10))
    assert out['zone'] == 'deep'
    assert out['values']['origin_distance_to_net_ft'] > 160


def test_behind_net_full_angle_and_folded_comparator_separate():
    out = calculate((95, 5))['values']
    assert out['origin_angle_deg'] > 90
    assert out['legacy_style_origin_abs_angle_deg'] < 90
    assert calculate((89, 0))['values']['origin_angle_deg'] is None


@pytest.mark.parametrize('point', [(10**1000, 0), (0, float('nan')), (False, 0), (101, 0)])
def test_invalid_points_rejected(point):
    with pytest.raises(ValueError): calculate(point)


def test_same_clock_outside_original_time_window_and_input_unchanged():
    point = [75, 10]
    before = deepcopy(point)
    assert calculate(point, seconds=0)['status'] == 'observed_outside_legacy_time_window'
    assert calculate(point, seconds=0)['values']['legacy_style_quality'] is None
    assert point == before


def test_false_boolean_surrogate_rejected():
    with pytest.raises(ValueError): calculate(eligible=1)


def test_observed_outside_window_differs_from_unknown_time():
    assert calculate(seconds=3)['values']['legacy_style_quality'] is not None
    assert calculate(seconds=3.001)['status'] == 'observed_outside_legacy_time_window'
    assert calculate(seconds=None)['status'] == 'unknown_elapsed_time'

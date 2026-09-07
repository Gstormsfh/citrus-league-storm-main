"""Offline original-style zone heuristics for eligible recorded-event pairs.

Coordinates MUST already share the current shooter's +x attacking frame. These
are named heuristic comparators, not measured passes, goalie tracking, learned
coefficients, or validated biological difficulty. No outcome input is accepted.
"""
import math
from projections.pre_shot_movement import measure as movement_measure

VERSION = 'citrus-pre-shot-zone-context-v1'
NAMES = ('origin_distance_to_net_ft', 'origin_angle_deg',
         'legacy_style_origin_abs_angle_deg', 'legacy_style_normalized_lateral_distance',
         'legacy_style_zone_relative_distance', 'legacy_style_quality')
FACTORS = {'crease': 2., 'slot_low_angle': 1.8, 'slot_high_angle': 1.6,
           'high_slot_low_angle': 1.3, 'high_slot_high_angle': 1.1,
           'blue_line_low_angle': .8, 'blue_line_high_angle': .6, 'deep': .4}
WEIGHTS = {'crease': 1., 'slot_low_angle': .9, 'slot_high_angle': .7,
           'high_slot_low_angle': .6, 'high_slot_high_angle': .5,
           'blue_line_low_angle': .4, 'blue_line_high_angle': .3, 'deep': .2}
DEPTHS = {'crease': (0., 10.), 'slot_low_angle': (10., 20.), 'slot_high_angle': (10., 20.),
          'high_slot_low_angle': (20., 35.), 'high_slot_high_angle': (20., 35.),
          'blue_line_low_angle': (35., 60.), 'blue_line_high_angle': (35., 60.), 'deep': (60., 100.)}


def _point(point):
    if point is None:
        return
    if (not isinstance(point, (tuple, list)) or len(point) != 2
            or any(type(v) not in (int, float) for v in point)
            or abs(point[0]) > 100 or abs(point[1]) > 42.5
            or any(not math.isfinite(v) for v in point)):
        raise ValueError('Finite bounded common-frame coordinates required')


def measure(*, prior_xy, shot_xy, elapsed_seconds, same_team_eligible):
    """Return six named measurements plus categorical origin zone.

    Original-style time eligibility is strictly 0 < elapsed <= 3 seconds.
    False/unknown eligibility yields None, not an invented no-pass/zero row. Missing
origin yields no zone. Known origin can retain zone/distance despite missing
shot geometry; quality requires known elapsed time and movement. Seconds/feet/
degrees are explicit; normalized values and quality are dimensionless [0,1].
Original thresholds/weights retained exactly, but no x-sign reorientation and
no fabricated missing defaults. Signed angle additionally preserves behind-net
geometry; the original folded angle is retained separately for zone comparison.
"""
    if same_team_eligible is not None and type(same_team_eligible) is not bool:
        raise ValueError('Explicit Boolean or unknown same-team eligibility required')
    _point(prior_xy)
    _point(shot_xy)
    movement = movement_measure(prior_xy=prior_xy, shot_xy=shot_xy,
                                elapsed_seconds=elapsed_seconds, orientation=1)['values']
    result = {'version': VERSION, 'publishable': False, 'zone': None, 'status': None,
              'values': dict.fromkeys(NAMES)}
    if same_team_eligible is not True:
        result['status'] = 'unknown_same_team_eligibility' if same_team_eligible is None else 'not_same_team'
        return result
    if elapsed_seconds is None:
        result['status'] = 'unknown_elapsed_time'
        return result
    if not 0 < elapsed_seconds <= 3:
        result['status'] = 'observed_outside_legacy_time_window'
        return result
    if prior_xy is None:
        result['status'] = 'missing_origin_geometry'
        return result
    x, y = prior_xy
    distance = math.hypot(89 - x, y)
    folded = 90. if x == 89 else math.degrees(math.atan2(abs(y), abs(89 - x)))
    angle = None if (x, y) == (89, 0) else math.degrees(math.atan2(y, 89 - x))
    if distance < 10:
        zone = 'crease'
    elif distance < 20:
        zone = 'slot_low_angle' if folded < 30 else 'slot_high_angle'
    elif distance < 35:
        zone = 'high_slot_low_angle' if folded < 30 else 'high_slot_high_angle'
    elif distance < 60:
        zone = 'blue_line_low_angle' if folded < 45 else 'blue_line_high_angle'
    else:
        zone = 'deep'
    low, high = DEPTHS[zone]
    values = result['values']
    values.update(origin_distance_to_net_ft=distance, origin_angle_deg=angle,
                  legacy_style_origin_abs_angle_deg=folded,
                  legacy_style_zone_relative_distance=min(1., max(0., (distance - low) / (high - low))))
    lateral = movement['event_lateral_displacement_ft']
    if lateral is not None:
        values['legacy_style_normalized_lateral_distance'] = min(1., lateral * FACTORS[zone] / 85.)
    immediacy, moving = movement['legacy_style_immediacy'], movement['legacy_style_movement']
    if immediacy is not None and moving is not None:
        values['legacy_style_quality'] = min(1., max(0., WEIGHTS[zone] * .4 + immediacy * .3
            + moving * .2 + max(0., 1. - distance / 100.) * .1))
    result['zone'] = zone
    result['status'] = 'eligible_recorded_event_zone' if shot_xy is not None else 'missing_shot_geometry'
    return result

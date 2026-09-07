"""Versioned movement measurements for offline validation, not a serving patch.

Two locations describe recorded event movement, not observed passes or goalie
tracking. Both are oriented to the current shooting team's frame. Legacy-style
immediacy/movement composites are retained as explicitly named comparators;
the raw distances, angles and elapsed seconds remain available to a new fit.
"""
import math

VERSION = 'citrus-pre-shot-movement-v1'
NAMES = ('event_elapsed_seconds', 'event_displacement_ft', 'event_lateral_displacement_ft',
         'event_longitudinal_displacement_ft', 'prior_event_distance_to_net_ft',
         'event_angle_change_deg', 'event_angular_rate_deg_per_second',
         'event_lateral_rate_ft_per_second', 'event_crossed_centerline',
         'legacy_style_immediacy', 'legacy_style_movement')


def _number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def measure(*, prior_xy, shot_xy, elapsed_seconds, orientation):
    """Pair arithmetic only: caller must establish prior-event eligibility.

    orientation is +1 or -1 from explicit team/defending-side context, never
    inferred from the sign of a shot coordinate. Missing geometry does not
    become zero movement. Same-clock events have unknown rates, not infinity.
    """
    values = dict.fromkeys(NAMES)
    if elapsed_seconds is not None and (not _number(elapsed_seconds) or elapsed_seconds < 0):
        raise ValueError('Finite nonnegative elapsed seconds required')
    values['event_elapsed_seconds'] = elapsed_seconds
    if elapsed_seconds is not None:
        values['legacy_style_immediacy'] = max(0., 1. - elapsed_seconds / 3.)
    if orientation is not None and (type(orientation) is not int or orientation not in (-1, 1)):
        raise ValueError('Explicit signed orientation required')
    if orientation is None or prior_xy is None or shot_xy is None:
        return {'version': VERSION, 'publishable': False, 'values': values,
                'geometry_status': 'missing_geometry_or_orientation'}
    for point in (prior_xy, shot_xy):
        if (not isinstance(point, (tuple, list)) or len(point) != 2
                or not all(_number(v) for v in point)
                or abs(point[0]) > 100 or abs(point[1]) > 42.5):
            raise ValueError('Finite in-rink point required')
    px, py = (orientation * v for v in prior_xy)
    sx, sy = (orientation * v for v in shot_xy)
    lateral, longitudinal = abs(sy - py), abs(sx - px)
    values.update(event_displacement_ft=math.hypot(sx - px, sy - py),
                  event_lateral_displacement_ft=lateral,
                  event_longitudinal_displacement_ft=longitudinal,
                  prior_event_distance_to_net_ft=math.hypot(89 - px, py),
                  event_crossed_centerline=int(py * sy < 0))
    if (px, py) != (89, 0) and (sx, sy) != (89, 0):
        before, after = math.degrees(math.atan2(py, 89 - px)), math.degrees(math.atan2(sy, 89 - sx))
        values['event_angle_change_deg'] = abs((after - before + 180) % 360 - 180)
    if elapsed_seconds is not None:
        values['legacy_style_movement'] = min(1., lateral / 50.) * values['legacy_style_immediacy']
        if elapsed_seconds > 0:
            values['event_lateral_rate_ft_per_second'] = lateral / elapsed_seconds
            if values['event_angle_change_deg'] is not None:
                values['event_angular_rate_deg_per_second'] = values['event_angle_change_deg'] / elapsed_seconds
    if any(value is not None and not _number(value) for value in values.values()):
        raise ValueError('Movement arithmetic must remain finite')
    return {'version': VERSION, 'publishable': False, 'values': values,
            'geometry_status': 'measured_recorded_event_pair'}

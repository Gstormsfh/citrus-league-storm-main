"""Geometry of externally identified pass endpoints, not a pass detector.

No assumed rink scale, net position, release timing or actual goalie movement.
These measurements are experimental and do not alter any serving xG model.
"""
import math


def measure(*, release, reception, shot, net, flight_seconds,
            reception_to_shot_seconds, coordinate_units):
    points = (release, reception, shot, net)
    if not coordinate_units or not isinstance(coordinate_units, str):
        raise ValueError('Explicit coordinate units required')
    for p in points:
        if not isinstance(p, (tuple, list)) or len(p) != 2 or not all(
                type(v) in (int, float) and math.isfinite(v) for v in p):
            raise ValueError('Finite two-dimensional coordinates required')
    for t in (flight_seconds, reception_to_shot_seconds):
        if type(t) not in (int, float) or not math.isfinite(t) or t < 0:
            raise ValueError('Finite nonnegative elapsed times required')
    def angle(a, b):
        u = (a[0]-net[0], a[1]-net[1])
        v = (b[0]-net[0], b[1]-net[1])
        if math.hypot(*u) == 0 or math.hypot(*v) == 0:
            return None
        return math.degrees(math.atan2(abs(u[0]*v[1]-u[1]*v[0]), u[0]*v[0]+u[1]*v[1]))
    pass_angle = angle(release, reception)
    distance = math.dist(release, reception)
    return {
        'coordinate_units': coordinate_units,
        'axis_convention': 'x longitudinal, y lateral; caller must verify orientation',
        'pass_lateral_distance': abs(reception[1]-release[1]),
        'pass_longitudinal_distance': abs(reception[0]-release[0]),
        'pass_endpoint_distance': distance,
        'pass_bearing_change_degrees': pass_angle,
        'reception_to_shot_bearing_change_degrees': angle(reception, shot),
        'release_to_shot_bearing_change_degrees': angle(release, shot),
        'receiver_endpoint_movement': math.dist(reception, shot),
        'pass_flight_seconds': flight_seconds,
        'reception_to_shot_seconds': reception_to_shot_seconds,
        'pass_endpoint_speed': distance / flight_seconds if flight_seconds > 0 else None,
        'pass_bearing_rate_degrees_per_second': pass_angle / flight_seconds
            if flight_seconds > 0 and pass_angle is not None else None,
        'actual_goalie_movement_measured': False,
        'pass_identity_and_timing_verified_by_function': False,
        'production_eligible': False,
    }

"""Continuous, causal control evidence. Scores are NOT probabilities.

Distance is puck-to-replay-actor, never puck-to-stick. Renderer units remain
uncalibrated. All actors compete; there is no forced owner for a loose puck.
"""
import math
from projections.possession_source_validation import validate


def extract(frames, *, distance_scale=84., motion_scale=24., persistence_ticks=3, player_roles=None):
    validate(frames)
    player_roles = {} if player_roles is None else player_roles
    if any(role not in ('goalie', 'skater') for role in player_roles.values()):
        raise ValueError('Explicit goalie/skater roles required')
    if any(not math.isfinite(x) or x <= 0 for x in (distance_scale, motion_scale)):
        raise ValueError('Positive finite scales required')
    if type(persistence_ticks) is not int or persistence_ticks < 1:
        raise ValueError('Positive integer persistence required')

    def valid(a):
        return a and all(type(a.get(k)) in (int, float) and math.isfinite(a[k]) for k in ('x', 'y'))

    previous, streaks, result = {}, {}, []
    for i, frame in enumerate(frames):
        actors, rows, next_streaks = frame['onIce'], [], {}
        puck, old_puck = actors.get('1'), previous.get('1')
        old_actors = {a.get('playerId'): a for a in previous.values() if a.get('playerId')}
        current = [a for a in actors.values() if valid(a) and a.get('playerId') and a.get('teamId')]
        if valid(puck):
            distances = {a['playerId']: math.hypot(a['x']-puck['x'], a['y']-puck['y']) for a in current}
            for a in current:
                pid, distance = a['playerId'], distances[a['playerId']]
                role = player_roles.get(pid, 'unknown')
                old = old_actors.get(pid)
                relative = None
                if valid(old) and valid(old_puck):
                    relative = math.hypot(puck['x']-old_puck['x']-a['x']+old['x'],
                                          puck['y']-old_puck['y']-a['y']+old['y'])
                supported = role != 'goalie' and relative is not None and distance <= distance_scale and relative <= motion_scale
                hold = streaks.get(pid, 0)+1 if supported else 0
                next_streaks[pid] = hold
                competitors = [d for p, d in distances.items() if p != pid]
                margin = min(competitors)-distance if competitors else None
                # A transparent product of proximity, co-motion, and persistence.
                # No softmax: a frame need not belong to any observed player.
                score = None if role == 'goalie' or relative is None else (
                    math.exp(-distance/distance_scale-relative/motion_scale)*min(1., hold/persistence_ticks))
                rows.append(dict(player_id=pid, team_id=a['teamId'], actor_role=role, distance_renderer_units=distance,
                                 relative_step_renderer_units=relative, nearest_competitor_margin=margin,
                                 consecutive_support=hold, evidence_score=score,
                                 puck_to_stick_distance=None, video_body_identity=None))
        rows.sort(key=lambda r: (-(r['evidence_score'] or 0), r['player_id']))
        result.append(dict(frame=i, actors=rows, status='evidence_available' if rows else 'missing_observation',
                           probability=None, calibrated=False, production_eligible=False))
        previous, streaks = actors, next_streaks
    return result

"""Causal replay-coordinate possession hypotheses, not video possession labels.

Never combine image pixels with renderer coordinates without registration.
Unknown data resets persistence; possession is not carried across a gap.
Thresholds are experimental native-renderer quantities, not probabilities.
"""
import math
from projections.possession_source_validation import validate


def infer(frames, *, radius=84., separation=12., relative_step_limit=24., minimum_hold=3, retention_radius=None, goalie_ids=()):
    validate(frames)
    if any(not math.isfinite(v) or v <= 0 for v in (radius, separation, relative_step_limit)):
        raise ValueError('Positive finite thresholds required')
    if type(minimum_hold) is not int or minimum_hold < 2:
        raise ValueError('At least two consecutive observations required')
    retention_radius = radius if retention_radius is None else retention_radius
    goalie_ids = set(goalie_ids)
    if not math.isfinite(retention_radius) or retention_radius < radius:
        raise ValueError('Retention radius must be finite and at least acquisition radius')

    def valid(a):
        return a and all(type(a.get(k)) in (float, int) and math.isfinite(a[k]) for k in ('x', 'y'))

    output, previous, streak, owner = [], None, 0, None
    for i, frame in enumerate(frames):
        actors = frame['onIce']
        puck = actors.get('1')
        row = dict(frame=i, status='unknown', reason='missing_puck', player_id=None,
                   evidence_source='replay_coordinates', verified=False, production_eligible=False)
        candidate = None
        if valid(puck):
            near = sorted([(math.hypot(a['x']-puck['x'], a['y']-puck['y']), a['playerId'], a)
                           for a in actors.values() if valid(a) and a.get('playerId') and a.get('teamId')],
                          key=lambda entry: (entry[0], entry[1]))
            row['reason'] = 'no_nearby_actor'
            established = bool(near and near[0][1] == owner and streak >= minimum_hold)
            effective_radius = retention_radius if established else radius
            if near and near[0][0] <= effective_radius:
                distance, pid, actor = near[0]
                row['distance_renderer_units'] = distance
                row['retention_boundary_used'] = bool(established and distance > radius)
                if pid in goalie_ids:
                    row.update(status='goalie_interaction_unresolved',
                               reason='goalie_control_requires_separate_evidence', nearby_goalie_id=pid)
                elif len(near) > 1 and near[1][0]-distance < separation:
                    row.update(status='contested', reason='ambiguous_nearest_actor')
                else:
                    old = next((a for a in (previous or {}).values() if a.get('playerId') == pid), None)
                    old_puck = (previous or {}).get('1')
                    row['reason'] = 'insufficient_motion_history'
                    if valid(old) and valid(old_puck):
                        relative = math.hypot(puck['x']-old_puck['x']-actor['x']+old['x'],
                                              puck['y']-old_puck['y']-actor['y']+old['y'])
                        row['relative_step_renderer_units'] = relative
                        row['reason'] = 'puck_not_comoving'
                        if relative <= relative_step_limit:
                            candidate = pid
                            row.update(reason='insufficient_persistence', team_id=actor['teamId'])
        streak = streak+1 if candidate is not None and candidate == owner else (1 if candidate else 0)
        owner = candidate
        if candidate is not None and streak >= minimum_hold:
            row.update(status='control_candidate', reason='separated_persistent_comotion', player_id=candidate)
        row['consecutive_support'] = streak
        output.append(row)
        previous = actors
    return output

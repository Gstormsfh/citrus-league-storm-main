"""Versioned first-party geometry/state/event-motion projection; never fitting.

No rink adjustment or inferred tracking. Outcome labels remain separate. Input
is revalidated against the frozen source, not accepted because a hash is present.
"""
import math
import re

from projections.analytics_publication import fingerprint
from projections.causal_feature_contract import build_causal_input_contract

VERSION = 'citrus-official-causal-projector-v1'
LIVE_LOCATION_EVENTS = frozenset((502, 503, 504, 506, 507, 508, 525))


def _entry(value=None, reason=None):
    return {'value': value, 'status': 'available' if reason is None else 'unavailable', 'reason': reason}


def _field(annotations, name):
    return annotations[name]['value']


def _seconds(event):
    minutes, seconds = map(int, event['time_in_period'].split(':'))
    return minutes * 60 + seconds


def project_row_features(row, home, away, *, score_state=None):
    """Shared arithmetic; callers validate full source and causal context first.

    Compact callers supply a prior-only score state and immediate prior event.
    Audit callers retain their original full prefix. No source gate is bypassed.
    """
    a, prefix = row['at_shot_annotations'], row['strict_prior_context']
    owner = _field(a, 'owner_team_id')
    features = {}
    side = _field(a, 'home_team_defending_side')
    orientation = (1 if (owner == home and side == 'left') or (owner == away and side == 'right') else -1) if side in ('left', 'right') and owner in (home, away) else None
    x, y = _field(a, 'x_raw'), _field(a, 'y_raw')
    geometry_reason = ('unknown_attacking_orientation' if orientation is None else
                       'missing_or_out_of_rink_coordinates' if x is None or y is None or abs(x) > 100 or abs(y) > 42.5 else None)
    features['x_raw'], features['y_raw'] = a['x_raw'].copy(), a['y_raw'].copy()
    if geometry_reason:
        for name in ('x_attacking', 'y_attacking', 'distance_to_goal_ft', 'signed_angle_deg'):
            features[name] = _entry(reason=geometry_reason)
    else:
        ox, oy = orientation*x, orientation*y
        features['x_attacking'], features['y_attacking'] = _entry(ox), _entry(oy)
        features['distance_to_goal_ft'] = _entry(math.hypot(89-ox, oy))
        # Signed full atan2 convention retains behind-goal geometry; unlike
        # legacy abs(dx), this deliberately does not fold it in front.
        features['signed_angle_deg'] = (_entry(reason='undefined_angle_at_goal_center')
                                       if ox == 89 and oy == 0 else _entry(math.degrees(math.atan2(oy, 89-ox))))
    code = _field(a, 'situation_code_raw')
    strength = isinstance(code, str) and re.fullmatch('[01][3-6][3-6][01]', code) is not None
    if strength:
        ag, ask, hsk, hg = map(int, code)
        strength = ag+ask <= 6 and hg+hsk <= 6 and owner in (home, away)
    if not strength:
        for name in ('shooting_skaters', 'defending_skaters', 'shooting_empty_net', 'defending_empty_net', 'skater_advantage'):
            features[name] = _entry(reason='unknown_or_invalid_situation_code')
    else:
        shooting, defending, shooting_goalie, defending_goalie = (hsk, ask, hg, ag) if owner == home else (ask, hsk, ag, hg)
        for name, value in [('shooting_skaters', shooting), ('defending_skaters', defending),
                            ('shooting_empty_net', not bool(shooting_goalie)), ('defending_empty_net', not bool(defending_goalie)),
                            ('skater_advantage', shooting-defending)]:
            features[name] = _entry(value)
    features['is_power_play'] = _entry(reason='penalty_state_not_reconstructed')
    features['time_since_powerplay_started'] = _entry(reason='penalty_state_not_reconstructed')
    if score_state is None:
        # A observed opening period-start establishes the zero-score origin.
        score_known = bool(prefix and prefix[0]['period'] == 1 and prefix[0]['period_type'] == 'REG'
                           and _seconds(prefix[0]) == 0 and prefix[0]['annotations']['event_type_code'] == 520)
        scores = {home: 0, away: 0}
        for event in prefix:
            if event['annotations']['event_type_code'] == 505 and event['period_type'] != 'SO':
                team = _field(event['annotations'], 'owner_team_id')
                if team not in scores:
                    score_known = False
                else:
                    scores[team] += 1
    else:
        score_known, scores = score_state
    features['score_differential_pre_shot'] = (_entry(scores[owner] - scores[away if owner == home else home])
                                              if score_known and owner in scores else _entry(reason='incomplete_score_origin_or_goal_owner'))
    prior = prefix[-1] if prefix else None
    motion_reason = None
    if not prior or prior['period'] != row['period'] or prior['period_type'] != row['period_type']:
        motion_reason = 'no_immediate_same_period_event'
    elif prior['annotations']['event_type_code'] not in LIVE_LOCATION_EVENTS:
        motion_reason = 'immediate_event_is_boundary_or_unknown'
    elif geometry_reason:
        motion_reason = geometry_reason
    else:
        px, py = _field(prior['annotations'], 'x_raw'), _field(prior['annotations'], 'y_raw')
        previous_side = _field(prior['annotations'], 'home_team_defending_side')
        if px is None or py is None or abs(px)>100 or abs(py)>42.5:
            motion_reason = 'missing_immediate_event_coordinates'
        elif previous_side is not None and previous_side != side:
            motion_reason = 'same_period_orientation_conflict'
    names = ('seconds_since_immediate_event', 'distance_from_immediate_event_ft', 'event_location_change_ft_per_second')
    if motion_reason:
        for name in names: features[name] = _entry(reason=motion_reason)
    else:
        elapsed = _seconds(row)-_seconds(prior)
        distance = math.hypot(x-px, y-py)
        features[names[0]], features[names[1]] = _entry(elapsed), _entry(distance)
        features[names[2]] = _entry(distance/elapsed) if elapsed>0 else _entry(reason='same_clock_speed_undefined')
    return features


def project_causal_features(staged, *, now=None):
    """Rebuild the input receipt, then compute only reviewed causal features.

    Unavailable source returns no feature rows. Complete source can still have
    unavailable geometry/strength/motion. Never infer rink side from shot sign.
    ``now`` is only the validation clock, never a replacement observation time.
    """
    rebuilt = build_causal_input_contract(staged['source_receipt'], evidence_kind=staged['evidence_kind'],
                                          exclusions=staged['exclusions'], now=now)
    if rebuilt != staged:
        raise ValueError('Causal input receipt is detached or modified')
    output = {'contract': VERSION, 'status': 'unavailable', 'training_ready': False,
              'publishable': False, 'historical_as_of_verified': False,
              'input_contract': rebuilt, 'input_contract_sha256': rebuilt['contract_sha256'],
              'family_catalog': dict(rebuilt['unavailable_families']), 'rows': [], 'availability': {}}
    if rebuilt['status'] != 'staged_not_training_ready':
        return {**output, 'projector_sha256': fingerprint(output)}
    payload = rebuilt['source_receipt']['prepared'][0]['payload']['pbp']
    home, away = payload['homeTeam']['id'], payload['awayTeam']['id']
    for row in rebuilt['rows']:
        features = project_row_features(row, home, away)
        output['rows'].append({'game_id': row['game_id'], 'event_id': row['event_id'],
                               'source_event_sha256': row['source_event_sha256'], 'excluded_reason': row['excluded_reason'],
                               'features': features, 'retrospective_labels': row['retrospective_labels'].copy()})
        for name, value in features.items():
            counts = output['availability'].setdefault(name, {'available': 0, 'unavailable': 0})
            counts['unavailable' if value['value'] is None else 'available'] += 1
    output['status'] = 'projected_not_training_ready'
    return {**output, 'projector_sha256': fingerprint(output)}

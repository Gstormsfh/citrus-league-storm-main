"""Independent raw-predecessor classification, not a new model feature.

No current outcome or future event is read. Reproduces the declared baseline
prior-SOG state while explaining its nulls; geometry facts do not change state.
The caller verifies complete raw ordering, game identity and frozen source bytes.
"""
import math
import re

VERSION = 'citrus-prior-sog-fidelity-v1'
LIVE = frozenset((502, 503, 504, 506, 507, 508, 525))


def _period(event):
    p = event.get('periodDescriptor')
    if (not isinstance(p, dict) or type(p.get('number')) is not int or p['number'] <= 0
            or p.get('periodType') not in ('REG', 'OT', 'SO')):
        raise ValueError('Explicit valid period required')
    return p['number'], p['periodType']


def _clock(event):
    clock = event.get('timeInPeriod')
    if (not isinstance(clock, str) or re.fullmatch(r'\d{2}:\d{2}', clock) is None
            or int(clock[3:]) >= 60):
        raise ValueError('Canonical event clock required')
    return int(clock[:2])*60 + int(clock[3:])


def _details(event):
    details = event.get('details')
    return details if isinstance(details, dict) else {}


def _owner(event, teams):
    owner = _details(event).get('eventOwnerTeamId')
    return owner if type(owner) is int and owner in teams else None


def _point_known(event):
    d = _details(event)
    return all(type(d.get(k)) in (int, float) and abs(d[k]) <= limit and math.isfinite(d[k])
               for k, limit in [('xCoord', 100), ('yCoord', 42.5)])


def classify(current, previous, home, away):
    if (not isinstance(current, dict) or previous is not None and not isinstance(previous, dict)
            or type(home) is not int or type(away) is not int or min(home, away) <= 0 or home == away):
        raise ValueError('Raw event objects and distinct positive teams required')
    period, clock = _period(current), _clock(current)
    prior_period = _period(previous) if previous is not None else None
    prior_clock = _clock(previous) if previous is not None else None
    same_period = prior_period == period
    gap = clock-prior_clock if same_period else None
    if gap is not None and gap < 0:
        raise ValueError('Prior event cannot follow current clock')
    teams = (home, away)
    owner = _owner(current, teams)
    prior_owner = _owner(previous, teams) if previous is not None else None
    code = previous.get('typeCode') if previous is not None else None
    if previous is not None and type(code) is not int:
        raise ValueError('Exact prior integer event code required')
    side = current.get('homeTeamDefendingSide')
    prior_side = previous.get('homeTeamDefendingSide') if previous is not None else None
    side = side if side in ('left', 'right') else None
    prior_side = prior_side if prior_side in ('left', 'right') else None
    relation = None if owner is None or prior_owner is None else 'same_team' if owner == prior_owner else 'opponent'
    if previous is None:
        reason, state = 'no_raw_predecessor', None
    elif not same_period:
        reason, state = 'predecessor_other_period', None
    elif code not in LIVE:
        reason, state = 'prior_type_outside_baseline_live_set', None
    elif owner is None:
        reason, state = 'current_owner_invalid_or_nonparticipant', None
    elif prior_owner is None:
        reason, state = 'prior_owner_invalid_or_nonparticipant', None
    elif code == 506 and owner == prior_owner:
        reason, state = 'observed_same_team_506', '1'
    else:
        reason, state = 'observed_other_eligible_predecessor', '0'
    band = ('no_same_period_predecessor' if gap is None else 'same_clock' if gap == 0 else
            'up_to_1s' if gap <= 1 else 'over_1_under_3s' if gap < 3 else
            'from_3_to_10s' if gap <= 10 else 'over_10s')
    return {'contract': VERSION, 'expected_state': state, 'reason': reason,
            'previous_event_type': code, 'gap_seconds': gap, 'gap_band': band,
            'facts': {'same_period': same_period, 'current_owner_known': owner is not None,
                      'prior_owner_known': prior_owner is not None, 'owner_relation': relation,
                      'prior_type_in_baseline_live_set': code in LIVE,
                      'current_side_known': side is not None, 'prior_side_known': prior_side is not None,
                      'side_conflict': side is not None and prior_side is not None and side != prior_side,
                      'current_coordinates_usable': _point_known(current),
                      'prior_coordinates_usable': _point_known(previous) if previous is not None else False}}

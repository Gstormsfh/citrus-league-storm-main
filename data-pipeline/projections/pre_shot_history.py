"""Offline recorded-event pair selectors; no pass/possession/tracking claims.

Input is one game's ordered official-style event prefix. Emit before current
outcome updates. Immediate context allows either team's preceding live event;
same-team-attempt context breaks on any intervening opponent event. Unknown
events/owners and explicit boundaries clear both. Missing geometry remains
missing; it never causes selection of an older, better-populated event.
"""
import math
import re
from projections.pre_shot_movement import measure

VERSION = 'citrus-pre-shot-history-v1'
LIVE = frozenset((503, 504, 506, 507, 508, 525))
ATTEMPTS = frozenset((506, 507))


def _point(details):
    x, y = details.get('xCoord'), details.get('yCoord')
    if (type(x) not in (int, float) or type(y) not in (int, float)
            or abs(x) > 100 or abs(y) > 42.5
            or not math.isfinite(x) or not math.isfinite(y)):
        return None
    return (x, y)


def _pair(prior, *, point, time, owner, side, home):
    orientation = None
    if prior is not None and side in ('left', 'right') and prior['side'] == side:
        orientation = 1 if (owner == home) == (side == 'left') else -1
    result = measure(prior_xy=prior['point'] if prior else None, shot_xy=point,
                     elapsed_seconds=time - prior['time'] if prior else None,
                     orientation=orientation)
    return {'prior_event_id': prior['id'] if prior else None,
            'prior_event_type': prior['code'] if prior else None,
            'prior_owner_relation': ('same_team' if prior['owner'] == owner else 'opponent') if prior else None,
            **result}


def project(events, *, home, away):
    """Return event-ID keyed contexts, including non-shot rows for prefix audit.

Require explicit strictly increasing sortOrder, unique integer IDs, nondecreasing
within-period clocks, stable period type, and positive distinct team IDs. Both
locations need explicit matching defending sides to produce geometry. Elapsed
time remains measurable when geometry is unavailable. Goal rows get the same
pre-event features as a non-goal shot at that position; goals then reset history.
Shootout rows are withheld and reset. No fitted artifacts or side effects.
"""
    if (not isinstance(events, list) or len(events) > 2000
            or type(home) is not int or type(away) is not int
            or min(home, away) <= 0 or home == away):
        raise ValueError('Bounded game prefix and distinct positive teams required')
    out, seen = {}, set()
    previous, attempt, period, last_time, last_order = None, None, None, None, None
    for event in events:
        if not isinstance(event, dict):
            raise ValueError('Event object required')
        eid, order = event.get('eventId'), event.get('sortOrder')
        details, descriptor = event.get('details', {}), event.get('periodDescriptor')
        clock = event.get('timeInPeriod')
        if (type(eid) is not int or eid < 0 or eid in seen or type(order) is not int
                or order < 0 or last_order is not None and order <= last_order
                or not isinstance(details, dict) or not isinstance(descriptor, dict)
                or type(descriptor.get('number')) is not int or descriptor['number'] < 1
                or descriptor.get('periodType') not in ('REG', 'OT', 'SO')
                or not isinstance(clock, str) or re.fullmatch(r'\d{2}:\d{2}', clock) is None
                or int(clock[3:]) >= 60):
            raise ValueError('Unique ordered IDs, details and canonical clocks required')
        current_period = (descriptor['number'], descriptor['periodType'])
        time = int(clock[:2]) * 60 + int(clock[3:])
        if period is not None and (current_period[0] < period[0]
                or current_period[0] == period[0] and current_period != period
                or current_period == period and time < last_time):
            raise ValueError('Period or clock reversal')
        if current_period != period:
            previous, attempt = None, None
        seen.add(eid)
        last_order, period, last_time = order, current_period, time
        owner, code = details.get('eventOwnerTeamId'), event.get('typeCode')
        valid_owner = type(owner) is int and owner in (home, away)
        eligible_current = valid_owner and descriptor['periodType'] != 'SO'
        point, side = _point(details), event.get('homeTeamDefendingSide')
        common = dict(point=point, time=time, owner=owner, side=side, home=home)
        selected_attempt = attempt if eligible_current and attempt and attempt['owner'] == owner else None
        out[eid] = {'version': VERSION, 'publishable': False,
                    'immediate_recorded_live_event': _pair(previous if eligible_current else None, **common),
                    'prior_same_team_unblocked_attempt': _pair(selected_attempt, **common)}
        # Current event code never participates in selecting its own predictors.
        if type(code) is int and code in LIVE and eligible_current:
            if attempt is not None and attempt['owner'] != owner:
                attempt = None
            previous = {'id': eid, 'code': code, 'owner': owner, 'time': time,
                        'point': point, 'side': side}
            if code in ATTEMPTS:
                attempt = previous
        else:
            previous, attempt = None, None
    return out

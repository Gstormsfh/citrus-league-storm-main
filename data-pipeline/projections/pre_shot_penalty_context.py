"""Offline latest recorded penalty annotations, never active penalty/PP state.

Emit each current event before updating history. The two channels refer to the
current event owner's team and its opponent. A goal/stoppage does not erase a
historical annotation; period changes and shootouts withhold cross-period age.
No fitting, database access, legacy imports, outcome target or countdown.
"""
import math
import re

VERSION = 'citrus-recorded-penalty-context-v1'
SCOPE = 'latest_recorded_penalty_in_current_period_not_active_state'
KNOWN_EVENTS = frozenset((502, 503, 504, 505, 506, 507, 508, 509, 510,
                          516, 517, 520, 521, 523, 524, 525, 535))
TYPE_CODES = frozenset(('MIN', 'MAJ', 'BEN', 'MIS', 'GAM', 'PS'))


def _empty(reason):
    return {'status': 'unavailable', 'reason': reason, 'prior_event_id': None,
            'penalty_team_id': None, 'recorded_type_code': None,
            'recorded_duration_minutes': None, 'seconds_since_recorded_penalty_event': None,
            'availability': {'type': reason, 'duration': reason, 'age': reason}}


def _emit(record, reason, time):
    if record is None:
        return _empty(reason)
    return {'status': 'recorded_annotation', 'reason': None,
            'prior_event_id': record['id'], 'penalty_team_id': record['owner'],
            'recorded_type_code': record['type'], 'recorded_duration_minutes': record['duration'],
            'seconds_since_recorded_penalty_event': time - record['time'],
            'availability': {'type': None if record['type'] is not None else 'missing_or_unknown_recorded_type',
                             'duration': None if record['duration'] is not None else 'missing_or_invalid_recorded_duration',
                             'age': None}}


def project(events, *, home, away):
    """Return event-ID keyed same-team/opponent strict-prefix annotations.

Only event type 509 updates penalty history. Unknown event codes invalidate both
channels; an unowned penalty invalidates both rather than falling back to an
older well-populated record. An owned penalty replaces its team's prior record
even when its type/duration is missing. Unknown current ownership withholds only
that event's shooter-relative output. Duration is the recorded minutes field,
not seconds remaining; neither zero nor a nonzero age implies an active penalty.
"""
    if (not isinstance(events, list) or len(events) > 2000
            or type(home) is not int or type(away) is not int
            or min(home, away) <= 0 or home == away):
        raise ValueError('Bounded event prefix and distinct positive team IDs required')
    latest = {home: None, away: None}
    reason = 'no_recorded_penalty_in_current_period'
    output, seen = {}, set()
    period = last_time = last_order = None
    for event in events:
        if not isinstance(event, dict):
            raise ValueError('Event object required')
        eid, order, code = event.get('eventId'), event.get('sortOrder'), event.get('typeCode')
        details, descriptor, clock = event.get('details', {}), event.get('periodDescriptor'), event.get('timeInPeriod')
        if (type(eid) is not int or eid < 0 or eid in seen or type(order) is not int or order < 0
                or last_order is not None and order <= last_order
                or type(code) is not int or code < 0 or not isinstance(details, dict)
                or not isinstance(descriptor, dict) or type(descriptor.get('number')) is not int
                or not 1 <= descriptor['number'] <= 20
                or descriptor.get('periodType') not in ('REG', 'OT', 'SO')
                or not isinstance(clock, str) or re.fullmatch(r'[0-9]{2}:[0-9]{2}', clock) is None
                or int(clock[3:]) >= 60):
            raise ValueError('Unique ordered event identity and canonical period/clock required')
        current = descriptor['number'], descriptor['periodType']
        time = int(clock[:2]) * 60 + int(clock[3:])
        if (time > 1200 or current[1] == 'REG' and current[0] > 3
                or current[1] in ('OT', 'SO') and current[0] < 4
                or period is not None and (current[0] < period[0]
                    or current[0] == period[0] and current != period
                    or current == period and time < last_time)):
            raise ValueError('Invalid period or within-period clock reversal')
        if current != period:
            latest = {home: None, away: None}
            reason = 'no_recorded_penalty_in_current_period'
        seen.add(eid)
        last_order, period, last_time = order, current, time
        owner = details.get('eventOwnerTeamId')
        valid_owner = type(owner) is int and owner in latest
        if current[1] == 'SO':
            same, other = _empty('shootout_scope_unsupported'), _empty('shootout_scope_unsupported')
        elif not valid_owner:
            same, other = _empty('unknown_current_event_owner'), _empty('unknown_current_event_owner')
        else:
            same = _emit(latest[owner], reason, time)
            other = _emit(latest[away if owner == home else home], reason, time)
        output[eid] = {'version': VERSION, 'scope': SCOPE, 'publishable': False,
                       'same_team': same, 'opponent': other}
        # No current goal/non-goal or current penalty annotation affects its own output.
        if current[1] == 'SO' or code not in KNOWN_EVENTS or code == 509 and not valid_owner:
            latest = {home: None, away: None}
            reason = ('shootout_scope_unsupported' if current[1] == 'SO' else
                      'unattributed_recorded_penalty' if code == 509 else 'unknown_event_boundary')
        elif code == 509:
            kind, duration = details.get('typeCode'), details.get('duration')
            if not isinstance(kind, str) or kind not in TYPE_CODES:
                kind = None
            if (type(duration) not in (int, float) or not 0 <= duration <= 60
                    or not math.isfinite(duration)):
                duration = None
            latest[owner] = {'id': eid, 'owner': owner, 'time': time, 'type': kind, 'duration': duration}
    return output

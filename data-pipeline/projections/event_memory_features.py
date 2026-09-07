"""Recorded event-history proxies, not possession, tracking or penalty age.

Emit before processing the current event outcome. Unknown events/ownership
invalidate window completeness until an explicit faceoff or period start.
Full official-source authentication remains the caller's responsibility.
"""
import math
import re

VERSION = 'citrus-recorded-event-memory-v1'
NAMES = ('same_team_attempts_previous_10s', 'opponent_attempts_previous_10s',
         'same_team_events_previous_10s', 'opponent_events_previous_10s',
         'seconds_since_last_same_team_attempt', 'last_same_team_attempt_displacement_ft',
         'last_same_team_attempt_angle_change_deg', 'seconds_since_observed_strength_spell_start')
LIVE = {503, 504, 506, 507, 508, 525}
RESET = {502, 509, 516, 520, 521, 523, 524}


def _clock(event):
    clock = event.get('timeInPeriod')
    pd = event.get('periodDescriptor', {})
    if (not isinstance(clock, str) or re.fullmatch(r'\d{2}:\d{2}', clock) is None
            or int(clock[3:]) >= 60 or type(pd.get('number')) is not int
            or pd['number'] < 1 or pd.get('periodType') not in ('REG', 'OT', 'SO')):
        raise ValueError('Explicit ordered event clock required')
    return (pd['number'], pd['periodType']), int(clock[:2]) * 60 + int(clock[3:])


def _strength(event):
    code = event.get('situationCode')
    if isinstance(code, str) and re.fullmatch('[01][3-6][3-6][01]', code):
        ag, a, h, hg = map(int, code)
        if ag + a <= 6 and hg + h <= 6: return code
    return None


def _point(event):
    d = event.get('details', {})
    x, y = d.get('xCoord'), d.get('yCoord')
    if (type(x) not in (int, float) or type(y) not in (int, float)
            or not math.isfinite(x) or not math.isfinite(y) or abs(x) > 100 or abs(y) > 42.5):
        return None
    return x, y


def project(events, *, home, away):
    if (not isinstance(events, list) or not 0 < len(events) <= 2000
            or type(home) is not int or type(away) is not int or home == away):
        raise ValueError('Bounded explicit game source required')
    out, seen, history, last_attempt = {}, set(), [], {}
    period, last_time, known, strength, spell_start = None, None, False, None, None
    for event in events:
        if not isinstance(event, dict) or type(event.get('eventId')) is not int or event['eventId'] in seen:
            raise ValueError('Unique canonical event IDs required')
        seen.add(event['eventId'])
        current_period, time = _clock(event)
        if period is not None and (current_period[0] < period[0]
                or current_period[0] == period[0] and current_period != period
                or current_period == period and time < last_time):
            raise ValueError('Event clock reversal')
        if current_period != period:
            history, last_attempt, known, strength, spell_start = [], {}, False, None, None
        period, last_time = current_period, time
        d = event.get('details', {})
        if not isinstance(d, dict): raise ValueError('Explicit event details object required')
        owner, code = d.get('eventOwnerTeamId'), event.get('typeCode')
        if type(owner) is not int: owner = None
        state = _strength(event)
        # Uses the current observed state, never infers the true transition time
        # or cause between recorded events. Period changes reset the spell.
        age = time - spell_start if state is not None and state == strength else None
        values = [None] * len(NAMES)
        if owner in (home, away):
            history = [r for r in history if time - r[0] <= 10]
            if known:
                values[:4] = [sum(r[1] == owner and r[2] for r in history),
                    sum(r[1] != owner and r[2] for r in history),
                    sum(r[1] == owner for r in history), sum(r[1] != owner for r in history)]
            prior = last_attempt.get(owner)
            if prior:
                values[4] = time - prior[0]
                a, b = _point(event), _point(prior[1])
                side = event.get('homeTeamDefendingSide')
                if (a is not None and b is not None and side in ('left', 'right')
                        and prior[1].get('homeTeamDefendingSide') in (None, side)):
                    sign = 1 if (owner == home and side == 'left') or (owner == away and side == 'right') else -1
                    ax, ay, bx, by = a[0]*sign, a[1]*sign, b[0]*sign, b[1]*sign
                    values[5] = math.hypot(ax-bx, ay-by)
                    if (ax, ay) != (89, 0) and (bx, by) != (89, 0):
                        aa, ba = math.degrees(math.atan2(ay, 89-ax)), math.degrees(math.atan2(by, 89-bx))
                        values[6] = abs((aa-ba+180) % 360 - 180)
        values[7] = age
        out[event['eventId']] = values
        # Nothing below changes the already emitted current-event feature row.
        if state != strength:
            strength, spell_start = state, time if state is not None else None
        if code in LIVE and owner in (home, away):
            history.append((time, owner, code in (506, 507)))
            if code in (506, 507): last_attempt[owner] = (time, event)
        else:
            history, last_attempt = [], {}
            known = code in RESET or code == 505
    return out

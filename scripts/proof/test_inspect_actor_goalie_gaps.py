from copy import deepcopy
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import inspect_actor_goalie_gaps as c


def payload():
    clock = {'periodDescriptor': {'number': 1, 'periodType': 'REG'}, 'timeInPeriod': '01:00'}
    marker = {**clock, 'eventId': 1, 'typeCode': 509, 'details': {'typeCode': 'PS', 'drawnByPlayerId': 11, 'eventOwnerTeamId': 2}}
    shot = {**clock, 'eventId': 2, 'typeCode': 506, 'situationCode': '1010', 'details': {'shootingPlayerId': 11, 'eventOwnerTeamId': 1}}
    return {'id': 2022020001, 'homeTeam': {'id': 1}, 'awayTeam': {'id': 2}, 'plays': [marker, shot]}


def test_matching_marker_is_context_not_reassignment():
    p = payload(); before = deepcopy(p); row = c.same_clock_context(p, 2)
    assert row['category'] == 'same_clock_ps_matching_drawn_player'
    assert row['attribution_reassigned'] is False and row['publishable'] is False and p == before


@pytest.mark.parametrize('change,expected', [
    ('missing_drawn', 'same_clock_ps_missing_drawn_player'),
    ('different_drawn', 'same_clock_ps_different_drawn_player'),
    ('wrong_team', 'ps_marker_team_conflict'),
    ('different_clock', 'no_same_clock_ps_marker'),
    ('different_period', 'no_same_clock_ps_marker'),
    ('not_ps', 'no_same_clock_ps_marker'),
    ('multiple', 'multiple_same_clock_ps_markers')])
def test_distinct_context_reasons(change, expected):
    p = payload(); marker = p['plays'][0]
    if change == 'missing_drawn': marker['details'].pop('drawnByPlayerId')
    elif change == 'different_drawn': marker['details']['drawnByPlayerId'] = 12
    elif change == 'wrong_team': marker['details']['eventOwnerTeamId'] = 1
    elif change == 'different_clock': marker['timeInPeriod'] = '00:59'
    elif change == 'different_period': marker['periodDescriptor'] = {'number': 2, 'periodType': 'REG'}
    elif change == 'not_ps': marker['details']['typeCode'] = 'MIN'
    else: p['plays'].insert(1, {**deepcopy(marker), 'eventId': 3})
    assert c.same_clock_context(p, 2)['category'] == expected


def test_intervening_stoppage_retained_not_dropped():
    p = payload(); stop = {**deepcopy(p['plays'][0]), 'eventId': 3, 'typeCode': 516, 'details': {'reason': 'tv-timeout'}}
    p['plays'].insert(1, stop)
    row = c.same_clock_context(p, 2)
    assert row['intervening_event_types'] == [516] and len(row['same_clock_prior_events']) == 2


def test_duplicate_target_rejected():
    p = payload(); p['plays'].append(deepcopy(p['plays'][1]))
    with pytest.raises(ValueError): c.same_clock_context(p, 2)

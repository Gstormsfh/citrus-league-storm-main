"""Independent synthetic PL correspondence/annotation review; no model fitting."""
from copy import deepcopy

import pytest
from projections import pl_onice_membership as m


def player(jersey=9, position='R', name='Example'):
    return f'<table><tr><td><font title="Right Wing - {name}">{jersey}</font></td></tr><tr><td>{position}</td></tr></table>'


def fixture():
    row = dict(report_row=6, period=1, seconds_into_period=11, event_type='SHOT',
               actor_team_abbrev='OTT', actor_sweater=9,
               away=m.parse_cell(player()), home=m.parse_cell(player()))
    pbp = dict(homeTeam=dict(id=9, abbrev='OTT'), awayTeam=dict(id=26, abbrev='LAK'),
               rosterSpots=[dict(teamId=9, playerId=100, sweaterNumber=9, positionCode='R'),
                            dict(teamId=26, playerId=200, sweaterNumber=9, positionCode='L')],
               plays=[dict(eventId=600, typeCode=506, timeInPeriod='00:11',
                           periodDescriptor=dict(number=1, periodType='REG'),
                           details=dict(eventOwnerTeamId=9, shootingPlayerId=100))])
    return row, pbp


def test_shared_jersey_across_teams_valid_with_position_disagreement_preserved():
    row, pbp = fixture()
    before = deepcopy((row, pbp))
    result = m.join_rows([row], pbp)[0]
    assert result['status'] == 'uniquely_matched_retrospective'
    assert result['home']['player_ids'] == [100]
    assert result['away']['player_ids'] == [200]
    assert result['away']['resolved_entries'][0]['position_agrees'] is False
    assert (row, pbp) == before


def test_nested_tables_preserve_order_not_nested_event_rows():
    cell = m.parse_cell('<table><tr><td>' + player(17, 'L') + '</td><td>&nbsp;</td><td>' + player(8, 'D') + '</td></tr></table>')
    assert cell['status'] == 'recorded'
    assert [r['sweater_number'] for r in cell['raw_entries']] == [17, 8]
    assert [r['recorded_position'] for r in cell['raw_entries']] == ['L', 'D']


@pytest.mark.parametrize('raw', [player() + player(), player(position='X'),
                                player().replace('</font>', ''), player(jersey='abc')])
def test_malformed_membership_is_not_empty_or_resolved(raw):
    assert m.parse_cell(raw)['status'] == 'malformed'


def test_position_from_unrelated_table_cannot_complete_player():
    raw = '<table><tr><td><font title="Example">9</font></td></tr></table><table><tr><td>R</td></tr></table>'
    assert m.parse_cell(raw)['status'] == 'malformed'


def test_duplicate_report_identity_withholds_all():
    row, pbp = fixture()
    other = {**deepcopy(row), 'report_row': 7}
    result = m.join_rows([row, other], pbp)[0]
    assert result['status'] == 'unmatched_or_ambiguous'
    assert result['report_row'] is None


def test_duplicate_pbp_identity_withholds_both_not_first_wins():
    row, pbp = fixture()
    pbp['plays'].append({**deepcopy(pbp['plays'][0]), 'eventId': 601})
    result = m.join_rows([row], pbp)
    assert all(r['status'] == 'unmatched_or_ambiguous' for r in result)


def test_actor_jersey_must_map_back_to_unique_player():
    row, pbp = fixture()
    pbp['rosterSpots'].append(dict(teamId=9, playerId=101, sweaterNumber=9, positionCode='C'))
    assert m.join_rows([row], pbp)[0]['status'] == 'unmatched_or_ambiguous'


def test_membership_player_cannot_have_two_roster_jerseys():
    row, pbp = fixture()
    pbp['rosterSpots'].append(dict(teamId=26, playerId=200, sweaterNumber=17, positionCode='L'))
    result = m.join_rows([row], pbp)[0]
    assert result['away']['player_ids'] is None
    assert result['away']['status'] != 'resolved_retrospective'


def test_empty_cell_is_unknown_not_zero_players():
    row, pbp = fixture()
    row['away'] = m.parse_cell('&nbsp;')
    result = m.join_rows([row], pbp)[0]
    assert result['away']['player_ids'] is None
    assert result['away']['status'] == 'empty_unavailable'


def test_event_outcome_is_join_metadata_not_causal_invariance_claim():
    row, pbp = fixture()
    goal = deepcopy(pbp)
    goal['plays'][0]['typeCode'] = 505
    goal['plays'][0]['details']['scoringPlayerId'] = 100
    assert m.join_rows([row], pbp)[0]['status'] == 'uniquely_matched_retrospective'
    assert m.join_rows([row], goal)[0]['status'] == 'unmatched_or_ambiguous'


@pytest.mark.parametrize('extra', ['<tr><td>R</td></tr>', '<tr><td>L</td></tr>'])
def test_extra_recognized_position_is_malformed(extra):
    raw = player().replace('</table>', extra + '</table>')
    assert m.parse_cell(raw)['status'] == 'malformed'


def test_boolean_actor_does_not_alias_integer_player():
    row, pbp = fixture()
    pbp['rosterSpots'][0]['playerId'] = 1
    pbp['plays'][0]['details']['shootingPlayerId'] = True
    try:
        result = m.join_rows([row], pbp)[0]
    except ValueError:
        return
    assert result['status'] == 'unmatched_or_ambiguous'


def test_malformed_conflicting_roster_identity_not_silently_ignored():
    row, pbp = fixture()
    pbp['rosterSpots'].append(dict(teamId=9, playerId='101', sweaterNumber=9, positionCode='C'))
    try:
        result = m.join_rows([row], pbp)[0]
    except ValueError:
        return
    assert result['status'] == 'unmatched_or_ambiguous'


@pytest.mark.parametrize('bad', [-1, True])
def test_invalid_event_identity_rejected(bad):
    row, pbp = fixture()
    pbp['plays'][0]['eventId'] = bad
    with pytest.raises(ValueError):
        m.join_rows([row], pbp)


def test_build_remains_retrospective_not_predictor_contract(monkeypatch):
    row, pbp = fixture()
    pbp.update(id=2018020059, gameDate='2018-10-13')
    monkeypatch.setattr(m, 'parse_report', lambda *args, **kwargs: [row])
    cells = ['6', '1', 'EV', '0:11<br>19:49', 'SHOT', 'OTT ONGOAL - #9 Example', player(), player()]
    body = ('<table><tr class="evenColor">' + ''.join('<td>' + c + '</td>' for c in cells) + '</tr></table>').encode()
    result = m.build(body, pbp)
    assert result['publishable'] is False
    assert result['prediction_eligible'] is False
    assert result['scope'] == 'retrospective_recorded_onice_membership_not_shift_intervals'
    assert len(result['report_rows']) == 1
    assert len(result['shots']) == 1


@pytest.mark.parametrize('period_type,period_number', [('REG', True), ('UNKNOWN', 1)])
def test_invalid_period_cannot_create_unique_match(period_type, period_number):
    row, pbp = fixture()
    pbp['plays'][0]['periodDescriptor'] = dict(number=period_number, periodType=period_type)
    try:
        result = m.join_rows([row], pbp)[0]
    except ValueError:
        return
    assert result['status'] == 'unmatched_or_ambiguous'

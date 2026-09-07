from copy import deepcopy
import pytest
from projections.pl_onice_membership import parse_cell, join_rows, _Outer


def cell(jersey='9', position='C'):
    return f'<table><tr><td><table><tr><td><font title="Center - PERSON">{jersey}</font></td></tr><tr><td>{position}</td></tr></table></td></tr></table>'


def row(number=1):
    return {'report_row': number, 'period': 1, 'seconds_into_period': 11, 'event_type': 'SHOT',
            'actor_team_abbrev': 'BBB', 'actor_sweater': 9,
            'away': parse_cell(cell()), 'home': parse_cell(cell())}


def source():
    return {'homeTeam': {'id': 2, 'abbrev': 'BBB'}, 'awayTeam': {'id': 1, 'abbrev': 'AAA'},
            'rosterSpots': [{'teamId': 1, 'playerId': 101, 'sweaterNumber': 9, 'positionCode': 'C'},
                            {'teamId': 2, 'playerId': 201, 'sweaterNumber': 9, 'positionCode': 'R'}],
            'plays': [{'eventId': 1, 'typeCode': 506, 'timeInPeriod': '00:11',
                       'periodDescriptor': {'number': 1, 'periodType': 'REG'},
                       'details': {'eventOwnerTeamId': 2, 'shootingPlayerId': 201}}]}


def test_nested_cell_preserves_recorded_title_jersey_position():
    out = parse_cell(cell())
    assert out['status'] == 'recorded'
    assert out['raw_entries'] == [{'raw_title': 'Center - PERSON', 'raw_sweater': '9', 'sweater_number': 9, 'recorded_position': 'C'}]


@pytest.mark.parametrize('raw', ['&nbsp;', '', ' \n '])
def test_empty_not_zero_players(raw):
    assert parse_cell(raw)['status'] == 'empty_unavailable'


@pytest.mark.parametrize('raw', [cell('bad'), cell(position='X'), cell()+cell(), cell()[:-8], '<p>unparsed</p>'])
def test_malformed_not_silent_skip(raw):
    assert parse_cell(raw)['status'] == 'malformed'


def test_nested_tables_not_extra_event_rows():
    parser = _Outer()
    parser.feed('<table><tr class="evenColor">' + '<td>x</td>'*6 + '<td>'+cell()+'</td><td>'+cell()+'</td></tr></table>')
    parser.close()
    assert len(parser.rows) == 1 and len(parser.rows[0]) == 8


def test_same_sweater_opposing_teams_and_position_disagreement_preserved():
    out = join_rows([row()], source())[0]
    assert out['away']['player_ids'] == [101]
    assert out['home']['player_ids'] == [201]
    assert out['home']['resolved_entries'][0]['position_agrees'] is False


def test_duplicate_pbp_candidate_withholds_both():
    pbp = source(); second = deepcopy(pbp['plays'][0]); second['eventId'] = 2; pbp['plays'].append(second)
    assert all(r['status'] == 'unmatched_or_ambiguous' for r in join_rows([row()], pbp))


def test_duplicate_report_candidate_withholds():
    assert join_rows([row(), row(2)], source())[0]['report_row'] is None


def test_ambiguous_jersey_cell_and_actor_inverse_mapping_withhold():
    pbp = source(); pbp['rosterSpots'].append({'teamId': 1, 'playerId': 102, 'sweaterNumber': 9})
    assert join_rows([row()], pbp)[0]['away']['status'] == 'unavailable_mapping'
    pbp = source(); pbp['rosterSpots'].append({'teamId': 2, 'playerId': 201, 'sweaterNumber': 10})
    assert join_rows([row()], pbp)[0]['report_row'] is None


def test_inputs_unmodified_and_unmatched_retained():
    pbp = source(); rows = [row()]; before = deepcopy((pbp, rows))
    join_rows(rows, pbp)
    assert (pbp, rows) == before
    pbp['plays'][0]['timeInPeriod'] = '00:12'
    assert join_rows(rows, pbp)[0]['candidate_report_rows'] == []

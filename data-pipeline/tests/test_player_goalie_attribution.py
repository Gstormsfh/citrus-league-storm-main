from copy import deepcopy
import json

import pytest
from projections import player_goalie_attribution as c
from projections.analytics_publication import fingerprint

LINEAGE = {name: str(i) * 64 for i, name in enumerate(sorted(c.LINEAGE), 1)}


def payload(gid=2022020001, home=1):
    plays = [{'eventId': i, 'sortOrder': i, 'typeCode': code, 'timeInPeriod': '00:10',
        'periodDescriptor': {'number': 1, 'periodType': 'REG'}, 'situationCode': '1551',
        'details': {'eventOwnerTeamId': home, 'scoringPlayerId' if code == 505 else 'shootingPlayerId': 11,
                    'goalieInNetId': 21, 'xCoord': 60, 'yCoord': 10}} for i, code in enumerate((505, 506, 507), 1)]
    return {'id': gid, 'season': (gid // 1_000_000) * 10000 + gid // 1_000_000 + 1,
            'gameType': gid // 10000 % 100, 'homeTeam': {'id': home}, 'awayTeam': {'id': 2},
            'plays': plays, 'rosterSpots': [
                {'playerId': 11, 'teamId': home, 'positionCode': 'C'},
                {'playerId': 12, 'teamId': home, 'positionCode': 'G'},
                {'playerId': 21, 'teamId': 2, 'positionCode': 'G'},
                {'playerId': 22, 'teamId': 2, 'positionCode': 'C'}]}


def args(p):
    expected = [{'game_id': p['id'], 'event_id': row['eventId'], 'source_event_sha256': fingerprint(row)} for row in p['plays']]
    predictions = [{'game_id': p['id'], 'event_id': i, 'probability': value} for i, value in enumerate((0, .2, .7), 1)]
    return json.dumps(p).encode(), expected, predictions


def build(p=None):
    return c.attribute_game(*args(p or payload()), lineage=LINEAGE, observed_at='2026-09-06T05:00:01Z')


def actor(result, pid=11, role='shooter', kind='regular'):
    return next(r for r in result['rows'] if (r['player_id'], r['role'], r['game_type']) == (pid, role, kind))


def test_complete_event_accounting_and_zero_not_missing():
    game = build(); output = c.aggregate_diagnostics([game]); row = actor(output)
    assert game['accounting']['shooter']['attributed'] == {'events': 3, 'xg': .8999999999999999, 'goals': 1}
    assert row['eligible_event_xg'] == pytest.approx(.9)
    assert row['eligible_event_count'] == 3 and row['eligible_event_goals'] == 1
    assert actor(output, 22)['eligible_event_xg'] == 0
    assert actor(output, 21, 'defending_goalie')['eligible_event_count'] == 3  # Includes the missed attempt.
    assert row['appearance_games'] is None and row['toi_seconds'] is None and row['xg_per60'] is None
    assert output['model_accepted'] is False and output['publishable'] is False


def test_goalie_as_shooter_preserved():
    p = payload(); p['plays'][0]['details']['scoringPlayerId'] = 12
    game = build(p); output = c.aggregate_diagnostics([game])
    assert game['events'][0]['shooter']['player_id'] == 12
    assert actor(output, 12)['eligible_event_count'] == 1


def test_empty_net_is_not_a_goalie_zero_or_prior_goalie_credit():
    p = payload(); p['plays'][1]['situationCode'] = '0651'; p['plays'][1]['details'].pop('goalieInNetId')
    game = build(p)
    assert game['events'][1]['defending_goalie']['status'] == 'not_applicable'
    assert game['accounting']['defending_goalie']['not_applicable']['events'] == 1
    assert actor(c.aggregate_diagnostics([game]), 21, 'defending_goalie')['eligible_event_count'] == 2


@pytest.mark.parametrize('raw', [21, 0, True, '21'])
def test_empty_net_with_any_recorded_actor_is_unresolved(raw):
    p = payload(); p['plays'][1]['situationCode'] = '0651'; p['plays'][1]['details']['goalieInNetId'] = raw
    row = build(p)['events'][1]['defending_goalie']
    assert row['status'] == 'unavailable' and row['reason'] == 'empty_net_actor_conflict'
    assert row['player_id'] is None


@pytest.mark.parametrize('code', [None, '', '9999', '1661', '1550x', '１５５１', 1551, True])
def test_unknown_situation_cannot_be_repaired_from_valid_goalie_id(code):
    p = payload(); p['plays'][1]['situationCode'] = code
    game = build(p); row = actor(c.aggregate_diagnostics([game]), 21, 'defending_goalie')
    assert game['events'][1]['defending_goalie']['reason'] == 'unknown_goalie_presence'
    assert row['eligible_event_xg'] is None and row['eligible_event_count'] is None
    assert row['attributed_event_subtotal'] == 2 and row['incomplete_game_ids'] == [p['id']]


@pytest.mark.parametrize('bad', ['missing', 'absent', 'team', 'position'])
def test_invalid_defending_actor_is_unavailable(bad):
    p = payload()
    if bad == 'missing': p['plays'][1]['details'].pop('goalieInNetId')
    elif bad == 'absent': p['plays'][1]['details']['goalieInNetId'] = 99
    elif bad == 'team': p['plays'][1]['details']['goalieInNetId'] = 12
    else: p['plays'][1]['details']['goalieInNetId'] = 22
    assert build(p)['events'][1]['defending_goalie']['status'] == 'unavailable'


def test_missing_shooter_withholds_whole_team_not_just_partial_actor():
    p = payload(); p['plays'][1]['details'].pop('shootingPlayerId')
    out = c.aggregate_diagnostics([build(p)])
    for pid in (11, 12): assert actor(out, pid)['eligible_event_count'] is None
    assert actor(out)['attributed_event_subtotal'] == 2
    assert actor(out, 22)['eligible_event_count'] == 0


@pytest.mark.parametrize('bad', ['none', 'duplicate', 'team', 'position', 'position_list', 'boolean_id', 'no_team_goalie'])
def test_bad_roster_is_not_empty_complete_population(bad):
    p = payload()
    if bad == 'none': p.pop('rosterSpots')
    elif bad == 'duplicate': p['rosterSpots'].append(deepcopy(p['rosterSpots'][0]))
    elif bad == 'team': p['rosterSpots'][0]['teamId'] = 99
    elif bad == 'position': p['rosterSpots'][0]['positionCode'] = 'unknown'
    elif bad == 'position_list': p['rosterSpots'][0]['positionCode'] = []
    elif bad == 'no_team_goalie': p['rosterSpots'][2]['positionCode'] = 'C'
    else: p['rosterSpots'][0]['playerId'] = True
    game = build(p); out = c.aggregate_diagnostics([game])
    assert game['roster_reason'] and out['complete_roster_population'] is False
    assert out['rows'] == [] and out['unknown_roster_game_ids'] == [p['id']]


def test_traded_player_stints_sum_without_duplicate_total_or_playoff_merge():
    games = [build(), build(payload(2022020002, 3)), build(payload(2022030001))]
    before = deepcopy(games); out = c.aggregate_diagnostics(games)
    assert games == before
    regular, playoff = actor(out), actor(out, kind='playoff')
    assert regular['eligible_event_count'] == 6 and playoff['eligible_event_count'] == 3
    assert regular['eligible_event_xg'] == sum(r['eligible_event_xg'] for r in regular['team_stints'])
    assert [r['team_id'] for r in regular['team_stints']] == [1, 3]
    assert len(regular['roster_listed_game_ids']) == 2 and regular['appearance_games'] is None


@pytest.mark.parametrize('bad', ['missing', 'duplicate', 'extra', 'wrong_game', 'bool_event', 'nan', 'negative', 'above_one', 'bool_probability', 'event_hash'])
def test_detached_or_invalid_prediction_population_rejected(bad):
    body, expected, predictions = args(payload())
    if bad == 'missing': predictions.pop()
    elif bad == 'duplicate': predictions[1] = deepcopy(predictions[0])
    elif bad == 'extra': predictions[0]['event_id'] = 99
    elif bad == 'wrong_game': predictions[0]['game_id'] += 1
    elif bad == 'bool_event': predictions[0]['event_id'] = True
    elif bad == 'event_hash': expected[0]['source_event_sha256'] = 'a' * 64
    else: predictions[0]['probability'] = {'nan': float('nan'), 'negative': -.1, 'above_one': 1.1, 'bool_probability': True}[bad]
    with pytest.raises(ValueError): c.attribute_game(body, expected, predictions, lineage=LINEAGE, observed_at='2026-09-06T05:00:01Z')


@pytest.mark.parametrize('bad', ['duplicate_game', 'drift', 'promoted', 'model_lineage'])
def test_aggregate_rejects_duplicate_or_changed_lineage(bad):
    games = [build(), build(payload(2022020002))]
    if bad == 'duplicate_game': games[1] = deepcopy(games[0])
    elif bad == 'drift': games[0]['events'][0]['probability'] = .8
    elif bad == 'promoted': games[0]['publishable'] = True
    else:
        games[1]['lineage']['raw_model_sha256'] = 'a' * 64
        games[1]['receipt_sha256'] = fingerprint({k: v for k, v in games[1].items() if k != 'receipt_sha256'})
    with pytest.raises(ValueError): c.aggregate_diagnostics(games)

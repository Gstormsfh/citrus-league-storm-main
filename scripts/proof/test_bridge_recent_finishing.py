from copy import deepcopy
import pytest
import bridge_recent_finishing as b
from test_compose_player_finishing import rows


def fixture():
    r = rows()
    for x in r: x['game_date'] = '2022-10-07'
    pred = {(x['game_id'], x['event_id']): {'neutral_xg': .3, 'baseline_neutral_xg': x['neutral_xg'],
            'publishable': False, 'bundle_fingerprint': 'a', 'recent_sidecar_fingerprint': 'b'} for x in r}
    return r, pred, {('a', 'b'): ('2022-10-01', '2022-10-31')}


def test_exact_recent_binding_and_recomputed_rates():
    out = b.attach(*fixture())
    p = b.aggregate(out, 'c'*64)[0]
    assert p['neutral_xg'] == pytest.approx(.9)
    assert p['eligible_event_goals'] == 1
    assert p['rates']['estimated_talent'] is None
    assert all(x['recent_sidecar_fingerprint'] == 'b' for x in out)


@pytest.mark.parametrize('bad', ['sidecar', 'base', 'date', 'missing', 'duplicate', 'promoted', 'baseline'])
def test_attachment_rejects_mixed_lineage(bad):
    r, p, pairs = fixture(); first = next(iter(p))
    if bad == 'sidecar': p[first]['recent_sidecar_fingerprint'] = 'c'
    elif bad == 'base': p[first]['bundle_fingerprint'] = 'c'
    elif bad == 'date': r[0]['game_date'] = '2022-11-01'
    elif bad == 'missing': p.pop(first)
    elif bad == 'duplicate': r.append(r[0])
    elif bad == 'promoted': p[first]['publishable'] = True
    else: p[first]['baseline_neutral_xg'] = .999
    with pytest.raises(ValueError): b.attach(r, p, pairs)


def test_credit_only_player_preserved_without_inventing_shots():
    r = rows(); credit = {**r[0], 'event_id': 9, 'player_id': 8479999, 'goal_credit': 1}
    totals = b.credit_totals(r, [credit])
    only = next(x for x in totals if x['player_id'] == 8479999)
    assert only['shot_event_goals'] == 0 and only['non_shot_goal_credits'] == 1
    assert only['complete_season_actuals'] is False
    assert sum(x['captured_goal_credits'] for x in totals) == 2
    assert b.aggregate(r, 'a'*64)[0]['rates']['shooting_percentage'] == 50
    with pytest.raises(ValueError): b.credit_totals(r, [{**credit, 'event_id': 1}])


def test_credit_team_stints_and_playoffs_separate():
    r = rows(); r[1]['team_id'] = 2
    extra = deepcopy(r[0]); extra.update(game_id=2022030001, game_type='playoff')
    out = b.credit_totals(r+[extra], [])
    assert len(out) == 3
    assert out == b.credit_totals((r+[extra])[::-1], [])


def test_recovered_nonshot_keeps_credit_and_rejects_probability():
    play = {'eventId': 1, 'typeCode': 505, 'periodDescriptor': {'periodType': 'REG'},
            'details': {'eventOwnerTeamId': 1, 'scoringPlayerId': 8470001}}
    payload = {'id': 2022020001, 'gameDate': '2022-10-07', 'gameType': 2, 'plays': [play],
               'rosterSpots': [{'teamId': 1, 'playerId': 8470001}]}
    event = {'event_id': 1, 'source_event_sha256': b.fingerprint(play), 'statistical_shot_attempt': False,
             'reviewed_non_shot_goal': True, 'team_id': 1, 'player_id': 8470001, 'shot_event_goal': 0,
             'official_goal_credit': 1, 'recorded_sog': 0, 'model_probability': None}
    partition = {'game_id': payload['id'], 'publishable': False, 'events': [event]}
    attempts, credits = b.recover(payload, partition, 'a'*64)
    assert attempts == [] and credits[0]['goal_credit'] == 1
    event['model_probability'] = .1
    with pytest.raises(ValueError): b.recover(payload, partition, 'a'*64)

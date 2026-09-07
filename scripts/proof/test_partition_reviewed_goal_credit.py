from copy import deepcopy
import pytest
import partition_reviewed_goal_credit as m


def fixture():
    def play(eid, code):
        return {'eventId': eid, 'typeCode': code, 'periodDescriptor': {'number': 1, 'periodType': 'REG'},
                'timeInPeriod': '01:02', 'details': {'eventOwnerTeamId': 1, 'scoringPlayerId': 8470001, 'shootingPlayerId': 8470001}}
    payload = {'id': 2022020001, 'rosterSpots': [{'teamId': 1, 'playerId': 8470001}],
               'plays': [play(1, 505), play(2, 505), play(3, 507)]}
    review = {'game_id': payload['id'], 'statistical_treatment_supported': True, 'publishable': False,
              'production_activated': False, 'feature_export_activated': False,
              'players': [{'team_id': 1, 'player_id': 8470001, 'official': {'goals': 2, 'sog': 1}}],
              'event_overlays': [{'event_id': 1, 'source_event_sha256': m.fingerprint(payload['plays'][0]),
                  'team_id': 1, 'player_id': 8470001, 'goal_credit': 1, 'recorded_sog_contribution': 0,
                  'base_shot_model_attempt_eligible': False, 'model_probability': None}]}
    return payload, review


def test_credit_can_exceed_sog_without_false_shot_conversion():
    p, r = fixture(); original = deepcopy(p); out = m.partition(p, r); row = out['players'][0]
    assert row['goal_credits'] == 2 and row['shot_event_goals'] == 1
    assert row['credited_goals_per_100_sog'] == 200 and row['shot_conversion_percentage'] == 100
    assert row['neutral_xg'] is None and row['estimated_talent'] is None
    assert len(out['events']) == len(p['plays']) and p == original
    assert out['events'][0]['official_goal_credit'] == 1
    assert out['events'][0]['statistical_shot_attempt'] is False
    assert all(e['model_probability'] is None for e in out['events'])


@pytest.mark.parametrize('field,value', [('source_event_sha256', 'bad'), ('player_id', 9), ('goal_credit', True),
    ('recorded_sog_contribution', 1), ('base_shot_model_attempt_eligible', True), ('model_probability', 0)])
def test_invalid_overlay_rejected(field, value):
    p, r = fixture(); r['event_overlays'][0][field] = value
    with pytest.raises(ValueError): m.partition(p, r)


def test_duplicate_overlay_and_source_event_rejected():
    p, r = fixture(); r['event_overlays'] *= 2
    with pytest.raises(ValueError): m.partition(p, r)
    p, r = fixture(); p['plays'].append(p['plays'][0])
    with pytest.raises(ValueError): m.partition(p, r)


@pytest.mark.parametrize('mutation', ['unresolved', 'unknown_event', 'shootout', 'wrong_total'])
def test_fail_closed(mutation):
    p, r = fixture()
    if mutation == 'unresolved': r['statistical_treatment_supported'] = False
    if mutation == 'unknown_event': r['event_overlays'][0]['event_id'] = 900
    if mutation == 'shootout': p['plays'][0]['periodDescriptor']['periodType'] = 'SO'
    if mutation == 'wrong_total': r['players'][0]['official']['sog'] = 2
    with pytest.raises(ValueError): m.partition(p, r)


def test_report_includes_misses_and_multiplicity():
    p, _ = fixture(); p.update(homeTeam={'id': 1, 'abbrev': 'ABC'}, awayTeam={'id': 2, 'abbrev': 'DEF'})
    p['rosterSpots'][0]['sweaterNumber'] = 7
    reviewer = m.module('review_goal_sog_evidence')
    def row(n, kind, clock='1:02'):
        return f'<tr id="PL-{n}"><td>{n}</td><td>1</td><td>EV</td><td>{clock}<br>18:58</td><td>{kind}</td><td>ABC #7 TEST(1)</td>'
    body = (row(1, 'GOAL')+row(2, 'GOAL')+row(3, 'MISS')).encode()
    result = m.match_report_attempts(p, body, reviewer)
    assert result['attempts'] == 3 and result['duplicate_identity_clock_groups'] == 1
    for wrong in ((row(1, 'GOAL')+row(3, 'MISS')).encode(), body.replace(b'MISS', b'SHOT'), body.replace(b'1:02', b'1:03')):
        with pytest.raises(ValueError): m.match_report_attempts(p, wrong, reviewer)

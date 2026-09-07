from copy import deepcopy
import pytest
import reconstruct_reviewed_features as m


def fixture():
    def event(eid, code, time):
        return {'eventId': eid, 'sortOrder': eid, 'typeCode': code, 'timeInPeriod': time,
                'periodDescriptor': {'number': 1, 'periodType': 'REG'}, 'homeTeamDefendingSide': 'left',
                'situationCode': '1551', 'details': {'eventOwnerTeamId': 1, 'xCoord': 75, 'yCoord': 10, 'shotType': 'wrist'}}
    p = {'id': 2022020001, 'gameDate': '2022-10-01', 'homeTeam': {'id': 1}, 'awayTeam': {'id': 2},
         'plays': [event(1, 520, '00:00'), event(2, 506, '01:00'), event(3, 505, '01:01'), event(4, 506, '01:02')]}
    partition = {'game_id': p['id'], 'events': [{'event_id': e['eventId'], 'raw_sequence_index': i,
        'source_event_sha256': m.fingerprint(e), 'statistical_shot_attempt': e['typeCode'] == 506,
        'shot_event_goal': 0, 'reviewed_non_shot_goal': e['typeCode'] == 505} for i, e in enumerate(p['plays'])]}
    return p, partition


def test_nonshot_goal_updates_score_and_resets_movement_without_becoming_row():
    p, side = fixture(); before = deepcopy(p); out = m.project(p, side)
    assert p == before and [r['event_id'] for r in out['rows']] == [2, 4]
    names = m.SCHEMA['names']; after = dict(zip(names, out['rows'][1]['features']))
    assert after['score_differential_pre_shot'] == 1
    assert after['prior_same_team_unblocked_attempt__event_elapsed_seconds'] is None
    assert after['immediate_recorded_live_event__event_elapsed_seconds'] is None
    assert out['rows'][1]['categorical']['previous_event_type'] == '505'
    assert out['pre_shootout_goal_credits'] == {1: 1, 2: 0}
    assert len(out['rows'][1]['features']) == 47


def test_future_coordinates_do_not_change_earlier_features():
    p, side = fixture(); original = m.project(p, side)['rows'][0]
    p['plays'][-1]['details']['yCoord'] = -35
    side['events'][-1]['source_event_sha256'] = m.fingerprint(p['plays'][-1])
    assert m.project(p, side)['rows'][0] == original


def test_inventory_drift_rejected():
    p, side = fixture(); p['plays'][1]['details']['xCoord'] = 3
    with pytest.raises(ValueError): m.project(p, side)


def test_geometry_missing_is_excluded_not_imputed():
    p, side = fixture(); p['plays'][1]['details'].pop('xCoord')
    side['events'][1]['source_event_sha256'] = m.fingerprint(p['plays'][1])
    out = m.project(p, side)
    assert [r['event_id'] for r in out['rows']] == [4]
    assert out['exclusions'][0]['reason'] == 'missing_geometry'

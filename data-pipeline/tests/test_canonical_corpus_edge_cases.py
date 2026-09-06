"""Regression cases found at the official receipt / stored corpus boundary."""
import copy
import pytest

from acquisition.event_observation_service import prepare_observation
from monitoring.canonical_corpus import compare_official
from tests.test_canonical_events import game, shot


def corpus_fixture(duplicate=False):
    event = shot(details={'eventOwnerTeamId': 1, 'shootingPlayerId': 7,
                          'xCoord': 60, 'yCoord': 10, 'shotType': 'wrist'})
    payload = game([event, copy.deepcopy(event)] if duplicate else [event])
    payload.update(gameState='OFF', periodDescriptor={'number': 3, 'periodType': 'REG'})
    payload['homeTeam'].update(score=0, sog=1)
    payload['awayTeam'].update(score=0, sog=0)
    prepared = prepare_observation(payload,
                                   '2026-01-01T00:00:00Z')
    observed = prepared[1][0]
    nhl = {**observed, 'seconds_elapsed': 60}
    raw = {**observed, 'player_id': observed['shooter_id'], 'shot_x': observed['x_raw'],
           'shot_y': observed['y_raw'], 'time_in_period': '01:00', 'type_desc': observed['event_type']}
    return {'nhl': [nhl], 'raw': [raw]}, {
        'game_id': observed['game_id'], 'observed_at': '2026-01-01T00:00:00Z',
        'prepared': prepared, 'status': prepared[2]['status']}


def test_outer_receipt_status_cannot_promote_a_quarantined_partial_event_set():
    snapshot, receipt = corpus_fixture(duplicate=True)
    assert receipt['prepared'][2]['status'] == 'quarantined'
    receipt['status'] = 'complete'
    with pytest.raises(ValueError, match='integrity|status|quarantin'):
        compare_official(snapshot, [receipt])


@pytest.mark.parametrize('source', ['nhl', 'raw'])
def test_stored_period_type_conflict_does_not_count_as_verified(source):
    snapshot, receipt = corpus_fixture()
    snapshot[source][0]['period_type'] = 'OT'
    report = compare_official(snapshot, [receipt])
    affected = next(item for item in report['games'] if item['source'] == source)
    assert affected['status'] == 'quarantined'
    assert affected['identity_verified_events'] == 0


@pytest.mark.parametrize('source', ['nhl', 'raw'])
def test_non_string_stored_shot_type_is_quarantined_without_crashing_report(source):
    snapshot, receipt = corpus_fixture()
    snapshot[source][0]['shot_type'] = 7
    report = compare_official(snapshot, [receipt])
    affected = next(item for item in report['games'] if item['source'] == source)
    assert affected['status'] == 'quarantined'
    assert affected['identity_verified_events'] == 0

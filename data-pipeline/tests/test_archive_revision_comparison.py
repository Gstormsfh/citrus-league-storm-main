import copy
from datetime import datetime, timezone

import pytest

from acquisition.event_observation_service import prepare_observation
from monitoring.archive_revision_comparison import compare_archive_revision, changed_paths
from tests.test_archive_source_receipt import receipt

NOW = datetime(2026, 9, 7, tzinfo=timezone.utc)


def current(row, payload=None):
    payload = copy.deepcopy(row['raw_json'] if payload is None else payload)
    observed = '2026-09-06T04:12:59+00:00'
    prepared = prepare_observation(payload, observed)
    return {'game_id': row['game_id'], 'url': row['source_url'],
            'observed_at': observed, 'prepared': prepared, 'status': prepared[2]['status']}


def test_equal_payload_different_receipt_identity_preserves_times_and_inputs():
    row = receipt(); fresh = current(row)
    before = copy.deepcopy((row, fresh))
    report = compare_archive_revision(row, fresh, now=NOW)
    assert report['status'] == 'compared'
    assert report['payload']['equal'] and report['events']['equal']
    assert report['archive_fetched_at'] == row['fetched_at']
    assert report['current_observed_at'] == fresh['observed_at']
    assert not report['historical_as_of_verified'] and not report['corpus_coverage_verified']
    assert (row, fresh) == before
    assert compare_archive_revision(row, fresh, now=NOW)['evidence_id'] == report['evidence_id']


def test_top_level_media_change_is_not_event_change():
    row = receipt(); payload = copy.deepcopy(row['raw_json']); payload['video'] = 'new'
    report = compare_archive_revision(row, current(row, payload), now=NOW)
    assert report['payload']['changed_paths'] == ['/video']
    assert report['events']['equal']


def test_event_media_change_is_not_typed_shot_change():
    row = receipt(); payload = copy.deepcopy(row['raw_json']); payload['plays'][0]['video'] = 'new'
    report = compare_archive_revision(row, current(row, payload), now=NOW)
    assert not report['events']['equal']
    assert report['events']['typed_fields_equal']
    assert report['payload']['changed_paths'] == ['/plays/0/video']


def test_coordinate_change_is_typed_shot_change():
    row = receipt(); payload = copy.deepcopy(row['raw_json']); payload['plays'][0]['details']['xCoord'] = 19
    report = compare_archive_revision(row, current(row, payload), now=NOW)
    assert not report['events']['typed_fields_equal']
    assert any(path.endswith('/x_raw') for path in report['events']['typed_changed_paths'])


@pytest.mark.parametrize('field,value', [('url','https://evil.test'),('game_id',2025020002),
    ('observed_at','2026-09-06'),('observed_at','2028-01-01T00:00:00Z'),
    ('observed_at','2026-01-01T00:00:00Z'),('status','unavailable'),('prepared',[])])
def test_corrupt_current_receipt_rejected(field, value):
    row = receipt(); fresh = current(row); fresh[field] = value
    assert compare_archive_revision(row, fresh, now=NOW)['status'] == 'rejected'


@pytest.mark.parametrize('part',[0,1,2])
def test_all_prepared_receipt_parts_are_recomputed(part):
    row = receipt(); fresh = current(row)
    if part == 0:
        fresh['prepared'][0]['id'] = 'wrong'
    elif part == 1:
        fresh['prepared'][1][0]['x_raw'] = 99
    else:
        fresh['prepared'][2]['expected_events'] += 1
    report = compare_archive_revision(row, fresh, now=NOW)
    assert 'prepared_receipt_mismatch' in report['current']['reasons']


def test_archive_corruption_and_nonfinal_current_prevent_comparison():
    row = receipt(); fresh = current(row); row['content_sha256'] = '0'*64
    assert compare_archive_revision(row, fresh, now=NOW)['status'] == 'rejected'
    row = receipt(); payload = copy.deepcopy(row['raw_json']); payload['gameState'] = 'LIVE'
    report = compare_archive_revision(row, current(row,payload), now=NOW)
    assert report['status'] == 'rejected'
    assert report['current']['identity_and_payload_validation']['final_game']['reason'] == 'game_not_final'


@pytest.mark.parametrize('value',[None, [], {'prepared':None}, {'nan':float('nan')}])
def test_malformed_envelope_is_fail_closed(value):
    assert compare_archive_revision(receipt(), value, now=NOW)['status'] == 'rejected'


def test_diff_distinguishes_missing_null_bool_and_escapes_pointer():
    assert changed_paths({}, {'a/b~':None}) == ['/a~1b~0']
    assert changed_paths({'a':True}, {'a':1}) == ['/a']

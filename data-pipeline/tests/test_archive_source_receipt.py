import copy
from datetime import datetime, timezone
import hashlib
import json

import pytest

from monitoring.archive_source_receipt import legacy_semantic_sha256, validate_archive_receipt
from tests.test_final_game_evidence import final_game


NOW = datetime(2026, 9, 6, tzinfo=timezone.utc)


def receipt():
    payload = final_game()
    payload['gameDate'] = '2025-10-01'
    return {'game_id': payload['id'], 'game_date': payload['gameDate'],
            'source_url': f"https://api-web.nhle.com/v1/gamecenter/{payload['id']}/play-by-play",
            'fetched_at': '2026-08-11 01:54:45+00',
            'content_sha256': legacy_semantic_sha256(payload), 'raw_json': payload}


def check(row):
    return validate_archive_receipt(row, now=NOW)


def test_verified_receipt_preserves_fetch_time_and_binds_all_row_metadata():
    row = receipt()
    before = copy.deepcopy(row)
    report = check(row)
    assert report['eligible']
    assert report['provenance']['status'] == 'verified'
    assert report['normalization']['status'] == 'complete'
    assert report['final_game']['status'] == 'verified'
    assert report['fetched_at'] == row['fetched_at']
    assert report['fetched_at_utc'] == '2026-08-11T01:54:45+00:00'
    assert not report['historical_as_of_verified']
    assert not report['corpus_coverage_verified']
    assert row == before
    assert check(row)['evidence_id'] == report['evidence_id']
    later_clock = validate_archive_receipt(row, now=datetime(2026, 10, 1, tzinfo=timezone.utc))
    assert later_clock['evidence_id'] == report['evidence_id']
    row['fetched_at'] = '2026-08-12T01:54:45Z'
    assert check(row)['evidence_id'] != report['evidence_id']


@pytest.mark.parametrize('url',[
    'http://api-web.nhle.com/v1/gamecenter/2025020001/play-by-play',
    'https://api-web.nhle.com.evil.test/v1/gamecenter/2025020001/play-by-play',
    'https://user@api-web.nhle.com/v1/gamecenter/2025020001/play-by-play',
    'https://api-web.nhle.com/v1/gamecenter/2025020002/play-by-play',
    'https://api-web.nhle.com/v1/gamecenter/2025020001/boxscore',
])
def test_wrong_official_endpoint_is_rejected(url):
    row = receipt(); row['source_url'] = url
    assert 'official_endpoint_mismatch' in check(row)['provenance']['reasons']


@pytest.mark.parametrize('gid',[None, True, -1, '2025020001', 2025020000, 2025010001])
def test_invalid_row_game_identity(gid):
    row = receipt(); row['game_id'] = gid
    result = check(row)
    assert 'invalid_canonical_game_identity' in result['provenance']['reasons']
    assert not result['eligible']


@pytest.mark.parametrize('field,value',[
    ('id',2025020002),('season',20242025),('gameType',3),('season','20252026'),
    ('gameDate','2025-10-02'),('gameDate',None),
])
def test_raw_identity_date_conflict_even_with_matching_hash(field,value):
    row = receipt(); row['raw_json'][field] = value
    row['content_sha256'] = legacy_semantic_sha256(row['raw_json'])
    assert check(row)['provenance']['status'] == 'rejected'


@pytest.mark.parametrize('value',[None,'2025-02-30','20251001','2017-10-01'])
def test_invalid_archive_date(value):
    row = receipt(); row['game_date'] = value
    assert check(row)['provenance']['status'] == 'rejected'


@pytest.mark.parametrize('value',[None,'garbage','2026-08-11T01:54:45','2027-01-01T00:00:00Z'])
def test_missing_naive_invalid_future_fetch_time(value):
    row = receipt(); row['fetched_at'] = value
    assert check(row)['provenance']['status'] == 'rejected'


def test_missing_corrupt_and_nonfinite_payloads():
    for payload in (None, [], 'not JSON', {'invalid': float('nan')}, {'invalid': float('inf')}):
        row = receipt(); row['raw_json'] = payload
        result = check(row)
        assert not result['eligible']
        assert result['provenance']['status'] == 'rejected'
    with pytest.raises(ValueError):
        legacy_semantic_sha256({'nan': float('nan')})


def test_semantic_hash_is_not_http_bytes_or_compact_json_fingerprint():
    row = receipt()
    legacy_bytes = json.dumps(row['raw_json'], sort_keys=True).encode('utf-8')
    assert hashlib.sha256(legacy_bytes).hexdigest() == row['content_sha256']
    # Different wire formatting describes the same parsed object, without
    # proving that either representation was the original HTTP response body.
    wire_bytes = json.dumps(row['raw_json'], indent=4, sort_keys=False).encode('utf-8')
    assert json.loads(wire_bytes) == row['raw_json']
    row['content_sha256'] = hashlib.sha256(wire_bytes).hexdigest()
    assert 'legacy_semantic_hash_mismatch' in check(row)['provenance']['reasons']
    row['content_sha256'] = hashlib.sha256(json.dumps(row['raw_json'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    assert 'legacy_semantic_hash_mismatch' in check(row)['provenance']['reasons']


def test_completeness_and_final_game_gate_are_separate_from_provenance():
    row = receipt(); row['raw_json']['gameState'] = 'LIVE'
    row['content_sha256'] = legacy_semantic_sha256(row['raw_json'])
    result = check(row)
    assert result['provenance']['status'] == 'verified'
    assert result['normalization']['status'] == 'complete'
    assert result['final_game']['reason'] == 'game_not_final'
    assert not result['eligible']
    row = receipt(); row['raw_json']['plays'] = []
    row['content_sha256'] = legacy_semantic_sha256(row['raw_json'])
    result = check(row)
    assert result['provenance']['status'] == 'verified'
    assert result['normalization']['status'] == 'quarantined'
    assert result['final_game']['status'] == 'quarantined'
    assert not result['eligible']


def test_missing_events_and_malformed_normalization_are_not_eligible():
    row = receipt(); del row['raw_json']['plays']
    row['content_sha256'] = legacy_semantic_sha256(row['raw_json'])
    assert check(row)['normalization']['status'] == 'unavailable'
    row = receipt(); row['raw_json']['plays'][0]['eventId'] = None
    row['content_sha256'] = legacy_semantic_sha256(row['raw_json'])
    assert check(row)['normalization']['quarantine_reasons'] == ['missing_or_duplicate_event_id']


def test_validation_requires_aware_clock_and_object_row():
    with pytest.raises(ValueError):
        validate_archive_receipt(receipt(), now=datetime(2026, 9, 6))
    assert check(None)['provenance']['reasons'] == ['archive_row_not_object']

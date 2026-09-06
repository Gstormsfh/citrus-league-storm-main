"""Synthetic new-revision review tests; no automatic approval or live calls."""
from datetime import datetime, timezone
import json

import pytest

from acquisition.review_goal_sog_revisions import compare_receipt, sha
from acquisition.canonical_events import normalize_pbp
from monitoring.final_game_evidence import verify_final_game
from projections.analytics_publication import fingerprint
from acquisition.event_observation_service import prepare_observation


@pytest.fixture
def synthetic():
    event = {'eventId':1,'typeCode':505,'sortOrder':10,'timeInPeriod':'01:00',
             'periodDescriptor':{'number':1,'periodType':'REG'},
             'details':{'eventOwnerTeamId':1,'scoringPlayerId':10,'xCoord':82,'yCoord':7}}
    payload = {'id':2025020001,'gameType':2,'season':20252026,'gameState':'OFF',
               'homeTeam':{'id':1,'score':1,'sog':0},'awayTeam':{'id':2,'score':0,'sog':0},
               'periodDescriptor':{'number':3,'periodType':'REG'},'plays':[event]}
    receipt = {'prepared':list(prepare_observation(payload,'2026-01-01T00:00:00Z'))}
    record = {'game_id':payload['id'],'event_id':1,'source_snapshot_id':receipt['prepared'][0]['id'],
              'source_event_sha256':fingerprint(event),
              'prior_final_game_evidence':json.loads(json.dumps(verify_final_game(payload)))}
    return None, receipt, {'records':[record]}, None, None


def new_receipt(tmp_path, synthetic, change=False):
    _, receipt, manifest, _, _ = synthetic
    record = manifest['records'][0]
    payload = receipt['prepared'][0]['payload']['pbp']
    payload['gameDate'] = '2025-10-01'
    old_bytes = json.dumps(receipt).encode()
    record['original_receipt_bytes_sha256'] = sha(old_bytes)
    record['source_payload_sha256'] = fingerprint(payload)
    if change:
        payload['plays'][0]['details']['xCoord'] = 81
    body = json.dumps(payload).encode()
    (tmp_path/'body.json').write_bytes(body)
    url = 'https://api-web.nhle.com/v1/gamecenter/2025020001/play-by-play'
    new = {'game_id':2025020001,'url':url,'response_url':url,'http_status':200,'status':'quarantined',
           'requested_at':'2026-02-01T00:00:00Z','observed_at':'2026-02-01T00:00:01Z',
           'body_file':'body.json','body_bytes':len(body),'body_sha256':sha(body),
           'source_payload_sha256':fingerprint(payload),'normalization':normalize_pbp(payload),
           'final_game_evidence':verify_final_game(payload),
           'schedule_identity':{'date':'2025-10-01','home_team_id':1,'away_team_id':2}}
    path = tmp_path/'2025020001.receipt.json'
    path.write_text(json.dumps(new))
    return record, old_bytes, path


def test_same_payload_new_timestamp_is_pending_never_approved(tmp_path, synthetic):
    record, old, path = new_receipt(tmp_path, synthetic)
    got = compare_receipt(record, old, path, now=datetime(2026,3,1,tzinfo=timezone.utc))
    assert got['status'] == 'pending_new_revision_review_same_semantic_payload'
    assert got['same_semantic_event'] and got['same_semantic_payload']
    assert not got['new_revision_approved'] and not got['overlay_applied']
    assert got['new_source_snapshot_id'] != record['source_snapshot_id']
    assert got['original_http_byte_equality'].startswith('unavailable')


def test_changed_event_is_retained_not_grandfathered(tmp_path, synthetic):
    record, old, path = new_receipt(tmp_path, synthetic, change=True)
    got = compare_receipt(record, old, path, now=datetime(2026,3,1,tzinfo=timezone.utc))
    assert got['status'] == 'unresolved_changed_source'
    assert not got['same_semantic_event'] and not got['same_semantic_payload']
    assert got['old_event']['details']['xCoord'] == 82
    assert got['new_event']['details']['xCoord'] == 81
    assert got['changed_top_level_fields'] == ['plays']


@pytest.mark.parametrize('field,value', [('observed_at','2027-01-01T00:00:00Z'),
    ('observed_at','2026-02-01T00:00:01'),('http_status',503),('body_file','../escape'),
    ('source_payload_sha256','bad'),('body_sha256','bad')])
def test_new_receipt_invalid_provenance_is_rejected(tmp_path, synthetic, field, value):
    record, old, path = new_receipt(tmp_path, synthetic)
    data = json.loads(path.read_bytes());data[field] = value;path.write_text(json.dumps(data))
    with pytest.raises((ValueError,OSError)):
        compare_receipt(record, old, path, now=datetime(2026,3,1,tzinfo=timezone.utc))

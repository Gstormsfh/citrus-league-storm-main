"""Synthetic adapter isolation; production artifact pins are never relaxed."""
import base64
from copy import deepcopy
import json

import pytest

from acquisition import frozen_http_goal_sog_adjudication as module
from acquisition.canonical_events import normalize_pbp
from acquisition.event_observation_service import prepare_observation
from monitoring.final_game_evidence import verify_final_game
from projections.analytics_publication import fingerprint


def encode(value):return json.dumps(value,allow_nan=False).encode()


@pytest.fixture
def fixture(monkeypatch):
    event={'eventId':1,'typeCode':505,'sortOrder':1,'timeInPeriod':'01:00',
           'periodDescriptor':{'number':1,'periodType':'REG'},
           'details':{'eventOwnerTeamId':1,'scoringPlayerId':10,'xCoord':80,'yCoord':3}}
    payload={'id':2025020001,'season':20252026,'gameType':2,'gameState':'OFF','gameDate':'2025-10-01',
             'homeTeam':{'id':1,'score':1,'sog':0},'awayTeam':{'id':2,'score':0,'sog':0},
             'periodDescriptor':{'number':3,'periodType':'REG'},'plays':[event]}
    body=encode(payload);url='https://api-web.nhle.com/v1/gamecenter/2025020001/play-by-play'
    receipt={'game_id':2025020001,'url':url,'response_url':url,'http_status':200,
             'requested_at':'2026-01-01T00:00:00Z','observed_at':'2026-01-01T00:00:01Z',
             'body_file':'2025020001.body.json','body_bytes':len(body),'body_sha256':module.sha(body),
             'byte_contract':'requests-content-after-decompression-not-wire-bytes','historical_as_of_verified':False,
             'source_payload_sha256':fingerprint(payload),'normalization':normalize_pbp(payload),
             'final_game_evidence':verify_final_game(payload),'status':'quarantined',
             'schedule_identity':{'date':'2025-10-01','game_type':2,'game_state':'OFF',
                                  'schedule_state':'OK','home_team_id':1,'away_team_id':2}}
    raw=encode(receipt)
    record={'game_id':2025020001,'event_id':1,'new_http_body_sha256':module.sha(body),
            'new_receipt_bytes_sha256':module.sha(raw),'new_source_snapshot_id':prepare_observation(payload,receipt['observed_at'])[0]['id'],
            'new_source_payload_sha256':fingerprint(payload),'new_source_event_sha256':fingerprint(event),
            'new_original_final_gate':json.loads(encode(receipt['final_game_evidence'])),
            'new_observed_at':receipt['observed_at'],'new_body_path':'synthetic.body','new_receipt_path':'synthetic.receipt'}
    old={'team_id':1,'player_id':10,'period':event['periodDescriptor'],'clock':'01:00','sort_order':1,'mechanism':'synthetic'}
    monkeypatch.setattr(module,'validate_http_approval',lambda **kwargs:({'records':[record]},{2025020001:old}))
    kwargs={k:b'synthetic' for k in ('http_manifest_bytes','revision_review_bytes','prior_manifest_bytes','prior_bundle_bytes')}
    kwargs['now']='2026-02-01T00:00:00Z'
    return body,raw,receipt,kwargs


def test_full_bytes_receipt_source_and_goal_retained(fixture):
    body,raw,receipt,kwargs=fixture
    result=module.adjudicate_frozen_http(body,raw,**kwargs)
    assert result['status']=='verified_statistical_overlay'
    assert base64.b64decode(result['source_http_body_base64'])==body
    assert base64.b64decode(result['source_receipt_base64'])==raw
    assert result['source_observation']['freeze_transport_receipt']==json.loads(raw)
    assert result['source_observation']['status']=='quarantined'
    assert result['source_observation']['prepared'][1][0]['is_goal'] is True
    assert result['source_observation']['prepared'][1][0]['x_raw']==80
    overlay=result['event_overlays'][0]
    assert overlay['goal_credit']==1 and overlay['recorded_sog_contribution']==0
    assert overlay['base_shot_model_attempt_eligible'] is False
    assert overlay['probability_interpretation']=='no_probability_assigned'
    assert not result['feature_export_activated'] and not result['production_activated']
    assert result==module.adjudicate_frozen_http(body,raw,**kwargs)


@pytest.mark.parametrize('kind',['body_format','receipt_format','new_timestamp','new_event'])
def test_new_exact_http_revision_requires_its_own_approval(fixture,kind):
    body,raw,receipt,kwargs=fixture
    if kind=='body_format':
        body+=b' ';receipt['body_bytes']=len(body);receipt['body_sha256']=module.sha(body);raw=encode(receipt)
    elif kind=='receipt_format':raw+=b' '
    elif kind=='new_timestamp':receipt['observed_at']='2026-01-02T00:00:00Z';raw=encode(receipt)
    else:
        p=json.loads(body);p['plays'][0]['details']['xCoord']=81;body=encode(p)
        receipt.update(body_bytes=len(body),body_sha256=module.sha(body),source_payload_sha256=fingerprint(p),normalization=normalize_pbp(p))
        raw=encode(receipt)
    result=module.adjudicate_frozen_http(body,raw,**kwargs)
    assert result['status']=='quarantined' and result['reason']=='unapproved_http_revision'
    assert result['event_overlays']==[]


@pytest.mark.parametrize('kind',['hash','normalization','gate','future'])
def test_incomplete_or_invalid_new_source_fails_closed(fixture,kind):
    body,raw,receipt,kwargs=fixture
    if kind=='hash':receipt['body_sha256']='bad'
    elif kind=='normalization':receipt['normalization']['events'][0]['x_raw']=0
    elif kind=='gate':receipt['final_game_evidence']['status']='verified'
    else:receipt['observed_at']='2027-01-01T00:00:00Z'
    with pytest.raises(ValueError):module.adjudicate_frozen_http(body,encode(receipt),**kwargs)


def test_unapproved_new_manifest_bytes_refused_after_old_approval_validation(monkeypatch):
    monkeypatch.setattr(module.prior,'validate_approval',lambda *args:{'records':[]})
    with pytest.raises(ValueError,match='Unapproved HTTP'):
        module.validate_http_approval(http_manifest_bytes=b'edited',revision_review_bytes=b'edited',
                                      prior_manifest_bytes=b'old',prior_bundle_bytes=b'old')

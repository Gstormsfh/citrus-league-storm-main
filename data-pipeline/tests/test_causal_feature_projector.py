import hashlib
import json
from copy import deepcopy
from pathlib import Path

import pytest
from acquisition.canonical_events import normalize_pbp
from monitoring.final_game_evidence import verify_final_game
from projections.analytics_publication import fingerprint
from projections.causal_feature_contract import build_causal_input_contract
from projections.causal_feature_projector import project_causal_features
from projections.frozen_feature_source import adapt_frozen_feature_source

NOW = '2026-09-06T10:00:00Z'


def payload():
    events = []
    for i, (code, clock) in enumerate([(520, '00:00'), (502, '00:10'), (505, '00:12'), (506, '00:14')]):
        events.append({'eventId': i+1, 'sortOrder': i, 'typeCode': code,
                       'periodDescriptor': {'number': 1, 'periodType': 'REG'}, 'timeInPeriod': clock,
                       'homeTeamDefendingSide': 'left', 'situationCode': '1551',
                       'details': {'eventOwnerTeamId': 1, 'xCoord': 0, 'yCoord': 0, 'shotType': 'wrist'}})
    return {'id': 2024020001, 'gameDate': '2025-01-01', 'season': 20242025, 'gameType': 2,
            'gameState': 'OFF', 'homeTeam': {'id': 1, 'score': 1, 'sog': 2},
            'awayTeam': {'id': 2, 'score': 0, 'sog': 0},
            'periodDescriptor': {'number': 3, 'periodType': 'REG'}, 'plays': events}


def pair(p):
    raw = json.dumps(p, indent=2).encode()
    url = f'https://api-web.nhle.com/v1/gamecenter/{p["id"]}/play-by-play'
    n, f = normalize_pbp(p), verify_final_game(p)
    r = {'game_id': p['id'], 'url': url, 'response_url': url, 'http_status': 200,
         'requested_at': '2026-09-06T05:00:00+00:00', 'observed_at': '2026-09-06T05:00:01+00:00',
         'body_sha256': hashlib.sha256(raw).hexdigest(), 'body_bytes': len(raw),
         'body_file': f'{p["id"]}.body.json', 'source_payload_sha256': fingerprint(p),
         'byte_contract': 'requests-content-after-decompression-not-wire-bytes', 'historical_as_of_verified': False,
         'schedule_identity': {'date': p['gameDate'], 'home_team_id': 1, 'away_team_id': 2,
                               'game_type': 2, 'game_state': 'OFF', 'schedule_state': 'OK'},
         'normalization': n, 'final_game_evidence': f,
         'status': 'verified' if n['complete'] and f['status'] == 'verified' else 'quarantined'}
    return raw, json.loads(json.dumps(r))


def project(p=None, exclusions=None):
    raw, r = pair(payload() if p is None else p)
    adapted = adapt_frozen_feature_source(raw, r, now=NOW)
    staged = build_causal_input_contract(adapted, evidence_kind='synthetic', exclusions=exclusions or [], now=NOW)
    return project_causal_features(staged, now=NOW)


def test_raw_zero_geometry_prior_score_and_excluded_goals_count():
    output = project(exclusions=[{'event_id': 3, 'reason': 'feature_unavailable'}])
    first, second = [x['features'] for x in output['rows']]
    assert first['x_raw']['value'] == 0 and first['distance_to_goal_ft']['value'] == 89
    assert first['signed_angle_deg']['value'] == 0
    assert first['score_differential_pre_shot']['value'] == 0
    assert second['score_differential_pre_shot']['value'] == 1
    assert second['event_location_change_ft_per_second']['value'] is None  # prior goal breaks motion
    assert output['rows'][0]['excluded_reason'] == 'feature_unavailable'
    assert not output['training_ready'] and not output['publishable']
    assert 'shooting_talent' in output['family_catalog']


@pytest.mark.parametrize('side,owner,x,y,expected', [('left',1,70,10,(70,10)),('right',1,-70,-10,(70,10)),
    ('left',2,-70,-10,(70,10)),('right',2,70,10,(70,10))])
def test_explicit_tandem_orientation(side,owner,x,y,expected):
    p = payload(); p['plays'][3]['homeTeamDefendingSide'] = side
    p['plays'][3]['details'].update(eventOwnerTeamId=owner,xCoord=x,yCoord=y)
    if owner == 2: p['homeTeam']['sog']-=1;p['awayTeam']['sog']+=1
    f=project(p)['rows'][1]['features']
    assert (f['x_attacking']['value'],f['y_attacking']['value']) == expected


@pytest.mark.parametrize('code,owner,expected', [('0651',1,(5,6,False,True)),('1560',1,(6,5,True,False)),
    ('1541',2,(5,4,False,False)),('1451',1,(5,4,False,False))])
def test_situation_digits_shooting_perspective(code,owner,expected):
    p=payload();p['plays'][3]['situationCode']=code;p['plays'][3]['details']['eventOwnerTeamId']=owner
    if owner==2:p['homeTeam']['sog']-=1;p['awayTeam']['sog']+=1
    f=project(p)['rows'][1]['features']
    assert tuple(f[k]['value'] for k in ('shooting_skaters','defending_skaters','shooting_empty_net','defending_empty_net'))==expected
    assert f['is_power_play']['value'] is None


@pytest.mark.parametrize('code', [None,1551,'551','2551','1552','1991','1661','1111','５５５５'])
def test_invalid_strength_is_unknown(code):
    p=payload();p['plays'][3]['situationCode']=code
    assert project(p)['rows'][1]['features']['shooting_skaters']['value'] is None


@pytest.mark.parametrize('change', ['missing_side','missing_coord','boundary','missing_prior','same_clock','new_period'])
def test_motion_does_not_bridge_or_impute(change):
    p=payload()
    if change=='missing_side':p['plays'][2].pop('homeTeamDefendingSide')
    elif change=='missing_coord':p['plays'][1]['details'].pop('xCoord')
    elif change=='boundary':p['plays'][1]['typeCode']=516
    elif change=='missing_prior':p['plays'][1]['details'].pop('yCoord')
    elif change=='same_clock':p['plays'][2]['timeInPeriod']='00:10'
    else:p['plays'][2]['periodDescriptor']={'number':2,'periodType':'REG'};p['plays'][3]['periodDescriptor']={'number':2,'periodType':'REG'}
    assert project(p)['rows'][0]['features']['event_location_change_ft_per_second']['value'] is None


def test_future_and_current_outcome_isolation_no_current_score_fields():
    original=payload();before=project(original)
    modified=deepcopy(original);modified['plays'][2]['typeCode']=506;modified['homeTeam']['score']=0
    modified['plays'][2]['details'].update(homeScore=999,assist1PlayerId=999)
    modified['plays'][3]['details']['xCoord']=80
    after=project(modified)
    assert before['rows'][0]['features']==after['rows'][0]['features']
    assert before['rows'][0]['retrospective_labels']!=after['rows'][0]['retrospective_labels']
    assert before['projector_sha256']!=after['projector_sha256']


def test_frozen_adapter_preserves_original_observation_and_bytes_binding():
    raw,r=pair(payload());before=deepcopy(r)
    a=adapt_frozen_feature_source(raw,r,now=NOW)
    assert a['observed_at']==r['observed_at'] and a['freeze_transport_receipt']==r
    assert a['source_body_sha256']==hashlib.sha256(raw).hexdigest() and r==before
    with pytest.raises(ValueError):adapt_frozen_feature_source(raw+b' ',r,now=NOW)
    staged=build_causal_input_contract(a,evidence_kind='synthetic',exclusions=[],now=NOW)
    staged['rows'][0]['at_shot_annotations']['x_raw']['value']=12
    with pytest.raises(ValueError):project_causal_features(staged,now=NOW)


@pytest.mark.parametrize('key,value', [('url','https://example.invalid'),('body_file','../other.json'),('body_bytes',True),
    ('status','verified-bypass'),('observed_at','2099-01-01T00:00:00Z'),('requested_at','2026-09-06T05:00:02Z'),
    ('historical_as_of_verified',True),('http_status',201)])
def test_frozen_transport_rejects_detachment(key,value):
    raw,r=pair(payload());r[key]=value
    with pytest.raises(ValueError):adapt_frozen_feature_source(raw,r,now=NOW)


def test_pinned_real_historical_freeze_withholds_nonmonotone_source():
    folder=Path(__file__).resolve().parents[2]/'scripts/proof/results/historical-official-freeze-20260906/2017/pbp'
    path=folder/'2017020001.receipt.json'
    if not path.exists():pytest.skip('Optional immutable local historical proof not present')
    raw=(folder/'2017020001.body.json').read_bytes();r=json.loads(path.read_text())
    assert hashlib.sha256(raw).hexdigest()=='b55a08dd776d332f13ed732dba86e343fbad3049b974ab388bf214cd48ef8534'
    source=adapt_frozen_feature_source(raw,r,now=NOW)
    staged=build_causal_input_contract(source,evidence_kind='real',exclusions=[],now=NOW)
    result=project_causal_features(staged,now=NOW)
    assert result['status']=='unavailable' and result['rows']==[]
    assert staged['source_gate']['reason']=='nonmonotone_full_stream_order_or_clock'


def test_pinned_real_modern_receipt_feature_availability():
    path=Path('/private/tmp/citrus-official-observations-20260906-0211/2025020014.json')
    if not path.exists():pytest.skip('Optional immutable local modern proof not present')
    source=json.loads(path.read_text())
    assert fingerprint(source)=='03da3f10da812f8b4906248ef131e39e95aa886b2db08b8ee17e8397f4c28feb'
    staged=build_causal_input_contract(source,evidence_kind='real',exclusions=[],now=NOW)
    result=project_causal_features(staged,now=NOW)
    assert len(result['rows'])==86
    assert result['availability']['distance_to_goal_ft']=={'available':86,'unavailable':0}
    assert result['availability']['score_differential_pre_shot']=={'available':86,'unavailable':0}
    assert result['availability']['event_location_change_ft_per_second']=={'available':83,'unavailable':3}
    assert result['availability']['is_power_play']=={'available':0,'unavailable':86}
    assert not result['training_ready']

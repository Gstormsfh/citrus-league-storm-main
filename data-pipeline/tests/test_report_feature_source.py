"""Synthetic report/source pairs plus optional separately frozen official proofs."""
from copy import deepcopy
from pathlib import Path
import hashlib
import json

import pytest
from acquisition.canonical_events import normalize_pbp
from acquisition.event_observation_service import prepare_observation
from acquisition import collect_feature_reports as collector
from monitoring.final_game_evidence import verify_final_game
from projections.analytics_publication import fingerprint
from projections.report_feature_source import (adapt_report_document_capture, build_report_feature_source,
                                               parse_report, report_url)

NOW='2026-09-06T10:00:00Z'
GID=2024020001


def fixture():
    plays=[]
    for i,(code,clock) in enumerate([(520,'00:00'),(505,'00:20'),(506,'00:10'),(524,'20:00')]):
        plays.append({'eventId':i+1,'sortOrder':i,'typeCode':code,'timeInPeriod':clock,
                      'periodDescriptor':{'number':1,'periodType':'REG'},
                      'details':{'eventOwnerTeamId':1,'scoringPlayerId':10,'shootingPlayerId':10,
                                 'xCoord':79,'yCoord':0,'shotType':'wrist'}})
    p={'id':GID,'gameDate':'2025-01-01','season':20242025,'gameType':2,'gameState':'OFF',
       'homeTeam':{'id':1,'abbrev':'AAA','score':1,'sog':2},'awayTeam':{'id':2,'abbrev':'BBB','score':0,'sog':0},
       'periodDescriptor':{'number':3,'periodType':'REG'},'plays':plays,
       'rosterSpots':[{'teamId':1,'playerId':10,'sweaterNumber':1}]}
    text='<table><tr><td>Play By Play Wednesday, January 1, 2025 Game 0001 Final BBB On Ice AAA On Ice</td></tr>'
    for n,clock,kind,desc in [(1,'0:00','PSTR','Period Start'),(2,'0:10','SHOT','AAA ONGOAL - #1 PLAYER, Wrist, Off. Zone, 10 ft.'),
                               (3,'0:20','GOAL','AAA #1 PLAYER(1), Wrist, Off. Zone, 10 ft.'),(4,'20:00','GEND','Game End')]:
        text+='<tr class="evenColor">'+''.join(f'<td>{x}</td>' for x in (n,1,'EV',clock+'<br>0:00',kind,desc))+'</tr>'
    body=(text+'</table>').encode()
    observed='2026-09-06T05:00:01+00:00'
    pbp={'game_id':GID,'observed_at':observed,'status':'complete',
         'url':f'https://api-web.nhle.com/v1/gamecenter/{GID}/play-by-play','prepared':list(prepare_observation(p,observed))}
    receipt={'game_id':GID,'url':report_url(GID),'response_url':report_url(GID),'http_status':200,
             'body_bytes':len(body),'body_sha256':hashlib.sha256(body).hexdigest(),'requested_at':'2026-09-06T05:00:00Z',
             'observed_at':observed,'historical_as_of_verified':False,
             'byte_contract':'requests-content-after-decompression-not-wire-bytes','timing_semantics':'per-response'}
    return p,pbp,body,receipt


def test_report_chronology_not_json_sort_and_no_orientation_acceptance():
    p,pbp,body,r=fixture();before=deepcopy(pbp)
    out=build_report_feature_source(pbp,body,r,now=NOW)
    assert out['attempt_population_matched'] and out['gameplay_type_counts_match']
    assert [e['event_id'] for e in out['features_in_report_order']]==[3,2]
    assert [e['raw_sort_order'] for e in out['features_in_report_order']]==[2,1]
    assert all(e['reported_distance_ft']==10 for e in out['features_in_report_order'])
    assert all(e['report_pre_shot_score_differential']==0 for e in out['features_in_report_order'])
    assert out['features_in_report_order'][0]['coordinate_distance_diagnostic']['semantics']=='diagnostic_not_orientation_acceptance'
    assert out['source_receipt']==before and pbp==before
    assert not out['training_ready'] and not out['publishable'] and 'shooting_talent' in out['preserved_family_catalog']


@pytest.mark.parametrize('change', ['team','date','game','final','missing_row','backward_clock','missing_end'])
def test_malformed_report_identity_or_inventory_rejected(change):
    p,pbp,body,r=fixture()
    replacements={'team':(b'AAA On Ice',b'CCC On Ice'),'date':(b'January 1',b'January 2'),
                  'game':(b'Game 0001',b'Game 0002'),'final':(b'Final',b'In Progress'),
                  'missing_row':(b'<td>2</td>',b'<td>8</td>'),'backward_clock':(b'0:20',b'0:05'),
                  'missing_end':(b'GEND',b'STOP')}
    a,b=replacements[change];body=body.replace(a,b)
    with pytest.raises(ValueError):parse_report(body,game_id=GID,game_date=p['gameDate'],away_abbrev='BBB',home_abbrev='AAA')


@pytest.mark.parametrize('key,value',[('body_sha256','x'),('http_status',True),('observed_at','2099-01-01T00:00:00Z'),
                                     ('requested_at','2026-09-06T05:01:00Z'),('timing_semantics','invented')])
def test_transport_rejected(key,value):
    _,pbp,body,r=fixture();r[key]=value
    with pytest.raises(ValueError):build_report_feature_source(pbp,body,r,now=NOW)


def test_missing_actor_and_distance_conflict_not_force_matched_or_repaired():
    p,pbp,body,r=fixture();p['rosterSpots']=[];pbp['prepared']=list(prepare_observation(p,pbp['observed_at']))
    out=build_report_feature_source(pbp,body,r,now=NOW)
    assert not out['attempt_population_matched'] and not out['features_in_report_order']
    assert len(out['unresolved_identities'])==2
    p,pbp,body,r=fixture();p['plays'][2]['details']['xCoord']=0
    pbp['prepared']=list(prepare_observation(p,pbp['observed_at']))
    out=build_report_feature_source(pbp,body,r,now=NOW)
    first=out['features_in_report_order'][0]
    assert first['reported_distance_ft']==10 and first['coordinate_distance_diagnostic']['net'] is None


def freeze_fixture(tmp_path):
    p,pbp,body,report_receipt=fixture();source=tmp_path/'source';folder=source/'2024/pbp';folder.mkdir(parents=True)
    expected={'date':p['gameDate'],'game_type':2,'home_team_id':1,'away_team_id':2,'game_state':'OFF','schedule_state':'OK'}
    raw=json.dumps(p).encode();r={'game_id':GID,'url':pbp['url'],'response_url':pbp['url'],'http_status':200,
      'body_bytes':len(raw),'body_sha256':hashlib.sha256(raw).hexdigest(),'body_file':f'{GID}.body.json',
      'source_payload_sha256':fingerprint(p),'requested_at':'2026-09-06T05:00:00Z','observed_at':pbp['observed_at'],
      'byte_contract':'requests-content-after-decompression-not-wire-bytes','historical_as_of_verified':False,
      'normalization':normalize_pbp(p),'final_game_evidence':verify_final_game(p),'status':'verified','schedule_identity':expected}
    (folder/f'{GID}.body.json').write_bytes(raw);(folder/f'{GID}.receipt.json').write_text(json.dumps(r))
    (source/'schedule-manifest.json').write_text(json.dumps({'2024':{'season':2024,'terminal_game_ids':[GID],'games':{str(GID):expected}}}))
    return source,body


class Response:
    status_code=200;url=report_url(GID)
    def __init__(self,body):self.body=body;self.closed=False
    def iter_content(self,chunk_size):yield self.body
    def close(self):self.closed=True


def test_collector_create_only_one_request_and_capture_binding(tmp_path):
    source,body=freeze_fixture(tmp_path);calls=[];response=Response(body)
    def request(url,**kwargs):calls.append((url,kwargs));return response
    output=tmp_path/'reports'
    out=collector.collect_reports(source,output,[2024],max_games=1,request=request,sleep=lambda _:None)
    assert out['status']=='collection_complete_not_model_acceptance' and len(calls)==1 and response.closed
    assert calls[0][1]['allow_redirects'] is False and calls[0][1]['stream'] is True
    assert (output/f'{GID}-PL.HTM').read_bytes()==body
    r=json.loads((output/f'{GID}.receipt.json').read_text())
    assert r['body_sha256']==hashlib.sha256(body).hexdigest() and r['pbp_observed_at']=='2026-09-06T05:00:01+00:00'
    with pytest.raises(FileExistsError):collector.collect_reports(source,output,[2024],max_games=1,request=request,sleep=lambda _:None)
    assert len(calls)==1


@pytest.mark.parametrize('failure',['http','redirect','oversize','request','health_disk'])
def test_collector_failure_no_retry_and_non_success_health(tmp_path,monkeypatch,capsys,failure):
    source,body=freeze_fixture(tmp_path);calls=[];response=Response(body)
    if failure=='http':response.status_code=500
    if failure=='redirect':response.url='https://example.invalid/report'
    if failure=='oversize':response.body=body+b' '*2000
    def request(*args,**kwargs):
        calls.append(1)
        if failure=='request':raise RuntimeError('DO_NOT_DISCLOSE_TEST_SECRET')
        return response
    if failure=='health_disk':
        original=collector._write
        def write(path,value):
            if path.name=='health.json':raise OSError('disk unavailable')
            return original(path,value)
        monkeypatch.setattr(collector,'_write',write)
    out=collector.collect_reports(source,tmp_path/'reports',[2024],max_games=1,request=request,
                                  max_body_bytes=1000 if failure=='oversize' else 4000000,sleep=lambda _:None)
    assert out['status']=='incomplete' and len(calls)==1
    printed=capsys.readouterr().out
    assert 'feature_report.health' in printed and 'DO_NOT_DISCLOSE_TEST_SECRET' not in printed
    assert 'DO_NOT_DISCLOSE_TEST_SECRET' not in ''.join(p.read_text() for p in (tmp_path/'reports').glob('*.json'))
    if failure=='oversize':assert (tmp_path/'reports'/f'{GID}-PL.HTM').stat().st_size==1000


@pytest.mark.parametrize('target',['body','receipt','manifest','inventory'])
def test_collector_end_of_run_detects_source_inventory_drift(tmp_path,target):
    source,body=freeze_fixture(tmp_path);output=tmp_path/'reports'
    def sleep(_):
        path={'body':source/f'2024/pbp/{GID}.body.json','receipt':source/f'2024/pbp/{GID}.receipt.json',
              'manifest':source/'schedule-manifest.json','inventory':output/'request-inventory.json'}[target]
        path.write_bytes(path.read_bytes()+b' ')
    out=collector.collect_reports(source,output,[2024],max_games=1,request=lambda *a,**k:Response(body),sleep=sleep)
    assert out['status']=='incomplete' and out['reason']=='collection_incomplete_or_source_drift'


@pytest.mark.parametrize('seasons,max_games,ids',[([],1,None),([2024,2024],1,None),([True],1,None),([2024],0,None),([2024],1,[2024020002])])
def test_collector_selection_fails_before_requests(tmp_path,seasons,max_games,ids):
    source,_=freeze_fixture(tmp_path)
    with pytest.raises((ValueError,KeyError)):collector.select_inventory(source,seasons,max_games=max_games,game_ids=ids)


@pytest.mark.parametrize('gid,attempts,unresolved',[(2017020001,86,0),(2018020001,96,2)])
def test_pinned_official_reports_match_retrospectively_without_raw_reordering(gid,attempts,unresolved):
    folder=Path(__file__).resolve().parents[2]/'scripts/proof/results/historical-report-samples-20260906'
    pbp_path=Path(f'/private/tmp/citrus-nhl-archive-current-samples-20260906-0420/{gid}.json')
    if not (folder/f'{gid}-PL.HTM').exists() or not pbp_path.exists():pytest.skip('Optional immutable official proof artifacts absent')
    body=(folder/f'{gid}-PL.HTM').read_bytes();manifest=json.loads((folder/'receipt.json').read_text())
    receipt=adapt_report_document_capture(body,manifest,game_id=gid)
    assert receipt['timing_semantics']=='bounded-document-window'
    out=build_report_feature_source(json.loads(pbp_path.read_text()),body,receipt,now=NOW)
    assert out['attempt_population_matched'] and out['gameplay_type_counts_match']
    assert len(out['features_in_report_order'])==attempts and len(out['unresolved_identities'])==unresolved
    assert all(r['reported_distance_ft'] is not None for r in out['features_in_report_order'])
    assert sum(r['coordinate_distance_diagnostic']['net'] is not None for r in out['features_in_report_order'])==86

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
from projections import compact_feature_export as export

NOW='2026-09-06T10:00:00Z'
WINDOWS={'train':{'start':'2019-07-01','end':'2024-06-30'},
         'calibration':{'start':'2024-07-01','end':'2025-06-30'},
         'test':{'start':'2025-07-01','end':'2026-08-31'}}


def fixture(gid=2024020001, day='2025-01-01'):
    plays=[]
    for i,(code,clock) in enumerate([(520,'00:00'),(502,'00:10'),(505,'00:12'),(506,'00:14')]):
        plays.append({'eventId':i+1,'sortOrder':i,'typeCode':code,'timeInPeriod':clock,
                      'periodDescriptor':{'number':1,'periodType':'REG'},
                      'homeTeamDefendingSide':'left','situationCode':'1551',
                      'details':{'eventOwnerTeamId':1,'xCoord':0,'yCoord':0,'shotType':'wrist'}})
    return {'id':gid,'gameDate':day,'season':(gid//1000000)*10000+gid//1000000+1,
            'gameType':2,'gameState':'OFF','homeTeam':{'id':1,'score':1,'sog':2},
            'awayTeam':{'id':2,'score':0,'sog':0},'periodDescriptor':{'number':3,'periodType':'REG'},'plays':plays}


def pair(p):
    raw=json.dumps(p,indent=2).encode();gid=p['id']
    url=f'https://api-web.nhle.com/v1/gamecenter/{gid}/play-by-play'
    n,f=normalize_pbp(p),verify_final_game(p)
    r={'game_id':gid,'url':url,'response_url':url,'http_status':200,
       'requested_at':'2026-09-06T05:00:00Z','observed_at':'2026-09-06T05:00:01Z',
       'body_sha256':hashlib.sha256(raw).hexdigest(),'body_bytes':len(raw),'body_file':f'{gid}.body.json',
       'source_payload_sha256':fingerprint(p),'byte_contract':'requests-content-after-decompression-not-wire-bytes',
       'historical_as_of_verified':False,'schedule_identity':{'date':p['gameDate'],'home_team_id':1,
       'away_team_id':2,'game_type':2,'game_state':'OFF','schedule_state':'OK'},
       'normalization':n,'final_game_evidence':f,'status':'verified' if n['complete'] and f['status']=='verified' else 'quarantined'}
    return raw,json.loads(json.dumps(r))


def project(p):
    raw,r=pair(p);source=adapt_frozen_feature_source(raw,r,now=NOW)
    return export.project_compact_game(source,evidence_kind='synthetic',windows=WINDOWS,now=NOW),source


def test_exact_audit_arithmetic_and_zero_and_full_inventory():
    compact,source=project(fixture());before=deepcopy(source)
    audit=project_causal_features(build_causal_input_contract(source,evidence_kind='synthetic',exclusions=[],now=NOW),now=NOW)
    for a,b in zip(compact['rows'],audit['rows']):
        assert a['features']=={k:b['features'][k]['value'] for k in export.FEATURES}
        assert a['feature_sha']==fingerprint({k:v for k,v in a.items() if k!='feature_sha'})
    assert compact['rows'][0]['features']['distance_to_goal_ft']==89
    assert compact['rows'][0]['coordinates']['x_raw']['value']==0
    assert compact['rows'][1]['features']['score_differential_pre_shot']==1
    assert len(compact['game_inventory']['stream_inventory'])==4 and source==before


def test_no_current_outcome_or_future_leakage_and_no_context_overfilter():
    p=fixture();first,_=project(p)
    p['plays'][2]['typeCode']=506;p['homeTeam']['score']=0
    p['plays'][2]['details'].update(homeScore=999,assist1PlayerId=999)
    p['plays'][3]['details']['xCoord']=80
    second,_=project(p)
    assert first['rows'][0]['features']==second['rows'][0]['features']
    p['plays'][2]['situationCode']=None
    third,_=project(p)
    assert third['rows'][0]['cohort_eligibility']=={'geometry_baseline':True,'full_context_matched':False}
    assert third['rows'][0]['features']['shooting_skaters'] is None


def test_source_order_rejection_retains_all_events_and_labels():
    p=fixture();p['plays'][3]['timeInPeriod']='00:01'
    result,_=project(p)
    assert not result['rows'] and result['game_inventory']['source_excluded_game']
    assert len(result['game_inventory']['stream_inventory'])==4
    assert result['game_inventory']['stream_inventory'][2]['retrospective_label'] is True


def test_linear_helper_receives_only_immediate_prior(monkeypatch):
    original=export.project_row_features;lengths=[]
    def checked(row,*args,**kwargs):
        lengths.append(len(row['strict_prior_context']))
        assert kwargs['score_state'] is not None
        return original(row,*args,**kwargs)
    monkeypatch.setattr(export,'project_row_features',checked)
    project(fixture());assert lengths==[1,1]


def freeze(tmp_path):
    root=tmp_path/'freeze';root.mkdir();schedule={}
    for gid,day in [(2023020001,'2024-01-01'),(2024020001,'2025-01-01'),(2025020001,'2026-01-01')]:
        raw,r=pair(fixture(gid,day));season=gid//1000000
        folder=root/str(season)/'pbp';folder.mkdir(parents=True)
        (folder/f'{gid}.body.json').write_bytes(raw)
        (folder/f'{gid}.receipt.json').write_text(json.dumps(r))
        schedule[str(season)]={'season':season,'window_complete':True,'reported_season_within_window':True,
          'unresolved_game_ids':[],'terminal_game_ids':[gid],'games':{str(gid):r['schedule_identity']}}
    (root/'schedule-manifest.json').write_text(json.dumps(schedule))
    return root


def run(root,out):
    return export.export_compact_features(root,out,seasons=[2023,2024,2025],windows=WINDOWS,max_games=3)


def test_create_only_split_files_inventory_and_all_hashes(tmp_path):
    root=freeze(tmp_path);out=tmp_path/'export';summary=run(root,out)
    assert summary['status']=='export_complete_not_fit_accepted'
    assert not summary['training_ready'] and not summary['publishable']
    assert summary['counts']['candidate_rows']==6
    assert summary['manifest_content_sha256']==fingerprint({k:v for k,v in summary.items() if k!='manifest_content_sha256'})
    for name,meta in summary['output_files'].items():
        body=(out/name).read_bytes()
        assert hashlib.sha256(body).hexdigest()==meta['sha256'] and len(body)==meta['bytes']
        assert len(body.splitlines())==meta['rows']
    for split in ('train','calibration','test'):
        rows=[json.loads(x) for x in (out/export.FEATURE_FILES[split]).read_text().splitlines()]
        games=[json.loads(x) for x in (out/export.INVENTORY_FILES[split]).read_text().splitlines()]
        assert len(rows)==2 and len(games)==1 and {r['split'] for r in rows+games}=={split}
    with pytest.raises(FileExistsError):run(root,out)


def test_missing_source_incomplete_explicit_inventory(tmp_path):
    root=freeze(tmp_path);(root/'2024/pbp/2024020001.body.json').unlink()
    out=tmp_path/'export';summary=run(root,out)
    assert summary['status']=='incomplete' and summary['source_failure_games']==[2024020001]
    game=json.loads((out/'calibration.game-inventory.jsonl').read_text())
    assert not game['inventory_complete'] and game['source_reason']=='source_pair_validation_failure'


def test_source_drift_fails_without_replacing_originals(tmp_path,monkeypatch):
    root=freeze(tmp_path);out=tmp_path/'export';original=export.project_compact_game
    def changing(*args,**kwargs):
        result=original(*args,**kwargs)
        if result['game_inventory']['game_id']==2025020001:
            p=root/'2023/pbp/2023020001.body.json';p.write_bytes(p.read_bytes()+b' ')
        return result
    monkeypatch.setattr(export,'project_compact_game',changing)
    result=run(root,out)
    assert result['status']=='incomplete' and result['reason']=='export_incomplete_or_source_drift'
    assert result['counts']['games']==3


def test_persistence_failure_stdout_sanitized(tmp_path,monkeypatch,capsys):
    root=freeze(tmp_path);out=tmp_path/'export';original=Path.open
    def denied(path,*args,**kwargs):
        if path.name=='export-manifest.json':raise OSError('secret should not be reported')
        return original(path,*args,**kwargs)
    monkeypatch.setattr(Path,'open',denied)
    result=run(root,out)
    assert result['status']=='incomplete' and result['manifest_persistence_error']=='OSError'
    assert 'secret' not in capsys.readouterr().out
    assert result['manifest_content_sha256']==fingerprint({k:v for k,v in result.items() if k!='manifest_content_sha256'})


def test_outside_window_retained_not_eligible():
    p=fixture(2018020001,'2019-01-01');result,_=project(p)
    assert len(result['rows'])==2 and result['game_inventory']['split']=='outside_windows'
    assert all(not row['cohort_eligibility']['geometry_baseline'] for row in result['rows'])
    assert result['rows'][0]['cohort_exclusions']['geometry_baseline']==['outside_declared_windows']


@pytest.mark.parametrize('change',['overlap','missing','unknown','boolean'])
def test_strict_windows(change):
    windows=deepcopy(WINDOWS)
    if change=='overlap':windows['test']['start']='2025-06-30'
    elif change=='missing':del windows['test']
    elif change=='unknown':windows['train']['extra']=1
    else:windows['train']['start']=True
    with pytest.raises((ValueError,TypeError)):export.validate_windows(windows)
